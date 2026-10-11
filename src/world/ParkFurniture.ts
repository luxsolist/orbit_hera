import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {WorldChunk} from './chunkManifest';
import type {CityAppearance} from './cities';
import {bindStreetLampNight} from './StreetProps';
import {hash,inside,streetTriangles,onTriangle} from './Vegetation';
// 공원 산책로 소품 — 좁은 길(폭 ≤4.5m)이 공원·정원·잔디 면 안을 지날 때 한쪽엔 벤치, 반대쪽엔
// 공원등을 교대로 둔다. 충돌 없음(기존 가로 소품과 동일). 워커에서 병합 메시로 만든다.

const PARK_KINDS=new Set(['park','garden','grass']);
function box(list:THREE.BufferGeometry[],w:number,h:number,d:number,x:number,y:number,z:number,color:number){
 const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();g.deleteAttribute('uv');g.translate(x,y,z);
 const c=new THREE.Color(color),colors=new Float32Array(g.getAttribute('position').count*3);for(let i=0;i<colors.length;i+=3)colors.set([c.r,c.g,c.b],i);
 g.setAttribute('color',new THREE.BufferAttribute(colors,3));list.push(g);
}
/** Sites in cell-local metres: [x,z,yaw,kind(0 bench / 1 lamp)]. Pure for tests. */
export function parkFurnitureSites(chunk:WorldChunk,size:number):number[] {
 const objects=chunk.objects;if(!objects?.areas?.length)return [];
 const parks=objects.areas.filter(a=>PARK_KINDS.has(a.k)&&a.p.length>=6);if(!parks.length)return [];
 const {road}=streetTriangles(chunk.compiledStreet),x0=chunk.cx*size,z0=chunk.cz*size,out:number[]=[];
 const taken:number[][]=[];
 for(const r of objects.roads){
  const w=r.w??3;if(w>4.5||r.bridge||r.tunnel)continue;
  for(let i=2;i<r.p.length;i+=2){
   const ax=r.p[i-2],az=r.p[i-1],bx=r.p[i],bz=r.p[i+1],len=Math.hypot(bx-ax,bz-az);if(len<20)continue;
   const ux=(bx-ax)/len,uz=(bz-az)/len;let n=0;
   for(let d=8+hash(ax,az,3)*12;d<len-6;d+=16,n++){
    const side=n%2?1:-1,kind=n%2,o=w/2+(kind?.7:1.1);
    const x=ax+ux*d-uz*o*side,z=az+uz*d+ux*o*side;
    if(x<x0+2||x>x0+size-2||z<z0+2||z>z0+size-2)continue;
    if(!parks.some(a=>inside(x,z,a.p)))continue;
    if(objects.buildings.some(b=>inside(x,z,b.p))||objects.water.some(wt=>wt.w==null&&inside(x,z,wt.p)))continue;
    if(onTriangle(road,x,z)||taken.some(t=>Math.abs(t[0]-x)<5&&Math.abs(t[1]-z)<5))continue;
    taken.push([x,z]);out.push(x,z,Math.atan2(-uz*side,ux*side),kind);
   }
  }
 }
 return out.slice(0,4*400);
}
export function addParkFurniture(group:THREE.Group,chunk:WorldChunk,size:number,ox:number,oz:number,height:(x:number,z:number)=>number,profile:CityAppearance):void {
 const sites=parkFurnitureSites(chunk,size);if(!sites.length)return;
 const parts:THREE.BufferGeometry[]=[],lenses:THREE.BufferGeometry[]=[],wood=0x8a6a48,iron=0x3f4a4c;
 for(let i=0;i<sites.length;i+=4){
  const x=sites[i],z=sites[i+1],yaw=sites[i+2],y=height(x,z);if(!Number.isFinite(y))continue;
  const local:THREE.BufferGeometry[]=[];
  if(sites[i+3]===0){
   // Slatted bench facing the path.
   box(local,1.7,.07,.42,0,.45,0,wood);box(local,1.7,.32,.06,0,.72,.2,wood);
   for(const dx of [-.72,.72])box(local,.07,.45,.46,dx,.23,.02,iron);
  }else{
   // Low park lantern (4m), warmer and shorter than street lights.
   box(local,.12,3.9,.12,0,1.95,0,iron);box(local,.34,.08,.34,0,4.02,0,iron);box(local,.42,.06,.42,0,3.55,0,iron);
   const lens=new THREE.BoxGeometry(.28,.4,.28).toNonIndexed();lens.deleteAttribute('uv');lens.translate(0,3.78,0);lens.rotateY(yaw);lens.translate(x-ox,y,z-oz);lenses.push(lens);
  }
  for(const g of local){g.rotateY(yaw);g.translate(x-ox,y,z-oz);parts.push(g);}
 }
 if(parts.length){
  const geometry=mergeGeometries(parts,false)!;parts.forEach(g=>g.dispose());
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:0});material.userData.paintedOwned=true;
  const mesh=new THREE.Mesh(geometry,material);mesh.name='park_furniture';mesh.userData.detailDistance=520;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
 }
 if(lenses.length){
  const geometry=mergeGeometries(lenses,false)!;lenses.forEach(g=>g.dispose());
  const material=new THREE.MeshBasicMaterial({color:profile.environment.night?.lampColor??0xffd69a});material.userData.paintedOwned=true;
  const mesh=new THREE.Mesh(geometry,material);mesh.name='street_lamp_lenses';mesh.userData.detailDistance=520;bindStreetLampNight(mesh,profile.environment.night);group.add(mesh);
 }
}
