import {paintedSeoul,paintedBusan} from '../src/world/cities/painted';
import {it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {cityAppearance,seoulAppearance,defaultAppearance,type CityAppearance} from '../src/world/cities';
import {facadeStyle,createFacadeMaterial} from '../src/world/BuildingFacade';
import {buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {addStreetProps,streetPropSites} from '../src/world/StreetProps';
import type {WorldChunk} from '../src/world/chunkManifest';
const chunk:WorldChunk={cx:0,cz:0,terrain:null,underground:null,objects:{buildings:[{p:[10,10,30,10,30,30,10,30],h:25}],roads:[{p:[5,100,195,100],w:10}],water:[]}};
const other:CityAppearance={...seoulAppearance,id:'test-city',buildings:{...seoulAppearance.buildings,colors:[0xff0000],weights:[7],roofs:[0x00ff00],apartmentHeight:40,windowContrast:.25},props:{...seoulAppearance.props,maxPerChunk:2,lampHeight:9,metal:0xff0000}};
it('resolves city IDs and leaves unconfigured cities on legacy appearance',()=>{
 expect(cityAppearance('seoul-stream')).toBe(paintedSeoul);
 expect(cityAppearance('busan-stream')).toBe(paintedBusan);
 expect(cityAppearance()).toBe(defaultAppearance);
 expect(defaultAppearance.buildings.enabled).toBe(false);expect(defaultAppearance.props.enabled).toBe(false);
});
it('isolates city wall, roof, architecture and material settings across builds',()=>{
 const a=buildChunkMesh(chunk,200,0,0,seoulAppearance),b=buildChunkMesh(chunk,200,0,0,other),c=buildChunkMesh(chunk,200,0,0,seoulAppearance);
 expect(facadeStyle(25,400,other)).toBe(0);expect(facadeStyle(25,400,seoulAppearance)).toBe(1);
 const geo=b.buildingMesh!.geometry,faces=geo.getAttribute('facadeFace'),colors=geo.getAttribute('color');
 for(let i=0;i<colors.count;i++)expect([colors.getX(i),colors.getY(i),colors.getZ(i)]).toEqual(faces.getX(i)===2?[0,1,0]:[1,0,0]);
 expect(a.buildingMesh!.material).toBe(c.buildingMesh!.material);expect(a.buildingMesh!.material).not.toBe(b.buildingMesh!.material);
 expect(Array.from(a.buildingMesh!.geometry.getAttribute('color').array)).toEqual(Array.from(c.buildingMesh!.geometry.getAttribute('color').array));
 for(const x of [a,b,c])disposeChunkGroup(x.group);
});
it('applies independent prop density, height, color and switches',()=>{
 expect(streetPropSites(chunk,200,other.props)).toHaveLength(2);
 expect(streetPropSites(chunk,200,{...other.props,lamps:false})).toHaveLength(0);
 const group=new THREE.Group();addStreetProps(group,chunk,200,0,0,()=>0,other.props);
 const lamp=group.getObjectByName('street_lights') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
 lamp.geometry.computeBoundingBox();expect(lamp.geometry.boundingBox!.max.y).toBeCloseTo(9.05);
 expect(lamp.material.color.getHex()).toBe(0xff0000);disposeChunkGroup(group);
});
it('binds facade detail settings separately per material',()=>{
 const compile=(p:CityAppearance)=>{const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'} as any;createFacadeMaterial(p).onBeforeCompile(shader,{} as any);return shader;};
 const a=compile(seoulAppearance),b=compile(other);
 expect(a.uniforms.cityDetail.value.x).toBe(1);expect(b.uniforms.cityDetail.value.x).toBe(.25);
 expect(b.fragmentShader).toContain('uniform vec3 cityDetail;');
});

it('paints both cities without changing collision geometry or shared legacy materials',()=>{
 const legacy=buildChunkMesh(chunk,200,0,0,seoulAppearance);
 for(const profile of [paintedSeoul,paintedBusan]){
  const painted=buildChunkMesh(chunk,200,0,0,profile);
  expect(painted.buildings).toEqual(legacy.buildings);
  const mat=painted.buildingMesh!.material as THREE.Material;
  expect(mat.customProgramCacheKey()).toContain('painted-reference-defined-v4');
  expect(mat).not.toBe(legacy.buildingMesh!.material);
  const dispose=vi.spyOn(mat,'dispose');disposeChunkGroup(painted.group);expect(dispose).toHaveBeenCalled();
 }
 expect((legacy.buildingMesh!.material as THREE.Material).userData.paintedOwned).toBeUndefined();
 expect(paintedBusan.buildings).not.toBe(paintedSeoul.buildings);
 expect(paintedBusan.props).not.toBe(paintedSeoul.props);
 disposeChunkGroup(legacy.group);
});
