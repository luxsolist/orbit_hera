import {readMapFixture} from './mapFixture';
import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {CHEONGGYE_PILOT as recipe,pilotChannelZ,pilotStreetHeight,pilotSupportHeight,pilotRamps,pilotInRiver,pilotBridgeRoad,resolvePilotBank} from '../src/world/cities/CheonggyePilot';
import {pilotRiverSurfaces,addPilotRiver,addPilotBridgeStructures} from '../src/world/cities/CheonggyeRiver';
import {terrainFootprint,addStreetGeometry} from '../src/world/StreetGeometry';
import {readFileSync} from 'node:fs';
import {applyMapCorrections} from '../src/world/MapCorrections';
import {buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {paintedSeoul} from '../src/world/cities/painted';

const target={x:(126.990929-126)*88316.0938412203,z:(38-37.568297)*111320};
const ray=(group:THREE.Group,x:number,z:number,from=200)=>{group.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(x,from,z),new THREE.Vector3(0,-1,0)).intersectObjects(group.children,true);};
describe('Cheonggye semantic surfaces',()=>{
 it('keeps the reported water section level across its width and gently descending even under bridges',()=>{
  let last=Infinity;const groups=new Map<string,THREE.Group>();
  for(let x=recipe.center[0]-490;x<=recipe.center[0]+490;x+=5){
   const cx=Math.floor(x/1024),cz=Math.floor(pilotChannelZ(x)/1024),key=cx+":"+cz;let group=groups.get(key);if(!group){group=new THREE.Group();addPilotRiver(group,cx,cz,1024,0,0,pilotStreetHeight);groups.set(key,group);}
   const zs=[-3,0,3].map(d=>pilotChannelZ(x)+d),heights=zs.map(z=>ray(group,x,z).find(h=>h.object.name==='pilot_river_water')!.point.y);
   expect(Math.max(...heights)-Math.min(...heights)).toBeLessThan(.002);
   expect(heights[0]).toBeLessThanOrEqual(last+.002);if(last<Infinity)expect(last-heights[0]).toBeLessThan(.02);last=heights[0];
  }
  for(const group of groups.values())disposeChunkGroup(group);
 });
 it('shares bank edges, water levels and ramp support at tile boundaries',()=>{
  const x=85*1024,z=pilotChannelZ(x);
  const left=pilotRiverSurfaces(84,46,1024,pilotStreetHeight),right=pilotRiverSurfaces(85,46,1024,pilotStreetHeight);
  for(const kind of ['water','path','bank','wall']){
   const boundary=(surfaces:typeof left)=>{const data=surfaces.find(s=>s.kind===kind)!.vertices;return [...new Set(Array.from({length:data.length/3},(_,i)=>data.slice(i*3,i*3+3)).filter(v=>Math.abs(v[0]-x)<1e-6).map(v=>v.map(n=>n.toFixed(4)).join(',')))].sort();};
   expect(boundary(left)).toEqual(boundary(right));expect(boundary(left).length).toBeGreaterThan(0);
  }
  expect(Number.isFinite(z)).toBe(true);
  for(const start of pilotRamps){const group=new THREE.Group();for(const cx of [84,85])addPilotRiver(group,cx,46,1024,0,0,pilotStreetHeight);
   let previous=Infinity;for(let d=0;d<=100;d+=2){const x=start+d,z=pilotChannelZ(x)+10;const hit=ray(group,x,z).find(h=>h.object.name==='pilot_river_bank');expect(hit).toBeDefined();expect(hit!.point.y).toBeCloseTo(pilotSupportHeight(x,z,0),2);if(previous<Infinity)expect(Math.abs(hit!.point.y-previous)).toBeLessThan(.25);previous=hit!.point.y;}
   disposeChunkGroup(group);
  }
 });
 it('removes old land and non-crossing streets at the reported river point; actual rendered supports match queries',()=>{
  const read=(p:string)=>readMapFixture(p);
  const raw=read('public/maps/37/126/5_2/85_46.json');
  const chunk=applyMapCorrections([37,126],raw,{roadGrade:read('public/maps/road-grade/37/126/85_46.json'),detail:read('public/maps/details/seoul/85_46.json'),appearance:read('public/maps/landmark-appearance/seoul/85_46.json')});
  const built=buildChunkMesh(chunk,1024,85*1024,46*1024,paintedSeoul),x=target.x;
  for(const d of [-10,-6,0,6,10]){const z=pilotChannelZ(x)+d,hits=ray(built.group,x-85*1024,z-46*1024);
   expect(hits.some(h=>h.object.name==='chunk_terrain')).toBe(false);expect(hits.some(h=>h.object.name.startsWith('street_'))).toBe(false);
   const support=hits.find(h=>h.object.name==='pilot_river_'+(d===0?'bed':Math.abs(d)===6?'path':'bank'));expect(support).toBeDefined();expect(support!.point.y).toBeCloseTo(pilotSupportHeight(x,z,0),2);
  }
  // Legacy embankment colliders must not survive inside the rebuilt promenade.
  for(let x=recipe.center[0]-170;x<recipe.center[0]+450;x+=5)for(const side of [-1,1]){
   const px=x-85*1024,pz=pilotChannelZ(x)+side*6-46*1024;
   expect(built.walls.filter(w=>px>=w.x0&&px<=w.x1&&pz>=w.z0&&pz<=w.z1),`blocked path ${x},${side}`).toEqual([]);
  }
  const z=pilotChannelZ(target.x),feet=pilotSupportHeight(target.x,z+6,0);
  const blocked=resolvePilotBank(target.x,z+8.6,.35,feet);expect(blocked.z).toBeLessThan(z+8.5);expect(pilotSupportHeight(blocked.x,blocked.z,feet)).toBeCloseTo(feet,3);
  const rampX=pilotRamps[1]+50,rampZ=pilotChannelZ(rampX)+9.5,rampFeet=pilotSupportHeight(rampX,rampZ,0);
  expect(resolvePilotBank(rampX,rampZ,.35,rampFeet)).toEqual({x:rampX,z:rampZ});
  // Land grid remains 33²; the narrow corridor no longer expands a whole chunk to 257².
  expect(chunk.terrain.size).toBe(33);disposeChunkGroup(built.group);
 },30000);
 it('renders connected road decks and keeps lower paths below those decks independently',()=>{
  const roads=recipe.streets.filter(r=>pilotBridgeRoad(r.slice(0,4))).map(r=>({p:r.slice(0,4),w:r[4]}));
  const group=new THREE.Group(),x=87235,z=pilotChannelZ(x)+6;
  const t={streetPilot:true,size:33,step:32,cellX0:85*1024,cellZ0:46*1024,heights:new Float32Array(33*33)};
  for(let j=0;j<33;j++)for(let i=0;i<33;i++)t.heights[j*33+i]=pilotStreetHeight(t.cellX0+i*32,t.cellZ0+j*32);
  addStreetGeometry(group,roads,t,0,0,paintedSeoul.street);addPilotRiver(group,85,46,1024,0,0,pilotStreetHeight);addPilotBridgeStructures(group,roads,85,46,1024,0,0,pilotStreetHeight);
  const deck=ray(group,x,z).find(h=>h.object.name==='street_asphalt')!;expect(deck).toBeDefined();expect(deck.point.y).toBeCloseTo(pilotSupportHeight(x,z),2);
  const below=ray(group,x,z,pilotStreetHeight(x,z)-1)[0];expect(below.object.name).toBe('pilot_river_path');expect(below.point.y).toBeCloseTo(pilotSupportHeight(x,z,below.point.y),2);
  expect(deck.point.y-below.point.y).toBeGreaterThan(3);
  const p:[number,number][]=[[target.x-2,target.z-2],[target.x+2,target.z-2],[target.x+2,target.z+2],[target.x-2,target.z+2]];
  expect(p.every(([x,z])=>pilotInRiver(x,z))).toBe(true);expect(terrainFootprint(p,t,0,0)).toHaveLength(0);
  disposeChunkGroup(group);
 });
});
