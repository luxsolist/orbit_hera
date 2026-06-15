// 전지구 타일 월드 포맷 계약 — DEM(지형)+OSM(오브젝트)[+추후 지하]를 위경도 셀 디렉터리 안
// 1024m 청크 파일로 분할. 빌드(scripts/build-world.mjs)가 생성, 런타임(mapLocator/ChunkStreamer)·에디터가 소비.
//
// 디렉터리(public/ 기준):
//   maps/landmarks.json                          # 전역 랜드마크 → 위치(이름 → {mapId,lat,lon,cell,cx,cz})
//   maps/<latCell>/<lonCell>/tiles.json          # 셀 청크 인덱스(존재 청크 목록 + 격자 파라미터)
//   maps/<latCell>/<lonCell>/<cx>_<cz>.json      # 1024m 청크: 지형(DEM)+오브젝트(OSM)+지하 결합
//   (latCell/lonCell = floor(lat)/floor(lon), 1° 셀 ≈ 111km. 셀 원점 = NW 모서리 lat=cell+1, lon=cell)

import type { Ring, AreaRing } from "./MapData";

/** 위경도 정수도 셀 [floor(lat), floor(lon)]. */
export type Cell = [number, number];

export const M_LAT = 111320; // 위도 1도 ≈ m

export function geoCell(lat: number, lon: number): Cell {
  return [Math.floor(lat), Math.floor(lon)];
}

/** 셀 격자 경도 m/도 — 셀 중앙 위도 기준(생성기·매니페스트 mLon 과 동일). 순수. */
export function cellMLon(cellLat: number): number {
  return M_LAT * Math.cos(((cellLat + 0.5) * Math.PI) / 180);
}

/**
 * 위경도 → 셀-로컬 미터(원점 = 셀 NW 모서리, x=동/z=남 ≥0). 생성기(build-world.mjs)의 toCell 과 동일.
 * mLon 미지정 시 셀 중앙 위도로 계산(매니페스트 mLon 주입 시 격자 완전 일치). 순수.
 */
export function cellLocalOf(lat: number, lon: number, cell: Cell, mLon = cellMLon(cell[0])): { x: number; z: number } {
  return { x: (lon - cell[1]) * mLon, z: (cell[0] + 1 - lat) * M_LAT };
}

/** 위경도 → 타일 청크 좌표(셀 NW 원점). 생성기(build-world.mjs)와 동일 공식. 순수. */
export function cellChunkOf(lat: number, lon: number, chunkSize = 1024): { cell: Cell; cx: number; cz: number } {
  const cell: Cell = [Math.floor(lat), Math.floor(lon)];
  const { x, z } = cellLocalOf(lat, lon, cell);
  return { cell, cx: Math.floor(x / chunkSize), cz: Math.floor(z / chunkSize) };
}

// ── 경로 헬퍼(public/ 상대; fetch 시 BASE_URL 접두) ──
// 청크는 셀 디렉터리 안에서 다시 **블록 디렉터리 `<bx>_<bz>/`(블록=BLOCK×BLOCK 청크)** 로 분산 — 한 디렉터리에 파일이 수천 개 쌓이는 것 방지(블록당 ≤ BLOCK² 파일).
export const CHUNK_BLOCK = 16;
export const chunkBlockDir = (cx: number, cz: number, block = CHUNK_BLOCK): string => `${Math.floor(cx / block)}_${Math.floor(cz / block)}`;
export const worldChunkPath = (cell: Cell, cx: number, cz: number, block = CHUNK_BLOCK): string => `maps/${cell[0]}/${cell[1]}/${chunkBlockDir(cx, cz, block)}/${cx}_${cz}.json`;
export const tilesPath = (cell: Cell): string => `maps/${cell[0]}/${cell[1]}/tiles.json`;
export const landmarkIndexPath = (): string => `maps/landmarks.json`;

/** 존재하는 청크 1칸 — 오브젝트/지형 유무 + 건물 수(밀집 스폰용). */
export interface ChunkEntry {
  cx: number;
  cz: number;
  objects: boolean; // 건물·도로·수역·구역 중 하나라도 있으면 true
  terrain: boolean;
  buildings?: number; // 이 청크의 건물 수(신 매니페스트). 미존재 시 objects 불리언으로 폴백.
}

