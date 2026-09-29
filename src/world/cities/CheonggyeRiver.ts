import {groundedRailing} from '../GroundedBarrier';
import * as THREE from 'three';
import {clipSurface,surfaceTriangles,type SurfacePolygon} from '../SurfacePartition';
import {CHEONGGYE_PILOT as recipe,PILOT_SECTION as section,pilotRiverLimits,pilotChannelZ,pilotWaterHeight,pilotRiverBlend,pilotRampFactor,pilotRamps,pilotBridgeRoad,pilotBridgeFootprint,pilotBridgeAt,pilotGroundHeight,pilotRiverCuts} from './CheonggyePilot';

export type RiverSurface={kind:'bed'|'water'|'path'|'bank'|'wall';vertices:number[]};
/** Shared station rows, clipped only after solving continuous river surfaces. No box segments. */
export function pilotRiverSurfaces(cx:number,cz:number,size:number,land:(x:number,z:number)=>number):RiverSurface[]{
 const x0=cx*size,z0=cz*size,x1=x0+size,z1=z0+size;
 const lo=Math.max(x0,pilotRiverLimits[0]),hi=Math.min(x1,pilotRiverLimits[1]);
 if(hi<=lo)return [];
 const stations=new Set([lo,hi,...recipe.channel.map(p=>p[0]),...pilotRamps.flatMap(x=>[x,x+44,x+50,x+56,x+100]),recipe.center[0]-500,recipe.center[0]+500]);
 for(let x=Math.ceil(lo/8)*8;x<hi;x+=8)stations.add(x);
 const xs=[...stations].filter(x=>x>=lo&&x<=hi).sort((a,b)=>a-b);
 const buffers=new Map<RiverSurface['kind'],number[]>();
 const row=(x:number,side:number,kind:RiverSurface['kind'],level='')=>{
  const z=pilotChannelZ(x)+side,blend=pilotRiverBlend(x),ground=land(x,z),water=pilotWaterHeight(x,land);
  const path=water+section.pathRise*(1-blend),street=ground;
  const ramp=side>0?path+(street-path)*pilotRampFactor(x):street;
  const y=kind==='water'?water:kind==='bed'?water-section.waterDepth:kind==='path'?path:kind==='bank'?ramp:level==='path'?path:level==='street'?street:ramp;
  return [x,y,z];
 };
 const add=(kind:RiverSurface['kind'],vertices:SurfacePolygon,vertical=false)=>{
  let poly=clipSurface(vertices,v=>v[2]-z0);poly=clipSurface(poly,v=>z1-v[2]);
  if(poly.length<3)return;
  const out=buffers.get(kind)??[];
  if(vertical){for(let i=1;i<poly.length-1;i++)out.push(...poly[0],...poly[i],...poly[i+1]);}
  else for(const v of surfaceTriangles(poly))out.push(...v);
  buffers.set(kind,out);
 };
 for(let i=1;i<xs.length;i++){
  const a=xs[i-1],b=xs[i];
  const strip=(kind:RiverSurface['kind'],left:number,right:number)=>add(kind,[row(a,left,kind),row(b,left,kind),row(b,right,kind),row(a,right,kind)]);
  strip('bed',-section.water,section.water);strip('water',-section.water,section.water);
  for(const s of [-1,1]){
   strip('path',s*section.water,s*section.path);
   // Water retaining lip (vertical), main wall and paved upper bank meet the same rows.
   const wall=(side:number,low:RiverSurface['kind'],high:RiverSurface['kind'],lowLevel='',highLevel='')=>add('wall',[row(a,side,low,lowLevel),row(b,side,low,lowLevel),row(b,side,high,highLevel),row(a,side,high,highLevel)],true);
   wall(s*section.water,'bed','path');
   wall(s*section.path,'path','wall','','ramp');
   add('bank',[row(a,s*section.path,'wall','ramp'),row(b,s*section.path,'wall','ramp'),row(b,s*section.wall,'bank'),row(a,s*section.wall,'bank')]);
   strip('bank',s*section.wall,s*section.bank);
   wall(s*section.bank,'bank','wall','','street');
  }
 }
 return [...buffers].map(([kind,vertices])=>({kind,vertices}));
}
export function addPilotRiver(group:THREE.Group,cx:number,cz:number,size:number,ox:number,oz:number,land:(x:number,z:number)=>number):void {
 const colors={bed:0x657d72,water:0x508f93,path:0xb6b5a9,wall:0x969a92,bank:0xadafa7};
 for(const {kind,vertices} of pilotRiverSurfaces(cx,cz,size,land)){
  const positions=vertices.map((v,i)=>i%3===0?v-ox:i%3===2?v-oz:v);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({color:colors[kind],roughness:kind==='water'?.26:.89,metalness:kind==='water'?.08:0,side:THREE.DoubleSide});material.userData.paintedOwned=true;
  const mesh=new THREE.Mesh(geometry,material);mesh.name='pilot_river_'+kind;bindPilotRiverMaterial(mesh,ox,oz);mesh.receiveShadow=true;mesh.castShadow=kind==='wall';group.add(mesh);
 }
 // Safety rails are derived from the solved bank boundary, never from stale OSM wall lines.
 const rails:number[]=[];
 const lo=Math.max(cx*size,pilotRiverLimits[0]),hi=Math.min((cx+1)*size,pilotRiverLimits[1]);
 const stations=[lo,...recipe.channel.map(p=>p[0]).filter(x=>x>lo&&x<hi),hi];
 for(let i=1;i<stations.length;i++)for(const side of [-1,1]){
  const a=stations[i-1],b=stations[i];if(b-a<.01)continue;
  const position=(x:number):[number,number]=>[x,pilotChannelZ(x)+side*(section.bank-.35)];
  const probes=[a,(a+b)/2,b].map(position);
  if(probes.some(([x,z])=>z<cz*size||z>(cz+1)*size||pilotBridgeAt(x,z)))continue;
  if(side>0&&pilotRamps.some(start=>a<start+100&&b>start))continue;
  const vertices=groundedRailing(position(a),position(b),1,(x,z)=>pilotGroundHeight(x,z,land));
  for(let k=0;k<vertices.length;k+=3)rails.push(vertices[k]-ox,vertices[k+1],vertices[k+2]-oz);
 }
 if(rails.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(rails,3));g.computeVertexNormals();const m=new THREE.MeshStandardMaterial({color:0x61706b,roughness:.83});m.userData.paintedOwned=true;const mesh=new THREE.Mesh(g,m);mesh.name='pilot_bank_rail';mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}

}

