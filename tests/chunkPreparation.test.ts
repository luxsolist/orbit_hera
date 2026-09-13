import {it,expect,vi,afterEach} from 'vitest';
import * as THREE from 'three';
import {ChunkPreparation} from '../src/world/ChunkPreparation';
import {prepareChunk,assembleChunk,chunkTransfers} from '../src/world/PreparedChunk';
import {buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {paintedSeoul} from '../src/world/cities/painted';
import type {WorldChunk} from '../src/world/chunkManifest';
import {ChunkCollisionWorld} from '../src/world/ChunkCollisionWorld';
import {CollisionWorld} from '../src/world/CollisionWorld';
import {updateStreetDetail} from '../src/world/StreetGeometry';
const profile={...paintedSeoul,props:{...paintedSeoul.props,enabled:false},ground:{...paintedSeoul.ground,enabled:false},street:{...paintedSeoul.street,geometry:false}};
const raw={cx:0,cz:0,terrain:{size:2,heights:[0,0,0,0]},objects:{buildings:[{p:[10,10,30,10,30,22,10,22],h:20},{p:[510,10,530,10,530,22,510,22],h:40}],roads:[],walls:[],water:[]}} as WorldChunk;
afterEach(()=>vi.unstubAllGlobals());
it('transfers geometry without losing facades, building ranges or shared destruction attributes',()=>{
 const packet=prepareChunk(raw,1024,0,0,profile),transfer=chunkTransfers(packet);
 expect(new Set(transfer).size).toBe(transfer.length);
 const clone=structuredClone(packet,{transfer:transfer as ArrayBuffer[]});
 expect(packet.meshes[0].attributes.position.array.byteLength).toBe(0);
 const it=assembleChunk(clone,0,0,profile);let r=it.next();while(!r.done)r=it.next();const built=r.value;
 const original=buildChunkMesh(raw,1024,0,0,profile);
 expect(built.buildings).toEqual(original.buildings);
 expect(Array.from(built.buildingMesh!.geometry.getAttribute('position').array)).toEqual(Array.from(original.buildingMesh!.geometry.getAttribute('position').array));
 const sections=built.group.children.filter(o=>o.name==='chunk_building_section') as THREE.Mesh[];
 expect(sections.length).toBe(1);expect(sections[0].geometry.getAttribute('position')).toBe(built.buildingMesh!.geometry.getAttribute('position'));
 expect((built.buildingMesh!.material as THREE.Material).customProgramCacheKey()).toContain('painted-reference');
 expect(built.buildingMesh!.geometry.getAttribute('facadeKind')).toBeTruthy();
 disposeChunkGroup(original.group);disposeChunkGroup(built.group);
});
it('preserves per-chunk collision, destruction and restoration through deactivate/reactivate',()=>{
 const a=new CollisionWorld();a.addAabbBox(0,20,0,20,10);a.finalize();
 const b=new CollisionWorld();b.addAabbBox(40,60,0,20,30);b.finalize();
 const world=new ChunkCollisionWorld();world.setChunk('a',a);world.setChunk('b',CollisionWorld.fromSnapshot(structuredClone(b.snapshot())));
 expect(world.topAt(50,10)).toBe(30);world.openBuildingAt(10,10);expect(world.topAt(10,10)).toBe(-Infinity);
 world.removeChunk('a');expect(world.segmentBlocked(-10,5,10,30,5,10)).toBe(Infinity);
 world.setChunk('a',a);expect(world.topAt(10,10)).toBe(-Infinity);world.closeBuildingAt(10,10);expect(world.topAt(10,10)).toBe(10);
 expect(world.segmentBlocked(-10,5,10,70,5,10)).toBeCloseTo(.125);expect(world.topAt(50,10)).toBe(30);
});
it('prioritizes queued work, cancels active work and rejects on disposal',async()=>{
 const instances:Fake[]=[];
 class Fake {onmessage!:(e:unknown)=>void;onerror!:()=>void;messages:{id:number}[]=[];terminated=false;constructor(){instances.push(this);}postMessage(m:{id:number}){this.messages.push(m);}terminate(){this.terminated=true;}}
 vi.stubGlobal('Worker',Fake);
 const prep=new ChunkPreparation(),abort=new AbortController(),job={cell:[37,126] as [number,number],cx:0,cz:0,block:16,size:1024,ox:0,oz:0,profile};
 const a=prep.prepare('a',job,abort.signal),b=prep.prepare('b',job),c=prep.prepare('c',job);prep.prioritize(['c','b']);
 const rejected=expect(a).rejects.toThrow('cancelled');abort.abort();await rejected;expect(instances[0].terminated).toBe(true);
 expect(instances[1].messages[0].id).toBe(3);instances[1].onmessage({data:{id:3,packet:null}});expect(await c).toBeNull();
 const disposed=expect(b).rejects.toThrow('disposed');prep.dispose();await disposed;expect(instances[1].terminated).toBe(true);
});

it('reduces distant small props with hysteresis while keeping tree silhouettes and lamp glow',()=>{
 const group=new THREE.Group();for(const name of ['street_lights','street_tree_trunks','street_tree_canopies','street_lamp_lenses']){const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));mesh.name=name;group.add(mesh);}
 updateStreetDetail(group,1300,0);expect(group.children.map(o=>o.visible)).toEqual([false,false,true,true]);
 updateStreetDetail(group,1100,0);expect(group.children[0].visible).toBe(false);
 updateStreetDetail(group,1000,0);expect(group.children.every(o=>o.visible)).toBe(true);
 group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});
});
