// 전지구 주요 명소 전장(맵) 정의. `node scripts/build-maps.mjs` 로 public/maps/ 에 빌드.
// 새 전장 추가 = 여기에 항목 하나 추가 후 빌드 스크립트 재실행.
//
// bbox: [south, west, north, east]  (위경도)
// lat0/lon0: 로컬 미터 좌표 원점(보통 명소 중심)
export const MAPS = [
  {
    id: "gyeongbokgung",
    name: "경복궁 · Gyeongbokgung",
    subtitle: "Seoul, Korea — 도심 한복판의 왕궁",
    lat0: 37.578,
    lon0: 126.977,
    bbox: [37.5695, 126.9685, 37.5862, 126.9855],
    bare: true,
    spawn: { x: 0, z: 360, yaw: 0 },
    // 이미 빌드된 맵 자신을 소스로 재사용(OSM 데이터는 그대로 통과, 랜드마크/문/스폰만 재베이킹).
    // 최초/전체 재수집이 필요하면 from 을 지우면 bbox 로 Overpass 수집한다.
    local: { from: "public/maps/gyeongbokgung.json" },
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
  {
    id: "manhattan",
    name: "Times Square",
    subtitle: "Manhattan, NYC — 마천루 협곡 (확장 ±2.5km)",
    lat0: 40.758,
    lon0: -73.9855,
    // A안 확장: 미드타운 대부분을 덮는 ~4.5km × ~3.5km 영역
    bbox: [40.7375, -74.0, 40.7785, -73.9705],
    spawn: { x: 45, z: 0, yaw: 3.14159 },
  },
  {
    id: "osaka",
    name: "Osaka Castle · 大阪城",
    subtitle: "Osaka, Japan — 天守閣 (일본식 양식 샘플)",
    lat0: 34.6873,
    lon0: 135.5259,
    bbox: [34.6808, 135.518, 34.6938, 135.5338],
    spawn: { x: 0, z: 170, yaw: 0 },
    // 천수각(데이터 구동 일본식 지붕) — 실측 위치(맵 원점 = 천수각).
    landmarks: [{ type: "tenshukaku", x: 0, z: 0 }],
  },
  {
    id: "paris",
    name: "Eiffel Tower",
    subtitle: "Paris, France — 샹드마르스 광장",
    lat0: 48.8584,
    lon0: 2.2945,
    bbox: [48.8524, 2.2865, 48.8644, 2.3025],
    spawn: { x: 0, z: 200, yaw: 0 },
    // 실측 위치의 양식화 랜드마크(세느강 방향 기반 회전)
    landmarks: [
      { type: "eiffel-tower", x: 0, z: 16 },
      { type: "pont-iena", x: -178, z: -157, rot: -0.577 },
      { type: "pont-bir-hakeim", x: -507, z: 304, rot: -0.715 },
      { type: "quai-branly", x: 241, z: -287, rot: -1.466 },
      { type: "palais-tokyo", x: 190, z: -646, rot: 0.349 },
    ],
  },
];
