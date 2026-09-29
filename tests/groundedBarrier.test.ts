import {readMapFixture} from './mapFixture';
import {it,expect} from 'vitest';
import * as THREE from 'three';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {groundedWall,groundedRailing,BARRIER_EMBED} from '../src/world/GroundedBarrier';
import {sampleChunkLandHeight,buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {applyMapCorrections} from '../src/world/MapCorrections';
import {paintedSeoul} from '../src/world/cities/painted';
import {CHEONGGYE_PILOT as recipe,pilotInRiver} from '../src/world/cities/CheonggyePilot';
import {prepareChunk,assembleChunk} from '../src/world/PreparedChunk';
import {corridorOutline,insideRoadOutline} from '../src/world/RoadNetwork';
import {pilotRoadNetwork,inPilot} from '../src/world/cities/CheonggyePilot';
import type {WorldChunk} from '../src/world/chunkManifest';

function mesh(positions:number[]){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.updateMatrixWorld();return m;}
function dispose(m:THREE.Mesh){m.geometry.dispose();(m.material as THREE.Material).dispose();}

it('follows both sides of a wall over terrain creases without buried tops or floating bases',()=>{
 const t={size:5,step:4,cellX0:0,cellZ0:0,heights:new Float32Array([0,0,2,0,0,0,1,4,0,0,0,2,6,2,0,0,0,3,1,0,0,0,0,0,0])};
 const built=groundedWall([1,2,15,14],2,1.4,t,0,0),m=mesh(built.positions);
 expect(built.walls.length).toBeGreaterThan(1);
 let checks=0;
 for(let u=.025;u<.99;u+=.025)for(const side of [-.55,0,.55]){
  const len=Math.hypot(14,12),x=1+14*u-12/len*side,z=2+12*u+14/len*side,ground=sampleChunkLandHeight(t,x,z);
  const upper=new THREE.Raycaster(new THREE.Vector3(x,30,z),new THREE.Vector3(0,-1,0)).intersectObject(m)[0];
  const lower=new THREE.Raycaster(new THREE.Vector3(x,-10,z),new THREE.Vector3(0,1,0)).intersectObject(m)[0];
  expect(upper).toBeDefined();expect(lower).toBeDefined();expect(upper.point.y-ground).toBeCloseTo(2,4);expect(lower.point.y-ground).toBeCloseTo(-BARRIER_EMBED,4);checks++;
 }
 expect(checks).toBeGreaterThan(100);
 expect(built.walls.every(w=>w.x1-w.x0<5&&w.z1-w.z0<5)).toBe(true);dispose(m);
});

it('anchors every railing post to the selected sloping deck surface with connected rails',()=>{
 const ground=(x:number,z:number)=>20+.08*x+.03*z,positions=groundedRailing([0,0],[12,6],.95,ground),m=mesh(positions),steps=Math.ceil(Math.hypot(12,6)/3);
 for(let i=0;i<=steps;i++){
  const x=12*i/steps,z=6*i/steps,y=ground(x,z);
  const base=new THREE.Raycaster(new THREE.Vector3(x,y-1,z),new THREE.Vector3(0,1,0)).intersectObject(m)[0];
  const top=new THREE.Raycaster(new THREE.Vector3(x,y+2,z),new THREE.Vector3(0,-1,0)).intersectObject(m)[0];
  expect(base.point.y).toBeCloseTo(y-BARRIER_EMBED,4);expect(top.point.y).toBeCloseTo(y+.95,4);
 }
 dispose(m);
});

it('audits all four pilot tiles against actual terrain and keeps wall geometry and collision through worker transfer',()=>{
 const read=(p:string)=>readMapFixture(p);
 let wallSegments=0,vertices=0,terrainChecks=0,roadClearanceChecks=0,maxBottomError=0,maxTopError=0;
 const roadGrid=new Map<string,number[][][]>();
 for(const c of pilotRoadNetwork.values())if(inPilot(...c.a)||inPilot(...c.b)){
  const poly=corridorOutline(c,c.w>=6&&c.w<=36?5.2:.45);
  for(let x=Math.floor(Math.min(...poly.map(p=>p[0]))/32);x<=Math.floor(Math.max(...poly.map(p=>p[0]))/32);x++)for(let z=Math.floor(Math.min(...poly.map(p=>p[1]))/32);z<=Math.floor(Math.max(...poly.map(p=>p[1]))/32);z++){
   const key=x+':'+z,list=roadGrid.get(key)??[];list.push(poly);roadGrid.set(key,list);
  }
 }
 const profile={...paintedSeoul,props:{...paintedSeoul.props,enabled:false}};
 for(const [cx,cz] of [[84,46],[85,46],[84,47],[85,47]]){
  const chunk=applyMapCorrections([37,126],read(`public/maps/37/126/5_2/${cx}_${cz}.json`),{detail:read(`public/maps/details/seoul/${cx}_${cz}.json`),roadGrade:read(`public/maps/road-grade/37/126/${cx}_${cz}.json`),appearance:read(`public/maps/landmark-appearance/seoul/${cx}_${cz}.json`)});
  const ox=cx*1024,oz=cz*1024,built=buildChunkMesh(chunk,1024,ox,oz,profile),terrain=built.group.getObjectByName('chunk_terrain') as THREE.Mesh;built.group.updateMatrixWorld(true);
  expect(built.group.getObjectByName('chunk_walls')).toBeDefined();
  for(const wall of chunk.objects.walls??[]){
   const h=wall.h??2.5,data=groundedWall(wall.p,h,wall.w??.4,built.terrain!,ox,oz);
   wallSegments+=data.walls.length;
   // Test the full wall width, not just its centreline or vertical contact.
   for(let i=2;i<wall.p.length;i+=2){
    const [ax,az,bx,bz]=wall.p.slice(i-2,i+2),len=Math.hypot(bx-ax,bz-az),steps=Math.max(1,Math.ceil(len));
    for(let j=0;j<=steps;j++)for(const side of [-.5,0,.5]){
     const x=ax+(bx-ax)*j/steps-(bz-az)/len*(wall.w??.4)*side,z=az+(bz-az)*j/steps+(bx-ax)/len*(wall.w??.4)*side;
     if(!inPilot(x,z))continue;
     const cuts=roadGrid.get(Math.floor(x/32)+':'+Math.floor(z/32))??[];
     expect(cuts.some(poly=>insideRoadOutline([x,z],poly)),`wall intrudes into road/sidewalk: ${x},${z}`).toBe(false);roadClearanceChecks++;
    }
   }
   for(let k=0;k<data.positions.length;k+=3){
    const x=data.positions[k]+ox,y=data.positions[k+1],z=data.positions[k+2]+oz,ground=sampleChunkLandHeight(built.terrain,x,z),offset=y-ground;
    const error=Math.min(Math.abs(offset-h),Math.abs(offset+BARRIER_EMBED));
    expect(error).toBeLessThan(.0001);
    if(Math.abs(offset-h)<Math.abs(offset+BARRIER_EMBED))maxTopError=Math.max(maxTopError,error);else maxBottomError=Math.max(maxBottomError,error);vertices++;
   }
   // Inspect a rendered cap against the real terrain at a representative triangle centre.
   for(let k=0;k<data.positions.length;k+=18){
    const a=data.positions.slice(k,k+3),b=data.positions.slice(k+3,k+6),c=data.positions.slice(k+6,k+9);
    if(c.length!==3)continue;
    const x=(a[0]+b[0]+c[0])/3,z=(a[2]+b[2]+c[2])/3,y=(a[1]+b[1]+c[1])/3;
    if(pilotInRiver(x+ox,z+oz))continue;
    const hit=new THREE.Raycaster(new THREE.Vector3(x,1000,z),new THREE.Vector3(0,-1,0)).intersectObject(terrain)[0];
    if(hit&&Math.abs(y-sampleChunkLandHeight(built.terrain,x+ox,z+oz)-h)<.001){expect(Math.abs(y-hit.point.y-h)).toBeLessThan(.005);terrainChecks++;break;}
   }
  }
  disposeChunkGroup(built.group);
 }
 expect(wallSegments).toBeGreaterThan(100);expect(terrainChecks).toBeGreaterThan(50);
 // Small pilot fixture validates the actual worker serialization/assembly path without rebuilding a full city twice.
 const cx=85,cz=46,ox=cx*1024,oz=cz*1024,x=recipe.center[0],z=recipe.center[1]-80;
 const chunk={cx,cz,streetPilot:true,terrain:{size:33,seaLevel:0,heights:Array(33*33).fill(35)},objects:{buildings:[],roads:[],water:[],walls:[{p:[x,z,x+25,z+8],h:2,w:.55}]},underground:null} as WorldChunk;
 const direct=buildChunkMesh(chunk,1024,ox,oz,profile),packet=structuredClone(prepareChunk(chunk,1024,ox,oz,profile)),assembly=assembleChunk(packet,ox,oz,profile);let result=assembly.next();while(!result.done)result=assembly.next();
 const worker=result.value;
 expect(worker.walls).toEqual(direct.walls);
 const attr=(g:THREE.Group)=>Array.from((g.getObjectByName('chunk_walls') as THREE.Mesh).geometry.getAttribute('position').array);
 expect(attr(worker.group)).toEqual(attr(direct.group));disposeChunkGroup(worker.group);disposeChunkGroup(direct.group);
 mkdirSync('build',{recursive:true});const report={tiles:4,wallCollisionSections:wallSegments,wallVertices:vertices,roadClearanceChecks,renderedTerrainChecks:terrainChecks,maxBottomError,maxTopError,embedMeters:BARRIER_EMBED};writeFileSync('build/cheonggye-barrier-audit.json',JSON.stringify(report,null,2));console.log(report);
},60000);
