import {it,expect} from 'vitest';
import {createStreetSeamSampler,reconcileStreetTerrain} from '../scripts/street-seams.mjs';
it('shares one boundary profile across tiles with different heights and sampling density',()=>{
 const a={base:10},b={base:14},map=new Map([['0_0',a],['1_0',b]]);
 const height=createStreetSeamSampler(map,(t:any,x:number,z:number)=>t.base+z*.01);
 for(const z of [0,8,17,32,67,1010])expect(height(1024,z)).toBeCloseTo(12+z*.01,8);
 expect(height(500,500)).toBeUndefined();
});
it('uses all four tiles at a corner and is independent of insertion order',()=>{
 const entries=[['0_0',{base:4}],['1_0',{base:8}],['0_1',{base:12}],['1_1',{base:16}]] as const;
 const sample=(t:any)=>t.base;
 const a=createStreetSeamSampler(new Map(entries),sample),b=createStreetSeamSampler(new Map([...entries].reverse()),sample);
 expect(a(1024,1024)).toBe(10);expect(b(1024,1024)).toBe(10);
});

it('reconciles physical ground and road edges without changing interiors or depending on order',()=>{
 const tile=(x:number,h:number)=>({size:3,step:512,cellX0:x,cellZ0:0,heights:new Float32Array(9),roadHeights:new Float32Array(9).fill(h)});
 const a=tile(0,2),b=tile(1024,4),entries=[['0_0',a],['1_0',b]] as const;
 const result=reconcileStreetTerrain(new Map(entries),(t:any)=>t.roadHeights[0]);
 const reverse=reconcileStreetTerrain(new Map([...entries].reverse()),(t:any)=>t.roadHeights[0]);
 expect(result.get('0_0').land[5]).toBe(3);expect(result.get('1_0').land[3]).toBe(3);
 expect(result.get('0_0').road[5]).toBe(3);expect(result.get('1_0').road[3]).toBe(3);
 expect(result.get('0_0').land[4]).toBe(0);expect(result.get('0_0').road[4]).toBe(2);
 expect(a.heights[5]).toBe(0);expect(result.get('0_0')).toEqual(reverse.get('0_0'));
});

it('uses the reconciled physical profile between crossing-edge grid vertices',()=>{
 const t={size:33,step:32,cellX0:0,cellZ0:0,heights:new Float32Array(1089),roadHeights:new Float32Array(1089)};
 const grids=reconcileStreetTerrain(new Map([['0_0',t]]),(_t:any,x:number,z:number)=>z===1024?Math.max(0,1-Math.abs(x-48)/20):0).get('0_0');
 const physical=(_t:any,x:number)=>{const i=Math.min(31,Math.floor(x/32)),f=x/32-i;return grids.land[1056+i]*(1-f)+grids.land[1057+i]*f;};
 const edge=createStreetSeamSampler(new Map([['0_0',t]]),physical);
 for(const x of [33,41,48,57,63])expect(edge(x,1024)).toBeCloseTo(physical(t,x),8);
 // A crossing's unsampled midpoint must not be reapplied only to the road mesh.
 expect(edge(48,1024)).toBeCloseTo(.2,8);
});
