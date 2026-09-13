import * as THREE from 'three';
import {citySurfaceMaps} from './CitySurfaceMaps';
import {seoulAppearance,type CityAppearance} from './cities';

/** Visual archetypes inferred from dimensions, not authoritative building-use data. */
export function facadeStyle(height: number, area: number, profile:CityAppearance=seoulAppearance): number {
  if (height >= profile.buildings.officeHeight) return 2; // office curtain wall
  if (height >= profile.buildings.apartmentHeight) return 1; // apartment
  if (area >= profile.buildings.industrialArea) return 3; // industrial
  return 0; // low-rise masonry
}
export const FACADE_COLORS=seoulAppearance.buildings.colors;
export const ROOF_COLORS=seoulAppearance.buildings.roofs;
function locationHash(x:number,z:number):number {
  let hash = Math.imul(Math.round(x * 10), 0x45d9f3b) ^ Math.imul(Math.round(z * 10), 0x27d4eb2d);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  return (hash ^ (hash >>> 13)) >>> 0;
}
export function facadeVariant(x:number,z:number):number { return (locationHash(x,z)>>>12)/1048576; }

/** Absolute footprint centroid: stable across reloads, build order and floating origins. */
export function facadeColor(x: number, z: number, profile:CityAppearance=seoulAppearance): number {
  const FACADE_COLORS=profile.buildings.colors,FACADE_WEIGHTS=profile.buildings.weights;
  let pick=locationHash(x,z)%FACADE_WEIGHTS.reduce((a,b)=>a+b,0);
  for(let i=0;i<FACADE_WEIGHTS.length;i++){
    if(pick<FACADE_WEIGHTS[i])return FACADE_COLORS[i];
    pick-=FACADE_WEIGHTS[i];
  }
  return FACADE_COLORS[0];
}
/** Roof vertex colors remain editable by combat damage/collapse, independently of wall paint. */
export function applyRoofColor(geometry:THREE.BufferGeometry,x:number,z:number,profile:CityAppearance=seoulAppearance):void {
  const ROOF_COLORS=profile.buildings.roofs;
  const faces=geometry.getAttribute('facadeFace'),kinds=geometry.getAttribute('facadeKind');
  const colors=geometry.getAttribute('color');
  const roof=new THREE.Color(ROOF_COLORS[(locationHash(x,z)>>>8)%ROOF_COLORS.length]);
  for(let i=0;i<colors.count;i++)if(kinds.getX(i)>=0&&faces.getX(i)===2)colors.setXYZ(i,roof.r,roof.g,roof.b);
}

/** Add facade coordinates to the existing shell without rooftop ornaments. */
export function dressBuilding(geometry: THREE.BufferGeometry, poly: number[], base: number, style: number, variant = 0): THREE.BufferGeometry {
  const geo=geometry;
  let x=0,z=0;for(let i=0;i<poly.length;i+=2){x+=poly[i];z+=poly[i+1];}x/=poly.length/2;z/=poly.length/2;
  const pos=geo.getAttribute('position'),normal=geo.getAttribute('normal');
  const coords=new Float32Array(pos.count*3),kinds=new Float32Array(pos.count),faces=new Float32Array(pos.count);
  for(let i=0;i<pos.count;i++){
    coords[i*3]=pos.getX(i)-x;coords[i*3+1]=pos.getY(i)-base;coords[i*3+2]=pos.getZ(i)-z;
    kinds[i]=style;faces[i]=Math.abs(normal.getY(i))>.5?2:Math.abs(normal.getX(i))>.5?0:1;
  }
  geo.setAttribute('facadePosition',new THREE.BufferAttribute(coords,3));
  geo.setAttribute('facadeKind',new THREE.BufferAttribute(kinds,1));
  geo.setAttribute('facadeFace',new THREE.BufferAttribute(faces,1));
  geo.setAttribute('facadeVariant',new THREE.BufferAttribute(new Float32Array(pos.count).fill(variant),1));
  return geo;
}

