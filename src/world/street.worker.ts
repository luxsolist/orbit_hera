import * as THREE from 'three';
import {addStreetGeometry,type StreetMeshData} from './StreetGeometry';
import type {ChunkTerrain} from './chunkMesh';
import type {CityAppearance} from './cities';
self.onmessage=(event:MessageEvent<{id:number;roads:{p:number[];w?:number}[];terrain:ChunkTerrain;ox:number;oz:number;colors:CityAppearance['street']}>)=>{
 const {id,roads,terrain,ox,oz,colors}=event.data;
 const group=new THREE.Group();
 try{
  addStreetGeometry(group,roads,terrain,ox,oz,colors);
  const data:StreetMeshData[]=group.children.map(child=>{
   const mesh=child as THREE.Mesh,g=mesh.geometry;
   return {layer:mesh.userData.streetLayer,position:g.getAttribute('position').array as Float32Array,normal:g.getAttribute('normal').array as Float32Array,coord:g.getAttribute('streetCoord').array as Float32Array};
  });
  const transfer=data.flatMap(d=>[d.position.buffer,d.normal.buffer,d.coord.buffer]) as ArrayBuffer[];
  (self as unknown as {postMessage:(data:unknown,transfer:ArrayBuffer[])=>void}).postMessage({id,data},transfer);
 }catch(error){self.postMessage({id,error:String(error)});}
 finally{for(const child of group.children)(child as THREE.Mesh).geometry.dispose();}
};
