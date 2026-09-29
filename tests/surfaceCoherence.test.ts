import {it,expect} from 'vitest';
import {reconcileUrbanTerrain,reconciledWaterLevel} from '../src/world/SurfaceCoherence';
import type {WorldChunk} from '../src/world/chunkManifest';
it('smooths a built-road bump after detail edits while preserving boundaries, road support and repeatability',()=>{
 const n=17,heights=Array.from({length:n*n},(_,k)=>40+((k%n)*.02)+10*Math.exp(-(((k%n)-8)**2+(Math.floor(k/n)-8)**2)/6));
 const raw={cx:0,cz:0,terrain:{size:n,heights},roadHeights:heights.map(h=>h+.3),objects:{buildings:[{p:[350,350,600,350,600,600,350,600]}],roads:[{p:[0,512,1024,512],w:28}],water:[]}} as unknown as WorldChunk;
 const fixed=reconcileUrbanTerrain(raw);expect(fixed.terrain.heights[8*n+8]).toBeLessThan(heights[8*n+8]-3);
 for(let i=0;i<n;i++)for(const k of [i,(n-1)*n+i,i*n,i*n+n-1])expect(fixed.terrain.heights[k]).toBe(heights[k]);
 expect(fixed.roadHeights!.every((h,i)=>h>=fixed.terrain.heights[i])).toBe(true);expect(reconcileUrbanTerrain(fixed)).toBe(fixed);expect(raw.terrain.heights).toBe(heights);
 const natural=reconcileUrbanTerrain({...raw,objects:{...raw.objects,buildings:[]}});expect(natural.terrain.heights).toEqual(heights);
 const protectedArea=reconcileUrbanTerrain(raw,()=>true);expect(protectedArea.terrain.heights).toEqual(heights);
});
it('reanchors estimated water to final shore heights without overriding explicit sea or surveyed levels',()=>{
 const water={p:[0,0,12,0,12,8,0,8],level:62.35,levelSource:'shore-dem-estimate'};
 expect(reconciledWaterLevel(water,(x)=>40+x*.02)).toBeCloseTo(39.85);
 for(const levelSource of ['osm-ele','sea-level-render-reference'])expect(reconciledWaterLevel({...water,levelSource},()=>40)).toBe(62.35);
 expect(reconciledWaterLevel(water,()=>NaN)).toBe(62.35);
});
