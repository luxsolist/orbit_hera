// 런타임에 서버에서 내려받는 전장(맵) 데이터 스키마.
// 모든 좌표는 로컬 미터(1 unit = 1m, 북 = -Z, 원점 = meta.lat0/lon0).

export interface WaterInfo {
  version: 1;
  kind: 'river' | 'stream' | 'canal' | 'lake' | 'pond' | 'reservoir' | 'unknown';
  style: 'natural' | 'engineered' | 'canal';
  styleSource: 'tag' | 'default' | 'legacy';
  widthSource: 'outline' | 'tag' | 'estimate' | 'legacy';
  sourceEstimate?:number;
  designWidth?:number;
  name?: string;
}

export interface Ring {
  highway?:string;roadName?:string;oneway?:string;lanes?:string;sourceNodes?:number[];service?:string;access?:string;
  streetSection?: {version:1;sourceWidth:number;carriageway:number;sidewalk:number;furniture:boolean;clearance:number;mode:"street"|"shared"|"conflict";explicitWidthAdjusted:boolean};
  structureKind?: 'platform' | 'shelter' | 'canopy';
  facilityKind?: 'platform' | 'shelter' | 'canopy' | 'toilets' | 'kiosk' | 'garage' | 'shed' | 'utility' | 'tollgate';
  roofed?: boolean;
  groundClearance?:number;
  clearanceSource?:string;
  supportPoints?:number[];
  ruin?:boolean;
  passageGroundParts?:{p:number[];holes?:number[][]}[];
  passageClearance?:number;
  walkableProfile?:{a:number[];b:number[];height:number;step:number};
  widthSource?: 'tag' | 'lanes' | 'class' | 'clearance';
  bridge?: boolean;
  tunnel?: boolean;
  layer?: number;
  /** Source-preserving water policy; no implicit city-wide engineered river section. */
  waterInfo?: WaterInfo;
  /** Reviewed replacement asset; attached only by the matching city patch. */
  landmarkModel?: string;
  statueModel?: string;
  palaceBuildingId?: string;
  landmarkAppearance?: import("./cities/SeoulLandmarkAppearance").LandmarkAppearance;
  seoulArchitecture?: import("./cities/SeoulDetail").DetailBuilding;
  /** Optional audit provenance; absent in older baked tiles. */
  osmId?: string;
  heightSource?: 'osm-height' | 'levels-estimate' | 'type-estimate' | 'default-estimate' | 'neighbor-estimate' | 'footprint-estimate';
  heightTag?: string;
  levelsTag?: string;
  p: number[]; // [x0,z0,x1,z1,...]
  h?: number; // 건물/담장 높이(m)
  w?: number; // 도로 폭 / 담장 두께 / 하천 폭(m)
  holes?: number[][]; // 수역 멀티폴리곤 구멍(섬·제방=육지). 각 [x0,z0,...] 닫힌 링. even-odd 채움으로 도려냄.
  /**
   * 얽힘 유형 — 이 건물이 **랜드마크로 승격**됐음을 뜻한다(일반 건물엔 없음).
   * 빌드가 부착(scripts/osm.mjs landmarkFrom = OSM 태그 자동분류, 또는 큐레이션 카탈로그 강제 승격),
   * 런타임은 BuildingCombat 에 일반 건물 대신 랜드마크로 등록한다. 정본: [entanglement.ts]
   */
  lm?: import("./entanglement").EntanglementClass;
  n?: string; // 랜드마크 표시명(브리핑/HUD) — lm 보유 시에만
}

/** 지표 면(공원/잔디/숲/모래/바위/포장 등) — k=종류(색 구분 키). */
export interface AreaRing {
  p: number[]; // 닫힌 폴리곤 [x0,z0,...]
  k: string; // "park"|"garden"|"grass"|"pitch"|"wood"|"scrub"|"sand"|"rock"|"pavement"
}

/**
 * 비건물 랜드마크(site) — 해변·교량·공원·하천·곶처럼 **건물 footprint 가 없는** 랜드마크.
 *
 * 왜 별도 엔티티인가: 랜드마크의 정본 경로는 "건물 승격"(Ring.lm)인데, 큐레이션 카탈로그의 상당수는
 * 애초에 건물이 아니다(실측: 부산 21개 중 8개 — 해운대·광안대교·태종대 류). 면/선 지오메트리에 얹으면
 * 청크 클립으로 조각나 하나가 여럿으로 세어지므로, 좌표+반경을 갖는 독립 엔티티로 둔다.
 * 좌표는 셀-로컬 m, y 는 빌드가 DEM 에서 구운 지표 높이.
 */
export interface SiteLandmark {
  x: number;
  z: number;
  y: number; // 지표 높이(빌드가 DEM 샘플) — 런타임은 전역 DEM 이 없어 직접 구할 수 없다
  r: number; // 대표 반경(m) — 하부 면(해변/공원) 크기에서 추정, 없으면 기본값
  lm: import("./entanglement").EntanglementClass;
  n?: string; // 표시명
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
  g: "box" | "cyl" | "cone" | "plane" | "hiproof" | "strut" | "mesh";
  vertices?: number[]; // custom non-indexed triangle mesh
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
  /** 얽힘 유형(택소노미 — [entanglement.ts]) — 미션 표적 선정·해제 저항·브리핑의 단일 출처. */
  cls?: import("./entanglement").EntanglementClass;
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
  /** 전지구 타일 월드(청크 스트리밍) 전장. 모든 전장이 스트리밍이다. */
  stream?: boolean;
  /** 스트리밍 전장 시작 방위(rad). 기본 0. */
  spawnYaw?: number;
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


