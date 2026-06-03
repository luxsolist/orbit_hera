// 런타임에 서버에서 내려받는 전장(맵) 데이터 스키마.
// 모든 좌표는 로컬 미터(1 unit = 1m, 북 = -Z, 원점 = meta.lat0/lon0).

export interface Ring {
  p: number[]; // [x0,z0,x1,z1,...]
  h?: number; // 건물 높이(m)
  w?: number; // 도로 폭(m)
}

/** 데이터 구동 랜드마크(structure)용 — 재질 정의 */
export interface MatDef {
  c: string; // hex 색 "ada793"
  rough?: number;
  metal?: number;
  flat?: boolean;
  opacity?: number;
}

/** 데이터 구동 랜드마크용 — 부품(프리미티브) 1개. g=모양, m=재질 인덱스. */
export interface Part {
  g: "box" | "cyl" | "cone" | "plane" | "hiproof" | "strut";
  m: number;
  p?: number[]; // [x,y,z] 로컬 위치
  rx?: number; // 로컬 X 회전(Euler XYZ)
  ry?: number; // 로컬 Y 회전
  rz?: number; // 로컬 Z 회전
  s?: number[]; // box [w,h,d] · plane [w,d]
  rt?: number; // cyl 윗 반지름
  rb?: number; // cyl 아랫 반지름
  h?: number; // cyl/cone 높이
  seg?: number; // 원형 분할
  open?: boolean; // cyl 옆면만(뚜껑 없음)
  t0?: number; // cyl thetaStart
  tl?: number; // cyl thetaLength(부분 실린더=아치)
  r?: number; // cone 반지름
  W?: number; // hiproof 처마 반폭 X
  D?: number; // hiproof 처마 반폭 Z
  H?: number; // hiproof 높이
  ridge?: number; // 용마루 길이 비율(0~1). 한국 길게(0.6), 일본/탑 짧게(0.3~)
  t?: number; // hiproof 처마 두께
  cap?: number; // 용마루 마루 높이 비율(0=없음). 한국 0.13
  fin?: number; // 마루 양끝 장식(망새) 높이 배수(0=없음). 한국 1.7
  up?: number; // 처마 끝(추녀/翼角) 들림(0=직선). 일본 강하게(~0.9)
  a?: number[]; // strut 시작점
  b?: number[]; // strut 끝점
  thick?: number; // strut 굵기
}

export interface ColliderDef {
  x: number;
  z: number;
  r: number;
  top: number;
}

export interface Landmark {
  /** 양식화 빌더 타입 — parts/mats 로 공통 렌더(전부 데이터 구동). */
  type: "structure";
  x: number;
  z: number;
  /** Y축 회전(라디안) — 다리·강변 건물 방향 맞춤. 기본 0. */
  rot?: number;
  // ── 데이터 구동(type="structure") 전용 ──
  parts?: Part[];
  mats?: MatDef[];
  colliders?: ColliderDef[];
  /** 축정렬 통과 불가 박스(광화문 피어 등). rot=0 기준 로컬 좌표. */
  boxColliders?: { x0: number; x1: number; z0: number; z1: number }[];
  /** 이 반경 안 OSM 건물을 제거(양식화 메시로 대체할 자리 비우기). */
  excludeR?: number;
}

export interface Mountain {
  x: number;
  z: number;
  h: number;
  r: number;
}

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
}

/** 카탈로그(목록) 항목 — public/maps/index.json */
export interface MapCatalogEntry {
  id: string;
  name: string;
  subtitle: string;
  bytes?: number;
  buildings?: number;
  lat?: number; // 침공 지점 위도(세계지도 표시용)
  lon?: number; // 침공 지점 경도
}

/** 전장 1개의 전체 렌더 데이터 — public/maps/<id>.json */
export interface MapData {
  id: string;
  name: string;
  subtitle: string;
  meta: { lat0: number; lon0: number; source: string };
  buildings: Ring[];
  roads: Ring[];
  water: Ring[];
  /** 성곽/궁장 등 둘레 담을 두를 닫힌 경계 폴리곤(있으면 내부는 맨땅 + 도로 제거) */
  boundary?: number[];
  /** 담장 개구부(문) */
  gates?: { x: number; z: number; r: number }[];
  /** 양식화 랜드마크(전각/동상 등) */
  landmarks?: Landmark[];
  /** 배경 산세(가우시안 봉우리) */
  mountains?: Mountain[];
  /** 플레이어 스폰 */
  spawn?: SpawnPoint;
  /** 경계(boundary) 내부를 특수 권역으로 처리하는 양식 — 없으면 일반 도심으로만 렌더. */
  precinct?: PrecinctSpec;
}

/**
 * 특수 권역(예: 궁궐 경내) 양식 — boundary 폴리곤 내부에 적용. 모든 값은 데이터(JSON)에서 주입해
 * 맵별 고유 처리를 코드 분기 없이 일반화한다. 색은 "0xRRGGBB" 문자열.
 */
/** 권역 내부 건물 양식(전통 전각 등). */
export interface PrecinctBuilding {
  color: string; // 벽체색
  maxHeight?: number; // 층고 상한(권역 내 저층화)
  skipEnclosuresOver?: number; // 이 면적 초과 인클로저(마당 솔리드)는 생략
  roof?: { color: string; thickness: number }; // 옥상 지붕 슬래브(기와 등)
}

/** 권역 경계 폴리라인을 따라 두르는 둘레 담장. */
export interface PrecinctWall {
  height: number;
  thickness: number;
  bodyColor: string;
  capColor: string;
}

export interface PrecinctSpec {
  /** 경계 내부 바닥색(있으면 포장 대신 이 색 맨땅 — 예: 마사토). */
  groundColor?: string;
  /** 경계 내부 아스팔트 도로·차선 제거 */
  suppressRoads?: boolean;
  /** 경계 내부 건물 양식 */
  building?: PrecinctBuilding;
  /** 둘레 담장 */
  wall?: PrecinctWall;
}
