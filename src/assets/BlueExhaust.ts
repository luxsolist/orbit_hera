import * as THREE from "three";

/** Shared outer blue haze, pale blue middle, and compact blue-white core. */
export const BLUE_EXHAUST_LAYERS=[
  [0x237eff,1,1,.13],
  [0x65baff,.67,.90,.20],
  [0xbceaff,.30,.72,.27],
] as const;

/** Open +Z plume: diameter tapers gently but never closes into a geometric point. */
export function createExhaustGeometry(radius:number,length:number):THREE.BufferGeometry {
  const positions:number[]=[],uv:number[]=[],indices:number[]=[],radial=24,rings=24;
  for(let j=0;j<=rings;j++){
    const t=j/rings,r=radius*(1-.55*t*t*(3-2*t));
    for(let i=0;i<=radial;i++){
      const angle=i/radial*Math.PI*2;positions.push(r*Math.cos(angle),r*Math.sin(angle),length*t);uv.push(i/radial,t);
      if(j<rings&&i<radial){const a=j*(radial+1)+i,b=a+radial+1;indices.push(a,a+1,b,a+1,b+1,b);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
export function createExhaustMaterial(color:number,opacity:number):THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms:{tint:{value:new THREE.Color(color)},opacity:{value:opacity}},
    vertexShader:`varying vec2 flameUv;varying vec3 viewNormal;varying vec3 viewPosition;
      void main(){flameUv=uv;viewNormal=normalMatrix*normal;vec4 p=modelViewMatrix*vec4(position,1.0);viewPosition=p.xyz;gl_Position=projectionMatrix*p;}`,
    fragmentShader:`uniform vec3 tint;uniform float opacity;varying vec2 flameUv;varying vec3 viewNormal;varying vec3 viewPosition;
      void main(){
        float t=flameUv.y;
        float edge=pow(abs(dot(normalize(viewNormal),normalize(-viewPosition))),0.65);
        float fade=pow(1.0-smoothstep(0.04,1.0,t),1.4)*smoothstep(0.0,0.025,t);
        vec3 gradient=mix(tint,vec3(0.015,0.12,0.8),smoothstep(0.0,0.9,t));
        gl_FragColor=vec4(gradient,opacity*edge*fade);
      }`,
    transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false
  });
}
