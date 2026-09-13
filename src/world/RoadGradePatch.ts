import type {WorldChunk} from './chunkManifest';
export interface RoadGradePatch {version:number;size:number;points:[number,number,number][]}
/** Original-value guards make overlays reversible, idempotent and safe after map rebuilds. */
export function applyRoadGradePatch(raw:WorldChunk,patch:RoadGradePatch|null):WorldChunk{
 if(!patch||patch.version!==1||patch.size!==raw.terrain.size||!Array.isArray(patch.points))return raw;
 const source=raw.terrain.heights;
 if(!patch.points.every(([i,old,value])=>Number.isInteger(i)&&i>=0&&i<source.length&&Number.isFinite(old)&&Number.isFinite(value)&&(Math.abs(source[i]-old)<.01||Math.abs(source[i]-value)<.01)))return raw;
 const heights=source.slice();for(const [i,,value] of patch.points)heights[i]=value;
 return {...raw,terrain:{...raw.terrain,heights}};
}
