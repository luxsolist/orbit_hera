import {cityNightSky,defaultCityNight} from './cities/night';
import type {CityNightSettings} from './cities/types';
import type {PaintedSkyColors} from './cities/types';
import * as THREE from 'three';
/** Clone city materials, leaving shared source materials untouched. */
export function applyPaintedMaterials(group:THREE.Group,settings:CityNightSettings=defaultCityNight):void {
 const night={value:0};
 const copies=new Map<THREE.Material,THREE.Material>();
 group.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  const convert=(source:THREE.Material)=>{
   const cached=copies.get(source);if(cached)return cached;
   if(!(source instanceof THREE.MeshStandardMaterial))return source;
   const material=source.clone();copies.set(source,material);
   material.userData.paintedOwned=true;
   if(source.map)source.dispose(); // Chunk-owned terrain material; texture transfers to the clone.
   material.roughness=1;material.metalness=0;
   const compile=source.onBeforeCompile.bind(source),key=source.customProgramCacheKey();
   material.onBeforeCompile=(shader,renderer)=>{
    compile(shader,renderer);
    shader.uniforms.cityNight=night;
    Object.assign(shader.uniforms,{
     nightOccupancy:{value:new THREE.Vector4(...settings.occupancy)},
     nightWarm:{value:new THREE.Color(settings.windowColors[0])},nightCool:{value:new THREE.Color(settings.windowColors[1])},
     nightWindow:{value:new THREE.Vector4(settings.coolShare,settings.windowIntensity,...settings.brightnessRange)},
     nightShopOccupancy:{value:settings.shopOccupancy},nightTint:{value:new THREE.Vector3(...settings.surfaceTint)}
    });
    shader.vertexShader='varying vec3 paintedPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npaintedPosition=position;');
    shader.fragmentShader='uniform vec4 nightOccupancy; uniform vec3 nightWarm; uniform vec3 nightCool; uniform vec4 nightWindow; uniform float nightShopOccupancy; uniform vec3 nightTint; uniform float cityNight; varying vec3 paintedPosition;\n'+shader.fragmentShader;
    if(source.map)shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
     if(diffuseColor.g>diffuseColor.r*1.12 && diffuseColor.g>diffuseColor.b*1.08){
      float groundValue=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.27,.34,.17)*clamp(groundValue/.30,.7,1.2),.85);
     }
    `);
    // Remove photographic masonry grain and normal-map relief in this art-direction study.
    shader.fragmentShader=shader.fragmentShader.replace('vec3 painted=diffuseColor.rgb*relief;','vec3 painted=diffuseColor.rgb;').replace('roofRelief*(1.0-seam*.07)','(1.0-seam*.025)').replace('(1.0-glazing)*.65','0.0').replace('painted*.82','painted*.46')
     .replace('mix(.60,.85,fVariant)','mix(.78,.94,fVariant)')
     .replace('floorBand*.035','floorBand*.055');
    const isFacade=shader.fragmentShader.includes('float glazing=0.0;');
    if(isFacade)shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float seed=fVariant*113.0+fFace*19.0;
      float room=fract(sin(dot(nightCell,vec2(12.9898,78.233))+seed)*43758.5453);
      float building=fract(sin(fVariant*719.0)*43758.5453);
      float occupied=fKind<.5?nightOccupancy.x:fKind<1.5?nightOccupancy.y:fKind<2.5?nightOccupancy.z:nightOccupancy.w;
      occupied=clamp(occupied*mix(.55,1.45,building),0.0,1.0);
      occupied=mix(occupied,nightShopOccupancy,step(.01,nightShop));
      float lit=mix(step(1.0-occupied,room),occupied,nightUnresolved);
      float tintPick=fract(sin(dot(nightCell,vec2(39.346,11.135))+seed)*27183.17);
      vec3 lamp=mix(nightWarm,nightCool,mix(step(1.0-nightWindow.x,tintPick),nightWindow.x,nightUnresolved));
      float strength=fract(sin(dot(nightCell,vec2(73.156,52.235))+seed)*19341.7);
      strength=mix(nightWindow.z,nightWindow.w,mix(strength*strength,1.0/3.0,nightUnresolved));
      totalEmissiveRadiance+=lamp*nightGlazing*lit*cityNight*nightWindow.y*strength;

    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
     float luminance=dot(outgoingLight,vec3(.2126,.7152,.0722));
     float paintBase=max(.08,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
     float illumination=luminance/paintBase;
     // Preserve bright sunlit paint while separating cool shaded faces into a distinct value band.
     float level=.53+.42*smoothstep(.32,.52,illumination)+.63*smoothstep(.72,1.04,illumination);
     vec3 tint=mix(vec3(.80,.91,1.08),vec3(1.07,1.035,.94),smoothstep(.35,1.15,illumination));
     float wash=sin(paintedPosition.x*.18+sin(paintedPosition.z*.29))*sin(paintedPosition.y*.35+paintedPosition.z*.12);
     vec3 clearPaint=diffuseColor.rgb*level*tint;
     float clearValue=dot(clearPaint,vec3(.2126,.7152,.0722));
     clearPaint=max(vec3(0.0),mix(vec3(clearValue),clearPaint,1.14));
     outgoingLight=mix(outgoingLight,clearPaint,.90)*(1.0+wash*.012);
     outgoingLight=mix(outgoingLight,outgoingLight*nightTint+totalEmissiveRadiance*.9,cityNight);
     #include <opaque_fragment>
    `);
   };
   material.customProgramCacheKey=()=>key+'-painted-city-night-v6';
   return material;
  };
  const previous=object.onBeforeRender;
  object.onBeforeRender=function(renderer,scene,camera,geometry,material,group){night.value=scene.userData.cityNight??0;previous.call(this,renderer,scene,camera,geometry,material,group);};
  object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
 });
}
export function addPaintedSky(scene:THREE.Scene,colors?:PaintedSkyColors,settings:CityNightSettings=defaultCityNight):THREE.Mesh {
 const nightColors=cityNightSky(settings);
 const sky=new THREE.Mesh(new THREE.SphereGeometry(2200,32,16),new THREE.ShaderMaterial({
 side:THREE.BackSide,depthWrite:false,uniforms:{nightZenith:{value:nightColors.zenith},nightHorizon:{value:nightColors.horizon},daylight:{value:1},twilight:{value:0},horizon:{value:new THREE.Vector3(...(colors?.horizon??[.65,.80,.94]))},zenith:{value:new THREE.Vector3(...(colors?.zenith??[.20,.48,.83]))}},
 vertexShader:'varying vec3 skyDirection;void main(){skyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
 fragmentShader:`uniform vec3 horizon;uniform vec3 zenith;uniform vec3 nightZenith;uniform vec3 nightHorizon;uniform float daylight;uniform float twilight;varying vec3 skyDirection;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 void main(){vec3 d=normalize(skyDirection);float h=max(0.0,d.y);
 vec3 sky=mix(horizon,zenith,smoothstep(0.0,.8,h));
 vec2 uv=d.xz/(h+.24)*2.5;float n=noise(uv)*.50+noise(uv*2.1)*.25+noise(uv*4.0)*.14+noise(uv*9.0)*.075+noise(uv*19.0)*.035;
 float clouds=smoothstep(.50,.64,n)*smoothstep(.02,.17,h);
 sky=mix(sky,vec3(1.12,1.06,.92),clouds*.85);vec3 nightSky=mix(nightHorizon,nightZenith,smoothstep(0.0,.65,h));sky=mix(nightSky,sky,daylight);sky=mix(sky,vec3(.66,.30,.20),twilight*(1.0-smoothstep(0.0,.5,h))*.6);gl_FragColor=vec4(sky,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 // Dither after tone mapping / output conversion: one output code step,
 // shared by RGB to avoid colored speckles, fixed in screen space to avoid flicker.
 float skyDither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
 gl_FragColor.rgb=clamp(gl_FragColor.rgb+vec3(skyDither/255.0),0.0,1.0);
 }`
 }));sky.frustumCulled=false;sky.name='painted-sky';
 sky.onBeforeRender=(_renderer,_scene,camera)=>{sky.material.uniforms.daylight.value=_scene.userData.cityDaylight??1;sky.material.uniforms.twilight.value=_scene.userData.cityTwilight??0;sky.position.copy(camera.position);sky.updateMatrixWorld();};
 scene.add(sky);return sky;
}
