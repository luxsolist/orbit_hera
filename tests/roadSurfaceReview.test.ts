import {readMapFixture} from './mapFixture';
import {streetContext} from '../src/world/StreetLayout';
import {roadSegmentKey,corridorOutline,insideRoadOutline} from '../src/world/RoadNetwork';
import {reconciledWaterLevel} from '../src/world/SurfaceCoherence';
import {addSeoulLandscape} from '../src/world/cities/SeoulDetail';
import {it,expect} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import * as THREE from 'three';
import {applyMapCorrections} from '../src/world/MapCorrections';
import {chunkTerrainEntry,sampleStreetHeight,sampleChunkLandHeight,sampleChunkSupportHeight} from '../src/world/chunkMesh';
import {addStreetGeometry} from '../src/world/StreetGeometry';
import {terrainTransitionWeight} from '../src/world/TerrainTransition';
import {pilotInRiver,CHEONGGYE_PILOT as recipe} from '../src/world/cities/CheonggyePilot';
import {paintedSeoul} from '../src/world/cities/painted';

it.each([{name:'east',lat:37.568468,lon:126.995145,cx:85,cz:46},{name:'west',lat:37.568969,lon:126.980758,cx:84,cz:46},{name:'seoul-station',lat:37.555348,lon:126.972961,cx:83,cz:48}])('checks actual road triangles and approaches near the $name reported location',({name,lat,lon,cx,cz})=>{
 const read=(p:string)=>readMapFixture(p);
 const raw=read(`public/maps/37/126/${Math.floor(cx/16)}_${Math.floor(cz/16)}/${cx}_${cz}.json`);
 const overlays={roadGrade:read(`public/maps/road-grade/37/126/${cx}_${cz}.json`),detail:read(`public/maps/details/seoul/${cx}_${cz}.json`),appearance:read(`public/maps/landmark-appearance/seoul/${cx}_${cz}.json`)};
 expect(overlays.roadGrade.surfaceRevision).toBe(1);
 const chunk=applyMapCorrections([37,126],raw,overlays),t=chunkTerrainEntry(chunk,1024)!;
 const prior=chunkTerrainEntry(applyMapCorrections([37,126],raw,{...overlays,roadGrade:null},{surfaceCoherence:false}),1024)!;
 const x=(lon-126)*88316.0938412203,z=(38-lat)*111320,ox=cx*1024,oz=cz*1024;
 const roads=chunk.objects.roads.filter(r=>r.p.some((_,i)=>i%2===0&&Math.hypot(r.p[i]-x,r.p[i+1]-z)<90));
 let samples=0,maxGrade=0,beforeGrade=0,worst:unknown,probe=[x,z],probeDistance=Infinity;
 const pre=chunkTerrainEntry(applyMapCorrections([37,126],raw,overlays,{streetPilot:false}),1024)!;
 for(const r of roads)for(let i=2;i<r.p.length;i+=2){
  const [ax,az,bx,bz]=r.p.slice(i-2,i+2),len=Math.hypot(bx-ax,bz-az),steps=Math.max(1,Math.ceil(len/2));
  for(const side of [-.4,0,.4]){
   let previous:number|undefined,old:number|undefined;
   for(let j=0;j<=steps;j++){
    const a=ax+(bx-ax)*j/steps-(bz-az)/len*(r.w??6)*side,b=az+(bz-az)*j/steps+(bx-ax)/len*(r.w??6)*side;
    if(Math.hypot(a-x,b-z)>60){previous=undefined;old=undefined;continue;}
    if(side===0&&!pilotInRiver(a,b)&&Math.hypot(a-x,b-z)<probeDistance){probe=[a,b];probeDistance=Math.hypot(a-x,b-z);}
    const h=sampleStreetHeight(t,a,b),h0=sampleStreetHeight(prior,a,b);
    expect(h).toBeGreaterThanOrEqual(sampleChunkLandHeight(t,a,b)-.002);
    if(previous!=null){if(Math.abs(h-previous)/(len/steps)>maxGrade){maxGrade=Math.abs(h-previous)/(len/steps);worst={p:[a,b],h,previous,pre:sampleStreetHeight(pre,a,b),road:r.p};}beforeGrade=Math.max(beforeGrade,Math.abs(h0-old!)/(len/steps));}
    previous=h;old=h0;samples++;
   }
  }
 }
 expect(samples).toBeGreaterThan(100);expect(maxGrade).toBeLessThan(.12);expect(maxGrade).toBeLessThan(beforeGrade);
 const group=new THREE.Group();addStreetGeometry(group,roads,t,ox,oz,paintedSeoul.street);group.updateMatrixWorld(true);
 const mesh=group.getObjectByName('street_asphalt')!;
 const [px,pz]=probe;expect(probeDistance).toBeLessThan(60);
 const hit=new THREE.Raycaster(new THREE.Vector3(px-ox,200,pz-oz),new THREE.Vector3(0,-1,0)).intersectObject(mesh)[0];
 expect(hit).toBeDefined();expect(hit.point.y).toBeCloseTo(sampleStreetHeight(t,px,pz),3);
 expect(sampleChunkSupportHeight(t,px,pz,hit.point.y)).toBeCloseTo(hit.point.y,3);
 for(const child of group.children)(child as THREE.Mesh).geometry.dispose();
 mkdirSync('build',{recursive:true});writeFileSync(`build/cheonggye-${name}-boundary-road-review.json`,JSON.stringify({coordinate:[lat,lon],samples,maxGrade,beforeGrade,worst,meshProbe:probe,roadHeight:hit.point.y,groundHeight:sampleChunkLandHeight(t,px,pz),checked:'actual asphalt triangles, walking support and both carriageway sides within 60m'},null,2));
 console.log({samples,maxGrade,beforeGrade,roadHeight:hit.point.y});
});

