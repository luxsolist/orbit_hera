import {streetSidewalk} from './streetSection.mjs';
import type {Ring} from './MapData';
import {solveRoadNetwork} from './RoadNetwork';
import {roadPaintCorners,planRoadMarkings} from './RoadMarkings';
import {STREET_MATERIAL_DETAIL_GLSL} from './StreetMaterialDetail';
import {defaultAppearance,type CityAppearance} from './cities';
import * as THREE from 'three';
import {PAINTED_SKY} from './PaintedCityStyle';
import {cityUniforms} from './cityUniforms';

export const STREET = defaultAppearance.street;
type Road = Pick<Ring,"p"|"w"|"streetSection">;
/** Visual pavement inferred from road width; no new collision or road topology. */
export function paintStreets(ctx:CanvasRenderingContext2D, roads:Road[], scale:number, x0:number, z0:number,colors:CityAppearance['street']=STREET):void {
 const STREET=colors;
 const path=(p:number[],offset=0)=>{
  ctx.beginPath();
  for(let i=0;i<p.length;i+=2){
   const prev=Math.max(0,i-2),next=Math.min(p.length-2,i+2);
   const dx=p[next]-p[prev],dz=p[next+1]-p[prev+1],length=Math.hypot(dx,dz)||1;
   const x=(p[i]-dz/length*offset-x0)*scale,y=(p[i+1]+dx/length*offset-z0)*scale;
   if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }
 };
 const stroke=(r:Road,width:number,color:string,offset=0)=>{
  path(r.p,offset);ctx.strokeStyle=color;ctx.lineWidth=Math.max(.35,width*scale);ctx.stroke();
 };
 const valid=roads.filter(r=>r.p.length>=4&&(r.w??6)>0);
 ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
 // Paint all shoulders before any carriageways so junctions remain connected.
 for(const r of valid){const w=r.w??6,s=streetSidewalk(r);if(s>0){stroke(r,w+s*2,STREET.pavement);}}
 for(const r of valid)stroke(r,(r.w??6)+.45,STREET.curb);
 for(const r of valid)stroke(r,r.w??6,STREET.asphalt);
 ctx.lineCap='butt';
 const network=solveRoadNetwork(valid);
 ctx.fillStyle=STREET.center;
 for(const [key,marks] of planRoadMarkings(network)){
  const c=network.get(key)!;
  for(const m of marks){
   const points=roadPaintCorners(c,m);
   ctx.beginPath();points.forEach(([x,z],i)=>i?ctx.lineTo((x-x0)*scale,(z-z0)*scale):ctx.moveTo((x-x0)*scale,(z-z0)*scale));ctx.closePath();ctx.fill();
  }
 }
 ctx.restore();
}

/** Per-city water look (CityDetailSettings.water + the city's painted sky, linear RGB). */
export interface WaterSurface {color:string;deep:readonly number[];ripple:number;horizon:readonly number[];zenith:readonly number[]}
export function waterSurface(profile:CityAppearance,color:string):WaterSurface|undefined {
 const w=profile.detail?.water;if(!w?.enabled)return undefined;const sky=profile.environment.paintedSky??PAINTED_SKY;
 return {color,deep:w.deep,ripple:w.ripple,horizon:sky.horizon,zenith:sky.zenith};
}
// Mobile-safe water: analytic ripples, Fresnel sky reflection and a sun glint in the terrain pass.
// No reflection render target; the reflected sky is the painted sky gradient.
const WATER_GLSL=`
 float waterNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5453);
  float c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5453),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5453);
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
 vec2 waterSlope(vec2 p,float t){
  // Domain warp breaks the long straight crests of summed sine waves.
  p+=vec2(waterNoise(p*.011),waterNoise(p*.011+19.1))*26.0;
  vec2 g=vec2(.6,.8)*cos(dot(p,vec2(.6,.8))*.31+t*1.05)*.55;
  g+=vec2(-.75,.45)*cos(dot(p,vec2(-.75,.45))*.83+t*1.6)*.3;
  g+=vec2(.25,-.95)*cos(dot(p,vec2(.25,-.95))*2.1+t*2.4)*.16;
  g+=vec2(-.9,-.3)*cos(dot(p,vec2(-.9,-.3))*4.7+t*3.3)*.08;
  return g;
 }
`;

