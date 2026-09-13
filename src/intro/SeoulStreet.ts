import * as THREE from 'three';
import {buildChunkMesh,sampleChunkHeight} from '../world/chunkMesh';
import {paintedSeoul} from '../world/cities/painted';
import {SkyEnvironment} from '../world/SkyEnvironment';
import {addPaintedSky} from '../world/PaintedCityStyle';
import {seoulStudyTarget,SEOUL_STUDY_URL,SEOUL_STUDY_ORIGIN} from '../world/SeoulStudyLocation';
import type {WorldChunk} from '../world/chunkManifest';
import type {Street} from './cinematicAssets';
let data:WorldChunk|undefined,pending:Promise<void>|undefined;
export function prepareSeoulStreet():Promise<void>{
 if(data)return Promise.resolve();
 return pending??=fetch(SEOUL_STUDY_URL).then(r=>{if(!r.ok)throw new Error('서울 인트로 지도 로딩 실패');return r.json();}).then(raw=>{data=raw;}).catch(error=>{pending=undefined;throw error;});
}
export function mappedSeoulStreet(scene:THREE.Scene):Street|undefined {
 if(!data)return undefined;
 const chunk=buildChunkMesh(data,1024,SEOUL_STUDY_ORIGIN.x,SEOUL_STUDY_ORIGIN.z,paintedSeoul);
 const anchor=seoulStudyTarget(chunk);
 chunk.group.position.copy(anchor).multiplyScalar(-1);scene.add(chunk.group);
 const sky=new SkyEnvironment(scene,{x:0,z:0,yaw:0},900,paintedSeoul.environment);addPaintedSky(scene);
 scene.environmentIntensity=0;scene.userData.paintedCity=true;
 scene.userData.introCityUpdate=()=>sky.update(0,0);
 // Keep the same set origin for actors; the establishing shot uses the exact preview camera offset.
 scene.userData.introCityAnchor=true;
 scene.userData.introGroundHeight=(x:number,z:number)=>sampleChunkHeight(chunk.terrain,x+anchor.x+SEOUL_STUDY_ORIGIN.x,z+anchor.z+SEOUL_STUDY_ORIGIN.z)-anchor.y;
 const details=new THREE.Group();scene.add(details);
 const dust=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({size:.03,transparent:true,opacity:.25}));scene.add(dust);
 // Deform only one real building: facade coordinates encode its centroid and base elevation.
 const mesh=chunk.buildingMesh,geo=mesh?.geometry,pos=geo?.getAttribute('position'),facade=geo?.getAttribute('facadePosition');
 let selected:number[]=[];let base=0;
 if(pos&&facade){
  let distance=Infinity,cx=0,cz=0;
  for(let i=0;i<pos.count;i++){const x=pos.getX(i)-facade.getX(i),z=pos.getZ(i)-facade.getZ(i),d=Math.hypot(x-anchor.x,z-anchor.z);if(d<distance){distance=d;cx=x;cz=z;base=pos.getY(i)-facade.getY(i);}}
  for(let i=0;i<pos.count;i++)if(Math.abs(pos.getX(i)-facade.getX(i)-cx)<.05&&Math.abs(pos.getZ(i)-facade.getZ(i)-cz)<.05)selected.push(i);
 }
 const original=pos?Float32Array.from(pos.array):new Float32Array();
 return {building:chunk.group,details,fragments:[],dust,damage(t:number){
  if(!pos)return;const k=THREE.MathUtils.smoothstep(t,1,8.5);
  for(const i of selected)pos.setY(i,base+(original[i*3+1]-base)*(1-.92*k));
  pos.needsUpdate=true;
 }};
}
