import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {CompiledStreetPlan} from './CompiledStreet';
import type {WorldChunk} from './chunkManifest';
import type {CityDetailSettings,SpeciesMix,TreeSpecies} from './cities/types';
import {inPilot,pilotInRiver} from './cities/CheonggyePilot';
import {inPalace} from './cities/PalaceSite';
import {cityUniforms} from './cityUniforms';
// 녹지 — 가로수(컴파일된 보도 위), 공원·정원·숲·덤불 산포. 워커는 위치 배열만 만들고
// 메인 스레드가 공유 템플릿 + InstancedMesh(512m 블록 × 수종 × 근/원 LOD)로 그린다.
// 충돌은 없다(기존 가로수/가로등과 같은 시각 소품).

/** Per tree: x,y,z (local), width, height, yaw, species (SPECIES index), tint index. */
export const VEGETATION_STRIDE=8;
/** Template order; the per-city mixes in CityDetailSettings.vegetation.species pick among these. */
export const SPECIES:readonly TreeSpecies[]=['broadleaf','conifer','umbrella','cypress'];
/** Deterministic weighted pick (weights need not sum to 1); empty mix → broadleaf. */
export function pickSpecies(mix:SpeciesMix,r:number):number {
 const total=SPECIES.reduce((a,k)=>a+(mix[k]??0),0);if(total<=0)return 0;
 let pick=r*total;for(let i=0;i<SPECIES.length;i++){const w=mix[SPECIES[i]]??0;if(pick<w)return i;pick-=w;}return 0;
}
// Crown width relative to the shared template (the umbrella crown is already wide).
const SPECIES_WIDTH=[1,.8,1,1];
type Settings=CityDetailSettings['vegetation'];
const BLOCK=512;

export function hash(x:number,z:number,salt=0):number {
 let h=Math.imul(Math.round(x*4)^salt*0x9e3779b1,0x45d9f3b)^Math.imul(Math.round(z*4)+salt,0x27d4eb2d);
 h=Math.imul(h^(h>>>16),0x85ebca6b);return ((h^(h>>>13))>>>0)/4294967296;
}
export function inside(x:number,z:number,p:number[]):boolean {
 let hit=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])hit=!hit;return hit;
}
function segmentDistance(x:number,z:number,ax:number,az:number,bx:number,bz:number):number {
 const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-ax-dx*t,z-az-dz*t);
}
function bbox(p:number[]){let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(let i=0;i<p.length;i+=2){x0=Math.min(x0,p[i]);x1=Math.max(x1,p[i]);z0=Math.min(z0,p[i+1]);z1=Math.max(z1,p[i+1]);}return {x0,z0,x1,z1};}

/** Uniform 16m bins over polygons/triangles so dense chunks avoid all-pairs tests. */
export class Bins<T> {
 private cells=new Map<number,T[]>();
 add(x0:number,z0:number,x1:number,z1:number,item:T){for(let a=Math.floor(x0/16);a<=Math.floor(x1/16);a++)for(let b=Math.floor(z0/16);b<=Math.floor(z1/16);b++){const k=a*65536+b,list=this.cells.get(k);if(list)list.push(item);else this.cells.set(k,[item]);}}
 at(x:number,z:number):T[]{return this.cells.get(Math.floor(x/16)*65536+Math.floor(z/16))??[];}
}
type Tri=Float64Array;
export function streetTriangles(plan:CompiledStreetPlan|undefined){
 const pavement=new Bins<Tri>(),road=new Bins<Tri>();
 if(!plan)return {pavement,road};
 for(const m of plan.meshes){
  const bins=m.layer===1?pavement:m.layer===3||m.layer===2||m.layer===6?road:undefined;if(!bins||(m.level??0)!==0)continue;
  const n=m.index?.length??m.position.length/3;
  for(let i=0;i+2<n;i+=3){
   const t=new Float64Array(6);for(let k=0;k<3;k++){const j=(m.index?.[i+k]??i+k)*3;t[k*2]=m.position[j]+plan.origin[0];t[k*2+1]=m.position[j+2]+plan.origin[1];}
   bins.add(Math.min(t[0],t[2],t[4]),Math.min(t[1],t[3],t[5]),Math.max(t[0],t[2],t[4]),Math.max(t[1],t[3],t[5]),t);
  }
 }
 return {pavement,road};
}
export function onTriangle(bins:Bins<Tri>,x:number,z:number):boolean {
 for(const t of bins.at(x,z)){
  const d1=(x-t[2])*(t[1]-t[3])-(t[0]-t[2])*(z-t[3]),d2=(x-t[4])*(t[3]-t[5])-(t[2]-t[4])*(z-t[5]),d3=(x-t[0])*(t[5]-t[1])-(t[4]-t[0])*(z-t[1]);
  if(!((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0)))return true;
 }
 return false;
}