it('extends a high boundary smoothly while preserving the core and the ground/road ordering',()=>{
 const settings=recipe.design.terrainTransition,half=recipe.halfSize;
 for(const height of [24,38,52]){
  let previous=38;
  for(let distance=half;distance<=half+settings.innerMargin+settings.maximumWidth+1;distance++){
   const w=terrainTransitionWeight(distance,half,height-.25,height,38,settings);
   const road=height+(38-height)*w,ground=height-.25+(38-height+.25)*w;
   expect(road).toBeGreaterThanOrEqual(ground-1e-9);
   expect(Math.abs(road-previous)).toBeLessThanOrEqual(settings.targetGrade+.001);previous=road;
   if(distance<=half+settings.innerMargin)expect(road).toBe(38);
  }
  expect(previous).toBe(height);
 }
});
it('keeps land and road seams continuous throughout the expanded approach and its untouched neighbors',()=>{
 const read=(p:string)=>readMapFixture(p);
 const chunks=new Map<string,ReturnType<typeof applyMapCorrections>>();
 for(let cz=45;cz<=48;cz++)for(let cx=83;cx<=86;cx++){
  const raw=read(`public/maps/37/126/${Math.floor(cx/16)}_${Math.floor(cz/16)}/${cx}_${cz}.json`);
  chunks.set(`${cx}:${cz}`,applyMapCorrections([37,126],raw,{
   roadGrade:read(`public/maps/road-grade/37/126/${cx}_${cz}.json`),
   detail:read(`public/maps/details/seoul/${cx}_${cz}.json`),
   appearance:read(`public/maps/landmark-appearance/seoul/${cx}_${cz}.json`),
  }));
 }
 for(const a of chunks.values())for(const [dx,dz] of [[1,0],[0,1]]){
  const b=chunks.get(`${a.cx+dx}:${a.cz+dz}`);if(!b)continue;
  const ta=chunkTerrainEntry(a,1024)!,tb=chunkTerrainEntry(b,1024)!;
  for(let i=0;i<=32;i++){
   const x=dx?(a.cx+1)*1024:a.cx*1024+i*32,z=dz?(a.cz+1)*1024:a.cz*1024+i*32;
   expect(sampleChunkLandHeight(ta,x,z)).toBeCloseTo(sampleChunkLandHeight(tb,x,z),2);
   expect(sampleStreetHeight(ta,x,z)).toBeCloseTo(sampleStreetHeight(tb,x,z),2);
  }
 }
});

