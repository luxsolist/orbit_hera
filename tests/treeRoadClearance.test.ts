import {it,expect,describe} from 'vitest';
import * as THREE from 'three';
import {detailedSeoul} from '../src/world/cities/detail';
import {buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {vegetationSites,VEGETATION_STRIDE} from '../src/world/Vegetation';
import {deckTreeConflict,TREE_TOP_PER_SCALE,DECK_TREE_GAP,DECK_SLAB_DEPTH} from '../src/world/treeClearance.mjs';
import type {WorldChunk} from '../src/world/chunkManifest';
import type {CompiledStreetPlan} from '../src/world/CompiledStreet';

// Same 200 m fixture as cityDetailTier: a 10 m carriageway (z 95–105) with 3 m pavements at ground
// level, plus an optional elevated deck (layer 3, level 1) over z 20–60 at height `deckY`.
const flat=(size=2)=>({size,seaLevel:0,heights:Array(size*size).fill(0)});
const quad=(z1:number,z2:number,y=0)=>[0,y,z1,200,y,z1,200,y,z2,0,y,z1,200,y,z2,0,y,z2];
function chunk(deckY?:number,objects:Partial<WorldChunk['objects']>={}):WorldChunk {
 const plan:CompiledStreetPlan={version:1,region:'test',bounds:[0,0,200,200],sourceHash:'t',compilerVersion:'t',origin:[0,0],props:[],
  meshes:[{layer:3,position:quad(95,105)},{layer:1,position:quad(105,108)},{layer:1,position:quad(92,95)},...(deckY===undefined?[]:[{layer:3,level:1,position:quad(20,60,deckY)}])]};
 return {cx:0,cz:0,terrain:flat(),underground:null,compiledStreet:plan,objects:{buildings:[],roads:[{p:[0,100,200,100],w:10}],water:[],...objects}};
}
const veg=detailedSeoul.detail!.vegetation,ground=()=>0;
const park={k:'park',p:[0,0,200,0,200,90,0,90]};
const sites=(c:WorldChunk,authored:Parameters<typeof vegetationSites>[3]=[])=>{
 const s=vegetationSites(c,200,veg,authored,ground),out:{x:number;z:number;w:number;h:number}[]=[];
 for(let i=0;i<s.length;i+=VEGETATION_STRIDE)out.push({x:s[i],z:s[i+2],w:s[i+3],h:s[i+4]});return out;
};

describe('trees and elevated roads',()=>{
 it('keeps every crown clear of a low deck over a park',()=>{
  const trees=sites(chunk(5,{areas:[park]}));
  expect(trees.length).toBeGreaterThan(0); // the park outside the deck still has trees
  for(const t of trees)expect(t.z+t.w*3.4<20||t.z-t.w*3.4>60).toBe(true);
 });
 it('allows trees under a deck high enough to clear them',()=>{
  const low=sites(chunk(5,{areas:[park]})).filter(t=>t.z>20&&t.z<60).length;
  const high=sites(chunk(40,{areas:[park]})).filter(t=>t.z>20&&t.z<60).length;
  expect(low).toBe(0);expect(high).toBeGreaterThan(0);
  expect(deckTreeConflict(0,1,40)).toBe(false);
  expect(deckTreeConflict(0,1,TREE_TOP_PER_SCALE+DECK_TREE_GAP+DECK_SLAB_DEPTH-.1)).toBe(true);
 });
 it('rejects any tree under a deck when no ground sampler is given (conservative)',()=>{
  const s=vegetationSites(chunk(40,{areas:[park]}),200,veg); // no ground sampler at all
  for(let i=0;i<s.length;i+=VEGETATION_STRIDE)expect(s[i+2]>20&&s[i+2]<60).toBe(false);
  expect(s.length).toBeGreaterThan(0);
 });
 it('drops authored trees that now stand on the carriageway, keeps the ones on pavement',()=>{
  const authored=[{x:50,z:100,kind:'grand' as const},{x:80,z:106.5,kind:'street' as const}];
  const trees=sites(chunk(undefined),authored);
  expect(trees.some(t=>t.x===50&&t.z===100)).toBe(false);
  expect(trees.some(t=>t.x===80&&t.z===106.5)).toBe(true);
 });
});

describe('planting height',()=>{
 it('plants trees on the ground under a deck, never on the deck surface',()=>{
  const c=chunk(40,{areas:[park]}),build=buildChunkMesh(c,200,0,0,detailedSeoul);
  const ys:number[]=[];const m=new THREE.Matrix4(),p=new THREE.Vector3();
  build.group.traverse(o=>{if(o instanceof THREE.InstancedMesh&&o.userData.vegetation)for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);p.setFromMatrixPosition(m);if(p.z>22&&p.z<58)ys.push(p.y);}});
  expect(ys.length).toBeGreaterThan(0);
  for(const y of ys)expect(y).toBeLessThan(1); // ground is 0, the deck is 40
  disposeChunkGroup(build.group);
 });
});
