#!/usr/bin/env python3
# 랜드마크 카탈로그(landmark-catalog.json)에 실측 위경도를 채운다 — Nominatim(OSM) 지오코딩.
# 정밀도 원칙: 날조 금지. 매칭 실패는 lat/lon 없이 geocodeStatus:"unresolved" 로 남긴다.
# Nominatim 사용정책: 최대 1req/s, 식별 가능한 User-Agent 필수. 이 스크립트는 1.1s 간격을 지킨다.
# 재개 가능: 이미 lat 필드가 있는 항목은 건너뛴다(중단 후 재실행 안전).

import json
import time
import sys
import urllib.parse
import requests

CATALOG_PATH = "scripts/data/landmark-catalog.json"
LOG_PATH = "scripts/data/geocode-log.jsonl"
CITY_CACHE_PATH = "scripts/data/geocode-city-cache.json"

UA = "OrbitHera-LandmarkCatalog-Research/1.0 (non-commercial hobby game project; landmark coordinate research)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"

# 도시 한글명 -> {en: 영문 도시명, country: 영문 국가명, cc: ISO3166-1 alpha2, big: 대도시 확산형이면 bbox 여유 넓힘}
CITY_META = {
    "로마": {"en": "Rome", "country": "Italy", "cc": "it"},
    "아테네": {"en": "Athens", "country": "Greece", "cc": "gr"},
    "이스탄불": {"en": "Istanbul", "country": "Turkey", "cc": "tr", "big": True},
    "예루살렘": {"en": "Jerusalem", "country": "Israel", "cc": "il"},
    "다마스쿠스": {"en": "Damascus", "country": "Syria", "cc": "sy"},
    "바그다드": {"en": "Baghdad", "country": "Iraq", "cc": "iq", "big": True},
    "이스파한": {"en": "Isfahan", "country": "Iran", "cc": "ir"},
    "카이로": {"en": "Cairo", "country": "Egypt", "cc": "eg", "big": True},
    "룩소르": {"en": "Luxor", "country": "Egypt", "cc": "eg"},
    "마라케시": {"en": "Marrakesh", "country": "Morocco", "cc": "ma"},
    "페스": {"en": "Fez", "country": "Morocco", "cc": "ma"},
    "바라나시": {"en": "Varanasi", "country": "India", "cc": "in"},
    "델리": {"en": "Delhi", "country": "India", "cc": "in", "big": True},
    "카트만두": {"en": "Kathmandu", "country": "Nepal", "cc": "np"},
    "시안": {"en": "Xi'an", "country": "China", "cc": "cn", "big": True},
    "뤄양": {"en": "Luoyang", "country": "China", "cc": "cn", "big": True},
    "베이징": {"en": "Beijing", "country": "China", "cc": "cn", "big": True},
    "교토": {"en": "Kyoto", "country": "Japan", "cc": "jp"},
    "나라": {"en": "Nara", "country": "Japan", "cc": "jp"},
    "방콕": {"en": "Bangkok", "country": "Thailand", "cc": "th", "big": True},
    "시엠레아프": {"en": "Siem Reap", "country": "Cambodia", "cc": "kh"},
    "루앙프라방": {"en": "Luang Prabang", "country": "Laos", "cc": "la"},
    "멕시코시티": {"en": "Mexico City", "country": "Mexico", "cc": "mx", "big": True},
    "쿠스코": {"en": "Cusco", "country": "Peru", "cc": "pe"},
    "아디스아바바": {"en": "Addis Ababa", "country": "Ethiopia", "cc": "et", "big": True},
    "뉴욕": {"en": "New York City", "country": "United States", "cc": "us", "big": True},
    "파리": {"en": "Paris", "country": "France", "cc": "fr", "big": True},
    "리우데자네이루": {"en": "Rio de Janeiro", "country": "Brazil", "cc": "br", "big": True},
    "뭄바이": {"en": "Mumbai", "country": "India", "cc": "in", "big": True},
    "상하이": {"en": "Shanghai", "country": "China", "cc": "cn", "big": True},
    "시드니": {"en": "Sydney", "country": "Australia", "cc": "au", "big": True},
    "마드리드": {"en": "Madrid", "country": "Spain", "cc": "es", "big": True},
    "베를린": {"en": "Berlin", "country": "Germany", "cc": "de", "big": True},
    "홍콩": {"en": "Hong Kong", "country": "Hong Kong", "cc": "hk", "big": True},
    "카사블랑카": {"en": "Casablanca", "country": "Morocco", "cc": "ma", "big": True},
    "도쿄": {"en": "Tokyo", "country": "Japan", "cc": "jp", "big": True},
    "나고야": {"en": "Nagoya", "country": "Japan", "cc": "jp", "big": True},
    "삿포로": {"en": "Sapporo", "country": "Japan", "cc": "jp", "big": True},
    "타이베이": {"en": "Taipei", "country": "Taiwan", "cc": "tw", "big": True},
    "가오슝": {"en": "Kaohsiung", "country": "Taiwan", "cc": "tw", "big": True},
    "마닐라": {"en": "Manila", "country": "Philippines", "cc": "ph", "big": True},
    "세부": {"en": "Cebu City", "country": "Philippines", "cc": "ph"},
    "자카르타": {"en": "Jakarta", "country": "Indonesia", "cc": "id", "big": True},
    "호치민": {"en": "Ho Chi Minh City", "country": "Vietnam", "cc": "vn", "big": True},
    "다낭": {"en": "Da Nang", "country": "Vietnam", "cc": "vn"},
    "사이판": {"en": "Saipan", "country": "Northern Mariana Islands", "cc": "mp"},
    "코로르": {"en": "Koror", "country": "Palau", "cc": "pw"},
    "포트모르즈비": {"en": "Port Moresby", "country": "Papua New Guinea", "cc": "pg"},
    "브리즈번": {"en": "Brisbane", "country": "Australia", "cc": "au", "big": True},
    "호놀룰루": {"en": "Honolulu", "country": "United States", "cc": "us"},
    "밴쿠버": {"en": "Vancouver", "country": "Canada", "cc": "ca", "big": True},
    "시애틀": {"en": "Seattle", "country": "United States", "cc": "us", "big": True},
    "샌프란시스코": {"en": "San Francisco", "country": "United States", "cc": "us", "big": True},
    "리마": {"en": "Lima", "country": "Peru", "cc": "pe", "big": True},
    "로스앤젤레스": {"en": "Los Angeles", "country": "United States", "cc": "us", "big": True},
    "시카고": {"en": "Chicago", "country": "United States", "cc": "us", "big": True},
    "워싱턴 D.C.": {"en": "Washington, D.C.", "country": "United States", "cc": "us"},
    "토론토": {"en": "Toronto", "country": "Canada", "cc": "ca", "big": True},
    "산티아고": {"en": "Santiago", "country": "Chile", "cc": "cl", "big": True},
    "보고타": {"en": "Bogotá", "country": "Colombia", "cc": "co", "big": True},
    "프라하": {"en": "Prague", "country": "Czechia", "cc": "cz"},
    "암스테르담": {"en": "Amsterdam", "country": "Netherlands", "cc": "nl"},
    "바르셀로나": {"en": "Barcelona", "country": "Spain", "cc": "es", "big": True},
    "베네치아": {"en": "Venice", "country": "Italy", "cc": "it"},
    "코펜하겐": {"en": "Copenhagen", "country": "Denmark", "cc": "dk"},
    "헬싱키": {"en": "Helsinki", "country": "Finland", "cc": "fi"},
    "더블린": {"en": "Dublin", "country": "Ireland", "cc": "ie"},
    "브뤼셀": {"en": "Brussels", "country": "Belgium", "cc": "be"},
    "취리히": {"en": "Zurich", "country": "Switzerland", "cc": "ch"},
    "레이캬비크": {"en": "Reykjavik", "country": "Iceland", "cc": "is"},
    "도하": {"en": "Doha", "country": "Qatar", "cc": "qa"},
    "리야드": {"en": "Riyadh", "country": "Saudi Arabia", "cc": "sa", "big": True},
    "텔아비브": {"en": "Tel Aviv", "country": "Israel", "cc": "il"},
    "나이로비": {"en": "Nairobi", "country": "Kenya", "cc": "ke", "big": True},
    "라고스": {"en": "Lagos", "country": "Nigeria", "cc": "ng", "big": True},
    "요하네스버그": {"en": "Johannesburg", "country": "South Africa", "cc": "za", "big": True},
    "케이프타운": {"en": "Cape Town", "country": "South Africa", "cc": "za", "big": True},
    "다카르": {"en": "Dakar", "country": "Senegal", "cc": "sn"},
    "콜롬보": {"en": "Colombo", "country": "Sri Lanka", "cc": "lk"},
    "다카": {"en": "Dhaka", "country": "Bangladesh", "cc": "bd", "big": True},
    "라호르": {"en": "Lahore", "country": "Pakistan", "cc": "pk", "big": True},
    "청두": {"en": "Chengdu", "country": "China", "cc": "cn", "big": True},
    "우한": {"en": "Wuhan", "country": "China", "cc": "cn", "big": True},
    "선전": {"en": "Shenzhen", "country": "China", "cc": "cn", "big": True},
    "멜버른": {"en": "Melbourne", "country": "Australia", "cc": "au", "big": True},
    "웰링턴": {"en": "Wellington", "country": "New Zealand", "cc": "nz"},
    "상트페테르부르크": {"en": "Saint Petersburg", "country": "Russia", "cc": "ru", "big": True},
    "런던": {"en": "London", "country": "United Kingdom", "cc": "gb", "big": True},
    "몬트리올": {"en": "Montreal", "country": "Canada", "cc": "ca", "big": True},
    "리스본": {"en": "Lisbon", "country": "Portugal", "cc": "pt"},
    "두바이": {"en": "Dubai", "country": "United Arab Emirates", "cc": "ae", "big": True},
    "부산": {"en": "Busan", "country": "South Korea", "cc": "kr", "big": True},
    "오클랜드": {"en": "Auckland", "country": "New Zealand", "cc": "nz", "big": True},
    "부에노스아이레스": {"en": "Buenos Aires", "country": "Argentina", "cc": "ar", "big": True},
    "비엔나": {"en": "Vienna", "country": "Austria", "cc": "at"},
    "싱가포르": {"en": "Singapore", "country": "Singapore", "cc": "sg"},
    "마이애미": {"en": "Miami", "country": "United States", "cc": "us", "big": True},
    "하갓냐(괌)": {"en": "Hagåtña", "country": "Guam", "cc": "gu"},
    "서울": {"en": "Seoul", "country": "South Korea", "cc": "kr", "big": True},
    "오사카": {"en": "Osaka", "country": "Japan", "cc": "jp", "big": True},
}

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
            else:
                print(f"  [warn] HTTP {r.status_code} for {params.get('q')}", file=sys.stderr)
        except requests.RequestException as e:
            print(f"  [warn] request error: {e}", file=sys.stderr)
        time.sleep(2 * (attempt + 1))
    return []