/**
 * Deterministic tree sites in cell-local metres (stable across chunk reloads and origins).
 * Street trees need a compiled pavement surface around the trunk; area trees avoid every
 * street layer, building, water body and authored landscape (palace / Cheonggye / Seoul detail).
 */
/** Hand-placed trees from city patches, re-rendered with the shared model: landmark groves, palace, street. */
export interface AuthoredTree {x:number;z:number;kind:'grand'|'palace'|'street'}
export function vegetationSites(chunk:WorldChunk,size:number,settings:Settings,authoredTrees:readonly AuthoredTree[]=[]):number[] {
 if(!settings.enabled)return [];
 const objects=chunk.objects;if(!objects)return [];
 const x0=chunk.cx*size,z0=chunk.cz*size,x1=x0+size,z1=z0+size;
 const plan=chunk.compiledStreet,{pavement,road}=streetTriangles(plan);
 const buildings=new Bins<number[]>();
 for(const b of [...objects.buildings,...(objects.structures??[]),...(plan?.resolvedStructures??[])]){if(b.p.length<6)continue;const r=bbox(b.p);buildings.add(r.x0-1,r.z0-1,r.x1+1,r.z1+1,b.p);}
 const water=new Bins<{p:number[];w?:number;holes?:number[][]}>();
 for(const w of objects.water){const r=bbox(w.p),pad=(w.w??0)/2+2;water.add(r.x0-pad,r.z0-pad,r.x1+pad,r.z1+pad,w);}
 const authored=new Bins<number[]>();for(const t of chunk.seoulDetail?.trees??[])authored.add(t[0]-6,t[1]-6,t[0]+6,t[1]+6,t);
 for(const t of authoredTrees)authored.add(t.x-6,t.z-6,t.x+6,t.z+6,[t.x,t.z]);
 const occupied=new Set<number>(),out:{x:number;z:number;w:number;h:number;yaw:number;species:number;tint:number;priority:number}[]=[];
 const blocked=(x:number,z:number,clearance:number)=>{
  if(x<x0+1||x>x1-1||z<z0+1||z>z1-1)return true;
  for(const p of buildings.at(x,z))if(inside(x,z,p))return true;
  for(const [dx,dz] of [[clearance,0],[-clearance,0],[0,clearance],[0,-clearance]])for(const p of buildings.at(x+dx,z+dz))if(inside(x+dx,z+dz,p))return true;
  for(const w of water.at(x,z)){
   if(w.w!=null){for(let i=2;i<w.p.length;i+=2)if(segmentDistance(x,z,w.p[i-2],w.p[i-1],w.p[i],w.p[i+1])<w.w/2+1.5)return true;}
   else if(inside(x,z,w.p)&&!(w.holes??[]).some(h=>inside(x,z,h)))return true;
  }
  if(chunk.streetPilot&&(inPilot(x,z)||pilotInRiver(x,z)))return true;
  if(chunk.palaceSite&&inPalace(x,z))return true;
  for(const t of authored.at(x,z))if(Math.abs(t[0]-x)<6&&Math.abs(t[1]-z)<6)return true;
  return false;
 };
 // One tree per 3m cell, so neighbouring sources never stack trunks.
 const claim=(x:number,z:number,radius:number)=>{const a=Math.floor(x/3),b=Math.floor(z/3),r=Math.ceil(radius/3);for(let i=-r;i<=r;i++)for(let j=-r;j<=r;j++)if(occupied.has((a+i)*100003+b+j))return false;occupied.add(a*100003+b);return true;};
 const leaves=settings.leaves.length;
 for(const p of plan?.props??[])if(!p.tree)claim(p.x,p.z,1.5); // keep lamps clear of canopies' trunks
 // Authored trees first (exact positions, no clearance tests: their patches already placed them).
 for(const t of authoredTrees){
  if(t.x<x0||t.x>=x1||t.z<z0||t.z>=z1)continue;claim(t.x,t.z,0);
  // Landmark groves stay large broadleaf; palace groves follow the city's authored mix; street → street mix.
  const r=hash(t.x,t.z,53),species=t.kind==='grand'?0:pickSpecies(t.kind==='palace'?settings.species.authored:settings.species.street,hash(t.x,t.z,59));
  const [w,h]=t.kind==='grand'?[1.35+r*.35,1.25+r*.45]:t.kind==='palace'?[.8+r*.25,.75+r*.3]:[settings.streetCrown[0],settings.streetCrown[1]+r*.15];
  out.push({x:t.x,z:t.z,w:w*SPECIES_WIDTH[species],h,yaw:hash(t.x,t.z,5)*Math.PI*2,species,tint:Math.floor(hash(t.x,t.z,7)*leaves),priority:-1});
 }

 // Street trees: ginkgo-like narrow crowns at the curb. Source ways may be single lanes with no
 // sidewalk attribute (e.g. Teheran-ro), so the compiled surfaces decide: walk out from the centreline
 // across the carriageway, then plant in a verge strip or on the first pavement band.
 if(plan)for(const r of objects.roads){
  if(r.tunnel||r.bridge||(r.layer??0)!==0)continue;
  for(let i=2;i<r.p.length;i+=2){
   const ax=r.p[i-2],az=r.p[i-1],bx=r.p[i],bz=r.p[i+1],len=Math.hypot(bx-ax,bz-az);if(len<12)continue;
   const ux=(bx-ax)/len,uz=(bz-az)/len;
   for(let d=4+hash(ax,az)*settings.streetSpacing;d<len-4;d+=settings.streetSpacing)for(const side of [-1,1]){
    const cx=ax+ux*d,cz=az+uz*d,at=(o:number):[number,number]=>[cx-uz*o*side,cz+ux*o*side];
    if(!onTriangle(road,...at(0)))continue; // only where this way owns a compiled carriageway
    let o=0;while(o<36&&onTriangle(road,...at(o+.5)))o+=.5;
    const halfWidth=o;if(halfWidth<2.5||halfWidth>=36)continue;
    // Avenues get continuous rows; narrower streets sparser planting; alleys none.
    if(halfWidth<settings.minRoadWidth/2&&hash(cx,cz,47)>.4)continue;
    let x=0,z=0,found=false;o+=.5;
    if(!onTriangle(pavement,...at(o))){
     let end=o;while(end<o+5&&!onTriangle(pavement,...at(end))&&!onTriangle(road,...at(end)))end+=.25;
     if(end-o>=.75&&end<o+5&&onTriangle(pavement,...at(end))){[x,z]=at((o+end)/2);found=true;}
    }else for(let k=o+.4;k<o+4;k+=.5){
     [x,z]=at(k);
     if([[.6,0],[-.6,0],[0,.6],[0,-.6]].every(([dx,dz])=>onTriangle(pavement,x+dx,z+dz))){found=true;break;}
    }
    if(!found||blocked(x,z,1.6)||!claim(x,z,4))continue;
    const s=.9+hash(x,z,3)*.3,species=pickSpecies(settings.species.street,hash(x,z,59));
    out.push({x,z,w:settings.streetCrown[0]*s*SPECIES_WIDTH[species],h:settings.streetCrown[1]*s,yaw:hash(x,z,5)*Math.PI*2,species,tint:Math.floor(hash(x,z,7)*leaves),priority:0});
   }
  }
 }
 for(const p of plan?.props??[])if(p.tree&&!blocked(p.x,p.z,.5)&&claim(p.x,p.z,2))out.push({x:p.x,z:p.z,w:.8,h:1,yaw:hash(p.x,p.z,5)*Math.PI*2,species:0,tint:Math.floor(hash(p.x,p.z,7)*leaves),priority:0});

 // Area scatter on a world-anchored jittered grid: identical across chunk seams.
 // Two land-cover classes render differently:
 //  · forest (wood, scrub): a continuous canopy, one tree per dense grid cell;
 //  · open green (park, garden, grass — e.g. Hangang parks, city squares): mostly lawn with
 //    widely spaced lone trees and small groups of 2–3, never a filled canopy.
 type Cover={spacing:number;keep:number;mix:SpeciesMix;w:number;h:number;open:boolean};
 const {forest,open}=settings.species,shrub:SpeciesMix={broadleaf:1};
 const kinds:Record<string,Cover>={
  wood:{spacing:settings.woodSpacing,keep:.92,mix:forest,w:1.05,h:1.15,open:false},scrub:{spacing:7,keep:.8,mix:shrub,w:.55,h:.42,open:false},
  park:{spacing:settings.parkSpacing,keep:.42,mix:open,w:1.25,h:1.05,open:true},garden:{spacing:settings.gardenSpacing,keep:.45,mix:open,w:.9,h:.85,open:true},
  grass:{spacing:settings.parkSpacing*1.35,keep:.3,mix:open,w:1.3,h:1.08,open:true}};
 for(const area of objects.areas??[]){
  const kind=kinds[area.k];if(!kind||area.p.length<6)continue;
  const r=bbox(area.p),s=kind.spacing;
  for(let gx=Math.floor(Math.max(r.x0,x0)/s);gx<=Math.floor(Math.min(r.x1,x1)/s);gx++)for(let gz=Math.floor(Math.max(r.z0,z0)/s);gz<=Math.floor(Math.min(r.z1,z1)/s);gz++){
   if(hash(gx,gz,11+s)>kind.keep)continue;
   const cx=(gx+.15+hash(gx,gz,13)*.7)*s,cz=(gz+.15+hash(gx,gz,17)*.7)*s;
   // Open green: 60% lone trees, 30% pairs, 10% triples within a ~5m clump.
   const g=hash(gx,gz,19),count=kind.open?(g<.6?1:g<.9?2:3):1;
   for(let k=0;k<count;k++){
    const a=hash(gx+k,gz,41)*Math.PI*2,d=k?3.5+hash(gx,gz+k,43)*2:0,x=cx+Math.cos(a)*d,z=cz+Math.sin(a)*d;
    if(!inside(x,z,area.p))continue;
    if(onTriangle(pavement,x,z)||onTriangle(road,x,z)||[[2,0],[-2,0],[0,2],[0,-2]].some(([dx,dz])=>onTriangle(road,x+dx,z+dz)||onTriangle(pavement,x+dx,z+dz)))continue;
    if(blocked(x,z,2.4)||!claim(x,z,kind.open?2:s*.3))continue;
    const scale=.82+hash(x,z,19)*.5,species=pickSpecies(kind.mix,hash(x,z,23));
    out.push({x,z,w:kind.w*scale*SPECIES_WIDTH[species],h:kind.h*scale,yaw:hash(x,z,29)*Math.PI*2,species,tint:Math.floor(hash(x,z,31)*leaves),priority:1+hash(x,z,37)});
   }
  }
 }
 out.sort((a,b)=>a.priority-b.priority);
 const result:number[]=[];
 for(const t of out.slice(0,settings.maxPerChunk))result.push(t.x,0,t.z,t.w,t.h,t.yaw,t.species,t.tint);
 return result;
}

