import {applyRomeDetail} from './cities/RomeDetail';
import type {Cell,WorldChunk} from './chunkManifest';
import type {BundleChunk} from './MapBundles';
import {applyRoadGradePatch} from './RoadGradePatch';
import {applyBusanDetail} from './cities/BusanDetail';
import {applySeoulDetail} from './cities/SeoulDetail';
import {applySeoulLandmarkAppearance} from './cities/SeoulLandmarkAppearance';
import {correctGwanghwamunRoadGrade} from './cities/GwanghwamunRoadGrade';
import {correctGwanghwamunStatues} from './cities/GwanghwamunStatues';
import {correctPalaceSite} from './cities/PalaceSite';
import {correctGyeongbokgungChunk} from './cities/Gyeongbokgung';
import {correctJamsilChunk} from './cities/jamsilCorrection';
type Overlays=Pick<BundleChunk,'detail'|'roadGrade'|'appearance'>;
type Correction=(cell:Cell,chunk:WorldChunk,overlays:Overlays)=>WorldChunk;
// Only city-specific geometry belongs here; transport and cache never select correction order.
const beforeRoad:Record<string,Correction>={
 '41/12':(cell,chunk,{detail})=>detail?applyRomeDetail(cell,chunk,detail):chunk,
 '35/129':(cell,chunk,{detail})=>detail?applyBusanDetail(cell,chunk,detail):chunk,
};
const afterRoad:Record<string,Correction>={
 '37/126':(cell,chunk,{detail,appearance})=>{
  chunk=correctPalaceSite(cell,correctGyeongbokgungChunk(cell,correctJamsilChunk(cell,chunk)));
  return applySeoulLandmarkAppearance(cell,correctGwanghwamunRoadGrade(cell,correctGwanghwamunStatues(cell,detail?applySeoulDetail(cell,chunk,detail):chunk)),appearance);
 },
};
export function applyMapCorrections(cell:Cell,chunk:WorldChunk,overlays:Overlays):WorldChunk{
 const key=cell.join('/');
 chunk=beforeRoad[key]?.(cell,chunk,overlays)??chunk;
 chunk=applyRoadGradePatch(chunk,overlays.roadGrade);
 return afterRoad[key]?.(cell,chunk,overlays)??chunk;
}
