import {it,expect} from 'vitest';
import {solveRoadNetwork,corridorOffsetPoint,insideRoadOutline,type RoadSource} from '../src/world/RoadNetwork';
import {roadPaintCorners,planRoadMarkings} from '../src/world/RoadMarkings';
function shape(roads:RoadSource[]){
 const network=solveRoadNetwork(roads),plan=planRoadMarkings(network),polys:{p:[number,number][];kind:string}[]=[];
 for(const [key,marks] of plan){const c=network.get(key)!;for(const m of marks)polys.push({kind:m.kind,p:roadPaintCorners(c,m)});}
 return polys;
}
it('keeps centre lines identical after 8m source segmentation at an unsplit geometric intersection',()=>{
 const original=[{p:[-100,0,100,0],w:16},{p:[0,-100,0,100],w:16}];
 const split=original.flatMap(r=>Array.from({length:25},(_,i)=>({p:[r.p[0]+(r.p[2]-r.p[0])*i/25,r.p[1]+(r.p[3]-r.p[1])*i/25,r.p[0]+(r.p[2]-r.p[0])*(i+1)/25,r.p[1]+(r.p[3]-r.p[1])*(i+1)/25],w:r.w})));
 const a=shape(original),b=shape(split);
 for(let x=-98.13;x<99;x+=1.7)for(const z of [-7.1,-4.03,-.2,0,.2,4.03,7.1])for(const kind of ['center']){
  const hit=(polys:typeof a)=>polys.some(p=>p.kind===kind&&insideRoadOutline([x,z],p.p));expect(hit(b),`${kind} at ${x},${z}`).toBe(hit(a));
 }
 expect(b.length).toBeGreaterThan(0);expect(b.every(p=>p.kind==='center')).toBe(true);
 expect(a.some(p=>insideRoadOutline([0,0],p.p))).toBe(false);
});
it('clears shallow crossing overlaps and removes short paint islands between nearby junctions',()=>{
 const polygons=shape([{p:[-80,0,80,0],w:8},{p:[-80,-10,80,10],w:8},{p:[10,-50,10,50],w:8}]);
 for(const x of [-5,0,5,10,15])expect(polygons.some(p=>insideRoadOutline([x,0],p.p))).toBe(false);
});
it('treats close approaches on a wide bridge as one junction instead of painting an isolated centre island',()=>{
 const polygons=shape([{p:[-100,0,100,0],w:32},{p:[-20,-40,-20,40],w:8},{p:[20,-40,20,40],w:8}]);
 for(const p of polygons.filter(p=>p.kind==='center'||p.kind==='dash'))expect(insideRoadOutline([0,.18],p.p)).toBe(false);
 expect(polygons.some(p=>p.kind==='center'&&insideRoadOutline([-70,0],p.p))).toBe(true);
});
it('keeps lane edges connected through changing road widths',()=>{
 const network=solveRoadNetwork([{p:[0,0,40,0],w:22},{p:[40,0,80,5],w:24}]);
 const c=[...network.values()].sort((a,b)=>a.phase-b.phase);
 for(const offset of [-3.62,-3.38,.06,.3]){
  const a=corridorOffsetPoint(c[0],c[0].length,offset),b=corridorOffsetPoint(c[1],0,offset);
  expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(1e-8);
 }
});
it('retains one coherent marking owner on overlapping parallel carriageways, independent of order and subdivision',()=>{
 const roads=[{p:[0,0,240,0],w:28},{p:[240,12,0,12],w:28}];
 for(const split of [false,true]){
  const source=split?roads.flatMap(r=>Array.from({length:24},(_,i)=>({p:[r.p[0]+(r.p[2]-r.p[0])*i/24,r.p[1],r.p[0]+(r.p[2]-r.p[0])*(i+1)/24,r.p[3]],w:r.w}))):roads;
  for(const ordered of [source,[...source].reverse()]){
   const polygons=shape(ordered);
   for(const x of [30,90,150,210]){
    expect(polygons.some(p=>p.kind==='center'&&insideRoadOutline([x,6],p.p))).toBe(true);
    expect(polygons.some(p=>p.kind==='center'&&insideRoadOutline([x,0],p.p))).toBe(false);
   }
   expect(polygons.some(p=>p.kind==='crosswalk')).toBe(false);
  }
 }
 const separated=shape([{p:[0,0,240,0],w:28},{p:[0,32,240,32],w:28}]);
 for(const z of [0,32])expect(separated.some(p=>p.kind==='center'&&insideRoadOutline([90,z],p.p))).toBe(true);
 const crossing=shape([{p:[-100,0,100,0],w:8},{p:[-100,-10,100,10],w:8}]);
 expect(crossing.some(p=>insideRoadOutline([0,0],p.p))).toBe(false);
});

it('centres one uninterrupted line in the union of parallel carriageways and keeps minor side entrances from cutting it',()=>{
 const roads=[{p:[0,0,240,0],w:28},{p:[240,20,0,20],w:28},{p:[110,-70,110,0],w:6}];
 const polygons=shape(roads);
 for(let x=30.731;x<210;x+=3.137){
  const hit=polygons.filter(p=>insideRoadOutline([x,10],p.p));expect(hit).toHaveLength(1);
  for(const z of [0,20])expect(polygons.some(p=>insideRoadOutline([x,z],p.p))).toBe(false);
 }
 const through=shape([{p:[0,0,240,0],w:28},{p:[110,-70,110,70],w:6}]);
 expect(through.some(p=>insideRoadOutline([110,0],p.p))).toBe(false);
});