/** Fill heights and convert to the local render frame. */
export function localVegetation(sites:number[],height:(x:number,z:number)=>number,ox:number,oz:number):Float32Array {
 const out=new Float32Array(sites.length);
 for(let i=0;i<sites.length;i+=VEGETATION_STRIDE){
  const x=sites[i],z=sites[i+2],y=height(x,z);
  out.set(sites.slice(i,i+VEGETATION_STRIDE),i);out[i]=x-ox;out[i+1]=Number.isFinite(y)?y:0;out[i+2]=z-oz;
 }
 return out;
}

// ── 메인 스레드: 공유 템플릿/재질 ──
const FOLIAGE='foliage';
function colored(geo:THREE.BufferGeometry,foliage:number,shade:(y:number,i:number)=>number):THREE.BufferGeometry {
 const g=geo.index?geo.toNonIndexed():geo;g.deleteAttribute('uv');
 const pos=g.getAttribute('position'),color=new Float32Array(pos.count*3),f=new Float32Array(pos.count).fill(foliage);
 for(let i=0;i<pos.count;i++){const v=shade(pos.getY(i),i);color.set([v,v,v],i*3);}
 g.setAttribute('color',new THREE.BufferAttribute(color,3));g.setAttribute(FOLIAGE,new THREE.BufferAttribute(f,1));return g;
}
/** Lumpy crowns: displace shared icosahedron vertices by a position hash (seam-free). */
function crown(radius:number,detail:number,cx:number,cy:number,cz:number,sy=1):THREE.BufferGeometry {
 const g=new THREE.IcosahedronGeometry(radius,detail),p=g.getAttribute('position'),nrm=g.getAttribute('normal');
 // Smooth sphere normals (not facet normals) keep displaced crowns soft and rounded under the sun.
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),k=1+(hash(x*7,z*7+y*3,41)-.5)*.28,l=Math.hypot(x,y,z)||1;nrm.setXYZ(i,x/l,y/l,z/l);p.setXYZ(i,x*k+cx,y*k*sy+cy,z*k+cz);}
 return g;
}
function canopyShade(base:number,top:number){return (y:number,i:number)=>.62+.38*THREE.MathUtils.smoothstep(y,base,top)+(hash(i,y,43)-.5)*.08;}
let templates:{near:THREE.BufferGeometry;far:THREE.BufferGeometry}[]|undefined;
function treeTemplates(){
 if(templates)return templates;
 const trunk=(h:number,r:number)=>colored(new THREE.CylinderGeometry(r*.7,r,h,6,1,true).translate(0,h/2,0),0,()=>1);
 const broad=[trunk(3.6,.26),colored(mergeGeometries([crown(2.5,1,0,5.5,0),crown(1.9,0,-1.2,4.6,.7),crown(1.8,0,1.1,4.8,-.8),crown(1.5,0,.2,6.9,.3)],false)!,1,canopyShade(3,8))];
 const broadFar=colored(crown(2.7,0,0,5.3,0,1.05),1,canopyShade(3,8));
 const cone=(r:number,h:number,y:number)=>new THREE.ConeGeometry(r,h,7,1,true).translate(0,y,0);
 const pine=[trunk(4.2,.22),colored(mergeGeometries([cone(2.3,3.4,3.9),cone(1.8,3,5.6),cone(1.2,2.6,7.2)].map(g=>g.toNonIndexed()),false)!,1,canopyShade(2.5,8.5))];
 const pineFar=colored(new THREE.ConeGeometry(2.1,6.4,6,1).translate(0,5.2,0),1,canopyShade(2.5,8.5));
 // Mediterranean stone pine: tall bare trunk under a flat, wide parasol crown.
 const umbrella=[trunk(6.3,.24),colored(mergeGeometries([crown(3.1,1,0,6.9,0,.4),crown(2.1,0,-1.9,6.6,.6,.45),crown(2,0,1.8,6.7,-.7,.45)],false)!,1,canopyShade(6,8))];
 const umbrellaFar=colored(crown(3.4,0,0,6.9,0,.42),1,canopyShade(6,8));
 // Italian cypress: narrow column.
 const cypress=[trunk(1.4,.16),colored(crown(1.05,1,0,5.1,0,4.1),1,canopyShade(1,9))];
 const cypressFar=colored(new THREE.ConeGeometry(1,9.2,5,1).translate(0,5.2,0),1,canopyShade(1,9));
 templates=[{near:mergeGeometries(broad,false)!,far:broadFar},{near:mergeGeometries(pine,false)!,far:pineFar},{near:mergeGeometries(umbrella,false)!,far:umbrellaFar},{near:mergeGeometries(cypress,false)!,far:cypressFar}];
 for(const t of templates){t.near.userData.shared=true;t.far.userData.shared=true;}
 return templates;
}
const materials=new Map<number,THREE.MeshStandardMaterial>();
export function vegetationMaterial(bark:number):THREE.MeshStandardMaterial {
 let material=materials.get(bark);if(material)return material;
 material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,metalness:0});
 material.onBeforeCompile=shader=>{
  shader.uniforms.vegetationWind=cityUniforms.time;shader.uniforms.barkColor={value:new THREE.Color(bark)};
  shader.vertexShader='attribute float foliage; uniform float vegetationWind; uniform vec3 barkColor; varying vec3 vLeaf; varying float vFoliage;\n'+shader.vertexShader;
  shader.fragmentShader='varying vec3 vLeaf; varying float vFoliage;\n'+shader.fragmentShader;
  // Blocky leaf mottling in template space (0.45m cells): reads as dense foliage, echoing voxel-art trees.
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float leafCell=fract(sin(dot(floor(vLeaf*2.2),vec3(12.9898,78.233,37.719)))*43758.5453);
   float leafFade=1.0-smoothstep(.25,.9,length(fwidth(vLeaf*2.2)));
   diffuseColor.rgb*=mix(1.0,mix(.74,1.16,leafCell),vFoliage*leafFade);`);
  // Bark keeps its own colour; instanceColor tints only foliage.
  shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>','#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\n vColor.rgb=mix(barkColor,color.rgb*instanceColor.rgb,foliage);\n#endif');
  // Cheap crown sway (no per-frame CPU work): phase from instance translation.
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   vLeaf=position;vFoliage=foliage;
   #ifdef USE_INSTANCING
   vec2 treeRoot=instanceMatrix[3].xz;
   float sway=sin(vegetationWind*1.3+treeRoot.x*.07+treeRoot.y*.05)+.4*sin(vegetationWind*2.9+treeRoot.y*.11);
   transformed.xz+=vec2(.06,.04)*sway*foliage*max(0.0,position.y-2.5)*.18;
   #endif`);
 };
 material.customProgramCacheKey=()=> 'city-vegetation-v2';
 materials.set(bark,material);return material;
}

