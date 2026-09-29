import {it,expect} from 'vitest';
import * as THREE from 'three';
import {applyRoadRefinement,refinementSource,subdivideHeights} from '../src/world/RoadRefinement';
import {chunkTerrainEntry,sampleChunkLandHeight,sampleChunkSupportHeight,buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {prepareChunk,assembleChunk} from '../src/world/PreparedChunk';
import {paintedSeoul} from '../src/world/cities/painted';
import type {WorldChunk} from '../src/world/chunkManifest';
// @ts-expect-error shared build-time JavaScript
import {refineLocalSurface,LOCAL_ROAD_SETTINGS,scopeAt} from '../scripts/local-road-refinement.mjs';
const fixture=()=>({cx:0,cz:0,terrain:{size:33,seaLevel:0,heights:Array.from({length:1089},(_,i)=>20+.2*(i%33)+.1*Math.floor(i/33))},objects:{buildings:[],roads:[],water:[],walls:[]},underground:null} as WorldChunk);
it('subdivision preserves the rendered triangular surface, including a nonplanar cell and seams',()=>{
 const c=fixture();c.terrain.heights[17*33+17]+=8;
 const a=chunkTerrainEntry(c,1024),b=chunkTerrainEntry({...c,terrain:{...c.terrain,size:129,heights:subdivideHeights(c.terrain.heights,33,129)}},1024);
 for(let z=0;z<=1024;z+=7.5)for(let x=0;x<=1024;x+=13.25)expect(sampleChunkLandHeight(b,x,z)).toBeCloseTo(sampleChunkLandHeight(a,x,z),4);
});
it('keeps ground and road offsets together, preserves borders, and rejects stale or malformed recipes',()=>{
 const c=fixture();c.roadHeights=c.terrain.heights.map(h=>h+.2);
 const i=64*129+64,r={version:1 as const,size:129,source:refinementSource(c),deltas:[[i,-2]] as [number,number][]};
 const out=applyRoadRefinement(c,r);expect(out.terrain.size).toBe(129);expect(out.roadHeights![i]-out.terrain.heights[i]).toBeCloseTo(.2);
 expect(applyRoadRefinement(out,r)).toBe(out);expect(c.terrain.size).toBe(33);
 const a=chunkTerrainEntry(c,1024),b=chunkTerrainEntry(out,1024);
 for(let x=0;x<=1024;x+=8)for(const z of [0,8,1016,1024])expect(sampleChunkLandHeight(b,x,z)).toBeCloseTo(sampleChunkLandHeight(a,x,z),4);
 for(const deltas of [[[0,1]],[[i,NaN]],[[i,9]],[[i,1],[i,2]],[[129*129+5,1]]])expect(applyRoadRefinement(c,{...r,deltas:deltas as [number,number][]})).toBe(c);
 expect(applyRoadRefinement({...c,objects:{...c.objects,roads:[{p:[0,0,20,20],w:6}]}},r).terrain.size).toBe(33);
});
it('uses the same refined geometry and grounding through worker transfer and direct rendering',()=>{
 const c=fixture(),i=64*129+64;const out=applyRoadRefinement(c,{version:1,size:129,source:refinementSource(c),deltas:[[i,-2]]});
 const profile={...paintedSeoul,props:{...paintedSeoul.props,enabled:false}};
 const direct=buildChunkMesh(out,1024,0,0,profile),packet=structuredClone(prepareChunk(out,1024,0,0,profile)),assembly=assembleChunk(packet,0,0,profile);let result=assembly.next();while(!result.done)result=assembly.next();const worker=result.value;
 expect(worker.terrain!.size).toBe(129);expect(worker.terrain!.heights).toEqual(direct.terrain!.heights);
 for(const built of [direct,worker]){built.group.updateMatrixWorld(true);const terrain=built.group.getObjectByName('chunk_terrain') as THREE.Mesh;
  for(const [x,z] of [[511,510],[512,512],[515,513],[1020,512]]){
   const hit=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0)).intersectObject(terrain)[0];
   expect(hit).toBeDefined();expect(hit.point.y).toBeCloseTo(sampleChunkSupportHeight(built.terrain,x,z),4);
  }disposeChunkGroup(built.group);
 }
});
it('protects all coarse support corners and reduces a local crest without creating road warnings',()=>{
 const codes=Array(1089).fill(0);codes[16*33+16]=2;expect(scopeAt(codes,33,510,510,0,0,32)&2).toBe(2);
 const n=129,source=Float64Array.from({length:n*n},(_,i)=>20+10*Math.exp(-((i%n-64)**2+(Math.floor(i/n)-64)**2)/12));
 const mask=Float64Array.from(source,(_,i)=>Math.hypot(i%n-64,Math.floor(i/n)-64)<20?1:0);
 const result=refineLocalSurface(source,mask,[{p:[400,512,624,512],w:6}],0,0,()=>20,LOCAL_ROAD_SETTINGS);
 expect(result).not.toBeNull();expect(result.removed).toBeGreaterThan(0);expect(result.guard.remainingRegressions).toBe(0);expect(result.surface[0]).toBe(source[0]);
});
