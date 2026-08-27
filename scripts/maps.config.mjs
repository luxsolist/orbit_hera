// 전지구 주요 명소 전장(맵) 정의. `npm run build:map -- <id>` 로 public/maps/ 에 빌드.
//
// 두 갈래로 구성된다:
//   ① HAND — 아래 배열. 손으로 다듬은 맵(양식화 랜드마크·성문·산세 등 개별 튜닝이 있는 곳).
//   ② 생성 — scripts/data/city-catalog.json(도시 100선)에서 자동 생성. 도시당 항목을 손으로 쓰면
//      100개 규모에서 오탈자·bbox 실수·누락이 그대로 수십 분짜리 빌드 낭비가 되므로 데이터에서 만든다.
//      소스 수정 → `node scripts/gen-city-config.mjs` 재생성 → 여기 자동 반영.
//   같은 id 가 양쪽에 있으면 HAND 가 이긴다(손 튜닝 보존). 100선 도시가 이미 다른 id 의 손 맵으로
//   덮여 있으면(서울=gyeongbokgung 등) city-catalog 의 mapId 로 표시돼 생성에서 빠진다.
//
// bbox: [south, west, north, east]  (위경도)
// lat0/lon0: 로컬 미터 좌표 원점(보통 명소 중심)
// stream: 스트리밍 카탈로그(public/maps/index.json) 항목 — build-world 가 청크를 구우며 업서트한다.
import { readFileSync } from "node:fs";
// bbox 공식은 gen-city-config 가 정본 — 여기서 다시 쓰면 조용히 갈라진다(순환 없음: 그쪽은 이 파일을 안 읽는다).
import { radiusBbox, RADIUS_M } from "./gen-city-config.mjs";

