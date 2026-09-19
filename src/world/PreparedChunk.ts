import {busanBridgeStreets} from './cities/BusanBridges';
import * as THREE from 'three';
import {buildChunkMesh,facadeMaterial,type ChunkBuild} from './chunkMesh';
import {CollisionWorld,type CollisionSnapshot} from './CollisionWorld';
import {addStreetGeometry,prepareStreetMeshes,type StreetMeshData} from './StreetGeometry';
import {streetMaterial} from './StreetSurface';
import {applyPaintedMaterials} from './PaintedCityStyle';
import type {WorldChunk} from './chunkManifest';
import type {CityAppearance} from './cities';

type Attribute={array:THREE.TypedArray;itemSize:number;normalized:boolean};
type Bounds={min:number[];max:number[];center:number[];radius:number};
type MeshPacket={bounds:Bounds;ranges?:{start:number;count:number;bounds:Bounds}[];name:string;attributes:Record<string,Attribute>;index:Attribute|null;material:ReturnType<THREE.Material['toJSON']>;texture?:ImageBitmap;cast:boolean;receive:boolean;order:number;userData:Record<string,unknown>;};
export interface PreparedChunk {
 data:Omit<ChunkBuild,'group'|'buildingMesh'>;
 meshes:MeshPacket[];
 streets:StreetMeshData[];
 collision:CollisionSnapshot;
 timings:{geometry:number;streets:number;collision:number};
}
/** The same geometry builders serve synchronous tools and worker preparation. */
export function prepareChunk(chunk:WorldChunk,size:number,ox:number,oz:number,profile:CityAppearance):PreparedChunk {
 const start=performance.now(),cb=buildChunkMesh(chunk,size,ox,oz,profile,undefined,true);
 const geometry=performance.now()-start,roadStart=performance.now();
 const streets=profile.street.geometry&&cb.terrain?prepareStreetMeshes(chunk.objects?.roads??[],cb.terrain,ox,oz,profile.street,busanBridgeStreets(chunk.seoulDetail)):[];
 const streetMs=performance.now()-roadStart,collisionStart=performance.now(),collision=new CollisionWorld();
 for(const b of cb.buildings)collision.addFootprintBox(b.poly,.3,b.top);
 for(const w of cb.walls)collision.addWallBox(w.x0,w.x1,w.z0,w.z1,w.top);
 const collisionMs=performance.now()-collisionStart,meshes:MeshPacket[]=[];
 const attribute=(a:THREE.BufferAttribute):Attribute=>({array:a.array,itemSize:a.itemSize,normalized:a.normalized});
 for(const object of cb.group.children){
  if(!(object instanceof THREE.Mesh)||Array.isArray(object.material))throw new Error('Unsupported prepared chunk object');
  const mat=object.material as THREE.MeshStandardMaterial;
  const map=mat.map;mat.map=null;
  const material=mat.toJSON();mat.map=map;
  const canvas=map?.image;
  const texture=typeof OffscreenCanvas!=='undefined'&&canvas instanceof OffscreenCanvas?canvas.transferToImageBitmap():undefined;
  if(map&&!texture)throw new Error('Chunk preparation requires an OffscreenCanvas texture');
  object.geometry.computeBoundingBox();object.geometry.computeBoundingSphere();
  const bounds=packBounds(object.geometry.boundingBox!,object.geometry.boundingSphere!);
  const ranges=object===cb.buildingMesh?buildingRanges(object.geometry,cb.buildings):undefined;
  meshes.push({bounds,ranges,name:object.name,attributes:Object.fromEntries(Object.entries(object.geometry.attributes).map(([k,a])=>[k,attribute(a as THREE.BufferAttribute)])),index:object.geometry.index?attribute(object.geometry.index):null,material,texture,cast:object.castShadow,receive:object.receiveShadow,order:object.renderOrder,userData:object.userData});
  object.geometry.dispose();if(map){map.dispose();mat.dispose();}else if(mat.userData.paintedOwned)mat.dispose();
 }
 const {group:_,buildingMesh:__,...data}=cb;
 return {data,meshes,streets,collision:collision.snapshot(),timings:{geometry,streets:streetMs,collision:collisionMs}};
}
export function chunkTransfers(packet:PreparedChunk):Transferable[]{
 const result=new Set<Transferable>();
 for(const m of packet.meshes){for(const a of Object.values(m.attributes))result.add(a.array.buffer as ArrayBuffer);if(m.index)result.add(m.index.array.buffer as ArrayBuffer);if(m.texture)result.add(m.texture);}
 if(packet.data.terrain)result.add(packet.data.terrain.heights.buffer as ArrayBuffer);
 for(const s of packet.streets){for(const v of Object.values(s))if(ArrayBuffer.isView(v))result.add(v.buffer as ArrayBuffer);}
 return [...result];
}
export function discardPreparedChunk(packet:PreparedChunk){for(const m of packet.meshes)m.texture?.close();}
/** Incremental assembly; the streamer advances this iterator within its frame budget. */
export function* assembleChunk(packet:PreparedChunk,ox:number,oz:number,profile:CityAppearance):Generator<void,ChunkBuild> {
 const group=new THREE.Group();group.name=`chunk:${packet.data.cx}:${packet.data.cz}`;
 let buildingMesh:THREE.Mesh|null=null,finished=false;
 try {
 for(const m of packet.meshes){
  const geometry=new THREE.BufferGeometry();for(const [k,a] of Object.entries(m.attributes))geometry.setAttribute(k,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
  if(m.index)geometry.setIndex(new THREE.BufferAttribute(m.index.array,m.index.itemSize));
  let material:THREE.Material;
  if(m.name==='chunk_buildings'&&profile.buildings.enabled)material=facadeMaterial(profile);
  else if(m.texture){const tex=new THREE.Texture(m.texture);tex.colorSpace=THREE.SRGBColorSpace;tex.flipY=false;tex.anisotropy=4;tex.needsUpdate=true;material=streetMaterial(tex,ox,oz,profile.street);}
  else {material=new THREE.MaterialLoader().parse(m.material);material.userData.paintedOwned=true;}
  const mesh=new THREE.Mesh(geometry,material);mesh.name=m.name;mesh.castShadow=m.cast;mesh.receiveShadow=m.receive;mesh.renderOrder=m.order;mesh.userData=m.userData;
  if(mesh.name==='street_lamp_lenses')mesh.onBeforeRender=(_r,scene)=>{(material as THREE.MeshBasicMaterial).color.set(0xffd69a).multiplyScalar(.08+2.5*(scene.userData.cityNight??0));};
  // Compute culling bounds before activation, rather than on its first rendered frame.
  setBounds(geometry,m.bounds);group.add(mesh);
  if(m.ranges?.length){
   const [first,...rest]=m.ranges;geometry.setDrawRange(first.start,first.count);setBounds(geometry,first.bounds);
   for(const range of rest){const g=new THREE.BufferGeometry();for(const [k,a] of Object.entries(geometry.attributes))g.setAttribute(k,a);g.setDrawRange(range.start,range.count);setBounds(g,range.bounds);const section=new THREE.Mesh(g,material);section.name='chunk_building_section';section.castShadow=m.cast;section.receiveShadow=m.receive;group.add(section);}
  }
  if(m.name==='chunk_buildings')buildingMesh=mesh;
  yield;
 }
 if(packet.data.terrain)for(const street of packet.streets){addStreetGeometry(group,[],packet.data.terrain,ox,oz,profile.street,[street]);yield;}
 if(profile.renderStyle==='painted')applyPaintedMaterials(group);
 finished=true;return {...packet.data,group,buildingMesh};
 } finally {
  if(!finished){group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const m=o.material as THREE.MeshStandardMaterial;if(m.map){m.map.dispose();m.dispose();}else if(m.userData.paintedOwned)m.dispose();}});discardPreparedChunk(packet);}
 }
}

