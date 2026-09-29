import {terrainTransitionWeight} from '../TerrainTransition';
import {solveRoadNetwork,roadSegmentKey,corridorOutline,insideRoadOutline} from '../RoadNetwork';
import {subtractSurface,type SurfacePolygon} from '../SurfacePartition';
import recipe from './cheonggye-pilot.json';
import type {Cell,WorldChunk} from '../chunkManifest';
export const CHEONGGYE_PILOT=recipe;
export const pilotRoadNetwork=solveRoadNetwork(recipe.roadNetwork);
const bridgeSegments=new Set(recipe.roadNetwork.filter(r=>r.bridge).map(r=>roadSegmentKey(r.p)));
const replacedRoadSegments=new Set(recipe.roadReplacements.map(r=>roadSegmentKey(r.p)));
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export function pilotWeight(x:number,z:number):number {
 return 1-smooth(recipe.halfSize+32,recipe.halfSize+recipe.blend,Math.max(Math.abs(x-recipe.center[0]),Math.abs(z-recipe.center[1])));
}
export const inPilot=(x:number,z:number)=>Math.max(Math.abs(x-recipe.center[0]),Math.abs(z-recipe.center[1]))<=recipe.halfSize;
export const pilotStreetHeight=(x:number,z:number)=>recipe.plane[0]+recipe.design.landGrade[0]*(x-recipe.center[0])+recipe.design.landGrade[1]*(z-recipe.center[1]);
export function segmentDistance(x:number,z:number,a:number[],b:number[]):number {
 const dx=b[0]-a[0],dz=b[1]-a[1],f=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
 return Math.hypot(x-a[0]-f*dx,z-a[1]-f*dz);
}
export function channelDistance(x:number,z:number):number {
 let d=Infinity;for(let i=1;i<recipe.channel.length;i++)d=Math.min(d,segmentDistance(x,z,recipe.channel[i-1],recipe.channel[i]));return d;
}
/** Continuous cross section: bed / water / lower path / retaining wall / upper bank.
 * The OSM centerline here is monotonic eastward; widths are perpendicular to the X sections.
 * Shared cut boundaries, render geometry and height queries all consume these sections.
 */