const HAND = [
  {
    id: "rome",
    name: "Rome · 로마",
    subtitle: "로마 도심 반경 20km — 콜로세움·포로 로마노·바티칸",
    lat0: 41.9028,
    lon0: 12.4964,
    // 로마 역사지구(콜로세움/포로 로마노 인근) 중심 반경 20km — 바티칸(2.4km)·트레비 분수(1.2km) 포함.
    bbox: [41.7231, 12.255, 42.0825, 12.7378],
    catalogHidden: true, // 카탈로그는 rome-stream 항목으로 노출
    catalogCity: "로마", // 큐레이션 랜드마크(landmark-catalog.json) 조회 키
    stream: { id: "rome-stream", name: "로마 · Rome", subtitle: "이탈리아 — 도심 반경 20km 청크 스트리밍 (1장 열지도)" },
    // 구릉 도시(팔라티노·카피톨리노 등 7언덕) — DEM raw, 건물 footprint 평탄화는 build-world(언덕 보존).
    bareEarth: false,
    heightmap: { src: "rome.terrain.bin", size: 2048, meters: 40000 },
  },
  {
    id: "busan",
    name: "Busan · 부산",
    subtitle: "부산 도심 반경 20km — 해운대·광안리·태종대",
    lat0: 35.16,
    lon0: 129.07,
    // 부산 도심(서면/시청) 중심 반경 20km — 해운대(8.2km)·광안리(4.5km)·태종대(12.1km) 포함.
    bbox: [34.9803, 128.8502, 35.3397, 129.2898],
    catalogHidden: true, // 카탈로그는 busan-stream 항목으로 노출
    catalogCity: "부산",
    stream: { id: "busan-stream", name: "부산 · Busan", subtitle: "35/129 부산 도심 반경 20km — 해운대·광안리·태종대" },
    // 해안 도시(바다+도심+산) — DEM raw, 건물 footprint 평탄화는 build-world(산 보존). 바다(0m)는 elevationColor 가 파랑.
    bareEarth: false,
    heightmap: { src: "busan.terrain.bin", size: 2048, meters: 40000 },
  },
  {
    id: "everest",
    name: "Everest · 에베레스트",
    subtitle: "Himalaya — 세계 최고봉 8,849m (반경 20km)",
    lat0: 27.9881,
    lon0: 86.9250,
    // 에베레스트 정상 중심 반경 20km(±0.18°lat / ±0.203°lon).
    bbox: [27.8084, 86.7215, 28.1678, 87.1285],
    catalogHidden: true, // 스트리밍 카탈로그 항목(everest-stream)으로 노출
    // 자연 산악이라 큐레이션 도시 랜드마크 없음(catalogCity 없음).
    stream: { id: "everest-stream", name: "에베레스트 · Everest", subtitle: "27/86 히말라야 — 세계 최고봉 8,849m (반경 20km 스트리밍)" },
    // 자연 산악 — bare-earth 형태학 열림 생략(도시 건물 제거용이라 산에 쓰면 봉우리/능선이 깎임). 실측 DEM 그대로.
    bareEarth: false,
    // 실측 40km×40km DEM(AWS Terrarium). 생성: node scripts/build-terrain.mjs real everest 2048 40000 13.
    heightmap: { src: "everest.terrain.bin", size: 2048, meters: 40000 },
  },
  {
    id: "gyeongbokgung",
    name: "경복궁 · Gyeongbokgung",
    subtitle: "Seoul, Korea — 도심 한복판의 왕궁",
    lat0: 37.578,
    lon0: 126.977,
    // 경복궁 중심 반경 20km(±0.18°lat / ±0.227°lon) — 무제한 배틀필드용 대면적 수집.
    bbox: [37.3983, 126.7503, 37.7577, 127.2037],
    bare: true,
    spawn: { x: 0, z: 360, yaw: 0 },
    // 스트리밍 타일 월드(seoul-stream)의 소스 전용 — 메뉴 카탈로그에는 노출 안 함.
    catalogHidden: true,
    catalogCity: "서울",
    stream: { id: "seoul-stream", name: "서울 도심 · Seoul", subtitle: "37/126 경복궁 일대 — 청크 스트리밍 타일 월드" },
    // 실측 40km×40km DEM(AWS Terrarium). DEM 은 raw — 평탄화는 build-world 가 **건물 풋프린트 아래만**(산·공원 보존).
    // 생성: node scripts/build-terrain.mjs real gyeongbokgung 2048 40000 13.
    bareEarth: false, // 전역 형태학 열림(봉우리 깎임) 끔 → 산 보존. 건물 스파이크는 build-world footprint 평탄화로 제거.
    heightmap: { src: "gyeongbokgung.terrain.bin", size: 2048, meters: 40000 }, // build/ 의 빌드 중간물(런타임 비사용)
    mountains: [
      { x: 120, z: -1250, h: 250, r: 300 }, // 북악산
      { x: -1150, z: -260, h: 220, r: 320 }, // 인왕산
      { x: 860, z: -1180, h: 150, r: 260 }, // 응봉 자락
    ],
    gates: [
      { x: -9, z: 234, r: 18 }, // 광화문
      { x: -131, z: -617, r: 13 }, // 신무문
      { x: 206, z: -15, r: 13 }, // 건춘문
      { x: -259, z: -85, r: 13 }, // 영추문
    ],
    // cls = 얽힘 유형(택소노미 — src/world/entanglement.ts, docs/spec/06-missions.md §8)
    landmarks: [
      { type: "geunjeongjeon", x: 0, z: -189, cls: "deep-roots" },
      { type: "gwanghwamun", x: -9, z: 234, cls: "deep-roots" },
      { type: "gyeonghoeru", x: -95, z: -235, cls: "deep-roots" },
      { type: "statue-sejong", x: -11, z: 572, cls: "memorial" },
      { type: "statue-yi", x: -4, z: 783, cls: "memorial" },
      // 주변 명소(실측 위치)
      { type: "blue-house", x: -73, z: -961, cls: "deep-roots" }, // 청와대
      { type: "folk-museum", x: 182, z: -399, cls: "archive" }, // 국립민속박물관(5층 목탑)
      { type: "mmca", x: 327, z: -113, cls: "archive" }, // 국립현대미술관 서울관
      { type: "sejong-center", x: -123, z: 632, rot: 1.571, cls: "resonance" }, // 세종문화회관(세종대로 동향)
      { type: "dongsipjagak", x: 214, z: 210, cls: "deep-roots" }, // 동십자각
      { type: "jogyesa", x: 443, z: 430, cls: "ritual" }, // 조계사
    ],
  },
  // 레거시 manhattan/osaka/paris(스트리밍 이전 monolithic)는 카탈로그 비노출·미사용이라 제거됨.
  // 새 도시는 아래 생성 경로(city-catalog.json)로 편입한다 — 손 항목은 개별 튜닝이 있을 때만.
];

