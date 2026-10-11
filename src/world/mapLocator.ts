import {readMapBundle,bundleEntry,type BundlePayload} from './MapBundles';
import {restoreRegionalArchitecture} from './cities/SeoulDetail';
import {fetchCatalog} from './maps';
// 위치(위도/경도) → 전지구 타일 월드 조회 — 위경도 셀 디렉터리를 타고 들어가 그 위치의 1024m 청크를 읽는다.
// 전역 랜드마크 인덱스(maps/landmarks.json)로 랜드마크 이름 → 위치/소속 청크도 조회.

import {
  cellLocalOf, cellChunkOf, worldChunkPath, tilesPath, landmarkIndexPath, M_LAT,
  type Cell, type WorldChunk, type TilesManifest, type LandmarkIndex, type LandmarkLoc,
} from "./chunkManifest";

/** 위경도 두 점 사이 근사 거리(m) — 평면 근사(소규모 거리). 순수. */
export function latLonDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * M_LAT;
  const dLon = (lon2 - lon1) * M_LAT * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/** 청크 (cx,cz) 중심을 둘러싼 반경 r청크 이내 청크 좌표(스트리밍 로드 창). 순수. */
export function neighborChunks(cx: number, cz: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) out.push([cx + dx, cz + dz]);
  return out;
}

const BASE = (): string => (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";

async function fetchJson<T>(path: string, baseUrl?:string): Promise<T | null> {
  try {
    const res = await fetch(baseUrl?new URL(path,baseUrl).href:`${BASE()}${path}`, { cache: "no-cache" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** 셀 타일 매니페스트(존재 청크 목록). */
export const fetchTiles = (cell: Cell): Promise<TilesManifest | null> => fetchJson<TilesManifest>(tilesPath(cell));

/** A city's build grid can extend beyond its integer latitude/longitude cell. */
export async function fetchCityTiles(lat:number,lon:number,mapId?:string):Promise<TilesManifest> {
  let cell:Cell=[Math.floor(lat),Math.floor(lon)];
  if(mapId){
    const entry=(await fetchCatalog()).find(c=>c.id===mapId);
    if(!entry?.stream||!Number.isFinite(entry.lat)||!Number.isFinite(entry.lon))
      throw new Error(`도시 지도 기준점 없음: ${mapId}`);
    cell=[Math.floor(entry.lat!),Math.floor(entry.lon!)];
  }
  const manifest=await fetchTiles(cell);
  if(!manifest)throw new Error(`타일 매니페스트 없음: ${tilesPath(cell)}`);
  return manifest;
}
export function manifestChunkAt(manifest:TilesManifest,lat:number,lon:number){
  const p=cellLocalOf(lat,lon,manifest.cell,manifest.mLon);
  return {cx:Math.floor(p.x/manifest.chunkSize),cz:Math.floor(p.z/manifest.chunkSize)};
}

/** (lat,lon) 위치의 1024m 청크 로드(지형+오브젝트). 없으면 null. */
export async function fetchWorldChunkAt(lat: number, lon: number, chunkSize = 1024, mapId?:string): Promise<WorldChunk | null> {
  if(mapId){
    const m=await fetchCityTiles(lat,lon,mapId),p=manifestChunkAt(m,lat,lon);
    if(!m.chunks.some(c=>c.cx===p.cx&&c.cz===p.cz))return null;
    return fetchWorldChunk(m.cell,p.cx,p.cz,m.block);
  }
  const { cell, cx, cz } = cellChunkOf(lat, lon, chunkSize);
  return fetchWorldChunk(cell,cx,cz);
}

/**
 * 청크 좌표로 직접 로드. block=매니페스트 블록 크기(경로 <bx>_<bz>/ 계산).
 * 런타임은 완성 청크(mapBuild v1: 보정·가로 컴파일이 빌드 시 끝난 데이터)만 받는다. 압축 묶음이 기본이고,
 * DecompressionStream 이 없으면 같은 완성 청크 JSON 을 읽는다. 원본+보정 조합은 빌드(MapCorrections) 몫이다.
 */
export const fetchWorldChunk = async (cell: Cell, cx: number, cz: number, block?: number, baseUrl?:string, bundlePayload?:BundlePayload): Promise<WorldChunk | null> => {
  let raw:WorldChunk|null=null;
  if(bundleEntry(cell,cx,cz)&&typeof DecompressionStream!=='undefined'){
    for(let attempt=0;attempt<2;attempt++){
      try{raw=(await readMapBundle(cell,cx,cz,baseUrl,attempt===0?bundlePayload:undefined))?.raw??null;break;}
      catch(error){if(attempt===1)throw new Error(`지도 묶음 로드 실패 (${cx}, ${cz}): ${String(error)}`);}
    }
  }
  raw??=await fetchJson<WorldChunk>(worldChunkPath(cell,cx,cz,block),baseUrl);
  if(!raw)return null;
  if(raw.mapBuild?.version!==1)throw new Error(`완성 청크가 아닙니다 (${cell.join('/')} ${cx}, ${cz}) — 지도 빌드를 다시 실행하세요.`);
  // Completed tiles built before the landmark-binding fix still need authored models re-bound.
  return restoreRegionalArchitecture(raw);
};

/** 랜드마크 이름 → 위치(위경도/셀/청크). */
export async function fetchLandmarkLocation(name: string): Promise<LandmarkLoc | null> {
  const idx = await fetchJson<LandmarkIndex>(landmarkIndexPath());
  return idx?.[name] ?? null;
}

export { cellChunkOf };
