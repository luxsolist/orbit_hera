import {applyRoadRefinement} from './RoadRefinement';
import {planStreetSections} from './streetSection.mjs';
import {fitStreetWidths} from './streetSpace.mjs';
import {reconcileUrbanTerrain,reconcileSurfaceDetails} from './SurfaceCoherence';
import {applyCheonggyePilot,inPilot} from './cities/CheonggyePilot';
import {applyAthensDetail} from './cities/AthensDetail';
import {applyRomeDetail} from './cities/RomeDetail';
import type {Cell,WorldChunk} from './chunkManifest';
import type {BundleChunk} from './MapBundles';
import {applyRoadGradePatch,applyRoadNetworkPatch} from './RoadGradePatch';
import {applyBusanDetail} from './cities/BusanDetail';
import {applySeoulDetail,restoreRegionalArchitecture} from './cities/SeoulDetail';
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
 '37/23':(cell,chunk,{detail})=>detail?applyAthensDetail(cell,chunk,detail):chunk,
 '41/12':(cell,chunk,{detail})=>detail?applyRomeDetail(cell,chunk,detail):chunk,
 '35/129':(cell,chunk,{detail})=>detail?applyBusanDetail(cell,chunk,detail):chunk,
};
const afterRoad:Record<string,Correction>={
 '37/126':(cell,chunk,{detail,appearance})=>{
  chunk=correctPalaceSite(cell,correctGyeongbokgungChunk(cell,correctJamsilChunk(cell,chunk)));
  return applySeoulLandmarkAppearance(cell,correctGwanghwamunRoadGrade(cell,correctGwanghwamunStatues(cell,detail?applySeoulDetail(cell,chunk,detail):chunk)),appearance);
 },
};
export function applyMapCorrections(cell:Cell,chunk:WorldChunk,overlays:Overlays,options:{streetSections?:boolean;streetPilot?:boolean;surfaceCoherence?:boolean;roadNetwork?:boolean;localRefinement?:boolean}={}):WorldChunk{
 if(chunk.mapBuild?.version===1)return restoreRegionalArchitecture(chunk);
 const key=cell.join('/');
 chunk=beforeRoad[key]?.(cell,chunk,overlays)??chunk;
 chunk=applyRoadGradePatch(chunk,overlays.roadGrade);
 const before=chunk;
 chunk=afterRoad[key]?.(cell,chunk,overlays)??chunk;
 // Reviewed city geometry has precedence over generic surface estimates.
 if(chunk.roadHeights&&chunk.terrain.heights!==before.terrain.heights)chunk={...chunk,roadHeights:chunk.roadHeights.map((h,i)=>chunk.terrain.heights[i]!==before.terrain.heights[i]?chunk.terrain.heights[i]:h)};
 // Subterranean paths are not painted onto the surface city.
 chunk={...chunk,objects:{...chunk.objects,roads:chunk.objects.roads.filter(r=>!r.tunnel&&(r.layer??0)>=0)}};
 // Classify once before any geometry, facade, collision or road generation.
 const separate=(b:WorldChunk['objects']['buildings'][number])=>!!b.structureKind&&!b.landmarkModel&&!b.statueModel&&!b.palaceBuildingId&&!b.seoulArchitecture;
 const structures=[...(chunk.objects.structures??[]),...chunk.objects.buildings.filter(separate)];
 const objects={...chunk.objects,buildings:chunk.objects.buildings.filter(b=>!separate(b)),structures};
 chunk={...chunk,objects:fitStreetWidths(objects)};
 chunk=options.streetPilot===false?chunk:applyCheonggyePilot(cell,chunk);
 // Final placement (including authored river streets) must obey the common space budget.
 if(options.streetSections!==false)chunk={...chunk,objects:planStreetSections(chunk.objects)};
 chunk=options.surfaceCoherence===false?chunk:reconcileUrbanTerrain(chunk,(x,z)=>!!chunk.streetPilot&&inPilot(x,z));
 chunk=options.roadNetwork===false?chunk:applyRoadNetworkPatch(chunk,overlays.roadGrade);
 if(options.localRefinement!==false&&options.roadNetwork!==false&&options.surfaceCoherence!==false)chunk=applyRoadRefinement(chunk,overlays.roadGrade?.refinement);
 chunk=options.surfaceCoherence===false?chunk:reconcileSurfaceDetails(chunk);
 if(overlays.roadGrade?.streetPlan?.version===1){const plan=overlays.roadGrade.streetPlan,footprints=new Map(plan.buildings?.map(b=>[b.id,b.p]));chunk={...chunk,...(plan.terrainHeights?{terrain:{...chunk.terrain,size:Math.sqrt(plan.terrainHeights.length),heights:plan.terrainHeights},roadHeights:plan.roadHeights??plan.terrainHeights}:{}),compiledStreet:plan,objects:{...chunk.objects,sites:plan.resolvedSites??chunk.objects.sites,water:plan.resolvedWater??chunk.objects.water,walls:plan.walls??chunk.objects.walls,structures:plan.resolvedStructures??chunk.objects.structures,buildings:plan.resolvedBuildings??chunk.objects.buildings.map(b=>footprints.has(b.osmId??" ")?{...b,p:footprints.get(b.osmId!)!}:b)}};}
 return chunk;
}
