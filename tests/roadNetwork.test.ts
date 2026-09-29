import {readMapFixture} from './mapFixture';
import {streetContext} from '../src/world/StreetLayout';
import {it,expect} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import * as THREE from 'three';
import {solveRoadNetwork,corridorFootprint,corridorPoint,roadSegmentKey} from '../src/world/RoadNetwork';
import {pilotRoadNetwork,inPilot,pilotStreetHeight,pilotInRiver,pilotBridgeRoad,pilotChannelZ,PILOT_SECTION,CHEONGGYE_PILOT as recipe} from '../src/world/cities/CheonggyePilot';
import {applyMapCorrections} from '../src/world/MapCorrections';
import {chunkTerrainEntry} from '../src/world/chunkMesh';
import {addStreetGeometry} from '../src/world/StreetGeometry';
import {paintedSeoul} from '../src/world/cities/painted';

function surfaceSampler(mesh:THREE.Mesh){
 const p=mesh.geometry.getAttribute('position'),grid=new Map<string,number[]>();
 for(let i=0;i<p.count;i+=3){const xs=[0,1,2].map(k=>p.getX(i+k)),zs=[0,1,2].map(k=>p.getZ(i+k));
  for(let x=Math.floor(Math.min(...xs)/32);x<=Math.floor(Math.max(...xs)/32);x++)for(let z=Math.floor(Math.min(...zs)/32);z<=Math.floor(Math.max(...zs)/32);z++){const key=x+':'+z,list=grid.get(key)??[];list.push(i);grid.set(key,list);}
 }
 return (x:number,z:number)=>{let height=-Infinity;
  for(const i of grid.get(Math.floor(x/32)+':'+Math.floor(z/32))??[]){
   const ax=p.getX(i),az=p.getZ(i),bx=p.getX(i+1),bz=p.getZ(i+1),cx=p.getX(i+2),cz=p.getZ(i+2);
   const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(det)<1e-9)continue;
   const a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det,b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det,c=1-a-b;
   if(Math.min(a,b,c)>=-1e-6)height=Math.max(height,a*p.getY(i)+b*p.getY(i+1)+c*p.getY(i+2));
  }return height;
 };
}
it('joins a bend with identical edge positions, width taper and continuous dash phase regardless of source order',()=>{
 const roads=[{p:[0,0,40,0],w:22},{p:[80,12,40,0],w:24},{p:[80,12,120,24],w:24}];
 const a=solveRoadNetwork(roads),b=solveRoadNetwork([...roads].reverse());
 expect([...a]).toEqual([...b]);
 const segments=[...a.values()].sort((a,b)=>a.phase-b.phase);
 for(let i=1;i<segments.length;i++){
  const before=segments[i-1],after=segments[i];expect(before.b).toEqual(after.a);
  expect(after.phase).toBeCloseTo(before.phase+before.length);
  for(const side of [-1,1]){
   const p=corridorPoint(before,before.length,side*before.w/2),q=corridorPoint(after,0,side*after.w/2);
   expect(Math.hypot(p[0]-q[0],p[1]-q[1])).toBeLessThan(1e-8);
  }
 }
});
it('retains a real T junction, removes duplicate edges and rejects malformed or zero length source lines',()=>{
 const n=solveRoadNetwork([{p:[0,0,40,0],w:8},{p:[40,0,80,0],w:8},{p:[40,0,40,30],w:8},{p:[40,0,0,0],w:8},{p:[0,0,0,0],w:8},{p:[0,0,NaN,1],w:8}]);
 expect(n.size).toBe(3);for(const s of n.values())expect(s.startJoined||s.endJoined).toBe(false);
});
it('audits every legacy pilot road corridor for folded faces, shared edges and continuous render height across all four tiles',()=>{
 // Exercise fallback corridor generation explicitly, without compiled street overrides.
 const read=(p:string)=>{const data=readMapFixture(p);delete data.streetPlan;return data;};
 const endpoints=new Map<string,{p:number[];w:number;phase:number}[]>();let sections=0,samples=0,joins=0,maxGrade=0,crossingTriangles=0;const checkedKeys=new Set<string>(),expectedKeys=new Set<string>();
 const folds:string[]=[];
 const inside=(x:number,z:number,p:number[])=>{let hit=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])hit=!hit;return hit;};
 for(const c of pilotRoadNetwork.values()){
  if(![c.a,c.b].every(p=>inPilot(...p)))continue;
  sections++;const poly=corridorFootprint(c);
  const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
  const signs=poly.map((p,i)=>cross(p,poly[(i+1)%4],poly[(i+2)%4]));
  if(signs.some(x=>x<=0))folds.push(c.key);
  for(const [at,joined,d] of [[c.a,c.startJoined,0],[c.b,c.endJoined,c.length]] as const)if(joined){
   const list=endpoints.get(at.join(','))??[];
   const points=[corridorPoint(c,d,-c.w/2),corridorPoint(c,d,c.w/2)].sort((a,b)=>a[0]-b[0]||a[1]-b[1]).flat();
   list.push({p:points,w:c.w,phase:c.phase+d});endpoints.set(at.join(','),list);
  }
 }
 expect(folds,JSON.stringify(folds.slice(0,12))).toEqual([]);
 for(const list of endpoints.values())if(list.length===2){joins++;expect(list[0].phase).toBeCloseTo(list[1].phase,4);for(let i=0;i<4;i++)expect(list[0].p[i]).toBeCloseTo(list[1].p[i],5);}
 for(const [cx,cz] of [[84,46],[85,46],[84,47],[85,47]]){
  const chunk=applyMapCorrections([37,126],read(`public/maps/37/126/5_2/${cx}_${cz}.json`),{
   roadGrade:read(`public/maps/road-grade/37/126/${cx}_${cz}.json`),detail:read(`public/maps/details/seoul/${cx}_${cz}.json`),appearance:read(`public/maps/landmark-appearance/seoul/${cx}_${cz}.json`)});
  const group=new THREE.Group(),terrain=chunkTerrainEntry(chunk,1024)!;
  addStreetGeometry(group,chunk.objects.roads,terrain,cx*1024,cz*1024,paintedSeoul.street);group.updateMatrixWorld(true);
  const asphalt=group.getObjectByName('street_asphalt') as THREE.Mesh,ground=surfaceSampler(asphalt);
  const markings=(group.getObjectByName('street_lane_lines') as THREE.Mesh|undefined)?.geometry.getAttribute('position');
  if(markings)for(let i=0;i<markings.count;i+=3){
   const points=[0,1,2].map(k=>[markings.getX(i+k)+cx*1024,markings.getZ(i+k)+cz*1024]);
   const [a,b,c]=points,area=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
   // Zebra/stop marks have larger triangles than longitudinal 18cm lane paint.
   if(area>.5&&points.every(p=>inPilot(...p as [number,number]))){
    crossingTriangles++;expect(pilotInRiver((a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3),'inferred crossing on bridge span').toBe(false);
   }
  }
  const finalNetwork=streetContext(chunk.objects.roads,true)!;
  const obstacleGrid=new Map<string,NonNullable<typeof terrain.streetObstacles>>();
  for(const o of terrain.streetObstacles??[]){const xs=o.p.filter((_,i)=>i%2===0),zs=o.p.filter((_,i)=>i%2===1);for(let x=Math.floor((Math.min(...xs)-.04)/64);x<=Math.floor((Math.max(...xs)+.04)/64);x++)for(let z=Math.floor((Math.min(...zs)-.04)/64);z<=Math.floor((Math.max(...zs)+.04)/64);z++){const key=x+','+z,a=obstacleGrid.get(key)??[];a.push(o);obstacleGrid.set(key,a);}}
  for(const r of chunk.objects.roads){const c=finalNetwork.get(roadSegmentKey(r.p));if(!c)continue;
   if(c.length>1&&inPilot(...c.a)&&inPilot(...c.b))expectedKeys.add(c.key);
   for(let d=1;d<c.length;d+=6)for(const side of [-.98,-.5,0,.5,.98]){
    const [x,z]=corridorPoint(c,d,c.w/2*side);if(!inPilot(x,z)||Math.floor(x/1024)!==cx||Math.floor(z/1024)!==cz)continue;
    if(!r.bridge&&(obstacleGrid.get(Math.floor(x/64)+","+Math.floor(z/64))??[]).some(o=>[-.02,.02].every(dx=>[-.02,.02].every(dz=>inside(x+dx,z+dz,o.p)&&!(o.holes??[]).some(h=>inside(x+dx,z+dz,h)))))){expect(Number.isFinite(ground(x-cx*1024,z-cz*1024)),`asphalt inside obstacle ${x},${z}`).toBe(false);checkedKeys.add(c.key);continue;}
    // On an ownership boundary either adjacent triangle may contain the sample;
    // Float32 vertices need a small tolerance, while strict interiors above remain checked.
    if(!r.bridge&&(obstacleGrid.get(Math.floor(x/64)+","+Math.floor(z/64))??[]).some(o=>[-.03,0,.03].some(dx=>[-.03,0,.03].some(dz=>inside(x+dx,z+dz,o.p)&&!(o.holes??[]).some(h=>inside(x+dx,z+dz,h)))))){checkedKeys.add(c.key);continue;}
    expect(pilotInRiver(x,z)&&!pilotBridgeRoad([...c.a,...c.b]),`road consumed by river: ${x},${z} ${c.key}`).toBe(false);
    const height=ground(x-cx*1024,z-cz*1024);
    expect(Number.isFinite(height),`road hole ${x},${z}`).toBe(true);expect(height).toBeCloseTo(pilotStreetHeight(x,z),3);samples++;checkedKeys.add(c.key);
    const q=corridorPoint(c,Math.min(c.length,d+1),side*c.w/2),dist=Math.hypot(q[0]-x,q[1]-z);
    if(dist>.01)maxGrade=Math.max(maxGrade,Math.abs(pilotStreetHeight(...q)-height)/dist);
   }
  }
  for(const child of group.children)(child as THREE.Mesh).geometry.dispose();
 }
 for(const key of expectedKeys)expect(checkedKeys.has(key),`missing final road from baked tiles: ${key}`).toBe(true);
 expect(sections).toBeGreaterThan(100);expect(joins).toBeGreaterThan(50);expect(samples).toBeGreaterThan(500);expect(maxGrade).toBeLessThan(.01);
 mkdirSync('build',{recursive:true});const report={sections,joins,samples,crossingTriangles,foldedFaces:folds.length,maxGrade,source:recipe.roadSource};writeFileSync('build/cheonggye-road-audit.json',JSON.stringify(report,null,2));console.log(report);
},60000);

it('preserves both river roads and sidewalk clearance at the reported hidden south road',()=>{
 const x=(126.986881-126)*88316.0938412203,axis=pilotChannelZ(x);
 const hits=[...pilotRoadNetwork.values()].filter(c=>x>Math.min(c.a[0],c.b[0])&&x<Math.max(c.a[0],c.b[0])&&Math.abs(c.b[0]-c.a[0])>Math.abs(c.b[1]-c.a[1])*1.5)
  .map(c=>({c,z:c.a[1]+(c.b[1]-c.a[1])*(x-c.a[0])/(c.b[0]-c.a[0])}));
 for(const side of [-1,1]){
  const road=hits.filter(h=>(h.z-axis)*side>0).sort((a,b)=>Math.abs(a.z-axis)-Math.abs(b.z-axis))[0];
  expect(road).toBeDefined();expect(road.c.w).toBe(8);
  expect(Math.abs(road.z-axis)-road.c.w/2-PILOT_SECTION.bank).toBeGreaterThan(2.6);
 }
});
