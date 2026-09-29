import {inCompiledStreet} from '../CompiledStreet';
import {defaultCityNight} from './night';
import type {CityNightSettings} from './types';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {WorldChunk} from '../chunkManifest';
import {streetPropSites,bindStreetLampNight} from '../StreetProps';
import {seoulAppearance} from './seoul';
import {inPilot,channelDistance} from './CheonggyePilot';
/** Reused procedural components, spatially batched for near-distance culling. No per-tree textures. */
export function addPilotStreetDetails(group:THREE.Group,chunk:WorldChunk,ox:number,oz:number,height:(x:number,z:number)=>number,night:CityNightSettings=defaultCityNight):void {
 const lenses:THREE.BufferGeometry[]=[];
 const batches=new Map<string,THREE.BufferGeometry[]>();
 const owned=(x:number,z:number)=>!inCompiledStreet(chunk.compiledStreet,x,z)&&inPilot(x,z)&&Math.floor(x/1024)===chunk.cx&&Math.floor(z/1024)===chunk.cz;
 const add=(g:THREE.BufferGeometry,x:number,y:number,z:number,color:number,rotation=0)=>{
  const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute('uv');v.rotateY(rotation);v.translate(x-ox,y,z-oz);
  const rgb=new THREE.Color(color),a=new Float32Array(v.getAttribute('position').count*3);for(let i=0;i<a.length;i+=3){a[i]=rgb.r;a[i+1]=rgb.g;a[i+2]=rgb.b;}v.setAttribute('color',new THREE.BufferAttribute(a,3));
  const key=Math.floor(x/128)+':'+Math.floor(z/128),list=batches.get(key)??[];list.push(v);batches.set(key,list);
 };
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:number,r=0)=>add(new THREE.BoxGeometry(w,h,d),x,y,z,c,r);
 const tree=(x:number,z:number)=>{const y=height(x,z),seed=Math.abs(Math.sin(x*1.31+z*.17)),h=5.5+seed*2;
  box(x,y+.055,z,1.7,.11,1.7,0x777971);
  add(new THREE.CylinderGeometry(.12,.19,h*.66,6),x,y+h*.33,z,0x665847);
  for(let i=0;i<5;i++){const a=i*2.399+seed,r=i?1:0;const g=new THREE.IcosahedronGeometry(1.45+seed*.3,1);g.scale(1,1.18,1);add(g,x+Math.cos(a)*r,y+h-.6+Math.sin(i)*.5,z+Math.sin(a)*r,[0x456048,0x536d46,0x63784e,0x4c6742,0x58744b][i]);}
 };
 const sites=streetPropSites(chunk,1024,{...seoulAppearance.props,enabled:true,trees:true,lamps:true,maxPerChunk:160,spacing:26,minSpacing:19,offset:1.4});
 let count=0;
 for(const p of sites){if(!owned(p.x,p.z)||channelDistance(p.x,p.z)<26)continue;
  // Remaining objects keep sidewalk passage; use small clear-space furnishings only.
  if(count%4<2)tree(p.x,p.z);else if(count%4===2){const y=height(p.x,p.z);add(new THREE.CylinderGeometry(.065,.105,6,8),p.x,y+3,p.z,0x4f5858);box(p.x+.3,y+6,p.z,.9,.13,.32,0x596467);lenses.push(new THREE.BoxGeometry(.75,.035,.24).translate(p.x+.3-ox,y+5.925,p.z-oz));}else{const y=height(p.x,p.z);box(p.x,y+.48,p.z,1.6,.12,.48,0x80694e);box(p.x,y+.78,p.z+.22,1.6,.48,.08,0x80694e);for(const dx of [-.6,.6])box(p.x+dx,y+.23,p.z,.09,.46,.4,0x4f5858);}
  count++;
 }
 for(const geos of batches.values()){
  const g=mergeGeometries(geos,false)!;geos.forEach(v=>v.dispose());const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.83});material.userData.paintedOwned=true;
  const mesh=new THREE.Mesh(g,material);mesh.name='pilot_street_details';mesh.userData.detailDistance=420;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
 }
 if(lenses.length){const geometry=mergeGeometries(lenses,false)!;lenses.forEach(g=>g.dispose());const material=new THREE.MeshBasicMaterial({color:0xffd69a});material.userData.paintedOwned=true;const mesh=new THREE.Mesh(geometry,material);mesh.name='street_lamp_lenses';bindStreetLampNight(mesh,night);group.add(mesh);}

}
