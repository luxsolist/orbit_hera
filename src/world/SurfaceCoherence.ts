import type {WorldChunk} from './chunkManifest';

export const SURFACE_COHERENCE={passes:32,relaxation:.55,maxAdjustment:10,roadRadius:96,buildingRadius:128};
type Point=[number,number];
/** Final pass after authored terrain edits. Fix urban bumps, never regrade whole
 * mountain/sea tiles. Border samples stay fixed so adjacent chunks still meet. */
export function reconcileUrbanTerrain(chunk:WorldChunk,protectedAt:(x:number,z:number)=>boolean=()=>false,size=1024):WorldChunk{
 if(chunk.surfaceReconciled)return chunk;
 const n=chunk.terrain.size,source=chunk.terrain.heights,step=size/(n-1),x0=chunk.cx*size,z0=chunk.cz*size;
 if(n<3||source.length!==n*n)return chunk;
 const authored=new Set((chunk.seoulDetail?.terrain??[]).map(([index])=>index));
 const mask=new Uint8Array(n*n),built=new Uint8Array(n*n),road=new Uint8Array(n*n);
 const stamp=(p:number[],pad:number,target:Uint8Array)=>{
  const xs=p.filter((_,i)=>i%2===0),zs=p.filter((_,i)=>i%2===1);if(!xs.length)return;
  const loX=Math.max(1,Math.ceil((Math.min(...xs)-pad-x0)/step)),hiX=Math.min(n-2,Math.floor((Math.max(...xs)+pad-x0)/step));
  const loZ=Math.max(1,Math.ceil((Math.min(...zs)-pad-z0)/step)),hiZ=Math.min(n-2,Math.floor((Math.max(...zs)+pad-z0)/step));
  for(let j=loZ;j<=hiZ;j++)for(let i=loX;i<=hiX;i++)target[j*n+i]=1;
 };
 for(const b of chunk.objects.buildings)stamp(b.p,SURFACE_COHERENCE.buildingRadius,built);
 for(const r of chunk.objects.roads)if(!r.bridge&&!r.tunnel)for(let i=2;i<r.p.length;i+=2)stamp(r.p.slice(i-2,i+2),SURFACE_COHERENCE.roadRadius,road);
 for(let j=1;j<n-1;j++)for(let i=1;i<n-1;i++){
  const k=j*n+i;if(!built[k]||!road[k]||authored.has(k)||[-1,0,1].some(dz=>[-1,0,1].some(dx=>protectedAt(x0+(i+dx)*step,z0+(j+dz)*step))))continue;
  const near:number[]=[];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)near.push(source[k+dz*n+dx]);
  if(near.every(Number.isFinite)&&Math.min(...near)>1&&Math.max(...near)-Math.min(...near)<30)mask[k]=1;
 }
 let heights=Array.from(source);
 for(let pass=0;pass<SURFACE_COHERENCE.passes;pass++){
  const next=heights.slice();for(let k=0;k<mask.length;k++)if(mask[k]){
   const mean=(heights[k-1]+heights[k+1]+heights[k-n]+heights[k+n])/4;
   next[k]=Math.max(source[k]-SURFACE_COHERENCE.maxAdjustment,Math.min(source[k]+SURFACE_COHERENCE.maxAdjustment,heights[k]+(mean-heights[k])*SURFACE_COHERENCE.relaxation));
  }heights=next;
 }
 const roadHeights=chunk.roadHeights?.map((h,i)=>Math.max(heights[i],h+heights[i]-source[i]));
 return {...chunk,surfaceReconciled:true,terrain:{...chunk.terrain,heights},...(roadHeights?{roadHeights}:{})};
}

/** DEM-derived water levels must follow the FINAL ground, not stale source DEM.
 * Surveyed/OSM elevations and sea datum remain authoritative. */
export function reconciledWaterLevel(w:{p:number[];level?:number;levelSource?:string},height:(x:number,z:number)=>number):number|undefined{
 if(w.level==null||w.levelSource!=='shore-dem-estimate')return w.level;
 const points:Point[]=[];
 for(let i=0;i<w.p.length;i+=2){const j=(i+2)%w.p.length,steps=Math.max(1,Math.ceil(Math.hypot(w.p[j]-w.p[i],w.p[j+1]-w.p[i+1])/4));for(let k=0;k<steps;k++)points.push([w.p[i]+(w.p[j]-w.p[i])*k/steps,w.p[i+1]+(w.p[j+1]-w.p[i+1])*k/steps]);}
 const samples=points.map(p=>height(...p));if(!samples.length||!samples.every(Number.isFinite))return w.level;
 return Math.min(...samples)-.15;
}

/** Bind derived levels into final map data as well as using them in the renderer. */
export function reconcileSurfaceDetails(chunk:WorldChunk,size=1024):WorldChunk{
 if(!chunk.seoulDetail)return chunk;
 const n=chunk.terrain.size,h=chunk.terrain.heights,x0=chunk.cx*size,z0=chunk.cz*size;
 const height=(x:number,z:number)=>{
  if(n<2||x<x0||x>x0+size||z<z0||z>z0+size)return NaN;
  const gx=(x-x0)/size*(n-1),gz=(z-z0)/size*(n-1),i=Math.min(n-2,Math.floor(gx)),j=Math.min(n-2,Math.floor(gz)),fx=gx-i,fz=gz-j;
  const a=h[j*n+i],b=h[j*n+i+1],c=h[(j+1)*n+i],d=h[(j+1)*n+i+1];return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
 };
 const water=chunk.seoulDetail.water.map(w=>{const level=reconciledWaterLevel(w,height);return level===w.level?w:{...w,level};});
 return {...chunk,seoulDetail:{...chunk.seoulDetail,water}};
}
