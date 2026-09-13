import {applyRoadGradePatch,type RoadGradePatch} from './RoadGradePatch';
import {correctGwanghwamunRoadGrade} from './cities/GwanghwamunRoadGrade';
import {correctGwanghwamunStatues} from './cities/GwanghwamunStatues';
import {applySeoulDetail,type SeoulDetail} from './cities/SeoulDetail';
import seoulIndex from './cities/seoul-detail-index.json';
import {correctPalaceSite} from './cities/PalaceSite';
import {correctGyeongbokgungChunk} from './cities/Gyeongbokgung';
import {correctJamsilChunk} from './cities/jamsilCorrection';
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

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE()}${path}`, { cache: "no-cache" });
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

/** 청크 좌표로 직접 로드. block=매니페스트 블록 크기(경로 <bx>_<bz>/ 계산). */
const seoulChunks=new Set(seoulIndex.chunks);
let roadGradeIndex:Promise<{cells:Record<string,string[]>}|null>|undefined;
async function fetchRoadGrade(cell:Cell,key:string){
 roadGradeIndex??=fetchJson<{cells:Record<string,string[]>}>('maps/road-grade/index.json');
 const index=await roadGradeIndex,cellKey=cell.join('/');
 return index?.cells?.[cellKey]?.includes(key)?fetchJson<RoadGradePatch>(`maps/road-grade/${cellKey}/${key}.json`):null;
}
export const fetchWorldChunk = async (cell: Cell, cx: number, cz: number, block?: number): Promise<WorldChunk | null> => {
  const key=`${cx}_${cz}`;
  const [raw,detail,roadGrade]=await Promise.all([
    fetchJson<WorldChunk>(worldChunkPath(cell,cx,cz,block)),
    cell[0]===37&&cell[1]===126&&seoulChunks.has(key)?fetchJson<SeoulDetail>(`maps/details/seoul/${key}.json`):Promise.resolve(null),
    fetchRoadGrade(cell,key),
  ]);
  if(!raw)return null;
  const chunk=correctPalaceSite(cell,correctGyeongbokgungChunk(cell,correctJamsilChunk(cell,applyRoadGradePatch(raw,roadGrade))));
  return correctGwanghwamunRoadGrade(cell,correctGwanghwamunStatues(cell,detail?applySeoulDetail(cell,chunk,detail):chunk));
};

/** 랜드마크 이름 → 위치(위경도/셀/청크). */
export async function fetchLandmarkLocation(name: string): Promise<LandmarkLoc | null> {
  const idx = await fetchJson<LandmarkIndex>(landmarkIndexPath());
  return idx?.[name] ?? null;
}

export { cellChunkOf };
