#!/usr/bin/env python3
"""4차 지오코딩 — **Wikidata**(1~3차는 전부 Nominatim).

왜 출처를 바꿨나: 1~3차는 질의 방식만 바꿔 가며 Nominatim 을 세 번 두드렸고 175개가 남았다.
남은 것들이 무명 대상이라서가 아니었다 — "우마이야 모스크"(다마스쿠스 대모스크)를 실측해 보면
Nominatim 은 **요르단 암만의 동명 모스크**를 1순위로 돌려준다. 거리 검증이 이를 올바르게 걸러내
미해결로 남은 것이다. 즉 파이프라인이 아니라 **데이터 출처**가 한계였다.

Wikidata 는 (1) 한국어 라벨을 갖고 있어 한글 이름으로 바로 찾히고, (2) P625(좌표)가 개체에
직접 붙어 있어 지명 검색의 동명이의 문제를 겪지 않는다. 같은 예시가 Q183562 로 즉시 해결된다.

검증은 1~3차와 같은 규칙을 쓴다 — 도시 중심에서 대도시 100km / 그 외 60km. 출처가 달라져도
"엉뚱한 도시의 동명 대상"을 받아들이지 않는다는 계약은 유지한다.

⚠ **1차 수단이 아니다.** 이 스크립트를 쓰고 나서 더 나은 길을 찾았다 — 좌표가 필요한 진짜 이유는
결국 그 OSM 피처를 찾기 위해서인데, 우리는 도시를 구울 때 **그 도시의 OSM 추출을 이미 갖고 있다**.
추출 안에서 이름으로 바로 찾으면 좌표라는 중간 단계가 사라지고, 네트워크·레이트리밋도 없다
(scripts/osm.mjs buildNameIndex/matchCuratedByName — build-maps 가 좌표 없는 항목에 자동 적용).
실측: 교토 4/4·바라나시 2/2·카이로 1/1 이 로컬 이름 매칭으로 해결됐다.

그래서 이 스크립트는 **로컬 매칭도 실패한 잔여분**(외래어 표기가 OSM 과 다른 경우 — 예: "Appian Way"
vs OSM "Via Appia Antica")을 위한 보조 수단이다. Wikidata 는 다국어 라벨을 갖고 있어 이 간극을
메울 수 있다. 다만 익명 API 레이트리밋이 빡빡해(1.5s 간격에도 429 빈발, Retry-After 40s대)
175개 전량 조회는 2시간+ 가 걸린다 — 소수 잔여분에만 쓸 것.

실행: python3 scripts/data/geocode-wikidata.py [--dry-run] [--limit N]
산출: landmark-catalog.json 갱신(해결분만) + scripts/data/geocode-wikidata-log.jsonl
"""
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request

CATALOG = "scripts/data/landmark-catalog.json"
CITY_CACHE = "scripts/data/geocode-city-cache.json"
LOG = "scripts/data/geocode-wikidata-log.jsonl"
UA = "OrbitHera-LandmarkCatalog-Research/1.0 (non-commercial hobby game project; landmark coordinate research)"
API = "https://www.wikidata.org/w/api.php"

# 1~3차와 동일한 거리 검증 반경(오매칭 차단). 대도시는 외곽 랜드마크가 멀어 100km.
BIG_CITIES = {
    "이스탄불", "바그다드", "카이로", "델리", "시안", "뤄양", "베이징", "방콕", "멕시코시티",
    "아디스아바바", "뉴욕", "파리", "리우데자네이루", "뭄바이", "상하이", "시드니", "마드리드",
    "베를린", "홍콩", "카사블랑카", "도쿄", "나고야", "삿포로", "타이베이", "가오슝", "마닐라",
    "자카르타", "호치민", "브리즈번", "밴쿠버", "시애틀", "샌프란시스코", "리마", "로스앤젤레스",
    "시카고", "토론토", "산티아고", "보고타", "리야드", "나이로비", "라고스", "요하네스버그",
    "케이프타운", "다카", "라호르", "청두", "우한", "선전", "멜버른", "상트페테르부르크", "런던",
    "몬트리올", "두바이", "부산", "오클랜드", "부에노스아이레스", "마이애미", "서울", "오사카",
}

_last = [0.0]
MIN_GAP = 1.5  # 초 — 0.34s 로 시작했다가 429 를 연발했다. 1.1s 도 잦아 1.5s 로 올렸다.

class RateLimited(Exception):
    pass

def get(params, tries=4):
    """Wikidata API GET.

    ⚠ **예외를 삼켜 '결과 없음'으로 취급하면 안 된다** — 처음에 그렇게 짰다가 429(요청 과다)가
    전부 not-found 로 기록돼, 스로틀링이 '위키데이터에 없는 대상'처럼 보였다(스핑크스가 미발견으로
    찍혔다). 429 는 백오프 후 재시도하고, 끝내 실패하면 **오류로 올린다**.
    """
    for attempt in range(tries):
        dt = time.time() - _last[0]
        if dt < MIN_GAP:
            time.sleep(MIN_GAP - dt)
        _last[0] = time.time()
        url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = float(e.headers.get("Retry-After") or 0) or (2 ** attempt) * 5
                print(f"    429 — {wait:.0f}s 대기 후 재시도({attempt + 1}/{tries})", flush=True)
                time.sleep(wait)
                continue
            raise
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)
    raise RateLimited(f"429 반복: {params.get('search') or params.get('ids')}")

def haversine(a_lat, a_lon, b_lat, b_lon):
    R = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def search(term, lang):
    d = get({"action": "wbsearchentities", "search": term, "language": lang,
             "uselang": lang, "type": "item", "limit": 5})
    return [x["id"] for x in d.get("search", [])]

