#!/usr/bin/env python3
# 1차 지오코딩에서 unresolved 로 남은 항목 재시도. 1차는 "이름, 도시, 국가" 결합 쿼리가 유명
# 랜드마크(바티칸 박물관·기자 피라미드·베르사유궁 등)에서 오히려 매칭 실패를 유발함을 확인
# (예: "Vatican Museums, Rome, Italy" → 0건, "Vatican Museums" 단독 → 정확 매칭).
# 전략: 이름 단독 쿼리(가장 신뢰도 높은 시그널) 우선 시도 → 결과를 도시 중심과의 거리로 검증해
# 엉뚱한 동명이지 매칭을 걸러낸다(하버사인, 국가 규모에 따라 반경 가변). 그래도 실패하면 unresolved 유지.

import json
import math
import time
import sys
import requests

CATALOG_PATH = "scripts/data/landmark-catalog.json"
LOG_PATH = "scripts/data/geocode-retry-log.jsonl"
CITY_CACHE_PATH = "scripts/data/geocode-city-cache.json"

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
    total_targets = sum(
        1 for c in cities for it in catalog["cities"][c] if "lat" not in it
    )
    print(f"재시도 대상: {total_targets}개")
    done = 0
    recovered = 0

    for city_ko in cities:
        items = catalog["cities"][city_ko]
        pending = [it for it in items if "lat" not in it]
        if not pending:
            continue
        city_geo = city_cache.get(city_ko)
        if not city_geo:
            continue
        clat, clon = city_geo["lat"], city_geo["lon"]

        for it in pending:
            done += 1
            candidates = []
            if it.get("nameEn"):
                candidates.append(it["nameEn"])
            candidates.append(it["name"])
            # 괄호 안 부가설명 제거한 버전도 시도(예: "다윗의 무덤" 은 이미 순수하지만
            # "심말라카" 처럼 원어가 나은 경우 대비 nameEn 우선순위 유지)
            import re
            for c in list(candidates):
                stripped = re.sub(r"[（(].*?[）)]", "", c).strip()
                if stripped and stripped != c:
                    candidates.append(stripped)

            found = None
            used_query = None
            for q in candidates:
                res = nominatim_search({"q": q, "format": "json", "limit": 3})
                if not res:
                    continue
                # 도시 중심과의 거리로 검증 — 가장 가까운 후보 채택
                best = None
                best_d = None
                for r0 in res:
                    try:
                        lat, lon = float(r0["lat"]), float(r0["lon"])
                    except (KeyError, ValueError):
                        continue
                    d = haversine_km(clat, clon, lat, lon)
                    if best_d is None or d < best_d:
                        best, best_d = r0, d
                if best is not None and best_d <= 120:  # 도시 반경 120km 이내만 인정(오매칭 방지)
                    found = (best, best_d)
                    used_query = q
                    break
            if found:
                r0, dist = found
                it["lat"] = float(r0["lat"])
                it["lon"] = float(r0["lon"])
                it["geocodeStrategy"] = "retry-name-only"
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
            logf.write(json.dumps({
                "city": city_ko, "name": it["name"], "status": status,
                "lat": it.get("lat"), "lon": it.get("lon"),
            }, ensure_ascii=False) + "\n")
            logf.flush()
            if done % 20 == 0:
                print(f"  진행 {done}/{total_targets} — 복구 {recovered}건")

        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
            json.dump(catalog, f, ensure_ascii=False, indent=2)
            f.write("\n")

    logf.close()
    print(f"재시도 완료: {done}건 중 {recovered}건 복구")

if __name__ == "__main__":
    main()
