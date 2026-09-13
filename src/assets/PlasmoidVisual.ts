import * as THREE from 'three';

export type PlasmoidKind = 'base' | 'leech' | 'skeeter' | 'brander' | 'elite' | 'boss';
export type PlasmoidPose = 'idle' | 'charge' | 'attack' | 'recover';

/** Visual-only prototype: aura and appendages never define collision bounds. */
export class PlasmoidVisual extends THREE.Group {
  readonly hitRadius = 1;
  private readonly body = new THREE.Group();
  private readonly extras: THREE.Mesh[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly ring?: THREE.Group;
  private readonly ringSegments: THREE.Mesh<THREE.TorusGeometry, THREE.ShaderMaterial>[] = [];
  private lastTime = 0;
  private poseSince = 0;
  private lastPose: PlasmoidPose = 'idle';
  constructor(readonly kind: PlasmoidKind, color = '#62cfff') {
    super(); this.add(this.body);
    const make = (radius: number, opacity: number, core: boolean) => {
      const material = new THREE.ShaderMaterial({
        uniforms: { tint: {value: new THREE.Color(color)}, time: {value: 0}, strength: {value: opacity}, core: {value: core ? 1 : 0}, arc: {value: 0}, daylight: {value: 0}, feature: {value: 0} },
        transparent: true, depthWrite: false, side: THREE.FrontSide,
        vertexShader: `varying vec3 n; varying vec3 v; varying vec3 p; varying vec2 tex;
          void main(){tex=uv;p=position; vec4 mv=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
        fragmentShader: `uniform vec3 tint; uniform float time,strength,core,arc,daylight,feature; varying vec3 n,v,p; varying vec2 tex;
          void main(){float facing=max(0.,dot(normalize(n),normalize(v)));
          float flow=.5+.5*sin(p.y*9.+sin(p.x*8.+time)*1.4-time*2.);
          float fade=pow(smoothstep(0.,mix(.85,.55,daylight*feature),facing),mix(1.5,.75,daylight*feature));
          vec3 c=mix(tint,vec3(1.),core*.88+flow*.14);
          float pigment=daylight*(feature*.76+(1.-feature)*(1.-core)*.2);
          float luminance=dot(c,vec3(.2126,.7152,.0722));
          c=max(vec3(0.),mix(vec3(luminance),c,1.+daylight*.25))*(1.-pigment);
          c*=mix(1.,.7+.3*facing,daylight*feature);
          gl_FragColor=vec4(c,fade*strength*mix(1.,1.9,daylight*feature)*(.82+.18*flow)*mix(1.,smoothstep(0.,.2,tex.x)*smoothstep(0.,.2,1.-tex.x),arc));
          gl_FragColor.a=clamp(gl_FragColor.a,0.,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      });
      this.materials.push(material);
      return new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
    };
    this.body.add(make(1.42,.16,false),make(1.12,.38,false),make(.86,.8,false),make(.42,1,true));
    const append = (x:number,y:number,z:number,sx:number,sy:number,sz:number) => {
      const mesh=make(1,.65,false); mesh.material.uniforms.feature.value=1;mesh.userData.feature=true;mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);this.body.add(mesh);this.extras.push(mesh);
    };
    if(kind==='leech'||kind==='elite')for(const s of [-1,1])append(s*.6,0,1.1,.3,.32,.72);
    if(kind==='skeeter'||kind==='elite')for(let i=0;i<3;i++)append((i-1)*.92,(i%2)*.55,-1.65,.23,.23,1.7);
    if(kind==='brander') {
      this.ring=new THREE.Group();this.ring.rotation.x=.8;this.body.add(this.ring);
      for(let i=0;i<3;i++) {
        const template=make(1,.85,false),mat=template.material;template.geometry.dispose();
        mat.uniforms.arc.value=1;mat.uniforms.feature.value=1;
        const segment=new THREE.Mesh(new THREE.TorusGeometry(1.65,.14,12,40,Math.PI*.48),mat);
        segment.userData.feature=true;segment.rotation.z=i*Math.PI*2/3;this.ring.add(segment);this.ringSegments.push(segment);
      }
    }
    if(kind==='boss')for(let i=0;i<6;i++) {
      const a=i*Math.PI/3;append(Math.cos(a)*1.6,Math.sin(a)*1.6,0,.28,.28,.28);
    }
    if(kind==='boss')this.body.add(make(1.75,.065,false));
  }
  setLighting(daylight:number){for(const m of this.materials)m.uniforms.daylight.value=THREE.MathUtils.clamp(daylight,0,1);}
  setDistance(distance:number){
    // Bounded world-space widening preserves small role details without changing hit bounds.
    const width=1+THREE.MathUtils.smoothstep(distance,12,100)*.4;
    this.extras.forEach(mesh=>{const base=mesh.userData.baseScale??(mesh.userData.baseScale=mesh.scale.clone());mesh.scale.copy(base);mesh.scale.x*=width;mesh.scale.y*=width;});
  }
  setColor(color:string){for(const m of this.materials)m.uniforms.tint.value.set(color);}
  update(time:number,pose:PlasmoidPose, elapsed?:number,emphasis:'front'|'tail'|'both'='both'){
    const dt=Math.max(0,Math.min(time-this.lastTime,.1));this.lastTime=time;
    if(pose!==this.lastPose){this.poseSince=time;this.lastPose=pose;}
    const age=elapsed??time-this.poseSince;
    for(const m of this.materials)m.uniforms.time.value=time;
    const pulse=1+Math.sin(time*2.8)*.025;
    const compression=pose==='charge'?.84:pose==='attack'?1.1:1;
    this.body.scale.setScalar(pulse*compression);
    if(this.kind==='leech')this.body.scale.y*=.83;
    this.body.position.y=Math.sin(time*1.8)*.055;
    this.body.position.z=pose==='attack' && (this.kind==='leech'||this.kind==='elite') ? .3*Math.sin(time*5) : 0;
    this.visible=true;
    for(const m of this.materials)m.uniforms.core.value=0;
    // Preserve the white nucleus in normal flight.
    this.materials[3].uniforms.core.value=pose==='recover'?.4:1;
    if(this.ring){
      const blend=elapsed===undefined?1-Math.exp(-dt*7):1;
      this.ring.rotation.x+=((pose==='idle'?.8:0)-this.ring.rotation.x)*blend;
      if(pose==='idle')this.ring.rotation.z=elapsed===undefined?this.ring.rotation.z+dt*.3:time*.3;
      else this.ring.rotation.z+=(0-this.ring.rotation.z)*blend;
      // The selected attack pose loops a visual mark launch; gameplay owns real timing.
      const flight=pose==='attack'?(age%1.6)/1.6:0;
      this.ring.position.z+=( (pose==='attack'?.8+flight*2.5:pose==='charge'?.85:0)-this.ring.position.z)*blend;
      this.ring.scale.setScalar(pose==='charge'?.8:pose==='attack'?.8+flight*.15:1);
      this.ringSegments.forEach((segment,i)=>{
        const restored=THREE.MathUtils.smoothstep(age,i*.35,i*.35+.65);
        segment.material.uniforms.strength.value=pose==='recover'?.08+.77*restored:pose==='attack'?.95*(1-flight):.85;
      });
    }
    if(this.kind==='boss')this.extras.forEach((mesh,i)=>{
      const a=i*Math.PI*2/this.extras.length+time*.3;
      const r=pose==='charge'?1.4:pose==='attack'?1.95+(age%1.6)*.6:1.95;
      mesh.position.set(Math.cos(a)*r,Math.sin(a)*r,Math.sin(a+time*.2)*.25);
    });
    this.extras.forEach((mesh,i)=>{const mat=mesh.material as THREE.ShaderMaterial;mat.uniforms.strength.value=this.kind==='elite'&&emphasis!=='both'&&((i<2)!==(emphasis==='front'))?.28:pose==='recover'?.4:.72;mesh.rotation.y=Math.sin(time*2+i)* (pose==='charge'?.03:.12);});
  }
  dispose(){this.traverse(n=>{if(n instanceof THREE.Mesh)n.geometry.dispose();});for(const m of this.materials)m.dispose();}
}