def entities(ids):
    """개체 일괄 조회(최대 50) → {qid: {lat, lon, label, desc}}. 좌표(P625) 없는 개체는 뺀다."""
    if not ids:
        return {}
    out = {}
    d = get({"action": "wbgetentities", "ids": "|".join(ids[:50]),
             "props": "claims|labels|descriptions", "languages": "ko|en"})
    for qid, e in (d.get("entities") or {}).items():
        cl = (e.get("claims") or {}).get("P625")
        if not cl:
            continue
        try:
            v = cl[0]["mainsnak"]["datavalue"]["value"]
        except (KeyError, TypeError):
            continue
        labels, descs = e.get("labels") or {}, e.get("descriptions") or {}
        out[qid] = {
            "lat": v["latitude"], "lon": v["longitude"],
            "label": (labels.get("ko") or labels.get("en") or {}).get("value"),
            "desc": (descs.get("en") or descs.get("ko") or {}).get("value"),
        }
    return out

PAREN = re.compile(r"\s*[\(（][^)）]*[\)）]\s*")

def queries(lm):
    """질의 후보(순서 = 신뢰도). 괄호 주석은 떼어 낸다 — "스트레이트 거리(직가)" 가 그대로면 안 맞는다."""
    out = [(lm["name"], "ko")]
    bare = PAREN.sub(" ", lm["name"]).strip()
    if bare and bare != lm["name"]:
        out.append((bare, "ko"))
    en = lm.get("nameEn")
    if en:
        out.append((en, "en"))
        bare_en = PAREN.sub(" ", en).strip()
        if bare_en and bare_en != en:
            out.append((bare_en, "en"))
    return out

def resolve(lm, center, radius):
    """질의를 순서대로 시도, **검증을 통과하는 즉시 멈춘다**(뒤 질의는 요청 낭비 + 오매칭 위험).

    반환: (best, distKm, sawCandidate) — sawCandidate 는 좌표 있는 개체를 보긴 했다는 뜻
    (거리초과와 미발견을 가르는 근거).
    """
    saw = False
    for term, lang in queries(lm):
        ids = search(term, lang)
        if not ids:
            continue
        ents = entities(ids)
        if ents:
            saw = True
        best, bestd = None, 1e9
        for qid in ids:  # 검색 관련도 순으로 보되, 검증 통과분 중 최근접
            e = ents.get(qid)
            if not e or not center:
                continue
            d = haversine(center["lat"], center["lon"], e["lat"], e["lon"])
            if d <= radius and d < bestd:
                best, bestd = (qid, e), d
        if best:
            return best, bestd, saw
    return None, None, saw

def main():
    dry = "--dry-run" in sys.argv
    limit = None
    for a in sys.argv:
        if a.startswith("--limit"):
            limit = int(a.split("=")[1]) if "=" in a else None

    cat = json.load(open(CATALOG, encoding="utf-8"))
    cities = json.load(open(CITY_CACHE, encoding="utf-8"))

    todo = []
    for city, lms in cat["cities"].items():
        for lm in lms:
            if lm.get("lat") is None:
                todo.append((city, lm))
    if limit:
        todo = todo[:limit]
    print(f"미해결 {len(todo)}개 → Wikidata 조회", flush=True)

    log = open(LOG, "w", encoding="utf-8")
    ok = far = none = err = 0
    for i, (city, lm) in enumerate(todo, 1):
        c = cities.get(city)
        radius = 100.0 if city in BIG_CITIES else 60.0
        rec = {"city": city, "name": lm["name"]}
        try:
            best, bestd, saw = resolve(lm, c, radius)
        except Exception as ex:  # 통신 실패는 **미발견과 구분**한다(재시도 대상)
            rec.update({"status": "error", "error": f"{type(ex).__name__}: {ex}"})
            log.write(json.dumps(rec, ensure_ascii=False) + "\n")
            err += 1
            continue
        if best:
            qid, e = best
            rec.update({"status": "RECOVERED", "lat": e["lat"], "lon": e["lon"],
                        "qid": qid, "label": e["label"], "desc": e["desc"], "distKm": round(bestd, 1)})
            if not dry:
                lm["lat"], lm["lon"] = e["lat"], e["lon"]
                lm["geocodeStrategy"] = "wikidata"
                lm["geocodeSource"] = {"wikidata": qid, "label": e["label"],
                                       "description": e["desc"], "cityDistKm": round(bestd, 1)}
                lm.pop("geocodeStatus", None)
            ok += 1
        elif saw:
            rec["status"] = "too-far"  # 개체는 찾았으나 다른 도시 — 받아들이지 않는다
            far += 1
        else:
            rec["status"] = "not-found"
            none += 1
        log.write(json.dumps(rec, ensure_ascii=False) + "\n")
        if i % 20 == 0:
            print(f"  {i}/{len(todo)}  해결 {ok} · 거리초과 {far} · 미발견 {none} · 오류 {err}", flush=True)
    log.close()

    print(f"\n결과: 해결 {ok} · 거리초과 {far} · 미발견 {none} · 오류 {err} (총 {len(todo)})")
    if not dry:
        resolved = sum(1 for lms in cat["cities"].values() for lm in lms if lm.get("lat") is not None)
        total = sum(len(lms) for lms in cat["cities"].values())
        cat["geocodeStats"] = {"resolved": resolved, "unresolved": total - resolved,
                               "resolvedAt": cat.get("geocodeStats", {}).get("resolvedAt"),
                               "wikidataPassAt": "2026-08-24"}
        json.dump(cat, open(CATALOG, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"카탈로그 갱신: {resolved}/{total} 해결 (미해결 {total - resolved})")

main()