const WATER_UNIFORMS_GLSL='uniform vec3 waterColor; uniform vec3 waterDeep; uniform float waterRipple; uniform float waterTime; uniform float waterDaylight; uniform vec3 waterSun; uniform vec3 waterHorizon; uniform vec3 waterZenith;\n'+WATER_GLSL;
function waterUniforms(water:WaterSurface){
 return {waterColor:{value:new THREE.Color(water.color)},waterTime:cityUniforms.time,waterDaylight:cityUniforms.daylight,waterSun:cityUniforms.sun,waterHorizon:{value:new THREE.Vector3(...water.horizon)},waterZenith:{value:new THREE.Vector3(...water.zenith)},waterDeep:{value:new THREE.Vector3(...water.deep)},waterRipple:{value:water.ripple}};
}
/** Shared ripple/Fresnel/glint stage; expects waterMask, waterGlint and streetPosition in scope. */
function injectWaterShading(shader:{fragmentShader:string}):void {
   shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   if(waterMask>0.0){
    vec3 upV=normalize((viewMatrix*vec4(0.0,1.0,0.0,0.0)).xyz),exV=normalize((viewMatrix*vec4(1.0,0.0,0.0,0.0)).xyz),ezV=normalize((viewMatrix*vec4(0.0,0.0,1.0,0.0)).xyz);
    vec2 slope=waterSlope(streetPosition,waterTime);
    // Ripples flatten with distance (texel footprint) to avoid shimmering on mobile resolutions.
    float rippleFade=1.0-smoothstep(.4,3.0,length(fwidth(streetPosition)));
    vec3 waterNormal=normalize(upV-(exV*slope.x+ezV*slope.y)*waterRipple*rippleFade);
    normal=normalize(mix(normal,waterNormal,waterMask));
    vec3 viewDir=normalize(vViewPosition);
    float facing=clamp(dot(waterNormal,viewDir),0.0,1.0);
    float fresnel=.06+.94*pow(1.0-facing,5.0);
    vec3 reflected=reflect(-viewDir,waterNormal);
    vec3 skyTone=mix(waterHorizon,waterZenith,smoothstep(0.0,.75,dot(reflected,upV)))*mix(.18,1.0,waterDaylight);
    vec3 deep=mix(diffuseColor.rgb*.45,waterDeep,.75);
    diffuseColor.rgb=mix(diffuseColor.rgb,mix(deep,skyTone*.62,clamp(fresnel*1.15+.12,0.0,1.0)),waterMask);
    vec3 sunV=normalize((viewMatrix*vec4(waterSun,0.0)).xyz);
    float glint=pow(max(dot(reflected,sunV),0.0),220.0)*3.2+pow(max(dot(reflected,sunV),0.0),28.0)*.12;
    waterGlint=vec3(1.0,.95,.84)*glint*waterMask*waterDaylight*smoothstep(0.0,.12,waterSun.y);
   }
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>','gl_FragColor.rgb+=waterGlint;\n#include <tonemapping_fragment>');
 }
/**
 * Standalone water surfaces (regional detail seas/ponds drawn as their own meshes, e.g. Busan coast).
 * Same shading as terrain water; the mesh colour is the water body. Rebound by name after worker transfer.
 */
export function waterMaterial(originX:number,originZ:number,water:WaterSurface):THREE.MeshStandardMaterial {
 const material=new THREE.MeshStandardMaterial({color:water.color,roughness:.6,metalness:0});
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,waterUniforms(water),{streetOrigin:{value:new THREE.Vector2(originX,originZ)}});
  shader.vertexShader='uniform vec2 streetOrigin; varying vec2 streetPosition;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nstreetPosition=(modelMatrix*vec4(position,1.0)).xz+streetOrigin;');
  shader.fragmentShader='varying vec2 streetPosition;\n'+WATER_UNIFORMS_GLSL+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n float waterMask=1.0;vec3 waterGlint=vec3(0.0);');
  injectWaterShading(shader);
 };
 material.customProgramCacheKey=()=> 'detail-water-surface-v1';
 material.userData.paintedOwned=true;
 return material;
}

/** Color-map classification avoids another per-chunk mask texture. Detail is in world metres. */
export function streetMaterial(map:THREE.Texture, originX:number, originZ:number,colors:CityAppearance['street']=STREET,water?:WaterSurface):THREE.MeshStandardMaterial {
 const waterColor=water?.color;
 const STREET=colors;
 const material=new THREE.MeshStandardMaterial({map,roughness:.97,metalness:0});
 material.onBeforeCompile=shader=>{
  if(water)Object.assign(shader.uniforms,waterUniforms(water));
  shader.uniforms.roadWear={value:STREET.wearStrength??0};
  shader.uniforms.streetOrigin={value:new THREE.Vector2(originX,originZ)};
  shader.uniforms.asphaltColor={value:new THREE.Color(STREET.asphalt)};
  shader.uniforms.pavementColor={value:new THREE.Color(STREET.pavement)};
  shader.vertexShader='uniform vec2 streetOrigin; varying vec2 streetPosition;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nstreetPosition=position.xz+streetOrigin;');
  shader.fragmentShader='uniform float roadWear; uniform vec3 asphaltColor; uniform vec3 pavementColor; varying vec2 streetPosition;\n'+(water?WATER_UNIFORMS_GLSL:'')+STREET_MATERIAL_DETAIL_GLSL+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    ${waterColor?'float waterMask=1.0-smoothstep(.035,.09,distance(diffuseColor.rgb,waterColor));vec3 waterGlint=vec3(0.0);':''}
    float roadSurface=1.0-smoothstep(.008,.025,distance(diffuseColor.rgb,asphaltColor));
    float walkSurface=1.0-smoothstep(.012,.045,distance(diffuseColor.rgb,pavementColor));
    diffuseColor.rgb=streetMaterialDetail(diffuseColor.rgb,streetPosition,roadSurface,walkSurface,roadWear);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.88,walkSurface);');
  if(water)injectWaterShading(shader);
 };
 material.customProgramCacheKey=()=> waterColor?'street-surfaces-common-v2-water2':'street-surfaces-common-v2';
 return material;
}
