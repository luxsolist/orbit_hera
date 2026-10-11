import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {cityAppearance,deviceAppearance} from '../src/world/cities';
import {paintedSeoul} from '../src/world/cities/painted';
import {paintedRome} from '../src/world/cities/rome';
import {paintedAthens} from '../src/world/cities/athens';
import {detailedSeoul,detailedRome,detailedAthens,seoulGrammar} from '../src/world/cities/detail';
import {buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {createFacadeMaterial} from '../src/world/BuildingFacade';
import {streetMaterial} from '../src/world/StreetSurface';
import {vegetationSites,addVegetation,pickSpecies,SPECIES,VEGETATION_STRIDE} from '../src/world/Vegetation';
import {parkFurnitureSites} from '../src/world/ParkFurniture';
import {facadeGrammar,grammarOrnaments,decodeSignSize,grammarZone,GRAMMAR} from '../src/world/FacadeGrammar';
import type {WorldChunk} from '../src/world/chunkManifest';
import type {CompiledStreetPlan} from '../src/world/CompiledStreet';

const flat=(size=2)=>({size,seaLevel:0,heights:Array(size*size).fill(0)});
/** 200m chunk with a 10m carriageway (z 95–105) and 3m pavements, all compiled at ground level. */
function street(cx=0,cz=0):CompiledStreetPlan {
 const x0=cx*200,z0=cz*200,quad=(z1:number,z2:number)=>[0,0,z1,200,0,z1,200,0,z2,0,0,z1,200,0,z2,0,0,z2];
 return {version:1,region:'test',bounds:[x0,z0,x0+200,z0+200],sourceHash:'t',compilerVersion:'t',origin:[x0,z0],props:[],
  meshes:[{layer:3,position:quad(95,105)},{layer:1,position:quad(105,108)},{layer:1,position:quad(92,95)}]};
}
function chunk(extra:Partial<WorldChunk['objects']>={},cx=0,cz=0,plan=true):WorldChunk {
 const x0=cx*200,z0=cz*200;
 return {cx,cz,terrain:flat(),underground:null,...(plan?{compiledStreet:street(cx,cz)}:{}),
  objects:{buildings:[],roads:[{p:[x0,z0+100,x0+200,z0+100],w:10}],water:[],...extra}};
}

describe('city detail tier profiles',()=>{
 it('serves the detail tier to every streamed city',()=>{
  expect(cityAppearance('seoul-stream')).toBe(detailedSeoul);
  expect(cityAppearance('rome-stream')).toBe(detailedRome);expect(cityAppearance('athens-stream')).toBe(detailedAthens);
  expect(paintedSeoul.detail).toBeUndefined();
  // Only the detail block, tree source, fog tint and id differ: palettes and streets are shared.
  expect(detailedSeoul.buildings).toBe(paintedSeoul.buildings);
  expect(detailedSeoul.street).toBe(paintedSeoul.street);
  expect(detailedSeoul.ground).toBe(paintedSeoul.ground);
  expect(detailedSeoul.props.trees).toBe(false);
 });
 it('halves the tree budget on touch-only devices without new profile objects per call',()=>{
  const a=deviceAppearance(detailedSeoul,true),b=deviceAppearance(detailedSeoul,true);
  expect(a).toBe(b);expect(deviceAppearance(detailedSeoul,false)).toBe(detailedSeoul);expect(deviceAppearance(paintedSeoul,true)).toBe(paintedSeoul);
  expect(a.detail!.vegetation.maxPerChunk).toBe(Math.round(detailedSeoul.detail!.vegetation.maxPerChunk/2));
  expect(a.detail!.vegetation.farDistance).toBeLessThan(detailedSeoul.detail!.vegetation.farDistance);
 });
});

describe('vegetation',()=>{
 const veg=detailedSeoul.detail!.vegetation;
 it('plants street trees on compiled pavement, never on the carriageway',()=>{
  const sites=vegetationSites(chunk(),200,veg);
  expect(sites.length/VEGETATION_STRIDE).toBeGreaterThan(20);
  for(let i=0;i<sites.length;i+=VEGETATION_STRIDE){const z=sites[i+2];expect(z<95||z>105).toBe(true);expect(z>=92&&z<=108).toBe(true);}
  expect(vegetationSites(chunk(),200,veg)).toEqual(sites); // deterministic
  expect(vegetationSites(chunk({},0,0,false),200,veg)).toEqual([]); // no compiled street → no street trees
 });
 it('scatters area trees outside buildings and water, owned by exactly one chunk',()=>{
  const park={k:'wood',p:[150,0,250,0,250,90,150,90]},house={p:[160,10,190,10,190,40,160,40],h:8},pond={p:[200,50,240,50,240,80,200,80]};
  const left=vegetationSites(chunk({areas:[park],buildings:[house],water:[pond]},0,0,false),200,veg);
  const right=vegetationSites(chunk({areas:[park],buildings:[],water:[pond]},1,0,false),200,veg);
  expect(left.length).toBeGreaterThan(0);expect(right.length).toBeGreaterThan(0);
  for(let i=0;i<left.length;i+=VEGETATION_STRIDE){const x=left[i],z=left[i+2];expect(x).toBeLessThan(200);expect(x>=158&&x<=192&&z>=8&&z<=42).toBe(false);}
  for(let i=0;i<right.length;i+=VEGETATION_STRIDE){const x=right[i],z=right[i+2];expect(x).toBeGreaterThanOrEqual(200);expect(x>200&&x<240&&z>50&&z<80).toBe(false);}
 });
 it('keeps parks and lawns open while forests stay continuous',()=>{
  const area=[0,0,200,0,200,90,0,90],count=(k:string)=>vegetationSites(chunk({areas:[{k,p:area}]},0,0,false),200,veg).length/VEGETATION_STRIDE;
  const wood=count('wood'),park=count('park'),grass=count('grass');
  expect(wood).toBeGreaterThan(150);
  // 1.8ha: forest ~200 trees, park/lawn a few dozen at most (Hangang-style open green).
  expect(park).toBeGreaterThan(0);expect(park).toBeLessThan(wood/6);expect(grass).toBeLessThan(wood/8);
 });
 it('renders patch-authored trees with the shared model at their exact positions',()=>{
  const authored=[{x:50,z:20,kind:'grand' as const},{x:60,z:30,kind:'palace' as const},{x:250,z:20,kind:'grand' as const}];
  const sites=vegetationSites(chunk({},0,0,false),200,veg,authored);
  const at=(x:number,z:number)=>{for(let i=0;i<sites.length;i+=VEGETATION_STRIDE)if(sites[i]===x&&sites[i+2]===z)return i;return -1;};
  expect(at(50,20)).toBeGreaterThanOrEqual(0);expect(at(60,30)).toBeGreaterThanOrEqual(0);
  expect(at(250,20)).toBe(-1); // owned by the neighbouring chunk
  expect(sites[at(50,20)+4]).toBeGreaterThan(1.2); // landmark groves stay large
 });
 it('respects the per-chunk cap and instanced LOD meshes share template geometry across chunks',()=>{
  const big={k:'wood',p:[0,0,200,0,200,90,0,90]};
  const sites=vegetationSites(chunk({areas:[big]},0,0,false),200,{...veg,maxPerChunk:25});
  expect(sites.length/VEGETATION_STRIDE).toBe(25);
  const data=new Float32Array(sites),a=new THREE.Group(),b=new THREE.Group();
  addVegetation(a,data,veg);addVegetation(b,data,veg);
  const meshes=(g:THREE.Group)=>g.children.filter((o):o is THREE.InstancedMesh=>o instanceof THREE.InstancedMesh);
  expect(meshes(a).length).toBeGreaterThan(0);
  expect(meshes(a)[0].geometry).toBe(meshes(b)[0].geometry);
  const lods=meshes(a).map(m=>m.userData.vegetation.lod);expect(lods).toContain('near');expect(lods).toContain('far');
  // A near/far pair shares one instance buffer.
  const near=meshes(a).find(m=>m.userData.vegetation.lod==='near')!,far=meshes(a).find(m=>m.instanceMatrix===near.instanceMatrix&&m!==near);
  expect(far?.userData.vegetation.lod).toBe('far');
  const spy=vi.spyOn(near.geometry,'dispose');disposeChunkGroup(a);expect(spy).not.toHaveBeenCalled();
  expect(meshes(b)[0].geometry.getAttribute('position').count).toBeGreaterThan(0);disposeChunkGroup(b);
 });
 it('places park benches and lanterns beside footpaths inside parks only',()=>{
  const c=chunk({areas:[{k:'park',p:[0,0,200,0,200,80,0,80]}],roads:[{p:[10,40,190,40],w:3},{p:[10,150,190,150],w:3}]},0,0,false);
  const sites=parkFurnitureSites(c,200);
  expect(sites.length).toBeGreaterThan(0);
  for(let i=0;i<sites.length;i+=4){expect(sites[i+1]).toBeLessThan(80);expect(Math.abs(sites[i+1]-40)).toBeGreaterThan(1.5);}
 });
});

describe('district facade grammar',()=>{
 // Seoul cell-local metres: Teheran-ro ≈ (91230, 55700); Myeongdong ≈ (86960, 48460).
 it('classifies the reference districts and leaves ordinary apartment slabs alone',()=>{
  const zone=(x:number,z:number)=>grammarZone(x,z,seoulGrammar)?.id;
  expect(zone(91230,55700)).toBe('gangnam');expect(zone(86960,48460)).toBe('myeongdong');expect(zone(87300,47800)).toBe('jongno');
  for(let i=0;i<40;i++){
   expect([GRAMMAR.glassTower,GRAMMAR.stoneOffice]).toContain(facadeGrammar(91230+i*13,55700,90,900,true,seoulGrammar));
   expect([GRAMMAR.streetCommercial,GRAMMAR.retailFlagship]).toContain(facadeGrammar(86960+i*7,48460,20,300,false,seoulGrammar));
   expect(facadeGrammar(20000+i*50,20000,30,600,true,seoulGrammar)).toBe(GRAMMAR.none); // apartment-height slab elsewhere
  }
  expect(facadeGrammar(91230,55700,90,10,true,seoulGrammar)).toBe(GRAMMAR.none); // kiosks/slivers keep the base shell
 });
 it('mounts blade signs outside the street-facing wall with face-local sign coordinates',()=>{
  // 20×12 footprint; the street lies to −z.
  const poly=[0,0,20,0,20,12,0,12];
  for(const winding of [poly,[0,0,0,12,20,12,20,0]]){
   const g=grammarOrnaments(GRAMMAR.streetCommercial,winding,0,24,[0,-1],1,1,1,seoulGrammar.signs)!;
   const pos=g.getAttribute('position'),kind=g.getAttribute('ornamentGrammar'),sign=g.getAttribute('signCoord');
   let outside=0;
   for(let i=0;i<pos.count;i++)if(kind.getX(i)>=GRAMMAR.sign){expect(pos.getZ(i)).toBeLessThan(1.01);if(pos.getZ(i)<-.05)outside++;}
   expect(outside).toBeGreaterThan(0);
   for(let i=0;i<pos.count;i++)if(kind.getX(i)>=GRAMMAR.sign){const [w,h]=decodeSignSize(sign.getZ(i));expect(w).toBeGreaterThan(0);expect(h).toBeGreaterThan(0);expect(sign.getX(i)).toBeLessThanOrEqual(w+.01);}
   expect(pos.count).toBeLessThanOrEqual(36*7); // a handful of boxes per building
   g.dispose();
  }
 });
 it('keeps collision footprints/tops and binds ornaments into each building range',()=>{
  const x0=91000,z0=55400,b=(dx:number,h:number)=>({p:[x0+dx,z0+20,x0+dx+30,z0+20,x0+dx+30,z0+60,x0+dx,z0+60],h});
  const c:WorldChunk={cx:x0/200,cz:z0/200,terrain:flat(),underground:null,objects:{buildings:[b(10,90),b(60,14),b(110,30),b(160,6)],roads:[{p:[x0,z0+10,x0+200,z0+10],w:12}],water:[]}};
  const detail=buildChunkMesh(c,200,x0,z0,detailedSeoul),legacy=buildChunkMesh(c,200,x0,z0,paintedSeoul);
  expect(detail.buildings.map(r=>[r.poly,r.top,r.baseY])).toEqual(legacy.buildings.map(r=>[r.poly,r.top,r.baseY]));
  const g=detail.buildingMesh!.geometry,grammar=g.getAttribute('facadeGrammar');
  expect(detail.buildings.reduce((n,r)=>n+r.vCount,0)).toBe(g.getAttribute('position').count);
  const kinds=new Set(Array.from(grammar.array as Float32Array));
  expect(kinds.has(GRAMMAR.glassTower)||kinds.has(GRAMMAR.stoneOffice)).toBe(true);
  expect(kinds.has(GRAMMAR.sign)).toBe(true);
  expect(legacy.buildingMesh!.geometry.getAttribute('facadeGrammar')).toBeUndefined();
  disposeChunkGroup(detail.group);disposeChunkGroup(legacy.group);
 });
});

describe('mobile-safe shading hooks',()=>{
 const compile=(material:THREE.Material)=>{const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader} as any;material.onBeforeCompile(shader,{} as any);return shader;};
 it('adds grammar and sign glow only to the detail facade program',()=>{
  const detail=createFacadeMaterial(detailedSeoul),legacy=createFacadeMaterial(paintedSeoul);
  const a=compile(detail),b=compile(legacy);
  expect(a.fragmentShader).toContain('fGrammar');expect(a.fragmentShader).toContain('signGlow*signNight');
  expect(b.fragmentShader).not.toContain('fGrammar');
  expect(detail.customProgramCacheKey()).not.toBe(legacy.customProgramCacheKey());
  // The roughness hook survives after the grammar block is inserted before it.
  expect(a.fragmentShader.indexOf('fGrammar>8.5')).toBeLessThan(a.fragmentShader.indexOf('roughnessFactor=mix(fKind>=0.0'));
 });
 it('water shading is opt-in, keeps STANDARD defines and needs no render target',()=>{
  const tex=new THREE.Texture(),water=streetMaterial(tex,0,0,detailedSeoul.street,{color:'#2f68b4',deep:[.05,.1,.1],ripple:.07,horizon:[.6,.8,.9],zenith:[.2,.5,.8]}),plain=streetMaterial(tex,0,0,detailedSeoul.street);
  const a=compile(water),b=compile(plain);
  expect(a.fragmentShader).toContain('waterMask');expect(a.fragmentShader).toContain('gl_FragColor.rgb+=waterGlint');
  expect(b.fragmentShader).not.toContain('waterMask');
  expect(water.defines).toEqual(plain.defines);
  expect(water.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
  expect(Object.values(a.uniforms).some((u:any)=>u.value instanceof THREE.WebGLRenderTarget||u.value instanceof THREE.Texture&&u.value!==tex)).toBe(false);
 });
});

describe('per-city detail parameters',()=>{
 const profiles=[detailedSeoul,detailedRome,detailedAthens];
 it('gives every streamed city its own detail block and a distinct character',()=>{
  for(const p of profiles){expect(p.detail).toBeDefined();expect(p.props.trees).toBe(false);}
  expect(new Set(profiles.map(p=>p.detail)).size).toBe(3);
  // Korean commercial grammar only where its references apply; Rome/Athens keep their architecture modules.
  expect(detailedSeoul.detail!.grammar).toBe(seoulGrammar);
  expect(detailedRome.detail!.grammar).toBeUndefined();expect(detailedAthens.detail!.grammar).toBeUndefined();
  expect(detailedRome.detail!.vegetation.species.open.umbrella).toBeGreaterThan(0);
  expect(detailedSeoul.detail!.vegetation.species.open.umbrella).toBeUndefined();
  expect(detailedAthens.detail!.clouds.coverage).toBeLessThan(detailedSeoul.detail!.clouds.coverage);
  // Palettes and streets stay the painted ones per city.
  expect(detailedRome.street).toBe(paintedRome.street);expect(detailedAthens.buildings).toBe(paintedAthens.buildings);
 });
 it('picks species by weight and builds every template',()=>{
  const counts=[0,0,0,0];for(let i=0;i<1000;i++)counts[pickSpecies({umbrella:3,cypress:1},i/1000)]++;
  expect(counts[0]+counts[1]).toBe(0);expect(counts[2]).toBe(750);expect(counts[3]).toBe(250);
  expect(pickSpecies({},.7)).toBe(0);
  const veg=detailedRome.detail!.vegetation,data=new Float32Array(SPECIES.flatMap((_,i)=>[i*600+10,0,10,1,1,0,i,0]));
  const g=new THREE.Group();addVegetation(g,data,veg);
  expect(new Set(g.children.map(m=>(m as THREE.InstancedMesh).geometry)).size).toBe(SPECIES.length*2);
  disposeChunkGroup(g);
 });
 it('uses each city water look and cloud amount without new passes',()=>{
  const tex=new THREE.Texture();
  for(const p of profiles){
   const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader} as any;
   streetMaterial(tex,0,0,p.street,{color:'#2f68b4',deep:p.detail!.water.deep,ripple:p.detail!.water.ripple,horizon:[.6,.8,.9],zenith:[.2,.5,.8]}).onBeforeCompile(shader,{} as any);
   expect(shader.uniforms.waterDeep.value.toArray()).toEqual([...p.detail!.water.deep]);expect(shader.uniforms.waterRipple.value).toBe(p.detail!.water.ripple);
  }
 });
});
