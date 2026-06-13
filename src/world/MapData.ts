// 런타임에 서버에서 내려받는 전장(맵) 데이터 스키마.
// 모든 좌표는 로컬 미터(1 unit = 1m, 북 = -Z, 원점 = meta.lat0/lon0).

export interface Ring {
  p: number[]; // [x0,z0,x1,z1,...]
  h?: number; // 건물/담장 높이(m)
  w?: number; // 도로 폭 / 담장 두께 / 하천 폭(m)
  holes?: number[][]; // 수역 멀티폴리곤 구멍(섬·제방=육지). 각 [x0,z0,...] 닫힌 링. even-odd 채움으로 도려냄.
}

/** 지표 면(공원/잔디/숲/모래/바위/포장 등) — k=종류(색 구분 키). */
export interface AreaRing {
  p: number[]; // 닫힌 폴리곤 [x0,z0,...]
  k: string; // "park"|"garden"|"grass"|"pitch"|"wood"|"scrub"|"sand"|"rock"|"pavement"
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
  /** 랜드마크 고유 체력(일반 건물과 별개) — 미지정 시 BuildingCombat 기본값. */
  hp?: number;
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
  /** 전지구 타일 월드(청크 스트리밍) 전장 — true 면 모놀리식 <id>.json 대신 StreamingWorld 로 로드. */
  stream?: boolean;
  /** 스트리밍 전장 시작 방위(rad). 기본 0. */
  spawnYaw?: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// 섹션형 스키마 v2 — 지형 / 오브젝트 / 지하를 한 JSON 안의 **독립 섹션**으로 분리.
// 맵 에디터에서 각 레이어(지형·건물·지하)를 따로 커스텀하기 위함. 하위호환은 normalizeMapData 가 담당.
// ─────────────────────────────────────────────────────────────────────────────

/** DEM 기반 하이트맵 — Float32 raw(.bin, size×size, row-major) 를 로컬 격자에 매핑. */
export interface HeightmapSpec {
  src: string; // public 경로(Float32 raw little-endian, size*size 개)
  size: number; // 격자 한 변 텍셀 수 N (N×N)
  meters: number; // 커버 변 길이(m) — 텍셀당 = meters/(size-1)
  originX?: number; // 좌상단(최소 x) 로컬 m. 기본 -meters/2
  originZ?: number; // 좌상단(최소 z) 로컬 m. 기본 -meters/2
}

/** 절차적 지형(하이트맵 없을 때 폴백) — 현 가우시안 봉우리 + 완만 기복 + 도심 평탄화. */
export interface ProceduralTerrain {
  mountains?: Mountain[];
  flattenCity?: boolean; // 도심(건물 bbox) 평탄화. 기본 true
  ripple?: number; // 완만한 기복 진폭(m). 기본 3
}

/** 지형 섹션 — 지표면 높이장 + 해수면 + 수역. (에디터: 지형 레이어) */
export interface TerrainSpec {
  seaLevel?: number; // 해수면 Y(m). 기본 0
  heightmap?: HeightmapSpec; // 있으면 DEM 샘플, 없으면 procedural
  procedural?: ProceduralTerrain;
  water?: Ring[]; // 수역 폴리곤
}

/** 지표 위 오브젝트 섹션 — 건물·도로·담장·지표면·랜드마크·경계. (에디터: 오브젝트 레이어) */
export interface ObjectsSpec {
  buildings: Ring[];
  roads: Ring[];
  walls?: Ring[]; // 담장/울타리(폴리라인 + h 높이 + w 두께)
  areas?: AreaRing[]; // 공원/잔디/숲/모래/바위 등 지표 면
  landmarks?: Landmark[];
  boundary?: number[];
  gates?: { x: number; z: number; r: number }[];
  precinct?: PrecinctSpec;
}

/** 지하 섹션 — §4 지하 공간 시스템 대비 골격(현재 예약). (에디터: 지하 레이어) */
export interface UndergroundSpec {
  layers?: unknown[]; // 추후: 터널/역/동굴 레이어(top/bottom 콜라이더 포함)
}

/** 정규화된 전장 데이터(섹션형 canonical) — World/TerrainField 가 소비. */
export interface NormalizedMap {
  id: string;
  name: string;
  subtitle: string;
  meta: { lat0: number; lon0: number; source: string; schema: number };
  terrain: TerrainSpec;
  objects: ObjectsSpec;
  underground?: UndergroundSpec;
  spawn: SpawnPoint;
}

/**
 * 평면(v1) 또는 섹션(v2) 원본 JSON → 섹션형 canonical(`NormalizedMap`). 순수.
 * - v2(`objects` 존재): 섹션을 그대로 쓰되 누락 기본값 채움.
 * - v1(평면): 최상위 `buildings/roads/...` → `objects`, `water/mountains` → `terrain`으로 끌어올림.
 */
export function normalizeMapData(raw: any): NormalizedMap {
  const meta = {
    lat0: raw?.meta?.lat0 ?? 0,
    lon0: raw?.meta?.lon0 ?? 0,
    source: raw?.meta?.source ?? "",
    schema: raw?.meta?.schema ?? (raw?.objects ? 2 : 1),
  };
  const spawn: SpawnPoint = raw?.spawn ?? { x: 0, z: 0, yaw: 0 };

  if (raw?.objects) {
    // v2 — 섹션형. 기본값만 보강.
    const t = raw.terrain ?? {};
    return {
      id: raw.id, name: raw.name, subtitle: raw.subtitle, meta, spawn,
      terrain: {
        seaLevel: t.seaLevel ?? 0,
        heightmap: t.heightmap,
        procedural: t.procedural ?? { flattenCity: true, ripple: 3 },
        water: t.water ?? [],
      },
      objects: {
        buildings: raw.objects.buildings ?? [],
        roads: raw.objects.roads ?? [],
        walls: raw.objects.walls,
        areas: raw.objects.areas,
        landmarks: raw.objects.landmarks,
        boundary: raw.objects.boundary,
        gates: raw.objects.gates,
        precinct: raw.objects.precinct,
      },
      underground: raw.underground,
    };
  }

  // v1 — 평면. 끌어올려 섹션화.
  return {
    id: raw.id, name: raw.name, subtitle: raw.subtitle, meta, spawn,
    terrain: {
      seaLevel: 0,
      procedural: { mountains: raw.mountains ?? [], flattenCity: true, ripple: 3 },
      water: raw.water ?? [],
    },
    objects: {
      buildings: raw.buildings ?? [],
      roads: raw.roads ?? [],
      walls: raw.walls,
      areas: raw.areas,
      landmarks: raw.landmarks,
      boundary: raw.boundary,
      gates: raw.gates,
      precinct: raw.precinct,
    },
    underground: raw.underground,
  };
}

/**
 * 하이트맵 바이리니어 샘플 — 로컬 (x,z) 의 지표 높이(m). 격자 밖은 가장자리 클램프. 순수.
 * heights: Float32 row-major size×size, 행=z 증가, 열=x 증가. originX/Z = 좌상단(최소) 로컬 m.
 */
export function sampleHeightmap(
  heights: Float32Array, size: number, meters: number,
  originX: number, originZ: number, x: number, z: number
): number {
  const step = meters / (size - 1);
  // 격자 좌표(부동)
  const gx = (x - originX) / step;
  const gz = (z - originZ) / step;
  const cx = Math.min(size - 1, Math.max(0, gx));
  const cz = Math.min(size - 1, Math.max(0, gz));
  const x0 = Math.floor(cx), z0 = Math.floor(cz);
  const x1 = Math.min(size - 1, x0 + 1), z1 = Math.min(size - 1, z0 + 1);
  const fx = cx - x0, fz = cz - z0;
  const h00 = heights[z0 * size + x0], h10 = heights[z0 * size + x1];
  const h01 = heights[z1 * size + x0], h11 = heights[z1 * size + x1];
  const top = h00 + (h10 - h00) * fx;
  const bot = h01 + (h11 - h01) * fx;
  return top + (bot - top) * fz;
}
