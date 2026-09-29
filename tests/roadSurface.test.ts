import {expect,it} from 'vitest';
import {designUrbanRoadSurface,fitRoadPlane,fairUrbanRoadSurface} from '../scripts/road-grade.mjs';
import {applyRoadGradePatch} from '../src/world/RoadGradePatch';
import {chunkTerrainEntry,sampleChunkSupportHeight,sampleStreetHeight} from '../src/world/chunkMesh';
import {terrainFootprint} from '../src/world/StreetGeometry';
import type {WorldChunk} from '../src/world/chunkManifest';

it('removes repetitive urban undulation while retaining a continuous real slope',()=>{
 const n=25,step=32,mask=new Uint8Array(n*n).fill(255),water=new Uint8Array(n*n),urban=mask;
 const plane=Float32Array.from({length:n*n},(_,k)=>30+(k%n)*.8+Math.floor(k/n)*.32);
 const clean=designUrbanRoadSurface(plane,mask,water,urban,n,n,step);
 expect(clean.surface[12*n+12]).toBeCloseTo(plane[12*n+12],4);
 const wavy=plane.map((v,k)=>v+3*Math.sin((k%n)*1.6)+2*Math.sin(Math.floor(k/n)*1.4));
 const out=designUrbanRoadSurface(wavy,mask,water,urban,n,n,step);
 let before=0,after=0;
 for(let z=7;z<18;z++)for(let x=7;x<18;x++){const k=z*n+x;before+=Math.abs(wavy[k]-plane[k]);after+=Math.abs(out.surface[k]-plane[k]);}
 expect(after).toBeLessThan(before*.45);
 expect(wavy).not.toEqual(out.surface);
 const mountain=Float32Array.from({length:n*n},(_,k)=>30+(k%n)*10);
 expect(designUrbanRoadSurface(mountain,mask,water,urban,n,n,step).land).toEqual(mountain);
});
it('keeps low riverbeds and unbuilt terrain, but removes elevated DEM errors from a river corridor',()=>{
 const n=17,k=8*n+8,g=new Float32Array(n*n).fill(30),mask=new Uint8Array(n*n).fill(255),water=new Uint8Array(n*n),urban=mask;
 for(let z=0;z<n;z++){water[z*n+8]=1;g[z*n+8]=24;}
 const out=designUrbanRoadSurface(g,mask,water,urban,n,n,32);
 expect(out.land[k]).toBe(24);expect(out.surface[k]).toBeCloseTo(30,4);
 for(let z=0;z<n;z++)g[z*n+8]=32;
 const high=designUrbanRoadSurface(g,mask,water,urban,n,n,32);
 expect(high.land[k]).toBeCloseTo(29.75,4);expect(high.surface[k]).toBeCloseTo(30,4);expect(g[k]).toBe(32);
 expect(Math.abs(high.surface[k]-high.surface[k+1])/32).toBeLessThanOrEqual(.061);
 expect(designUrbanRoadSurface(g,mask,water,new Uint8Array(n*n),n,n,32).land).toEqual(g);
 expect(fitRoadPlane([[0,0,30,1]],32)).toBeNull();
});
it('uses the same baked surface for street triangles and walking, keeping riverbed support below decks',()=>{
 const raw={cx:0,cz:0,terrain:{size:2,seaLevel:0,heights:[20,20,20,20]},objects:{roads:[{p:[0,16,32,16],w:8,bridge:true}],buildings:[],water:[]}} as unknown as WorldChunk;
 const patch={version:1,size:2,points:[],surfaceRevision:1,surfacePoints:[0,1,2,3].map(i=>[i,20,26] as [number,number,number])};
 const out=applyRoadGradePatch(raw,patch),t=chunkTerrainEntry(out,32)!;
 expect(raw.terrain.heights).toEqual([20,20,20,20]);
 const mesh=terrainFootprint([[0,12],[32,12],[32,20],[0,20]],t,0,0,true);
 for(let i=1;i<mesh.length;i+=3)expect(mesh[i]).toBe(26);
 expect(sampleStreetHeight(t,16,16)).toBe(26);
 expect(sampleChunkSupportHeight(t,16,16,26)).toBe(26);
 expect(sampleChunkSupportHeight(t,16,16,20)).toBe(20);
 expect(sampleChunkSupportHeight(t,16,1,30)).toBe(20);
 expect(applyRoadGradePatch(out,patch)).toEqual(out);
 expect(applyRoadGradePatch(raw,{...patch,surfacePoints:[[0,21,26]]})).toBe(raw);
});

it('fairing removes repeated rejected ridges while preserving a continuous hillside and unbuilt ground',()=>{
 const n=33,step=32,mask=new Uint8Array(n*n).fill(255),water=new Uint8Array(n*n);
 const plane=Float32Array.from({length:n*n},(_,k)=>30+(k%n)*6+Math.floor(k/n)*2);
 const smooth=fairUrbanRoadSurface(plane,plane,plane,mask,water,mask,n,n);
 expect(smooth.surface).toEqual(plane);
 const noisy=plane.map((v,k)=>v+15*Math.sin(k%n*1.9)+10*Math.sin(Math.floor(k/n)*1.5));
 const out=fairUrbanRoadSurface(noisy,noisy,noisy,mask,water,mask,n,n);
 let before=0,after=0;
 for(let z=8;z<25;z++)for(let x=8;x<25;x++){const k=z*n+x;before+=Math.abs(noisy[k]-plane[k]);after+=Math.abs(out.surface[k]-plane[k]);expect(Math.abs(out.surface[k]-noisy[k])).toBeLessThanOrEqual(30.001);}
 expect(after).toBeLessThan(before*.15);
 expect(fairUrbanRoadSurface(noisy,noisy,noisy,mask,water,new Uint8Array(n*n),n,n).surface).toEqual(noisy);
});

it('does not restore a large peak already removed by evidence-based repair',()=>{
 const n=17,ground=new Float32Array(n*n).fill(30),raw=ground.slice(),mask=new Uint8Array(n*n).fill(255);raw[8*n+8]=100;
 const out=fairUrbanRoadSurface(ground,ground,raw,mask,new Uint8Array(n*n),mask,n,n);
 expect(out.surface[8*n+8]).toBe(30);expect(out.land[8*n+8]).toBe(30);
});
