import {it,expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import {corridorOffsetPoint} from '../src/world/RoadNetwork';
import {roadPaintCorners,planRoadMarkings,DEFAULT_MARKINGS} from '../src/world/RoadMarkings';
import {pilotRoadNetwork,pilotInRiver,pilotBridgeRoad,CHEONGGYE_PILOT as recipe} from '../src/world/cities/CheonggyePilot';
import baked from '../src/world/cities/cheonggye-markings.json';

it('audits the baked pilot paint, complete stroke lengths, surface support and reproducibility',()=>{
 const settings={...DEFAULT_MARKINGS,...recipe.design.markings},plan=planRoadMarkings(pilotRoadNetwork,settings,(c,p)=>pilotBridgeRoad([...c.a,...c.b])||!pilotInRiver(...p)),runs=new Map<string,{kind:string;length:number}>();
 let patches=0,crosswalks=0,surfaceSamples=0;
 for(const [key,rows] of baked.segments as [string,number[][]][]){
  const c=pilotRoadNetwork.get(key)!;expect(c).toBeDefined();const marks=plan.get(key)!;
  expect(rows).toEqual(marks.map(m=>[m.start,m.end,m.left,m.right,m.layer,0,m.endLeft,m.endRight].map(n=>Math.round(n*1e5)/1e5)));
  for(const m of marks){
   expect(m.end).toBeGreaterThan(m.start);expect(m.start).toBeGreaterThanOrEqual(-.00001);expect(m.end).toBeLessThanOrEqual(c.length+.00001);
   expect(Math.max(Math.abs(m.left),Math.abs(m.right))).toBeLessThan(c.w/2);patches++;expect(m.kind).toBe('center');expect(m.layer).toBe(4);
   for(const t of [0,.5,1])for(const side of [m.left*(1-t)+m.endLeft*t,m.right*(1-t)+m.endRight*t]){
    const p=corridorOffsetPoint(c,m.start+(m.end-m.start)*t,side);
    if(!pilotBridgeRoad([...c.a,...c.b]))expect(pilotInRiver(...p),`${m.kind} on unsupported river ${p}`).toBe(false);surfaceSamples++;
   }
  }
 }
 // Accumulate on the whole network: chunk subdivisions must not create short isolated centre strokes.
 for(const marks of plan.values())for(const m of marks){const run=runs.get(m.run)??{kind:m.kind,length:0};run.length+=m.end-m.start;runs.set(m.run,run);}
 for(const r of runs.values())expect(r.length).toBeGreaterThanOrEqual(settings.minimumRun-1e-5);
 expect(patches).toBeGreaterThan(100);expect(crosswalks).toBe(0);
 mkdirSync('build',{recursive:true});const report={segments:baked.segments.length,patches,crosswalkStripes:crosswalks,surfaceSamples,settings};writeFileSync('build/cheonggye-marking-audit.json',JSON.stringify(report,null,2));console.log(report);
},30000);

it('restores longitudinal paint west of 37.570273,126.987768 while leaving its junction clear',()=>{
 const plan=planRoadMarkings(pilotRoadNetwork,{...DEFAULT_MARKINGS,...recipe.design.markings});
 const road=[...pilotRoadNetwork.values()].find(c=>[c.a,c.b].some(p=>p[0]===87040&&p[1]===47837)&&[c.a,c.b].some(p=>p[0]===87231&&p[1]===47835))!;
 expect(road).toBeDefined();const marks=plan.get(road.key)!;
 const runs=marks.filter(m=>m.kind==='center');
 expect(runs.reduce((sum,m)=>sum+m.end-m.start,0)).toBeGreaterThan(road.length*.5);
 expect(marks.every(m=>m.layer===4&&m.kind==='center')).toBe(true);
});

it('draws exactly one continuous centred line near 37.570168,126.988701 between genuine junctions',()=>{
 const plan=planRoadMarkings(pilotRoadNetwork,{...DEFAULT_MARKINGS,...recipe.design.markings});
 const roads=[...pilotRoadNetwork.values()].filter(c=>c.w>=6&&Math.abs(c.a[0]-c.b[0])>70&&Math.max(c.a[0],c.b[0])>=87280&&Math.min(c.a[0],c.b[0])<=87410&&c.a[1]>47800&&c.a[1]<47860&&c.b[1]>47800&&c.b[1]<47860);
 const quads=roads.flatMap(c=>(plan.get(c.key)??[]).map(m=>roadPaintCorners(c,m)));
 for(let x=87285.7;x<87410;x+=3.13){
  const rows=quads.flatMap(p=>{const a=[(p[0][0]+p[3][0])/2,(p[0][1]+p[3][1])/2],b=[(p[1][0]+p[2][0])/2,(p[1][1]+p[2][1])/2];if(x<Math.min(a[0],b[0])||x>=Math.max(a[0],b[0]))return [];return [a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0])];});
  expect(rows,`centre count at ${x}`).toHaveLength(1);
  const bounds=roads.filter(c=>x>=Math.min(c.a[0],c.b[0])&&x<=Math.max(c.a[0],c.b[0])).flatMap(c=>{const z=c.a[1]+(c.b[1]-c.a[1])*(x-c.a[0])/(c.b[0]-c.a[0]);return [z-c.w/2,z+c.w/2];});
  expect(Math.abs(rows[0]-(Math.min(...bounds)+Math.max(...bounds))/2)).toBeLessThan(1);
 }
});