/** 청크 건물 수 — 신 매니페스트는 buildings, 구 매니페스트는 objects 불리언(1/0)으로 폴백. 순수. */
function buildingCount(c: ChunkEntry): number {
  return c.buildings ?? (c.objects ? 1 : 0);
}

/**
 * 무작위 스폰 청크 선택 — **건물 밀집 도심 위주**. 작전구역 중심이 될 청크를 고른다.
 *
 * 밀집도 = 반경 `R` 청크 이웃의 **건물 수 합**(도로·수역만 있는 산악 청크는 건물 0 → 후보 제외).
 * 건물 있는 + 지형(terrain) 후보를 밀집도순 정렬해 **상위 `topFrac`(기본 25%)** 안에서 무작위 선택
 * → 도심 코어에 집중하되 매판 다른 위치(변주). 건물 청크가 없으면(예: 에베레스트) 지형 청크,
 * 그것도 없으면 아무 청크. 빈 목록은 null. rand: ()=>[0,1). 순수(테스트 가능).
 */
export function pickSpawnChunk(chunks: ChunkEntry[], rand: () => number, R = 2, topFrac = 0.25): ChunkEntry | null {
  if (chunks.length === 0) return null;
  const candidates = chunks.filter((c) => buildingCount(c) > 0 && c.terrain); // 스폰 = 건물 + 디딜 지형(도로·수역만은 제외)
  if (candidates.length === 0) {
    const land = chunks.filter((c) => c.terrain);
    const pool = land.length > 0 ? land : chunks;
    return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  }
  // 이웃 건물 수 합으로 밀집도 산정 — 건물이 빽빽할수록 큼(도심 코어)
  const bmap = new Map<string, number>();
  for (const c of chunks) { const b = buildingCount(c); if (b > 0) bmap.set(`${c.cx}_${c.cz}`, b); }
  const scored = candidates.map((c) => {
    let d = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) d += bmap.get(`${c.cx + dx}_${c.cz + dz}`) ?? 0;
    return { c, d };
  });
  scored.sort((a, b) => b.d - a.d); // 밀집도 내림차순
  const topN = Math.max(1, Math.ceil(scored.length * Math.min(1, Math.max(0, topFrac)))); // 상위 비율(최소 1)
  return scored[Math.min(topN - 1, Math.floor(rand() * topN))].c;
}

/** 1024m 월드 청크 — 지형(DEM)+오브젝트(OSM)+지하. 좌표는 셀-로컬 m(원점=셀 NW). */
export interface WorldChunk {
  cx: number;
  cz: number;
  terrain: { size: number; seaLevel: number; heights: number[] }; // size×size row-major(평지=size 0)
  objects: { buildings: Ring[]; roads: Ring[]; water: Ring[]; walls?: Ring[]; areas?: AreaRing[] };
  underground: unknown | null; // 추후 별도 생성해 병합
}

/** 셀 타일 매니페스트 — maps/<latCell>/<lonCell>/tiles.json. */
export interface TilesManifest {
  cell: Cell;
  originLat: number; // 셀 NW 모서리(= cell[0]+1)
  originLon: number; // = cell[1]
  chunkSize: number; // m
  terrainSize: number; // 청크당 지형 샘플 한 변
  mLon: number; // 셀 격자 경도 m/도(= 111320·cos(cell+0.5))
  block: number; // 블록 디렉터리 한 변(청크 수) — worldChunkPath 의 <bx>_<bz>/ 계산
  chunks: ChunkEntry[];
}

/** 랜드마크 → 위치(위경도 + 셀 + 청크). */
export interface LandmarkLoc {
  mapId: string;
  lat: number;
  lon: number;
  cell: Cell;
  cx: number;
  cz: number;
}
/** 전역 랜드마크 인덱스 — maps/landmarks.json (이름 → 위치). */
export type LandmarkIndex = Record<string, LandmarkLoc>;