/** Bridge slabs and railings, partitioned by the same river boundary and tile rectangle. */
export function addPilotBridgeStructures(group:THREE.Group,roads:{p:number[];w?:number}[],cx:number,cz:number,size:number,ox:number,oz:number,land:(x:number,z:number)=>number):void {
 const slab:number[]=[],rail:number[]=[];
 const quad=(out:number[],a:number[],b:number[],c:number[],d:number[])=>out.push(...a,...b,...c,...a,...c,...d);
 const clipChunk=(poly:SurfacePolygon)=>{
  for(const side of [(v:number[])=>v[0]-cx*size,(v:number[])=>(cx+1)*size-v[0],(v:number[])=>v[2]-cz*size,(v:number[])=>(cz+1)*size-v[2]])poly=clipSurface(poly,side);
  return poly;
 };
 for(const r of roads)for(let k=2;k<r.p.length;k+=2){
  const p=r.p.slice(k-2,k+2);if(!pilotBridgeRoad(p))continue;
  const [ax,az,bx,bz]=p,len=Math.hypot(bx-ax,bz-az),dx=(bx-ax)/len,dz=(bz-az)/len,w=r.w??6;
  const footprint=pilotBridgeFootprint(p,w).map(([x,z])=>[x,0,z]);
  for(const cut of pilotRiverCuts){
   let poly=footprint;
   for(let j=0;j<cut.length;j++){const a=cut[j],b=cut[(j+1)%cut.length];poly=clipSurface(poly,v=>(b[0]-a[0])*(v[2]-a[1])-(b[1]-a[1])*(v[0]-a[0]));}
   poly=clipChunk(poly);if(poly.length<3)continue;
   poly=poly.map(([x,_,z])=>[x,land(x,z)-.05,z]);
   for(const v of surfaceTriangles(poly))slab.push(v[0],v[1]-.55,v[2]);
   for(let j=0;j<poly.length;j++){
    const a=poly[j],b=poly[(j+1)%poly.length];quad(slab,a,b,[b[0],b[1]-.55,b[2]],[a[0],a[1]-.55,a[2]]);
    const edgeLength=Math.hypot(b[0]-a[0],b[2]-a[2]);
    // Rail only along bridge sides, never across either street entrance or tile seams.
    if(edgeLength<.1||Math.abs(((b[0]-a[0])*dz-(b[2]-a[2])*dx)/edgeLength)>.01)continue;
    // Seat the complete post footprint on the deck, not on its outer edge or on river ground.
    const mx=(a[0]+b[0])/2,mz=(a[2]+b[2])/2,side=Math.sign((mx-ax)*(-dz)+(mz-az)*dx);
    const inwardX=dz*side*.2,inwardZ=-dx*side*.2;
    const anchored=groundedRailing([a[0]+inwardX,a[2]+inwardZ],[b[0]+inwardX,b[2]+inwardZ],.95,land);
    for(const v of anchored)rail.push(v);
   }
  }
 }
 for(const [name,vertices,color] of [['slab',slab,0x8d9493],['rail',rail,0x61706b]] as const){
  if(!vertices.length)continue;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.map((v,i)=>i%3===0?v-ox:i%3===2?v-oz:v),3));g.computeVertexNormals();const mat=new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide,roughness:.83});mat.userData.paintedOwned=true;const mesh=new THREE.Mesh(g,mat);mesh.name='pilot_bridge_'+name;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
 }
}