/** Instanced trees per 512m block and species, sharing one instance buffer between LODs. */
export function addVegetation(group:THREE.Group,data:Float32Array|undefined,settings:Settings|undefined):void {
 if(!data?.length||!settings)return;
 const blocks=new Map<string,number[]>();
 for(let i=0;i<data.length;i+=VEGETATION_STRIDE){const key=`${Math.floor(data[i]/BLOCK)}:${Math.floor(data[i+2]/BLOCK)}:${data[i+6]}`;const list=blocks.get(key);if(list)list.push(i);else blocks.set(key,[i]);}
 const material=vegetationMaterial(settings.bark),tmp=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),color=new THREE.Color();
 for(const [key,list] of blocks){
  const species=+key.split(':')[2],template=treeTemplates()[species];
  const matrices=new THREE.InstancedBufferAttribute(new Float32Array(list.length*16),16),colors=new THREE.InstancedBufferAttribute(new Float32Array(list.length*3),3);
  list.forEach((i,k)=>{
   tmp.compose(new THREE.Vector3(data[i],data[i+1]-.15,data[i+2]),q.setFromAxisAngle(up,data[i+5]),new THREE.Vector3(data[i+3],data[i+4],data[i+3]));tmp.toArray(matrices.array,k*16);
   color.setHex(settings.leaves[data[i+7]%settings.leaves.length]).multiplyScalar(.9+((i*7919)%97)/97*.2);color.toArray(colors.array,k*3);
  });
  for(const lod of ['near','far'] as const){
   const mesh=new THREE.InstancedMesh(template[lod],material,list.length);
   mesh.instanceMatrix=matrices;mesh.instanceColor=colors;mesh.name='vegetation_'+lod;
   mesh.userData.vegetation={lod,near:settings.nearDistance,far:settings.farDistance};
   mesh.castShadow=lod==='near';mesh.receiveShadow=true;mesh.visible=lod==='far';
   mesh.computeBoundingBox();mesh.computeBoundingSphere();
   group.add(mesh);
  }
 }
}

/** Distance LOD by block bounds; called with the other street-detail culling each frame. */
export function updateVegetationLod(mesh:THREE.InstancedMesh,x:number,z:number):void {
 const v=mesh.userData.vegetation as {lod:'near'|'far';near:number;far:number},box=mesh.boundingBox!;
 const d=Math.hypot(Math.max(box.min.x-x,0,x-box.max.x),Math.max(box.min.z-z,0,z-box.max.z));
 mesh.visible=v.lod==='near'?d<v.near:d>=v.near&&d<v.far;
}

/** Soft canopy contact shade in the baked ground texture (cell-local sites). */
export function paintCanopyShade(ctx:CanvasRenderingContext2D,sites:number[],scale:number,x0:number,z0:number,strength:number):void {
 ctx.save();ctx.fillStyle=`rgba(24,34,22,${strength})`;
 for(let i=0;i<sites.length;i+=VEGETATION_STRIDE){
  const r=Math.max(1.2,sites[i+3]*2.3)*scale;
  ctx.beginPath();ctx.arc((sites[i]-x0)*scale,(sites[i+2]-z0)*scale,r,0,Math.PI*2);ctx.fill();
 }
 ctx.restore();
}
