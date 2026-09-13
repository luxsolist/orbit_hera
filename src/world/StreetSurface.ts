import {defaultAppearance,type CityAppearance} from './cities';
import * as THREE from 'three';

export const STREET = defaultAppearance.street;
type Road = {p:number[];w?:number};
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
 const valid=roads.filter(r=>r.p.length>=4);
 ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
 // Paint all shoulders before any carriageways so junctions remain connected.
 for(const r of valid){const w=r.w??6;if(w>=6&&w<=24){stroke(r,w+5.2,STREET.curb);stroke(r,w+4.6,STREET.pavement);}}
 for(const r of valid)stroke(r,(r.w??6)+.45,STREET.curb);
 for(const r of valid)stroke(r,r.w??6,STREET.asphalt);
 ctx.lineCap='butt';
 for(const r of valid){
  const w=r.w??6;if(w<16)continue;
  stroke(r,.18,STREET.center,-.22);stroke(r,.18,STREET.center,.22);
  if(w>=22){ctx.setLineDash([4*scale,7*scale]);stroke(r,.18,STREET.marking,-3.5);stroke(r,.18,STREET.marking,3.5);ctx.setLineDash([]);}
 }
 ctx.restore();
}

/** Color-map classification avoids another per-chunk mask texture. Detail is in world metres. */
export function streetMaterial(map:THREE.Texture, originX:number, originZ:number,colors:CityAppearance['street']=STREET):THREE.MeshStandardMaterial {
 const STREET=colors;
 const material=new THREE.MeshStandardMaterial({map,roughness:.97,metalness:0});
 material.onBeforeCompile=shader=>{
  shader.uniforms.streetOrigin={value:new THREE.Vector2(originX,originZ)};
  shader.uniforms.asphaltColor={value:new THREE.Color(STREET.asphalt)};
  shader.uniforms.pavementColor={value:new THREE.Color(STREET.pavement)};
  shader.vertexShader='uniform vec2 streetOrigin; varying vec2 streetPosition;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nstreetPosition=position.xz+streetOrigin;');
  shader.fragmentShader='uniform vec3 asphaltColor; uniform vec3 pavementColor; varying vec2 streetPosition;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    float roadSurface=1.0-smoothstep(.008,.025,distance(diffuseColor.rgb,asphaltColor));
    float walkSurface=1.0-smoothstep(.012,.045,distance(diffuseColor.rgb,pavementColor));
    vec2 grainCoord=streetPosition*12.0;
    float grainFade=1.0-smoothstep(.3,1.0,max(fwidth(grainCoord.x),fwidth(grainCoord.y)));
    float grain=fract(sin(dot(floor(grainCoord),vec2(127.1,311.7)))*43758.5453)-.5;
    diffuseColor.rgb*=1.0+grain*.16*roadSurface*grainFade;
    vec2 tile=streetPosition/vec2(.6,.4),edge=abs(fract(tile)-.5),aa=max(fwidth(tile),vec2(.002));
    float tileFade=1.0-smoothstep(.3,.8,max(aa.x,aa.y));
    float joint=max(smoothstep(.475-aa.x,.475+aa.x,edge.x),smoothstep(.46-aa.y,.46+aa.y,edge.y));
    diffuseColor.rgb*=1.0-joint*.18*walkSurface*tileFade;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.88,walkSurface);');
 };
 material.customProgramCacheKey=()=> 'street-surfaces-v1';
 return material;
}