it('keeps generated curbs out of road interiors near 37.570759,126.997662 in the mixed pilot tile',()=>{
 const read=(p:string)=>readMapFixture(p);
 const raw=read('public/maps/37/126/5_2/86_46.json');expect(raw).toBeTruthy();
 // Exercise the curb generator from clean inputs, independently of the baked mesh.
 const grade=read('public/maps/road-grade/37/126/86_46.json');delete grade.streetPlan;
 const chunk=applyMapCorrections([37,126],raw,{roadGrade:grade,detail:null,appearance:null});
 expect(chunk.streetPilot).toBe(true);
 const terrain=chunkTerrainEntry(chunk,1024)!,ox=86*1024,oz=46*1024,x=(126.997662-126)*88316.0938412203,z=(38-37.570759)*111320;
 const group=new THREE.Group();addStreetGeometry(group,chunk.objects.roads,terrain,ox,oz,paintedSeoul.street);
 const curb=group.getObjectByName('street_raised_curbs') as THREE.Mesh;expect(curb).toBeDefined();
 const network=streetContext(chunk.objects.roads,!!chunk.streetPilot)!;
 const roads=chunk.objects.roads.flatMap(r=>Array.from({length:r.p.length/2-1},(_,i)=>network.get(roadSegmentKey(r.p.slice(i*2,i*2+4))))).filter(c=>c&&c.w>.6).map(c=>corridorOutline(c!,-.6));
 const p=curb.geometry.getAttribute('position');let samples=0;
 for(let i=0;i<p.count;i++){
  const px=p.getX(i)+ox,pz=p.getZ(i)+oz;if(Math.hypot(px-x,pz-z)>120)continue;samples++;
  const inside=roads.some(p=>insideRoadOutline([px,pz],p));
  expect(inside,`curb inside asphalt ${px},${pz}`).toBe(false);
 }
 expect(samples).toBeGreaterThan(100);
 for(const child of group.children)(child as THREE.Mesh).geometry.dispose();
 console.log({coordinate:[37.570759,126.997662],curbSamples:samples,interiorCurbs:0});
},30000);

it('reconciles the floating water and final urban ground near 37.569138,126.978560',()=>{
 const read=(p:string)=>readMapFixture(p);
 const raw=read('public/maps/37/126/5_2/84_46.json'),overlays={roadGrade:read('public/maps/road-grade/37/126/84_46.json'),detail:read('public/maps/details/seoul/84_46.json'),appearance:read('public/maps/landmark-appearance/seoul/84_46.json')};
 // Compare the terrain correction itself; completed-mesh parity is tested separately.
 delete overlays.roadGrade.streetPlan;
 const before=applyMapCorrections([37,126],raw,overlays,{surfaceCoherence:false}),after=applyMapCorrections([37,126],raw,overlays);
 const old=chunkTerrainEntry(before,1024)!,terrain=chunkTerrainEntry(after,1024)!;
 const x=(126.978560-126)*88316.0938412203,z=(38-37.569138)*111320;
 let beforeGrade=0,afterGrade=0;
 for(let dz=-64;dz<=64;dz+=8)for(let dx=-96;dx<96;dx+=8)for(const [sx,sz] of [[8,0],[0,8]]){
  beforeGrade=Math.max(beforeGrade,Math.abs(sampleChunkLandHeight(old,x+dx+sx,z+dz+sz)-sampleChunkLandHeight(old,x+dx,z+dz))/8);
  afterGrade=Math.max(afterGrade,Math.abs(sampleChunkLandHeight(terrain,x+dx+sx,z+dz+sz)-sampleChunkLandHeight(terrain,x+dx,z+dz))/8);
 }
 expect(afterGrade).toBeLessThan(.08);expect(afterGrade).toBeLessThan(beforeGrade*.5);
 const water=before.seoulDetail!.water.find(w=>w.id==='way/370027259')!,height=(x:number,z:number)=>sampleChunkLandHeight(terrain,x,z),level=reconciledWaterLevel(water,height)!;
 expect(water.level!-level).toBeGreaterThan(10);expect(after.seoulDetail!.water.find(w=>w.id===water.id)!.level).toBeCloseTo(level,4);
 for(let i=0;i<water.p.length;i+=2)expect(level-height(water.p[i],water.p[i+1])).toBeLessThanOrEqual(0);
 const group=new THREE.Group(),onlyWater={...after,seoulDetail:{...after.seoulDetail!,water:[water],trees:[],walls:[],bridges:[],bridgeApproaches:[],athensSites:[],romeSites:[]}};
 addSeoulLandscape(group,onlyWater,84*1024,46*1024,height);expect(group.children.length).toBe(1);
 const geometry=(group.children[0] as THREE.Mesh).geometry,p=geometry.getAttribute('position');for(let i=0;i<p.count;i++)expect(p.getY(i)).toBeCloseTo(level+.03,4);geometry.dispose();
 console.log({coordinate:[37.569138,126.978560],beforeGrade,afterGrade,oldWater:water.level,finalWater:level,finalGround:height(x,z)});
},30000);