function packBounds(box:THREE.Box3,sphere:THREE.Sphere):Bounds {return {min:box.min.toArray(),max:box.max.toArray(),center:sphere.center.toArray(),radius:sphere.radius};}
function setBounds(g:THREE.BufferGeometry,b:Bounds){g.boundingBox=new THREE.Box3(new THREE.Vector3().fromArray(b.min),new THREE.Vector3().fromArray(b.max));g.boundingSphere=new THREE.Sphere(new THREE.Vector3().fromArray(b.center),b.radius);}
/** Buildings are sorted spatially by the common builder; share attributes for destruction updates. */
function buildingRanges(g:THREE.BufferGeometry,buildings:ChunkBuild['buildings']) {
 const pos=g.getAttribute('position'),result:{start:number;count:number;bounds:Bounds}[]=[];
 let last='',box=new THREE.Box3(),start=0,count=0;const point=new THREE.Vector3();
 const finish=()=>{if(count)result.push({start,count,bounds:packBounds(box.clone().expandByScalar(4),box.clone().expandByScalar(4).getBoundingSphere(new THREE.Sphere()))});};
 for(const b of buildings){
  const x=b.poly.filter((_,i)=>i%2===0),z=b.poly.filter((_,i)=>i%2===1);
  const key=`${Math.floor((Math.min(...x)+Math.max(...x))/512)}:${Math.floor((Math.min(...z)+Math.max(...z))/512)}`;
  if(key!==last){finish();last=key;box=new THREE.Box3();start=b.vStart;count=0;}
  for(let i=b.vStart;i<b.vStart+b.vCount;i++)box.expandByPoint(point.set(pos.getX(i),pos.getY(i),pos.getZ(i)));
  count+=b.vCount;
 }
 finish();return result;
}
