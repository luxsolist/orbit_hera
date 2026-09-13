import {it,expect} from 'vitest';
import {repairUrbanSpikes,correctedRoadSample,repairLattice,waterContains,auditRoadLattice} from '../scripts/road-grade.mjs';
import {applyRoadGradePatch} from '../src/world/RoadGradePatch';
import type {WorldChunk} from '../src/world/chunkManifest';
it('preserves a smooth slope and repairs isolated peaks and dips',()=>{
 const plane=Array.from({length:25},(_,i)=>40+(i%5-2)*2+(Math.floor(i/5)-2));
 expect(correctedRoadSample(40,plane)).toBe(40);
 const peak=plane.slice();peak[12]=52;expect(correctedRoadSample(52,peak)).toBe(40);
 const dip=plane.slice();dip[12]=29;expect(correctedRoadSample(29,dip)).toBe(40);
 expect(correctedRoadSample(80,[...plane.slice(0,24),100])).toBe(80);
});
it('does not alter protected roads/water or values outside road influence',()=>{
 const n=9,g=new Float32Array(n*n).fill(40),mask=new Uint8Array(n*n).fill(255),protectedMask=new Uint8Array(n*n);g[40]=52;
 protectedMask[40]=1;expect(repairLattice(g,mask,protectedMask,n,n).grid[40]).toBe(52);
 protectedMask[40]=0;mask[40]=0;expect(repairLattice(g,mask,protectedMask,n,n).grid[40]).toBe(52);
 mask[40]=255;expect(repairLattice(g,mask,protectedMask,n,n).grid[40]).toBe(40);expect(g[40]).toBe(52);
});
it('applies overlays immutably and refuses mismatching rebuilt source data',()=>{
 const raw={terrain:{size:2,heights:[40,52,40,40]},objects:{buildings:[]}} as unknown as WorldChunk;
 const patch={version:1,size:2,points:[[1,52,40] as [number,number,number]]};
 const out=applyRoadGradePatch(raw,patch);expect(out.terrain.heights).toEqual([40,40,40,40]);expect(raw.terrain.heights[1]).toBe(52);expect(applyRoadGradePatch(out,patch)).toEqual(out);
 expect(applyRoadGradePatch(raw,{...patch,points:[[1,99,40]]})).toBe(raw);
});

it('does not mask an entire stream bounding box or neighboring road samples',()=>{
 const river={p:[0,0,100,100,100,110,0,10]};expect(waterContains(10,90,river)).toBe(false);expect(waterContains(50,55,river)).toBe(true);
 const n=9,g=new Float32Array(81).fill(40),mask=new Uint8Array(81).fill(255),protect=new Uint8Array(81);g[40]=59;protect[42]=1;
 expect(repairLattice(g,mask,protect,n,n).grid[40]).toBe(40);
 expect(auditRoadLattice(g,mask,protect,n,n,32).steepEdges).toBeGreaterThan(0);
});

it('repairs a multi-sample urban peak that the mountain guard excludes',()=>{
 const n=17,k=8*n+8,g=new Float32Array(n*n).fill(40),mask=new Uint8Array(n*n).fill(255),protect=new Uint8Array(n*n),urban=new Uint8Array(n*n).fill(1);
 for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)g[k+dz*n+dx]=85;
 g[k]=107;
 expect(repairLattice(g,mask,protect,n,n).grid[k]).toBe(107);
 const repaired=repairUrbanSpikes(g,mask,protect,urban,n,n);
 expect(repaired.grid[k]).toBe(40);expect(repaired.evidence.get(k)?.reason).toBe('isolated-urban-peak');expect(g[k]).toBe(107);
 protect[k]=1;expect(repairUrbanSpikes(g,mask,protect,urban,n,n).grid[k]).toBe(107);
 protect[k]=0;urban.fill(0);expect(repairUrbanSpikes(g,mask,protect,urban,n,n).grid[k]).toBe(107);
 urban.fill(1);mask.fill(0);mask[k]=255;expect(repairUrbanSpikes(g,mask,protect,urban,n,n).grid[k]).toBe(107);
});
it('preserves broad hills, protected anchors and anomalies beyond the urban limit',()=>{
 const n=17,k=8*n+8,mask=new Uint8Array(n*n).fill(255),protect=new Uint8Array(n*n),urban=new Uint8Array(n*n).fill(1);
 const hill=Float32Array.from({length:n*n},(_,i)=>40+Math.max(0,80-Math.hypot(i%n-8,Math.floor(i/n)-8)*8));
 expect(repairUrbanSpikes(hill,mask,protect,urban,n,n).grid[k]).toBe(hill[k]);
 const g=new Float32Array(n*n).fill(40);g[k]=107;protect[k+4]=1;
 expect(repairUrbanSpikes(g,mask,protect,urban,n,n).grid[k]).toBe(107);
 protect[k+4]=0;g[k]=140;
 expect(repairUrbanSpikes(g,mask,protect,urban,n,n).grid[k]).toBe(140);
 const audit=auditRoadLattice(g,mask,protect,n,n,32,{originX:1024,originZ:2048,locations:true,exclusions:new Map([[k,'exceeds-urban-limit']])});
 expect(audit.reasons['exceeds-urban-limit']).toBeGreaterThan(0);
 expect(audit.locations.some((p:{x:number;z:number})=>p.x===1280&&p.z===2304)).toBe(true);
});