// ─────────────────────────── 도시 100선 자동 생성 ───────────────────────────

const CITY_CATALOG = "scripts/data/city-catalog.json";
// DEM 변 = 반경×2 (cityMapDef 가 계산). 어긋나면 지형이 맵보다 좁아진다.

/** 장 번호 → 카탈로그 부제에 쓰는 라벨. 0 = 서장(기완료 3도시). */
const CHAPTER_LABEL = {
  0: "서장",
  1: "1장 열지도",
  2: "2장 같은 박자",
  3: "3장 죽음의 방향",
  4: "4~6장 확장",
};

/**
 * city-catalog 항목 하나 → maps.config 맵 정의. 순수.
 *
 * 전 도시 공통 규격: 중심 반경 20km · 실측 DEM 2048² · bareEarth 끔(전역 형태학 열림은 산세를 깎는다 —
 * 건물 스파이크는 build-world 의 footprint 평탄화가 처리). catalogHidden = 메뉴에는 스트리밍 항목만 노출.
 */
// 배치 오버라이드 — **더 이상 필요 없다.** 지형이 위치의 순수 함수가 되기 전에는 두 도시의 상자가
// 겹치면 소유 경계에서 지형이 어긋나(실측 최대 30m) 나라를 반경 11.2km 로 줄여야 했다.
// 지금은 겹쳐도 같은 값이 나오므로(실측 0m) 모든 도시가 규격 반경 20km 를 쓴다.
// 남겨 두는 이유: 특정 도시의 중심·반경을 손으로 조정할 필요가 생길 때의 자리.
export const PLACEMENT = {}; // 지형이 위치 순수 함수가 되어 배치 조정이 불필요해졌다(검증 중)


export function cityMapDef(c) {
  // 오버라이드는 **중심·반경만** 갈아끼운다(재귀 호출로 처리하면 오버라이드가 다시 걸려 무한 재귀 —
  // 실제로 밟았다). 나머지 필드 구성은 한 곳에만 둔다.
  const ov = PLACEMENT[c.id];
  const lat = ov?.lat ?? c.lat;
  const lon = ov?.lon ?? c.lon;
  const r = ov?.radiusM ?? RADIUS_M;
  const bbox = ov ? radiusBbox(lat, lon, r) : c.bbox;
  const km = r / 1000;
  return {
    id: c.id,
    name: `${c.en} · ${c.cityKo}`,
    subtitle: `${c.cityKo} 도심 반경 ${km}km — ${c.country}`,
    catalogCity: c.cityKo, // 큐레이션 랜드마크 카탈로그(landmark-catalog.json) 조회 키
    lat0: lat,
    lon0: lon,
    bbox,
    catalogHidden: true,
    bareEarth: false,
    heightmap: { src: `${c.id}.terrain.bin`, size: 2048, meters: r * 2 },
    stream: {
      id: `${c.id}-stream`,
      name: `${c.cityKo} · ${c.en}`,
      subtitle: `${c.country} — 도심 반경 ${km}km 청크 스트리밍 (${CHAPTER_LABEL[c.chapter] ?? `${c.chapter}장`})`,
    },
    chapter: c.chapter,
  };
}

/**
 * 생성 도시 목록 — 파일이 없으면 빈 배열(손 맵만으로 동작). 두 부류를 뺀다:
 *   · mapId — 손 맵이 담당하는 도시
 *   · buildExcluded — 큐레이션 정책 판단으로 빌드하지 않기로 한 도시. **MAPS 에서 빼야** 실효가 있다:
 *     남겨 두면 build-pipeline 이 그대로 받고, --all 전량 빌드에도 딸려 들어간다. 카탈로그에는
 *     남아 있으므로(장 배속·100선 집계 유지) 왜 빠졌는지는 데이터에서 확인된다.
 */
function generatedMaps() {
  let cat;
  try { cat = JSON.parse(readFileSync(CITY_CATALOG, "utf8")); }
  catch { return []; } // 아직 생성 안 됨 — build:map 은 손 맵으로 계속 동작
  return (cat.cities ?? []).filter((c) => !c.mapId && !c.buildExcluded).map(cityMapDef);
}

const handIds = new Set(HAND.map((m) => m.id));
export const MAPS = [...HAND, ...generatedMaps().filter((m) => !handIds.has(m.id))];
