import {expect,it} from 'vitest';
// @ts-expect-error build-time JavaScript
import {fairRoadGraph,fitNetworkSurface,auditRoadJoins,rejectNewRoadWarnings} from '../scripts/road-network-grade.mjs';
import {applyRoadNetworkPatch} from '../src/world/RoadGradePatch';
import type {WorldChunk} from '../src/world/chunkManifest';
it('preserves a continuous slope and shares a ground intersection vertex',()=>{
 const r=[{p:[0,0,30,0,80,0]}];const g=fairRoadGraph(r,(x:number)=>10+x*.1,()=>true);
 for(const n of g.nodes)expect(n.value).toBeCloseTo(n.h,5);
 const cross=fairRoadGraph([{p:[0,0,20,0,40,0]},{p:[20,-20,20,0,20,20]}],()=>10,()=>true);
 expect(cross.nodes.filter((n:any)=>n.x===20&&n.z===0)).toHaveLength(1);
 expect(cross.nodes.find((n:any)=>n.x===20&&n.z===0).neighbors).toHaveLength(4);
});
it('reduces repeated peaks while preserving endpoints and protected vertices',()=>{
 const g=fairRoadGraph([{p:[0,0,16,0,32,0,48,0,64,0]}],(x:number)=>x===32?30:10,(x:number)=>x!==16);
 expect(g.nodes.find((n:any)=>n.x===32).value).toBeLessThan(20);
 expect(g.nodes.find((n:any)=>n.x===16).value).toBe(10);
 expect(g.nodes.find((n:any)=>n.x===0).value).toBe(10);
});
it('does not join bridges, tunnels or different levels into the ground graph',()=>{
 const g=fairRoadGraph([{p:[0,0,20,0]},{p:[10,-10,10,0,10,10],bridge:true},{p:[0,0,0,20],tunnel:true},{p:[20,0,20,20],layer:1}],()=>10,()=>true);
 expect(g.nodes.some((n:any)=>n.z!==0)).toBe(false);
});
it('fits one continuous lattice across tile seams and keeps protected vertices fixed',()=>{
 const s=new Float64Array(81).fill(10);s[40]=25;const mask=new Float64Array(81).fill(1);mask[39]=0;
 const out=fitNetworkSurface(s,mask,new Float64Array(81),new Float64Array(81),9,9);
 expect(out[40]).toBeLessThan(15);expect(out[39]).toBe(10);expect(out[0]).toBe(10);
 const slope=Float64Array.from({length:81},(_,i)=>10+(i%9)*2);const fitted=fitNetworkSurface(slope,mask,new Float64Array(81),new Float64Array(81),9,9);
 fitted.forEach((v:number,i:number)=>expect(v).toBeCloseTo(slope[i],5));
});
it('checks a crest split into separate road records and ignores an ordinary intersection',()=>{
 const r=[{p:[-16,0,0,0]},{p:[0,0,16,0]}];expect(auditRoadJoins(r,(x:number)=>10-Math.abs(x)*.3).roughJoins).toBe(1);
 expect(auditRoadJoins(r,(x:number)=>10+x*.3).roughJoins).toBe(0);
 expect(auditRoadJoins([...r,{p:[0,0,0,16]}],(x:number)=>10-Math.abs(x)*.3).joins).toBe(0);
});
it('applies one baked delta to ground and road, rejects stale data, and is idempotent',()=>{
 const c={terrain:{size:2,heights:[10,10,10,10]},roadHeights:[11,11,11,11]} as unknown as WorldChunk;
 const p={version:1,size:2,points:[],network:{version:1 as const,points:[[0,10,11,-2]] as [number,number,number,number][]}};
 const out=applyRoadNetworkPatch(c,p);expect(out.terrain.heights[0]).toBe(8);expect(out.roadHeights![0]).toBe(9);expect(c.terrain.heights[0]).toBe(10);
 expect(applyRoadNetworkPatch(out,p)).toBe(out);
 expect(applyRoadNetworkPatch({...c,terrain:{...c.terrain,heights:[15,10,10,10]}},p).terrain.heights[0]).toBe(15);
 expect(applyRoadNetworkPatch(c,{...p,network:{version:1,points:[[0,10,11,99]]}})).toBe(c);
});

it('defers a proposed correction when it creates a new road crest',()=>{
 const source=new Float64Array(81).fill(10),candidate=source.slice();candidate[40]=25;
 const roads=[{p:[8,16,24,16],w:4}];
 const result=rejectNewRoadWarnings(roads,source,candidate,9,9,4,0,0);
 expect(result.report.initialRegressions).toBeGreaterThan(0);expect(result.report.remainingRegressions).toBe(0);expect(result.surface[40]).toBe(10);
});

it('also defers a correction that makes an existing steep road worse',()=>{
 const source=Float64Array.from({length:81},(_,i)=>10+(i%9)*2),candidate=source.slice();candidate[40]+=10;
 const result=rejectNewRoadWarnings([{p:[8,16,24,16],w:4}],source,candidate,9,9,4,0,0);
 expect(result.report.initialRegressions).toBeGreaterThan(0);expect(result.report.remainingRegressions).toBe(0);expect(result.surface[40]).toBe(source[40]);
});
