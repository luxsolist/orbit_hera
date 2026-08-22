#!/usr/bin/env python3
# 2차 재시도(패턴3): nameEn 에 쉼표가 있으면 첫 세그먼트만 단독 검색(예: "Hermitage Museum, Winter
# Palace" → "Hermitage Museum"), 그리고 " Beijing/Temple" 류 어순 변형 없이 그대로 재시도.
# 거리검증 반경을 도시 규모별로 차등(대형 광역도시 100km, 그외 60km)해 오매칭(예: Bab Tuma가
# 로테르담/오만으로 잘못 매칭)을 더 엄격히 걸러낸다.

import json
import math
import time
import sys
import requests

CATALOG_PATH = "scripts/data/landmark-catalog.json"
LOG_PATH = "scripts/data/geocode-retry2-log.jsonl"
CITY_CACHE_PATH = "scripts/data/geocode-city-cache.json"

BIG_CITIES = {
    "이스탄불", "바그다드", "카이로", "델리", "시안", "뤄양", "베이징", "방콕", "멕시코시티",
    "아디스아바바", "뉴욕", "파리", "리우데자네이루", "뭄바이", "상하이", "시드니", "마드리드",
    "베를린", "홍콩", "카사블랑카", "도쿄", "나고야", "삿포로", "타이베이", "가오슝", "마닐라",
    "자카르타", "호치민", "브리즈번", "밴쿠버", "시애틀", "샌프란시스코", "리마", "로스앤젤레스",
    "시카고", "토론토", "산티아고", "보고타", "리야드", "나이로비", "라고스", "요하네스버그",
    "케이프타운", "다카", "라호르", "청두", "우한", "선전", "멜버른", "상트페테르부르크", "런던",
    "몬트리올", "두바이", "부산", "오클랜드", "부에노스아이레스", "마이애미", "서울", "오사카",
}

UA = "OrbitHera-LandmarkCatalog-Research/1.0 (non-commercial hobby game project; landmark coordinate research)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"

session = requests.Session()
session.headers.update({"User-Agent": UA})

_last_req = [0.0]
def rate_limit():
    now = time.time()
    dt = now - _last_req[0]
    if dt < 1.1:
        time.sleep(1.1 - dt)
    _last_req[0] = time.time()

def nominatim_search(params, tries=3):
    for attempt in range(tries):
        rate_limit()
        try:
            r = session.get(NOMINATIM, params=params, timeout=20)
            if r.status_code == 200:
                return r.json()
            print(f"  [warn] HTTP {r.status_code} for {params.get('q')}", file=sys.stderr)
        except requests.RequestException as e:
            print(f"  [warn] request error: {e}", file=sys.stderr)
        time.sleep(2 * (attempt + 1))
    return []

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def main():
    with open(CATALOG_PATH, encoding="utf-8") as f:
        catalog = json.load(f)
    with open(CITY_CACHE_PATH, encoding="utf-8") as f:
        city_cache = json.load(f)

    logf = open(LOG_PATH, "a", encoding="utf-8")
    cities = list(catalog["cities"].keys())
    total_targets = sum(1 for c in cities for it in catalog["cities"][c] if "lat" not in it)
    print(f"3차 재시도 대상: {total_targets}개")
    done = recovered = 0

    for city_ko in cities:
        items = catalog["cities"][city_ko]
        pending = [it for it in items if "lat" not in it]
        if not pending:
            continue
        city_geo = city_cache.get(city_ko)
        if not city_geo:
            continue
        clat, clon = city_geo["lat"], city_geo["lon"]
        radius = 100 if city_ko in BIG_CITIES else 60

        for it in pending:
            done += 1
            candidates = []
            name_en = it.get("nameEn") or ""
            if "," in name_en:
                candidates.append(name_en.split(",")[0].strip())
                parts = [p.strip() for p in name_en.split(",")]
                if len(parts) >= 2:
                    candidates.append(parts[-1] + " " + parts[0])  # "Beijing Temple of Confucius" 류 어순 변형
            if "·" in it["name"]:
                candidates.append(it["name"].split("·")[0].strip())

            found = None
            used_query = None
            for q in candidates:
                if not q:
                    continue
                res = nominatim_search({"q": q, "format": "json", "limit": 3})
                if not res:
                    continue
                best, best_d = None, None
                for r0 in res:
                    try:
                        lat, lon = float(r0["lat"]), float(r0["lon"])
                    except (KeyError, ValueError):
                        continue
                    d = haversine_km(clat, clon, lat, lon)
                    if best_d is None or d < best_d:
                        best, best_d = r0, d
                if best is not None and best_d <= radius:
                    found = (best, best_d)
                    used_query = q
                    break
            if found:
                r0, dist = found
                it["lat"] = float(r0["lat"])
                it["lon"] = float(r0["lon"])
                it["geocodeStrategy"] = "retry2-comma-split"
                it["geocodeSource"] = {
                    "osmType": r0.get("osm_type"), "osmId": r0.get("osm_id"),
                    "displayName": r0.get("display_name"), "importance": r0.get("importance"),
                    "distanceFromCityCenterKm": round(dist, 1), "matchedQuery": used_query,
                }
                it.pop("geocodeStatus", None)
                recovered += 1
                status = "RECOVERED"
            else:
                status = "still-unresolved"
                it["geocodeStatus"] = "unresolved"
            logf.write(json.dumps({
                "city": city_ko, "name": it["name"], "status": status,
                "lat": it.get("lat"), "lon": it.get("lon"),
            }, ensure_ascii=False) + "\n")
            logf.flush()

        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
            json.dump(catalog, f, ensure_ascii=False, indent=2)
            f.write("\n")

    logf.close()
    print(f"3차 재시도 완료: {done}건 중 {recovered}건 복구")

if __name__ == "__main__":
    main()