export const PILOT_SECTION=recipe.design.section;
export const pilotRiverLimits=[recipe.center[0]-recipe.halfSize-recipe.blend,recipe.center[0]+recipe.halfSize+recipe.blend];
export function pilotChannelZ(x:number):number {
 for(let i=1;i<recipe.channel.length;i++){const a=recipe.channel[i-1],b=recipe.channel[i];if(x<=b[0])return a[1]+(b[1]-a[1])*Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0])));}
 return recipe.channel[recipe.channel.length-1][1];
}
export const pilotInRiver=(x:number,z:number)=>x>=pilotRiverLimits[0]&&x<=pilotRiverLimits[1]&&Math.abs(z-pilotChannelZ(x))<PILOT_SECTION.bank;
export const pilotRiverBlend=(x:number)=>smooth(recipe.halfSize,recipe.halfSize+recipe.blend,Math.abs(x-recipe.center[0]));
export function pilotWaterHeight(x:number,land=pilotStreetHeight):number {
 const blend=pilotRiverBlend(x),water=recipe.plane[0]-recipe.design.waterDrop+recipe.design.waterGrade*(x-recipe.center[0]);
 return water*(1-blend)+(land(x,pilotChannelZ(x))-.06)*blend;
}
// Two 100m longitudinal access ramps on the south bank, connected at both ends.
export const pilotRamps=recipe.design.rampOffsets.map(offset=>recipe.center[0]+offset);
export function pilotRampFactor(x:number):number {
 for(const start of pilotRamps)if(x>=start&&x<=start+100)return Math.max(0,(Math.abs(x-start-50)-6)/44);
 return 1;
}
export function pilotGroundHeight(x:number,z:number,land=pilotStreetHeight):number {
 if(!pilotInRiver(x,z))return land(x,z);
 const d=Math.abs(z-pilotChannelZ(x)),water=pilotWaterHeight(x,land),path=water+PILOT_SECTION.pathRise*(1-pilotRiverBlend(x));
 if(d<PILOT_SECTION.water)return water-PILOT_SECTION.waterDepth;
 if(d<PILOT_SECTION.path)return path;
 return z>pilotChannelZ(x)?path+(land(x,z)-path)*pilotRampFactor(x):land(x,z);
}
/** Road crossing classification uses source connectivity, never terrain heights. */
export function pilotBridgeRoad(p:number[]):boolean {
 if(p.length!==4)return false;
 if(bridgeSegments.has(roadSegmentKey(p)))return true;
 const [ax,az,bx,bz]=p;
 if(Math.max(ax,bx)<pilotRiverLimits[0]||Math.min(ax,bx)>pilotRiverLimits[1])return false;
 return (az-pilotChannelZ(ax))*(bz-pilotChannelZ(bx))<0&&Math.abs(bz-az)>Math.abs(bx-ax)*.5;
}
export function pilotBridgeFootprint(p:number[],w:number):[number,number][]{
 const corridor=pilotRoadNetwork.get(roadSegmentKey(p));
 if(corridor)return corridorOutline(corridor,w>=6&&w<=36?5.2:.45);
 const [ax,az,bx,bz]=p,len=Math.hypot(bx-ax,bz-az),half=(w+(w>=6&&w<=36?5.2:.45))/2,nx=-(bz-az)/len*half,nz=(bx-ax)/len*half;
 return [[ax-nx,az-nz],[bx-nx,bz-nz],[bx+nx,bz+nz],[ax+nx,az+nz]];
}
const pilotDecks=recipe.streets.filter(r=>pilotBridgeRoad(r.slice(0,4))).map(r=>pilotBridgeFootprint(r.slice(0,4),r[4]));
export function pilotBridgeAt(x:number,z:number):boolean {
 return pilotDecks.some(p=>insideRoadOutline([x,z],p));
}
/** Explicit support levels: callers with feet below a deck keep the riverside surface. */
export function pilotSupportHeight(x:number,z:number,feetY=Infinity,land=pilotStreetHeight):number {
 const ground=pilotGroundHeight(x,z,land),deck=land(x,z);
 return pilotInRiver(x,z)&&pilotBridgeAt(x,z)&&feetY>=deck-.35?deck:ground;
}
/** Prevent a low-level mover snapping through a retaining wall onto the street. */
export function resolvePilotBank(x:number,z:number,radius:number,feetY:number):{x:number;z:number} {
 if(!inPilot(x,z))return {x,z};
 const center=pilotChannelZ(x),side=Math.sign(z-center)||1,d=Math.abs(z-center);
 if(d>PILOT_SECTION.bank+radius+2||feetY>=pilotStreetHeight(x,z)-.35)return {x,z};
 const probeZ=z+side*radius;
 if(pilotGroundHeight(x,probeZ)<=feetY+.35)return {x,z};
 const path=pilotWaterHeight(x)+PILOT_SECTION.pathRise;
 const edge=feetY<path-.35?PILOT_SECTION.water:PILOT_SECTION.path;
 return {x,z:center+side*Math.min(d,edge-radius-.02)};
}
export const pilotRiverCuts=(()=>{
 const xs=[pilotRiverLimits[0],...recipe.channel.map(p=>p[0]).filter(x=>x>pilotRiverLimits[0]&&x<pilotRiverLimits[1]),pilotRiverLimits[1]];
 return xs.slice(1).map((x,i)=>{const a=xs[i],za=pilotChannelZ(a),zb=pilotChannelZ(x),r=PILOT_SECTION.bank;return [[a,za-r],[x,zb-r],[x,zb+r],[a,za+r]];});
})();
/** Removes the channel instead of hiding the old ground under another polygon. */
export function cutPilotRiver(poly:SurfacePolygon):SurfacePolygon[]{
 const minX=Math.min(...poly.map(v=>v[0])),maxX=Math.max(...poly.map(v=>v[0])),minZ=Math.min(...poly.map(v=>v[2])),maxZ=Math.max(...poly.map(v=>v[2]));
 let pieces=[poly];
 for(const cut of pilotRiverCuts){
  if(cut[0][0]>=maxX||cut[1][0]<=minX||Math.min(...cut.map(p=>p[1]))>=maxZ||Math.max(...cut.map(p=>p[1]))<=minZ)continue;
  pieces=pieces.flatMap(p=>subtractSurface(p,cut));
 }
 return pieces;
}
const barrierCuts=(()=>{
 const grid=new Map<string,number[][][]>();
 const add=(poly:number[][])=>{const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);
  for(let x=Math.floor(Math.min(...xs)/32);x<=Math.floor(Math.max(...xs)/32);x++)for(let z=Math.floor(Math.min(...zs)/32);z<=Math.floor(Math.max(...zs)/32);z++){
   const key=x+':'+z,list=grid.get(key)??[];list.push(poly);grid.set(key,list);
  }
 };
 for(const cut of pilotRiverCuts)add(cut);
 for(const c of pilotRoadNetwork.values())if(inPilot(...c.a)||inPilot(...c.b))add(corridorOutline(c,(c.w>=6&&c.w<=36?5.2:.45)+1.2));
 return grid;
})();
function nearbyBarrierCuts(p:number[]):number[][][]{
 const found=new Set<number[][]>();
 for(let x=Math.floor(Math.min(p[0],p[2])/32);x<=Math.floor(Math.max(p[0],p[2])/32);x++)for(let z=Math.floor(Math.min(p[1],p[3])/32);z<=Math.floor(Math.max(p[1],p[3])/32);z++)for(const cut of barrierCuts.get(x+':'+z)??[])found.add(cut);
 return [...found];
}
/** Clip legacy wall lines to land, removing their rendered AND collision footprint. */
export function pilotLandSegments(p:number[]):number[][] {
 const output:number[][]=[];
 for(let i=2;i<p.length;i+=2){
  const [ax,az,bx,bz]=p.slice(i-2,i+2);let intervals=[[0,1]];
  for(const cut of nearbyBarrierCuts([ax,az,bx,bz])){
   let lo=0,hi=1;
   for(let j=0;j<cut.length&&lo<=hi;j++){
    const a=cut[j],b=cut[(j+1)%cut.length];
    const side=(x:number,z:number)=>(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);
    const v=side(ax,az),d=side(bx,bz)-v;
    if(Math.abs(d)<1e-9){if(v<0)hi=-1;}else if(d>0)lo=Math.max(lo,-v/d);else hi=Math.min(hi,-v/d);
   }
   if(hi<=lo)continue;
   intervals=intervals.flatMap(([a,b])=>b<=lo||a>=hi?[[a,b]]:[[a,Math.min(b,lo)],[Math.max(a,hi),b]].filter(([a,b])=>b-a>1e-6));
  }
  for(const [a,b] of intervals)output.push([ax+(bx-ax)*a,az+(bz-az)*a,ax+(bx-ax)*b,az+(bz-az)*b]);
 }
 return output;
}
/** Pure final-stage correction: same terrain for mesh, roads, buildings and walking.
 * The coarse land grid stays independent of the exact vector river corridor.
 * All intersecting tiles use one world-space recipe, including their shared borders.
 */
