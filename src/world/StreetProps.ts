import {seoulAppearance,type CityAppearance} from './cities';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {WorldChunk} from './chunkManifest';

type Point={x:number;z:number;tree:boolean};
const materials=new WeakMap<CityAppearance['props'],THREE.MeshStandardMaterial[]>();
function propMaterials(config:CityAppearance['props']){
 let result=materials.get(config);if(!result){result=[new THREE.MeshStandardMaterial({color:config.metal,roughness:.65}),new THREE.MeshStandardMaterial({color:config.bark,roughness:.95}),new THREE.MeshStandardMaterial({color:config.leaves,roughness:.95})];materials.set(config,result);}return result;
}
function inside(x:number,z:number,p:number[]):boolean {
 let hit=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])hit=!hit;return hit;
}
function distance(x:number,z:number,ax:number,az:number,bx:number,bz:number):number {
 const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));
 return Math.hypot(x-ax-dx*t,z-az-dz*t);
}
/** Sparse visual props only; reject buildings, water, carriageways and chunk edges. */
export function streetPropSites(chunk:WorldChunk,size:number,config:CityAppearance['props']=seoulAppearance.props):Point[]{
 if(!config.enabled||config.maxPerChunk<=0)return [];
 const objects=chunk.objects;if(!objects)return [];
 const buildings=objects.buildings.map(b=>({p:b.p,x0:Math.min(...b.p.filter((_,i)=>i%2===0))-2,x1:Math.max(...b.p.filter((_,i)=>i%2===0))+2,z0:Math.min(...b.p.filter((_,i)=>i%2===1))-2,z1:Math.max(...b.p.filter((_,i)=>i%2===1))+2}));
 const segments:{ax:number;az:number;bx:number;bz:number;w:number}[]=[];
 for(const road of objects.roads)for(let i=2;i<road.p.length;i+=2)segments.push({ax:road.p[i-2],az:road.p[i-1],bx:road.p[i],bz:road.p[i+1],w:road.w??6});
 const candidates:Point[]=[];
 for(const r of segments){
  if(r.w<6||r.w>24)continue;
  const length=Math.hypot(r.bx-r.ax,r.bz-r.az);if(length<24)continue;
  for(let d=18;d<length-6;d+=Math.max(1,config.spacing))for(const side of [-1,1]){
   const x=r.ax+(r.bx-r.ax)*d/length-(r.bz-r.az)/length*(r.w/2+config.offset)*side;
   const z=r.az+(r.bz-r.az)*d/length+(r.bx-r.ax)/length*(r.w/2+config.offset)*side;
   if(x<chunk.cx*size+2||x>(chunk.cx+1)*size-2||z<chunk.cz*size+2||z>(chunk.cz+1)*size-2)continue;
   if(buildings.some(b=>x>=b.x0&&x<=b.x1&&z>=b.z0&&z<=b.z1))continue;
   if(segments.some(s=>distance(x,z,s.ax,s.az,s.bx,s.bz)<s.w/2+.7))continue;
   if(objects.water.some(w=>w.w!=null?w.p.some((_,i)=>i%2===0&&i>=2&&distance(x,z,w.p[i-2],w.p[i-1],w.p[i],w.p[i+1])<w.w!/2+2):inside(x,z,w.p)&&!(w.holes??[]).some(h=>inside(x,z,h))))continue;
   const tree=(objects.areas??[]).some(a=>['park','wood','garden','grass'].includes(a.k)&&inside(x,z,a.p));
   if(tree?!config.trees:!config.lamps)continue;
   candidates.push({x,z,tree});
  }
 }
 // Stable spatial shuffle avoids filling only the first roads in file order.
 const key=(p:Point)=>((Math.imul(Math.round(p.x),73856093)^Math.imul(Math.round(p.z),19349663))>>>0);
 candidates.sort((a,b)=>key(a)-key(b));const sites:Point[]=[];
 for(const p of candidates){if(sites.every(q=>Math.hypot(p.x-q.x,p.z-q.z)>config.minSpacing))sites.push(p);if(sites.length>=config.maxPerChunk)break;}
 return sites;
}
export function addStreetProps(group:THREE.Group,chunk:WorldChunk,size:number,originX:number,originZ:number,heightAt:(x:number,z:number)=>number,config:CityAppearance['props']=seoulAppearance.props):void {
 const geometry:THREE.BufferGeometry[][]=[[],[],[]];
 const lenses:THREE.BufferGeometry[]=[];
 for(const p of streetPropSites(chunk,size,config)){
  const y=heightAt(p.x,p.z),x=p.x-originX,z=p.z-originZ;
  if(!Number.isFinite(y))continue;
  const first=geometry.map(g=>g.length);
  if(p.tree){
   geometry[1].push(new THREE.CylinderGeometry(.10,.17,3.5,8).toNonIndexed().translate(x,y+1.75,z));
   for(const [dx,dy,dz,r] of [[0,4,0,1.3],[-.7,3.7,.3,1],[.6,3.8,-.4,1.1]]){
    const crown=new THREE.SphereGeometry(r,12,8).toNonIndexed();crown.scale(1,1.15,1);crown.translate(x+dx,y+dy,z+dz);geometry[2].push(crown);
   }
  }else{
   geometry[0].push(new THREE.CylinderGeometry(.065,.105,config.lampHeight,8).toNonIndexed().translate(x,y+config.lampHeight/2,z));
   lenses.push(new THREE.BoxGeometry(.68,.035,.22).toNonIndexed().translate(x+.25,y+config.lampHeight-.065,z));
   geometry[0].push(new THREE.BoxGeometry(.85,.10,.27).toNonIndexed().translate(x+.25,y+config.lampHeight,z));
  }
  if(p.tree)for(let i=1;i<3;i++)for(const geo of geometry[i].slice(first[i]))geo.translate(-x,-y,-z).scale(config.treeScale,config.treeScale,config.treeScale).translate(x,y,z);
 }
 propMaterials(config).forEach((material,i)=>{
  if(!geometry[i].length)return;const merged=mergeGeometries(geometry[i],false);geometry[i].forEach(g=>g.dispose());
  if(!merged)return;const mesh=new THREE.Mesh(merged,material);mesh.name=['street_lights','street_tree_trunks','street_tree_canopies'][i];mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
 });
 if(lenses.length){
  const geo=mergeGeometries(lenses,false);lenses.forEach(g=>g.dispose());
  if(geo){const mat=new THREE.MeshBasicMaterial({color:0xffd69a});mat.userData.paintedOwned=true;
   const mesh=new THREE.Mesh(geo,mat);mesh.name='street_lamp_lenses';
   mesh.onBeforeRender=(_renderer,scene)=>{mat.color.set(0xffd69a).multiplyScalar(.08+2.5*(scene.userData.cityNight??0));};
   group.add(mesh);
  }
 }

}