def load_city_cache():
    try:
        with open(CITY_CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_city_cache(cache):
    with open(CITY_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

def geocode_city(city_ko, cache):
    if city_ko in cache:
        return cache[city_ko]
    meta = CITY_META[city_ko]
    q = f"{meta['en']}, {meta['country']}"
    res = nominatim_search({"q": q, "format": "json", "limit": 1, "countrycodes": meta["cc"]})
    if not res:
        res = nominatim_search({"q": q, "format": "json", "limit": 1})
    if not res:
        print(f"  [ERROR] 도시 중심 지오코딩 실패: {city_ko} ({q})", file=sys.stderr)
        entry = None
    else:
        bb = res[0]["boundingbox"]  # [south, north, west, east] as strings
        entry = {
            "lat": float(res[0]["lat"]),
            "lon": float(res[0]["lon"]),
            "bbox": [float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3])],
            "display_name": res[0]["display_name"],
        }
    cache[city_ko] = entry
    save_city_cache(cache)
    return entry

def pad_bbox(bbox, big):
    s, n, w, e = bbox
    pad = 0.35 if big else 0.12
    return (max(-90, s - pad), min(90, n + pad), max(-180, w - pad), min(180, e + pad))

def geocode_landmark(name, name_en, city_ko, city_geo):
    meta = CITY_META[city_ko]
    query_name = name_en if name_en else name
    s, n, w, e = pad_bbox(city_geo["bbox"], meta.get("big", False))
    # viewbox = left,top,right,bottom = west,north,east,south
    viewbox = f"{w},{n},{e},{s}"
    q1 = f"{query_name}, {meta['en']}, {meta['country']}"
    res = nominatim_search({
        "q": q1, "format": "json", "limit": 1,
        "viewbox": viewbox, "bounded": 1, "countrycodes": meta["cc"],
    })
    strategy = "bounded"
    if not res and name_en and name_en != name:
        res = nominatim_search({
            "q": f"{name}, {meta['en']}, {meta['country']}", "format": "json", "limit": 1,
            "viewbox": viewbox, "bounded": 1, "countrycodes": meta["cc"],
        })
        strategy = "bounded-ko"
    if not res:
        res = nominatim_search({
            "q": q1, "format": "json", "limit": 1,
            "viewbox": viewbox, "bounded": 0, "countrycodes": meta["cc"],
        })
        strategy = "biased"
    if not res:
        res = nominatim_search({"q": q1, "format": "json", "limit": 1})
        strategy = "freeform"
    if not res:
        return None, strategy
    r0 = res[0]
    return {
        "lat": float(r0["lat"]),
        "lon": float(r0["lon"]),
        "osmType": r0.get("osm_type"),
        "osmId": r0.get("osm_id"),
        "displayName": r0.get("display_name"),
        "importance": r0.get("importance"),
    }, strategy