export function applyCheonggyePilot(cell:Cell,raw:WorldChunk,size=1024):WorldChunk {
 if(cell[0]!==37||cell[1]!==126||raw.streetPilot)return raw;
 const x0=raw.cx*size,z0=raw.cz*size,r=recipe.halfSize+recipe.design.terrainTransition.innerMargin+recipe.design.terrainTransition.maximumWidth;
 if(x0>recipe.center[0]+r||x0+size<recipe.center[0]-r||z0>recipe.center[1]+r||z0+size<recipe.center[1]-r)return raw;
 const t=raw.terrain,n=t.size;if(n<2)return raw;
 const old=(x:number,z:number,h=t.heights)=>{const gx=(x-x0)/size*(n-1),gz=(z-z0)/size*(n-1),i=Math.min(n-2,Math.floor(gx)),j=Math.min(n-2,Math.floor(gz)),fx=gx-i,fz=gz-j,a=h[j*n+i],b=h[j*n+i+1],c=h[(j+1)*n+i],d=h[(j+1)*n+i+1];return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);};
 const spacing=32,resolution=size/spacing+1,heights:number[]=[],roadHeights:number[]=[];
 for(let j=0;j<resolution;j++)for(let i=0;i<resolution;i++){
  const x=x0+i*spacing,z=z0+j*spacing,h=old(x,z),road=raw.roadHeights?old(x,z,raw.roadHeights):h,design=pilotStreetHeight(x,z);
  const distance=Math.max(Math.abs(x-recipe.center[0]),Math.abs(z-recipe.center[1]));
  const w=terrainTransitionWeight(distance,recipe.halfSize,h,road,design,recipe.design.terrainTransition);
  heights.push(h+(design-h)*w);if(raw.roadHeights)roadHeights.push(road+(design-road)*w);
 }
 const roads=raw.objects.roads.flatMap(r=>{
  const out=[];for(let i=2;i<r.p.length;i+=2){const p=r.p.slice(i-2,i+2);if(!replacedRoadSegments.has(roadSegmentKey(p)))out.push({...r,p});}return out;
 });
 // Rebucket displaced geometry, including a width halo: the old owner tile may no longer contain it.
 for(const r of recipe.roadNetwork){if(!r.layout)continue;const [ax,az,bx,bz]=r.p,pad=r.w*.8+4;
  if(Math.max(ax,bx)+pad<x0||Math.min(ax,bx)-pad>x0+size||Math.max(az,bz)+pad<z0||Math.min(az,bz)-pad>z0+size)continue;
  roads.push({p:r.p,w:r.w,bridge:r.bridge});
 }
 return {...raw,...(raw.roadHeights?{roadHeights}:{}),streetPilot:true,objects:{...raw.objects,roads,walls:raw.objects.walls?.flatMap(w=>pilotLandSegments(w.p).map(p=>({...w,p}))),water:raw.objects.water.map(w=>w.w&&w.p.some((_,i)=>i%2===0&&pilotInRiver(w.p[i],w.p[i+1]))?{...w,w:8}:w)},terrain:{...t,size:resolution,heights}};
}