/** Fine material detail, shared by the direct viewer and reconstructed worker meshes. */
export function bindPilotRiverMaterial(mesh:THREE.Mesh,ox:number,oz:number):void {
 const material=mesh.material as THREE.MeshStandardMaterial,kind=mesh.name.replace('pilot_river_','');
 if(!['wall','path','bank','water'].includes(kind))return;
 material.onBeforeCompile=shader=>{
  shader.uniforms.riverOrigin={value:new THREE.Vector3(ox,0,oz)};
  shader.vertexShader='uniform vec3 riverOrigin; varying vec3 riverPoint;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nriverPoint=position+riverOrigin;');
  shader.fragmentShader='varying vec3 riverPoint;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   ${kind==='water'?`
    float wave=sin(riverPoint.x*1.2+sin(riverPoint.z*.7))*sin(riverPoint.z*2.2);
    float waveFade=1.0-smoothstep(.1,.8,max(fwidth(riverPoint.x),fwidth(riverPoint.z)));
    diffuseColor.rgb*=1.0+wave*.06*waveFade;
   `:`
    vec2 tile=${kind==='wall'?'vec2(riverPoint.x/1.3,riverPoint.y/.42)':'riverPoint.xz/vec2(.8,.5)'};
    tile.x+=mod(floor(tile.y),2.0)*.5;
    vec2 aa=max(fwidth(tile),vec2(.001)),edge=abs(fract(tile)-.5);
    float seam=max(smoothstep(.48-aa.x,.48+aa.x,edge.x),smoothstep(.48-aa.y,.48+aa.y,edge.y));
    float fade=1.0-smoothstep(.18,.65,max(aa.x,aa.y));
    float stone=fract(sin(dot(floor(tile),vec2(12.98,78.23)))*43758.54)-.5;
    diffuseColor.rgb*=1.0+(stone*.06-seam*.12)*fade;
   `}
  `);
 };
 material.customProgramCacheKey=()=> 'river-surfaces-v2-'+kind;
}