/** Shared material and surface textures; no per-window meshes or extra draw calls. */
export function createFacadeMaterial(profile:CityAppearance=seoulAppearance): THREE.MeshStandardMaterial {
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0,flatShading:true});
 material.onBeforeCompile=shader=>{
  shader.uniforms.cityDetail={value:new THREE.Vector3(profile.buildings.windowContrast,profile.buildings.windowSpacing,profile.buildings.architectureStrength)};
  const maps=citySurfaceMaps(profile.buildings.texturePath);
  for(const [name,texture] of Object.entries(maps))shader.uniforms[name]={value:texture};
  shader.vertexShader='attribute vec3 facadePosition; attribute float facadeKind; attribute float facadeFace; attribute float facadeVariant; varying float fVariant; varying vec3 fPosition; varying float fKind; varying float fFace;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nfPosition=facadePosition; fKind=facadeKind; fFace=facadeFace; fVariant=facadeVariant;');
  shader.fragmentShader=Object.keys(maps).map(name=>`uniform sampler2D ${name};`).join('\n')+'\n'+'uniform vec3 cityDetail; varying float fVariant; varying vec3 fPosition; varying float fKind; varying float fFace;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    float glazing=0.0;
    vec2 surfaceUv=(fFace>1.5?fPosition.xz:vec2(fFace<.5?fPosition.z:fPosition.x,fPosition.y))/4.0;
    if(fFace<1.5 && fKind<.5)surfaceUv=vec2(fFace<.5?fPosition.z:fPosition.x,fPosition.y)/vec2(1.92,1.76);
    vec3 surfaceColor=vec3(1.0),surfaceNormal=vec3(0.0,0.0,1.0);
    float surfaceRough=.85;
    if(fKind>=0.0 && fFace<2.5){
      if(fFace>1.5){surfaceColor=texture2D(roofcolor,surfaceUv).rgb;surfaceNormal=texture2D(roofnormal,surfaceUv).rgb*2.0-1.0;surfaceRough=texture2D(roofroughness,surfaceUv).r;}
      else if(fKind<.5){surfaceColor=texture2D(brickcolor,surfaceUv).rgb;surfaceNormal=texture2D(bricknormal,surfaceUv).rgb*2.0-1.0;surfaceRough=texture2D(brickroughness,surfaceUv).r;}
      else {surfaceColor=texture2D(concretecolor,surfaceUv).rgb;surfaceNormal=texture2D(concretenormal,surfaceUv).rgb*2.0-1.0;surfaceRough=texture2D(concreteroughness,surfaceUv).r;}
    }
    if(fKind>=0.0){
      if(fFace>2.5){ diffuseColor.rgb*=vec3(.38,.42,.43); }
      else if(fFace>1.5){
        vec2 roof=fPosition.xz/2.4;
        vec2 edge=abs(fract(roof)-.5);
        vec2 aa=max(fwidth(roof),vec2(.002));
        float seam=max(smoothstep(.47-aa.x,.47+aa.x,edge.x),smoothstep(.47-aa.y,.47+aa.y,edge.y));
        // Roof paint is already a separate vertex color. Only retain texture relief.
        float roofRelief=clamp(dot(surfaceColor,vec3(.2126,.7152,.0722))/.123,.88,1.12);
        diffuseColor.rgb*=roofRelief*(1.0-seam*.07);
      }else{
        float industrial=step(2.5,fKind),office=step(1.5,fKind)*(1.0-industrial);
        float pitch=mix(3.1,1.7,office);pitch=mix(pitch,4.5,industrial);
        pitch*=mix(.88,1.18,fVariant)*cityDetail.y;
        vec2 grid=vec2(fFace<.5?fPosition.z:fPosition.x,fPosition.y)/vec2(pitch,mix(3.2,4.2,industrial)*mix(.94,1.08,fract(fVariant*7.0)));
        grid.x+=fVariant;
        vec2 cell=abs(fract(grid)-.5),aa=max(fwidth(grid),vec2(.002));
        vec2 limit=mix(vec2(.30,.31),vec2(.43,.42),office);limit=mix(limit,vec2(.35,.16),industrial);
        limit*=vec2(mix(.8,1.0,fract(fVariant*11.0)),mix(.82,1.0,fract(fVariant*17.0)));
        vec2 windowMask=1.0-smoothstep(limit-aa,limit+aa,cell);
        float detail=1.0-smoothstep(.25,.65,max(aa.x,aa.y));
        glazing=windowMask.x*windowMask.y*detail*step(1.4,fPosition.y);
        float variation=fract(sin(dot(floor(grid),vec2(12.9898,78.233)))*43758.5453);
        vec3 glass=mix(vec3(.23,.32,.38),vec3(.42,.51,.56),variation*.5);
        // Preserve sampled paint hue: texture supplies relative luminance, not a second paint color.
        float referenceLuma=fKind<.5?.126:.502;
        float relief=clamp(dot(surfaceColor,vec3(.2126,.7152,.0722))/referenceLuma,.78,1.18);
        vec3 painted=diffuseColor.rgb*relief;
        // Low-contrast glazing: read as facade material instead of a repeated dark grid.
        vec3 tintedGlass=mix(painted*.82,glass,.12);
        tintedGlass=mix(painted,tintedGlass,mix(.60,.85,fVariant));
        float distanceSoftening=1.0-smoothstep(.03,.22,max(aa.x,aa.y));
        diffuseColor.rgb=mix(painted,tintedGlass,clamp(glazing*mix(.3,1.0,distanceSoftening)*cityDetail.x,0.0,1.0));
        float floorBand=smoothstep(.46-aa.y,.46+aa.y,cell.y)*detail;
        diffuseColor.rgb*=1.0-floorBand*.035;
        float baseShade=mix(.9,1.0,smoothstep(0.0,2.5,fPosition.y));
        diffuseColor.rgb*=baseShade;
        // Larger architectural divisions distinguish building use without dark window grids.
        float wallX=fFace<.5?fPosition.z:fPosition.x;
        float apartment=step(.5,fKind)*(1.0-step(1.5,fKind));
        float lowrise=1.0-step(.5,fKind);
        float facadeFade=(1.0-smoothstep(.15,.8,max(fwidth(wallX),fwidth(fPosition.y))))*cityDetail.z;
        float bay=fract(wallX/mix(7.0,11.0,fVariant)+fVariant);
        float bayAA=max(fwidth(bay),.002);
        float pier=1.0-smoothstep(.07-bayAA,.07+bayAA,abs(bay-.5));
        diffuseColor.rgb*=1.0+apartment*pier*.075*facadeFade;
        float officeBand=fract(fPosition.y/mix(10.0,15.0,fVariant));
        float bandAA=max(fwidth(officeBand),.002);
        float belt=1.0-smoothstep(.025-bandAA,.025+bandAA,abs(officeBand-.5));
        diffuseColor.rgb*=1.0-office*belt*.045*facadeFade;
        float groundFloor=(1.0-smoothstep(2.8,3.05,fPosition.y))*step(.12,fPosition.y)*facadeFade;
        float front=step(.5,fFace);
        float shops=lowrise*step(.35,fVariant)*front;
        float shopBay=abs(fract(wallX/mix(3.8,5.2,fVariant)+fVariant)-.5);
        float shopAA=max(fwidth(shopBay),.002);
        float opening=1.0-smoothstep(.35-shopAA,.35+shopAA,shopBay);
        float shopMask=shops*groundFloor*opening;
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.7+vec3(.025,.032,.035),shopMask*.65);
        // A narrow, subdued fascia, with no repeated logos or bright signs.
        float fascia=(1.0-smoothstep(.11,.18,abs(fPosition.y-3.15)))*shops*facadeFade;
        diffuseColor.rgb*=1.0-fascia*.12;
        float door=(1.0-smoothstep(.5,.65,abs(wallX)))*(1.0-smoothstep(2.15,2.3,fPosition.y));
        float entry=door*front*groundFloor*(1.0-shops)*(1.0-industrial);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.72,entry);
        float loadingDoor=industrial*groundFloor*opening*front;
        diffuseColor.rgb*=1.0-loadingDoor*.14;
        glazing=max(glazing,shopMask);

      }
    }
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(fKind>=0.0?surfaceRough:roughnessFactor,.5,glazing);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    vec3 dpX=dFdx(-vViewPosition),dpY=dFdy(-vViewPosition);
    vec2 duX=dFdx(surfaceUv),duY=dFdy(surfaceUv);
    float determinant=duX.x*duY.y-duX.y*duY.x;
    if(fKind>=0.0 && fFace<2.5 && abs(determinant)>0.0000001){
      vec3 tangent=normalize(dpX*duY.y-dpY*duX.y)*sign(determinant);
      tangent=normalize(tangent-normal*dot(normal,tangent));
      vec3 bitangent=normalize(cross(normal,tangent))*sign(determinant);
      vec3 mapped=normalize(mat3(tangent,bitangent,normal)*surfaceNormal);
      normal=normalize(mix(normal,mapped,(1.0-glazing)*.65));
    }
  `);
 };
 material.customProgramCacheKey=()=> 'city-facades-architectural-v6';
 return material;
}