def main():
    with open(CATALOG_PATH, encoding="utf-8") as f:
        catalog = json.load(f)

    city_cache = load_city_cache()
    logf = open(LOG_PATH, "a", encoding="utf-8")

    cities = list(catalog["cities"].keys())
    total_cities = len(cities)
    for ci, city_ko in enumerate(cities, 1):
        if city_ko not in CITY_META:
            print(f"[SKIP] 메타 없음: {city_ko}", file=sys.stderr)
            continue
        items = catalog["cities"][city_ko]
        pending = [it for it in items if "lat" not in it]
        if not pending:
            print(f"[{ci}/{total_cities}] {city_ko} — 이미 완료({len(items)}개), 건너뜀")
            continue

        city_geo = geocode_city(city_ko, city_cache)
        if city_geo is None:
            print(f"[{ci}/{total_cities}] {city_ko} — 도시 중심 지오코딩 실패, 전체 건너뜀", file=sys.stderr)
            continue

        print(f"[{ci}/{total_cities}] {city_ko} — {len(pending)}개 지오코딩 시작")
        resolved = 0
        for it in pending:
            result, strategy = geocode_landmark(it["name"], it.get("nameEn"), city_ko, city_geo)
            if result:
                it["lat"] = result["lat"]
                it["lon"] = result["lon"]
                it["geocodeStrategy"] = strategy
                it["geocodeSource"] = {
                    "osmType": result["osmType"], "osmId": result["osmId"],
                    "displayName": result["displayName"], "importance": result["importance"],
                }
                resolved += 1
            else:
                it["geocodeStatus"] = "unresolved"
            logf.write(json.dumps({
                "city": city_ko, "name": it["name"], "nameEn": it.get("nameEn"),
                "resolved": bool(result), "strategy": strategy,
                "lat": it.get("lat"), "lon": it.get("lon"),
            }, ensure_ascii=False) + "\n")
            logf.flush()

        # 도시 단위로 진행상황 저장(중단 시 재개 가능)
        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
            json.dump(catalog, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"[{ci}/{total_cities}] {city_ko} — 완료: {resolved}/{len(pending)} 해결")

    logf.close()
    print("전체 완료")

if __name__ == "__main__":
    main()
