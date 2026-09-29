import {describe,it,expect} from 'vitest';
import {compiledStreetHeight,inCompiledStreet,type CompiledStreetPlan} from '../src/world/CompiledStreet';
const plan:CompiledStreetPlan={version:1,region:'test',bounds:[100,200,110,210],sourceHash:'test',compilerVersion:'1',origin:[100,200],props:[],meshes:[{layer:3,position:[0,5,0,10,5,0,0,7,10],index:[0,2,1]}]};
describe('compiled street render/support contract',()=>{
 it('samples exactly the indexed rendered triangle and respects deck height',()=>{
 expect(compiledStreetHeight(plan,102,202)).toBeCloseTo(5.4);
 expect(compiledStreetHeight(plan,102,202,2)).toBeUndefined();
 expect(compiledStreetHeight(plan,109,209)).toBeUndefined();
 expect(compiledStreetHeight(plan,99,200)).toBeUndefined();
 });
 it('bounds are independent of camera/chunk origin',()=>{expect(inCompiledStreet(plan,105,205)).toBe(true);expect(inCompiledStreet(plan,5,5)).toBe(false);});
});

it('keeps ground and upper support independently addressable',()=>{
 const p:CompiledStreetPlan={...plan,meshes:[...plan.meshes,{...plan.meshes[0],level:1,position:plan.meshes[0].position.map((v,i)=>i%3===1?v+20:v)}]};
 expect(compiledStreetHeight(p,102,202,Infinity,0)).toBeCloseTo(5.4);
 expect(compiledStreetHeight(p,102,202,Infinity,1)).toBeCloseTo(25.4);
 expect(compiledStreetHeight(p,102,202,6)).toBeCloseTo(5.4);
});

it('applies baked ground heights to shared terrain and support, not an overlay plane',async()=>{
 const {applyMapCorrections}=await import('../src/world/MapCorrections');
 const {chunkTerrainEntry,sampleChunkSupportHeight}=await import('../src/world/chunkMesh');
 const raw={cx:0,cz:0,terrain:{size:3,heights:Array(9).fill(0)},objects:{buildings:[],structures:[],roads:[],water:[],walls:[]}} as any;
 const p:CompiledStreetPlan={...plan,bounds:[0,0,1024,1024],origin:[0,0],meshes:[],terrainHeights:Array(9).fill(3),roadHeights:Array(9).fill(3)};
 const chunk=applyMapCorrections([0,0],raw,{roadGrade:{version:1,size:3,points:[],streetPlan:p},detail:null,appearance:null},{streetPilot:false,streetSections:false,surfaceCoherence:false,roadNetwork:false,localRefinement:false});
 expect(chunk.terrain.heights).toEqual(p.terrainHeights);expect(raw.terrain.heights[4]).toBe(0);
 expect(sampleChunkSupportHeight(chunkTerrainEntry(chunk,1024),512,512)).toBe(3);
});

it('tolerates baked submillimetre edge rounding but does not bridge real gaps',()=>{
 expect(compiledStreetHeight({...plan,bounds:[99,200,110,210]},100-.0001,202)).toBeDefined();
 expect(compiledStreetHeight({...plan,bounds:[99,200,110,210]},100-.01,202)).toBeUndefined();
});

it('does not extrapolate a thin triangle beyond its finite tip',()=>{
 const p:CompiledStreetPlan={...plan,bounds:[0,0,100,100],origin:[0,0],meshes:[{layer:3,position:[0,0,0,10,10,0,10,10,.00001],index:[0,1,2]}]};
 expect(compiledStreetHeight(p,12,.00001)).toBeUndefined();
 expect(compiledStreetHeight(p,5,.000002)).toBeCloseTo(5);
});

// A fine legacy refinement must not leave its grid dimensions on the new baked grid.
it('replaces grid dimensions and road fallback together with compiled terrain',async()=>{
 const {applyMapCorrections}=await import('../src/world/MapCorrections');
 const {chunkTerrainEntry,sampleStreetHeight}=await import('../src/world/chunkMesh');
 const raw={cx:0,cz:0,terrain:{size:129,heights:Array(129*129).fill(0)},roadHeights:Array(129*129).fill(99),objects:{buildings:[],structures:[],roads:[],water:[],walls:[]}} as any;
 const p:CompiledStreetPlan={...plan,bounds:[0,0,1024,1024],origin:[0,0],meshes:[],terrainHeights:Array(33*33).fill(4)};
 const chunk=applyMapCorrections([0,0],raw,{roadGrade:{version:1,size:129,points:[],streetPlan:p},detail:null,appearance:null},{streetPilot:false,streetSections:false,surfaceCoherence:false,roadNetwork:false,localRefinement:false});
 expect(chunk.terrain.size).toBe(33);expect(chunk.roadHeights).toEqual(p.terrainHeights);
 const t=chunkTerrainEntry(chunk,1024);
 for(const x of [0,512,1024])for(const z of [0,512,1024])expect(sampleStreetHeight(t,x,z)).toBe(4);
});
