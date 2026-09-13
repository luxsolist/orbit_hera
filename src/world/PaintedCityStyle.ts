import * as THREE from 'three';
/** Clone city materials, leaving shared source materials untouched. */
export function applyPaintedMaterials(group:THREE.Group):void {
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
    shader.vertexShader='varying vec3 paintedPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npaintedPosition=position;');
    shader.fragmentShader='uniform float cityNight; varying vec3 paintedPosition;\n'+shader.fragmentShader;
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
      float room=fract(sin(dot(floor(fPosition/vec3(3.0,3.0,3.0)),vec3(12.9898,78.233,37.719))+fVariant*113.0)*43758.5453);
      totalEmissiveRadiance+=vec3(1.0,.68,.29)*glazing*step(.64,room)*cityNight*1.5;
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
     outgoingLight=mix(outgoingLight,outgoingLight*vec3(.22,.30,.48)+totalEmissiveRadiance*.9,cityNight);
     #include <opaque_fragment>
    `);
   };
   material.customProgramCacheKey=()=>key+'-painted-reference-defined-v4';
   return material;
  };
  const previous=object.onBeforeRender;
  object.onBeforeRender=function(renderer,scene,camera,geometry,material,group){night.value=scene.userData.cityNight??0;previous.call(this,renderer,scene,camera,geometry,material,group);};
  object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
 });
}
export function addPaintedSky(scene:THREE.Scene):THREE.Mesh {
 const sky=new THREE.Mesh(new THREE.SphereGeometry(2200,32,16),new THREE.ShaderMaterial({
 side:THREE.BackSide,depthWrite:false,uniforms:{daylight:{value:1},twilight:{value:0}},
 vertexShader:'varying vec3 skyDirection;void main(){skyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
 fragmentShader:`uniform float daylight;uniform float twilight;varying vec3 skyDirection;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 void main(){vec3 d=normalize(skyDirection);float h=max(0.0,d.y);
 vec3 sky=mix(vec3(.65,.80,.94),vec3(.20,.48,.83),smoothstep(0.0,.8,h));
 vec2 uv=d.xz/(h+.24)*2.5;float n=noise(uv)*.50+noise(uv*2.1)*.25+noise(uv*4.0)*.14+noise(uv*9.0)*.075+noise(uv*19.0)*.035;
 float clouds=smoothstep(.50,.64,n)*smoothstep(.02,.17,h);
 sky=mix(sky,vec3(1.12,1.06,.92),clouds*.85);sky=mix(vec3(.025,.045,.095),sky,daylight);sky=mix(sky,vec3(.66,.30,.20),twilight*(1.0-smoothstep(0.0,.5,h))*.6);gl_FragColor=vec4(sky,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`
 }));sky.frustumCulled=false;sky.name='painted-sky';
 sky.onBeforeRender=(_renderer,_scene,camera)=>{sky.material.uniforms.daylight.value=_scene.userData.cityDaylight??1;sky.material.uniforms.twilight.value=_scene.userData.cityTwilight??0;sky.position.copy(camera.position);sky.updateMatrixWorld();};
 scene.add(sky);return sky;
}
