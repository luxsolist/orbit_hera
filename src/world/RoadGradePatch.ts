import type {WorldChunk} from './chunkManifest';
export interface RoadGradePatch {streetPlan?:import("./CompiledStreet").CompiledStreetPlan;version:number;size:number;points:[number,number,number][];refinement?:import('./RoadRefinement').RoadRefinement;surfaceRevision?:number;surfacePoints?:[number,number,number][];network?:{version:1;points:[number,number,number,number][]}}
/** Original-value guards make overlays reversible, idempotent and safe after map rebuilds. */
export function applyRoadGradePatch(raw:WorldChunk,patch:RoadGradePatch|null):WorldChunk{
 if(!patch||patch.version!==1||patch.size!==raw.terrain.size||!Array.isArray(patch.points))return raw;
 const source=raw.terrain.heights;
 if(![...patch.points,...(patch.surfacePoints??[])].every(([i,old,value])=>Number.isInteger(i)&&i>=0&&i<source.length&&Number.isFinite(old)&&Number.isFinite(value)&&(Math.abs(source[i]-old)<.01||Math.abs(source[i]-value)<.01)))return raw;
 const heights=source.slice();for(const [i,,value] of patch.points)heights[i]=value;
 const roadHeights=patch.surfaceRevision===1&&patch.surfacePoints?.length?heights.slice():undefined;
 if(roadHeights)for(const [i,,value] of patch.surfacePoints!)roadHeights[i]=value;
 return {...raw,...(roadHeights?{roadHeights}:{}),terrain:{...raw.terrain,heights}};
}

/** Baked final-surface correction: [index, expected land, expected street, delta].
 * Validate the entire patch first so stale recipes cannot partially change a chunk.
 */
export function applyRoadNetworkPatch(raw:WorldChunk,patch:RoadGradePatch|null):WorldChunk{
 const net=patch?.network;if(!net||patch?.size!==raw.terrain.size||net.version!==1||!Array.isArray(net.points)||!net.points.length)return raw;
 const land=raw.terrain.heights,street=raw.roadHeights??land;
 const valid=new Set(net.points.map(p=>p[0])).size===net.points.length&&net.points.every(([i,g,s,d])=>Number.isInteger(i)&&i>=0&&i<land.length&&[g,s,d].every(Number.isFinite)&&Math.abs(d)<=15.001);
 if(!valid)return raw;
 const matches=(applied:boolean)=>net.points.every(([i,g,s,d])=>Math.abs(land[i]-g-(applied?d:0))<.002&&Math.abs(street[i]-s-(applied?d:0))<.002);
 if(matches(true))return raw;if(!matches(false))return raw;
 const heights=Array.from(land),roadHeights=Array.from(street);
 for(const [i,,,d] of net.points){heights[i]+=d;roadHeights[i]+=d;}
 return {...raw,terrain:{...raw.terrain,heights},roadHeights};
}
