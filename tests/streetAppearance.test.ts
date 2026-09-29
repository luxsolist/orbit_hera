import {it,expect} from 'vitest';
import * as THREE from 'three';
import {addStreetGeometry,type StreetMeshData} from '../src/world/StreetGeometry';
import {paintStreets,streetMaterial} from '../src/world/StreetSurface';
import {cityAppearance} from '../src/world/cities';
import {paintedSeoul} from '../src/world/cities/painted';
const compile=(m:THREE.Material)=>{const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader} as any;m.onBeforeCompile(shader,{} as any);return shader;};
it('preserves the reviewed pilot interior colours as the city-wide palette',()=>{
 for(const [name,base,target,weight] of [['asphalt','#667981',[.075,.085,.09],.8],['pavement','#d2cbb9',[.48,.46,.41],.65]] as const){
  const reviewed=new THREE.Color(base).lerp(new THREE.Color().setRGB(...target),weight);
  const actual=new THREE.Color(paintedSeoul.street[name]);
  expect(actual.r).toBeCloseTo(reviewed.r,2);expect(actual.g).toBeCloseTo(reviewed.g,2);expect(actual.b).toBeCloseTo(reviewed.b,2);
 }
});
it('shares city palette and detail across ordinary, pilot, elevated, prepared and texture street paths',()=>{
 const t={size:2,step:100,cellX0:0,cellZ0:0,heights:new Float32Array(4)};
 for(const id of ['seoul-stream','busan-stream','rome-stream','athens-stream',undefined]){
  const colors=cityAppearance(id).street,groups=[new THREE.Group(),new THREE.Group(),new THREE.Group(),new THREE.Group()];
  addStreetGeometry(groups[0],[{p:[10,50,90,50],w:16}],t,0,0,colors);
  addStreetGeometry(groups[1],[{p:[10,50,90,50],w:16}],{...t,streetPilot:true},0,0,colors);
  addStreetGeometry(groups[2],[],t,0,0,colors,undefined,[{a:[10,10,58,10,10,42],b:[90,10,58,90,10,42]}]);
  const prepared:StreetMeshData[]=groups[0].children.map(c=>{const m=c as THREE.Mesh;return {layer:m.userData.streetLayer,position:m.geometry.getAttribute('position').array as Float32Array,normal:m.geometry.getAttribute('normal').array as Float32Array,coord:m.geometry.getAttribute('streetCoord').array as Float32Array};});
  addStreetGeometry(groups[3],[],t,0,0,colors,prepared);
  const fills:string[]=[],strokes:string[]=[];
  const ctx={fillStyle:'',strokeStyle:'',save(){},restore(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},stroke(){strokes.push(this.strokeStyle);},fill(){fills.push(this.fillStyle);}};
  paintStreets(ctx as unknown as CanvasRenderingContext2D,[{p:[10,50,90,50],w:24}],1,0,0,colors);
  expect(fills.length).toBeGreaterThan(0);expect(fills.every(c=>c===colors.center)).toBe(true);expect(strokes).not.toContain(colors.marking);
  const tex=new THREE.Texture(),fallback=streetMaterial(tex,0,0,colors),shader=compile(fallback);
  expect(shader.uniforms.asphaltColor.value.getHexString()).toBe(new THREE.Color(colors.asphalt).getHexString());
  expect(shader.uniforms.roadWear.value).toBe(colors.wearStrength??0);
  expect(shader.fragmentShader).toContain('streetMaterialDetail(diffuseColor.rgb,streetPosition');
  const reference=(groups[0].getObjectByName('street_asphalt') as THREE.Mesh).material;
  for(const group of groups){
   expect(group.getObjectByName('street_lane_lines')).toBeUndefined();
   const material=(group.getObjectByName('street_asphalt') as THREE.Mesh).material as THREE.MeshStandardMaterial;
   expect(material).toBe(reference);expect(material.color.getHexString()).toBe(new THREE.Color(colors.asphalt).getHexString());
   const compiled=compile(material);expect(compiled.uniforms.streetPilotArea).toBeUndefined();expect(compiled.fragmentShader).not.toContain('pilotMask');
   expect(compiled.fragmentShader).toContain('streetMaterialDetail(diffuseColor.rgb,streetUV');
   for(const c of group.children)(c as THREE.Mesh).geometry.dispose();
  }
  fallback.dispose();tex.dispose();
 }
});
