// 전지구 주요 명소 전장(맵) 정의. `node scripts/build-maps.mjs` 로 public/maps/ 에 빌드.
// 새 전장 추가 = 여기에 항목 하나 추가 후 빌드 스크립트 재실행.
//
// bbox: [south, west, north, east]  (위경도)
// lat0/lon0: 로컬 미터 좌표 원점(보통 명소 중심)
export const MAPS = [
  {
    id: "busan",
    name: "Busan · 부산",
    subtitle: "부산 도심 반경 20km — 해운대·광안리·태종대",
    lat0: 35.16,
    lon0: 129.07,
    // 부산 도심(서면/시청) 중심 반경 20km — 해운대(8.2km)·광안리(4.5km)·태종대(12.1km) 포함.
    bbox: [34.9803, 128.8502, 35.3397, 129.2898],
    catalogHidden: true, // 카탈로그는 busan-stream 항목으로 노출
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
    landmarks: [
      { type: "geunjeongjeon", x: 0, z: -189 },
      { type: "gwanghwamun", x: -9, z: 234 },
      { type: "gyeonghoeru", x: -95, z: -235 },
      { type: "statue-sejong", x: -11, z: 572 },
      { type: "statue-yi", x: -4, z: 783 },
      // 주변 명소(실측 위치)
      { type: "blue-house", x: -73, z: -961 }, // 청와대
      { type: "folk-museum", x: 182, z: -399 }, // 국립민속박물관(5층 목탑)
      { type: "mmca", x: 327, z: -113 }, // 국립현대미술관 서울관
      { type: "sejong-center", x: -123, z: 632, rot: 1.571 }, // 세종문화회관(세종대로 동향)
      { type: "dongsipjagak", x: 214, z: 210 }, // 동십자각
      { type: "jogyesa", x: 443, z: 430 }, // 조계사
    ],
  },
  // 레거시 manhattan/osaka/paris(스트리밍 이전 monolithic)는 카탈로그 비노출·미사용이라 제거됨.
  // 새 도시는 gyeongbokgung 처럼 스트리밍 파이프라인(build-pipeline)으로 생성한다.
];
