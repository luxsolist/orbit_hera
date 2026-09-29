import * as THREE from 'three';
import {addStreetGeometry} from '../src/world/StreetGeometry';
import {paintedSeoul} from '../src/world/cities/painted';
import {streetFreeFootprints} from '../src/world/StreetEnvelope';
import {it,expect} from 'vitest';
import {planStreetSections,STREET_SECTION} from '../src/world/streetSection.mjs';
import type {Ring} from '../src/world/MapData';
const road:Ring={p:[0,0,0,80],w:28};
it('budgets sidewalks before asphalt and protects short oblique building corners',()=>{
 const b:Ring={p:[9,38,12,35,14,40,10,43]},input={roads:[road],buildings:[b]},out=planStreetSections(input),r=out.roads[0];
 expect(r.w).toBeLessThan(10);expect(r.streetSection!.sidewalk).toBe(2.3);
 expect((r.w!/2+r.streetSection!.sidewalk+STREET_SECTION.curb)*STREET_SECTION.maxMiter+STREET_SECTION.facadeGap).toBeLessThanOrEqual(9.001);
 expect(out.buildings).toBe(input.buildings);expect(road.w).toBe(28);expect(planStreetSections(out)).toEqual(out);
});
it('narrow streets lose furniture before walking space; centreline conflicts are explicit',()=>{
 const objects={roads:[road],walls:[{p:[4.8,0,4.8,80],w:.4}]};const r=planStreetSections(objects).roads[0];
 expect(r.streetSection!.furniture).toBe(false);expect(r.w).toBeLessThan(6);
 const q=planStreetSections({roads:[road],buildings:[{p:[-2,20,2,20,2,30,-2,30]}]}).roads[0];expect(q.w).toBe(28);expect(q.streetSection!.furniture).toBe(false);expect(q.streetSection!.mode).toBe('conflict');
});
it('leaves grade-separated roads alone and records contradictions to explicit widths',()=>{
 const walls=[{p:[8,0,8,80]}];const input={roads:[{...road,bridge:true},{...road,widthSource:'tag' as const}],walls};
 const [bridge,ground]=planStreetSections(input).roads;expect(bridge).toEqual(input.roads[0]);expect(ground.streetSection!.explicitWidthAdjusted).toBe(true);
});
it('tapers inferred widths continuously and independently of road direction',()=>{
 const roads=[0,1,2,3].map(i=>({p:[0,i*8,0,(i+1)*8],w:28}));const objects={roads,buildings:[{p:[8,25,12,25,12,30,8,30]}]};
 const a=planStreetSections(objects),b=planStreetSections({...objects,roads:roads.map(r=>({...r,p:[...r.p.slice(2),...r.p.slice(0,2)]}))});
 a.roads.forEach((r,i)=>{expect(r.w).toBe(b.roads[i].w);if(i)expect(Math.abs(r.w!-a.roads[i-1].w!)).toBeLessThanOrEqual(.961);});
});

it('preserves roads on islands inside water holes, and excludes surface roads in water',()=>{
 const water=[{p:[-100,-100,100,-100,100,100,-100,100],holes:[[-30,-90,30,-90,30,90,-30,90]]}];
 const r=planStreetSections({roads:[road],water}).roads[0];expect(r.w).toBeGreaterThan(5);
 expect(planStreetSections({roads:[road],water:[{...water[0],holes:[]}]}).roads[0].streetSection!.mode).toBe('conflict');
});
it('converges on long chains of tiny segments without order-dependent or repeated-build shrinkage',()=>{
 const roads=Array.from({length:100},(_,i)=>({p:[0,i,0,i+1],w:28})),input={roads,buildings:[{p:[8,97,12,97,12,100,8,100]}]};
 const a=planStreetSections(input),b=planStreetSections({...input,roads:[...roads].reverse()});
 expect(a.roads.map(r=>r.w)).toEqual(b.roads.map(r=>r.w).reverse());expect(planStreetSections(a)).toEqual(a);
});

it('partitions the street instead of deleting the whole link when an obstacle crosses the axis',()=>{
 const pieces=streetFreeFootprints([[-4,0],[4,0],[4,30],[-4,30]],[{p:[-2,10,2,10,2,15,-2,15]}]);
 const area=(p:[number,number][])=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-a[1]*b[0];},0))/2;
 expect(pieces.reduce((sum,p)=>sum+area(p),0)).toBeCloseTo(220,6);
 const island=streetFreeFootprints([[-4,0],[4,0],[4,30],[-4,30]],[{p:[-10,-10,10,-10,10,40,-10,40,-10,-10],holes:[[-5,-5,5,-5,5,35,-5,35,-5,-5]]}]);
 expect(island.reduce((sum,p)=>sum+area(p),0)).toBeCloseTo(240,6);
});

it('does not cut an elevated bridge deck with ground-level building masks',()=>{
 const t={size:3,step:50,cellX0:-50,cellZ0:-50,heights:new Float32Array(9).fill(30),streetObstacles:[{p:[-20,-20,20,-20,20,20,-20,20]}]};
 const probe=(bridge:boolean)=>{const group=new THREE.Group();addStreetGeometry(group,[{p:[0,-10,0,10],w:8,bridge}],t,0,0,paintedSeoul.street);const count=(group.getObjectByName('street_asphalt') as THREE.Mesh|undefined)?.geometry.getAttribute('position').count??0;for(const child of group.children)(child as THREE.Mesh).geometry.dispose();return count;};
 expect(probe(false)).toBe(0);expect(probe(true)).toBeGreaterThan(0);
});
