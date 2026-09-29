import {streetSidewalk} from './streetSection.mjs';
import type {Ring} from './MapData';
import {solveRoadNetwork} from './RoadNetwork';
import {roadPaintCorners,planRoadMarkings} from './RoadMarkings';
import {STREET_MATERIAL_DETAIL_GLSL} from './StreetMaterialDetail';
import {defaultAppearance,type CityAppearance} from './cities';
import * as THREE from 'three';

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

/** Color-map classification avoids another per-chunk mask texture. Detail is in world metres. */
export function streetMaterial(map:THREE.Texture, originX:number, originZ:number,colors:CityAppearance['street']=STREET):THREE.MeshStandardMaterial {
 const STREET=colors;
 const material=new THREE.MeshStandardMaterial({map,roughness:.97,metalness:0});
 material.onBeforeCompile=shader=>{
  shader.uniforms.roadWear={value:STREET.wearStrength??0};
  shader.uniforms.streetOrigin={value:new THREE.Vector2(originX,originZ)};
  shader.uniforms.asphaltColor={value:new THREE.Color(STREET.asphalt)};
  shader.uniforms.pavementColor={value:new THREE.Color(STREET.pavement)};
  shader.vertexShader='uniform vec2 streetOrigin; varying vec2 streetPosition;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nstreetPosition=position.xz+streetOrigin;');
  shader.fragmentShader='uniform float roadWear; uniform vec3 asphaltColor; uniform vec3 pavementColor; varying vec2 streetPosition;\n'+STREET_MATERIAL_DETAIL_GLSL+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    float roadSurface=1.0-smoothstep(.008,.025,distance(diffuseColor.rgb,asphaltColor));
    float walkSurface=1.0-smoothstep(.012,.045,distance(diffuseColor.rgb,pavementColor));
    diffuseColor.rgb=streetMaterialDetail(diffuseColor.rgb,streetPosition,roadSurface,walkSurface,roadWear);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.88,walkSurface);');
 };
 material.customProgramCacheKey=()=> 'street-surfaces-common-v2';
 return material;
}
