import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import placements from './gyeongbokgung-placement.json';
import models from './gyeongbokgung-models.json';
import {StructureBuilder} from '../StructureBuilder';
import {setUniformColor} from '../geo';
import type {Cell,WorldChunk} from '../chunkManifest';
import type {Part,MatDef} from '../MapData';
const builder=new StructureBuilder();
/** Exact existing footprint match: other cities/buildings and updated source geometry are untouched. */
export function correctGyeongbokgungChunk(cell:Cell,raw:WorldChunk):WorldChunk {
 if(cell[0]!==37||cell[1]!==126)return raw;
 const local=placements.filter(p=>p.cx===raw.cx&&p.cz===raw.cz);
 if(!local.length)return raw;
 let changed=false;
 const buildings=raw.objects.buildings.map(b=>{
  const entry=local.find(p=>p.poly.length===b.p.length&&p.poly.every((v,i)=>v===b.p[i]));
  if(!entry)return b;
  changed=true;return {...b,landmarkModel:entry.id,lm:b.lm??'deep-roots' as const,n:entry.name};
 });
 return changed?{...raw,objects:{...raw.objects,buildings}}:raw;
}
/** Color-baked geometry joins the existing combat mesh; no duplicate visual-only target. */
export function palaceGeometry(id:string,originX:number,originZ:number,base:number,groundBase=base):THREE.BufferGeometry|null {
 const placement=placements.find(p=>p.id===id);
 const model=(models as unknown as Record<string,{parts:Part[];mats:MatDef[]}>)[id];
 if(!placement||!model)return null;
 const pieces:THREE.BufferGeometry[]=[];
 for(const p of model.parts){const g=builder.partGeometry(p);if(!g)continue;setUniformColor(g,new THREE.Color('#'+model.mats[p.m].c));pieces.push(g);}
 const geometry=mergeGeometries(pieces,false);pieces.forEach(g=>g.dispose());if(!geometry)return null;
 geometry.computeBoundingBox();const bounds=geometry.boundingBox!;
 // Fit horizontal silhouette to mapped outline in the palace axis; vertical detail remains an estimate.
 const c=Math.cos(placement.rot),s=Math.sin(placement.rot),xs:number[]=[],zs:number[]=[];
 for(let i=0;i<placement.poly.length;i+=2){const x=placement.poly[i]-placement.x,z=placement.poly[i+1]-placement.z;xs.push(x*c-z*s);zs.push(x*s+z*c);}
 geometry.translate(-(bounds.min.x+bounds.max.x)/2,-bounds.min.y,-(bounds.min.z+bounds.max.z)/2);
 geometry.scale((Math.max(...xs)-Math.min(...xs))/(bounds.max.x-bounds.min.x),1,(Math.max(...zs)-Math.min(...zs))/(bounds.max.z-bounds.min.z));
 geometry.rotateY(placement.rot);geometry.translate(placement.x-originX,base,placement.z-originZ);
 if(groundBase<base-.01){
  const shape=new THREE.Shape();
  for(let i=0;i<placement.poly.length;i+=2){const x=placement.poly[i]-originX,z=placement.poly[i+1]-originZ;if(i===0)shape.moveTo(x,-z);else shape.lineTo(x,-z);}
  shape.closePath();const foundation=new THREE.ExtrudeGeometry(shape,{depth:base-groundBase,bevelEnabled:false,steps:1});
  foundation.rotateX(-Math.PI/2);foundation.translate(0,groundBase,0);foundation.deleteAttribute('uv');
  setUniformColor(foundation,new THREE.Color('#b3afa2'));
  const merged=mergeGeometries([foundation,geometry],false);foundation.dispose();geometry.dispose();return merged;
 }
 return geometry;
}
