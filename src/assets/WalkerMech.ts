import * as THREE from "three";
import { WalkerGarnish } from "./WalkerGarnish";
import { applyWalkerSkin, parseWalkerSkin, WALKER_SKIN_SLOTS, type WalkerSkin, type WalkerSkinSlot, type WalkerSkinMaterials } from "./WalkerSkin";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const WALKER_ASSET = {
  id: "android-01", version: 11, droneId: "walker",
  units: "metres", up: "+Y", forward: "+Z", origin: "ground-between-feet",
  cameraSocket: "socket_camera", muzzleSocket: "socket_muzzle", leftMuzzleSocket: "socket_muzzle_left",
} as const;

/** Calibrated to the visible proportions of the supplied three-quarter reference. */
export const WALKER_PROPORTIONS = {
  hipHeight: 2.07,
  hipHalfWidth: .74,
  upperLegLength: .92,
  lowerLegLength: 1.38,
  hullScale: [.88, .62, 1.1808] as const,
  legScale: [1.18, 1.15, 1.12] as const,
  footScale: [1.18, 1, 1.20] as const,
  weaponScale: [.94, .94, .94] as const,
} as const;

export interface WalkerPose {
  /** Continuous gait cycle in radians. Advance with distance travelled, not frame count. */
  phase?: number;
  walk?: number;
  /** Local-space foot travel; +Z is forward. Legacy clips default to forward. */
  travelX?: number;
  travelZ?: number;
  stride?: number;
  lift?: number;
  airborne?: number;
  dash?: number;
  /** Local foot offset for directional dash follow-through, in metres. */
  legTrailX?: number;
  legTrailZ?: number;
  /** Blended weapon-ready pose, 0..1. */
  aim?: number;
  aimYaw?: number;
  aimPitch?: number;
  crouch?: number;
}
export interface WalkerOptions {
  skin?: WalkerSkin;
  armorColor?: THREE.ColorRepresentation;
  trimColor?: THREE.ColorRepresentation;
  /** Omits small fasteners and radiator slats; same joints and proportions. */
  detail?: "high" | "medium";
}
type Leg = { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group };
type Arm = { shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group; mantle: THREE.Group };

/** Rigid articulated mecha. No intro dependencies, DOM, global caches or shared ownership. */
export class WalkerMech extends THREE.Group {
  readonly pelvis = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly head = new THREE.Group();
  readonly legs: Record<"left" | "right", Leg>;
  readonly arms: Record<"left" | "right", Arm>;
  readonly sockets: { camera: THREE.Object3D; muzzle: THREE.Object3D; leftMuzzle: THREE.Object3D; offHand: THREE.Object3D; back: THREE.Object3D; focus: THREE.Object3D };
  private geometries = new Set<THREE.BufferGeometry>();
  private materials: THREE.MeshStandardMaterial[];
  private roughness: THREE.DataTexture;
  private skinMaterials: WalkerSkinMaterials;
  private baseSkin: WalkerSkin;
  private garnish?: WalkerGarnish;
  private disposed = false;
  private pose: WalkerPose = {};

  constructor(options: WalkerOptions = {}) {
    super();
    const skin=options.skin?parseWalkerSkin(options.skin):undefined;
    this.name = "ED209_WALKER";
    this.userData.asset = { ...WALKER_ASSET };
    const fine = options.detail !== "medium";
    const pixels = new Uint8Array(128 * 128 * 4);
    let seed = 1729;
    for (let i = 0; i < pixels.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const v = 180 + ((seed >>> 24) % 38);
      pixels[i] = pixels[i + 1] = pixels[i + 2] = v; pixels[i + 3] = 255;
    }
    this.roughness = new THREE.DataTexture(pixels, 128, 128);
    this.roughness.wrapS = this.roughness.wrapT = THREE.RepeatWrapping;
    this.roughness.magFilter=THREE.LinearFilter;
    this.roughness.minFilter=THREE.LinearMipmapLinearFilter;
    this.roughness.generateMipmaps=true;
    this.roughness.needsUpdate = true;
    const armor = new THREE.MeshStandardMaterial({ color: options.armorColor ?? 0x68737b, roughness: .57, metalness: .48, roughnessMap: this.roughness });
    const trim = new THREE.MeshStandardMaterial({ color: options.trimColor ?? 0x68737b, roughness: .5, metalness: .38, roughnessMap: this.roughness });
    const frame = new THREE.MeshStandardMaterial({ color: 0x151e26, roughness: .58, metalness: .65 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x71858e, roughness: .3, metalness: .88 });
    const amber = new THREE.MeshStandardMaterial({ color: 0xd99135, roughness: .52, metalness: .35 });
    const sensor = new THREE.MeshStandardMaterial({ color: 0xea332b, emissive: 0xd9150d, emissiveIntensity: 1.4, roughness: .25, metalness: .25 });
    this.materials = [armor, trim, frame, steel, amber, sensor];
    this.skinMaterials={armor,trim,frame,steel,accent:amber,sensor};
    for(const slot of WALKER_SKIN_SLOTS){
      this.skinMaterials[slot].name="walker."+slot;
      this.skinMaterials[slot].userData.skinSlot=slot;
    }
    this.baseSkin={schemaVersion:1,modelId:"android-01",id:"base",name:"기본 골격 / 외피",description:"표면 장식 없는 기본형",materials:Object.fromEntries(WALKER_SKIN_SLOTS.map(slot=>{
      const m=this.skinMaterials[slot];return [slot,{color:"#"+m.color.getHexString(),roughness:m.roughness,metalness:m.metalness,emissive:"#"+m.emissive.getHexString(),emissiveIntensity:m.emissiveIntensity}];
    })) as WalkerSkin["materials"]};
    armor.roughnessMap=trim.roughnessMap=null;
    this.userData.skinId="base";

    const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: number[], name = "") => {
      this.geometries.add(geo);
      const m = new THREE.Mesh(geo, mat); m.position.fromArray(pos); m.name = name;
      m.castShadow = m.receiveShadow = true; parent.add(m); return m;
    };
    const block = (p: THREE.Object3D, mat: THREE.Material, size: number[], pos: number[], name = "") =>
      mesh(p, new RoundedBoxGeometry(size[0], size[1], size[2], 1, Math.min(...size) * .12), mat, pos, name);
    // Bevelled, tapered eight-sided armour instead of stacks of rounded cubes.
    const plate = (p: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, pos: number[], taper = .72) => {
      const shape = new THREE.Shape();
      shape.moveTo(-w * .38, h * .5); shape.lineTo(w * .38, h * .5);
      shape.lineTo(w * .5, h * .3); shape.lineTo(w * taper * .5, -h * .35);
      shape.lineTo(w * taper * .32, -h * .5); shape.lineTo(-w * taper * .32, -h * .5);
      shape.lineTo(-w * taper * .5, -h * .35); shape.lineTo(-w * .5, h * .3); shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .018, bevelThickness: .014, curveSegments: 1 });
      g.translate(0, 0, -d / 2);
      return mesh(p, g, mat, pos);
    };
    const cylinder = (p: THREE.Object3D, mat: THREE.Material, r: number, length: number, pos: number[], axis: "x" | "y" | "z" = "x") => {
      const m = mesh(p, new THREE.CylinderGeometry(r, r, length, fine ? 20 : 12), mat, pos);
      if (axis === "x") m.rotation.z = Math.PI / 2;
      if (axis === "z") m.rotation.x = Math.PI / 2;
      return m;
    };
    const socket = (p: THREE.Object3D, name: string, pos: number[]) => {
      const o = new THREE.Object3D(); o.name = "socket_" + name; o.position.fromArray(pos); p.add(o); return o;
    };
    const joint = (p: THREE.Object3D, name: string, pos: number[]) => {
      const o = new THREE.Group(); o.name = name; o.position.fromArray(pos); p.add(o); return o;
    };
    const loft=(parent:THREE.Object3D,mat:THREE.Material,stations:number[][],pos:number[])=>{
      const vertices:number[]=[],indices:number[]=[],uv:number[]=[];
      stations.forEach(([z,w,top,bottom],j)=>{
        const edge=Math.min(.10,(top-bottom)*.28,w*.25);
        const ring=[[-w*.72,top],[w*.72,top],[w,top-edge],[w,bottom+edge],[w*.64,bottom],[-w*.64,bottom],[-w,bottom+edge],[-w,top-edge]];
        ring.forEach(([x,y],i)=>{vertices.push(x,y,z);uv.push(i/8,j/(stations.length-1));});
        if(j)for(let i=0;i<8;i++){const a=(j-1)*8+i,b=(j-1)*8+(i+1)%8,c=j*8+i,d=j*8+(i+1)%8;indices.push(a,c,b,b,c,d);}
      });
      for(let i=1;i<7;i++){indices.push(0,i,i+1);const n=(stations.length-1)*8;indices.push(n,n+i+1,n+i);}
      const source=new THREE.BufferGeometry();source.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));source.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));source.setIndex(indices);
      const g=source.toNonIndexed();source.dispose();g.computeVertexNormals();return mesh(parent,g,mat,pos);
    };
    const strut=(parent:THREE.Object3D,mat:THREE.Material,r:number,a:number[],b:number[])=>{
      const start=new THREE.Vector3().fromArray(a),end=new THREE.Vector3().fromArray(b),delta=end.clone().sub(start);
      const m=cylinder(parent,mat,r,delta.length(),start.add(end).multiplyScalar(.5).toArray(),"y");
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;
    };
    this.pelvis.name="pelvis";this.pelvis.position.y=WALKER_PROPORTIONS.hipHeight;this.add(this.pelvis);
    this.torso.name="torso";this.torso.position.y=.54;this.pelvis.add(this.torso);
    // Fixed pelvic bridge carries the hips; the upper hull rotates just above it with no exposed bearing.
    block(this.pelvis,frame,[1.38,.30,.68],[0,0,0],"load_bearing_chassis");
    loft(this.pelvis,armor,[[-.43,.48,.17,-.16],[-.26,.65,.22,-.19],[.26,.65,.22,-.19],[.43,.48,.13,-.14]],[0,0,0]);
    // Low faceted waist housing closes the gap; its narrow central coupling nests inside the hull.
    loft(this.pelvis,armor,[[-.34,.27,.35,.19],[-.18,.43,.39,.19],[.18,.43,.39,.19],[.34,.27,.35,.19]],[0,0,0]);
    block(this.pelvis,frame,[.48,.12,.40],[0,.40,0],"recessed_waist_coupling");
    // Head and torso form one low, forward-projecting automotive armour shell.
    loft(this.torso,armor,[[-.94,.56,.45,-.04],[-.58,.89,.80,-.24],[.38,.86,.69,-.36],[1.12,.43,.24,-.12]],[0,.20,0]);
    loft(this.torso,frame,[[-.50,.63,.08,-.22],[.65,.56,-.05,-.40],[1.01,.35,-.16,-.32]],[0,0,0]);
    this.head.name="head";this.head.position.set(0,.24,1.16);this.torso.add(this.head);
    // Keep the camera/rig anchor, but the front hull has no face-like sensor assembly.
    for(const side of [-1,1]){
      cylinder(this.torso,steel,.11,.06,[side*.52,.06,-.76],"z");
      cylinder(this.torso,frame,.074,.075,[side*.52,.06,-.78],"z");
      const cable=new THREE.CatmullRomCurve3([new THREE.Vector3(side*.55,-.12,.53),new THREE.Vector3(side*.67,-.35,.45),new THREE.Vector3(side*.92,-.24,.28)]);
      mesh(this.torso,new THREE.TubeGeometry(cable,12,.026,6,false),frame,[0,0,0]);
      // Recessed shoulder launcher cells and service markings.

    }
    // Reverse knees: upper link folds back; long shin returns forward to broad single-piece feet.
    const makeLeg=(side:number):Leg=>{
      const name=side<0?"left":"right";
      const hip=joint(this.pelvis,name+"_hip",[side*WALKER_PROPORTIONS.hipHalfWidth,0,-.06]);
      cylinder(hip,frame,.23,.42,[0,0,0]);cylinder(hip,steel,.16,.45,[0,0,0]);
      cylinder(hip,frame,.10,.47,[0,0,0]);
      block(hip,frame,[.27,.59,.26],[0,-.36,0]);
      plate(hip,armor,.43,.59,.30,[0,-.34,.05],.74);
      for(const edge of [-1,1])cylinder(hip,steel,.033,.49,[edge*.18,-.35,-.10],"y");
      const knee=joint(hip,name+"_knee",[0,-.8,0]);
      cylinder(knee,steel,.18,.49,[0,0,0]);cylinder(knee,frame,.123,.52,[0,0,0]);
      // The raised spur exaggerates the distinctive backward hock silhouette.
      loft(knee,armor,[[-.20,.21,.16,-.10],[.16,.21,.08,-.12]],[0,.11,-.09]);
      block(knee,frame,[.24,.97,.23],[0,-.54,0]);
      plate(knee,armor,.46,1.04,.31,[0,-.60,.04],.60);
      for(const edge of [-1,1]){
        cylinder(knee,frame,.067,.75,[edge*.20,-.51,-.035],"y");
        cylinder(knee,steel,.038,.86,[edge*.20,-.68,-.035],"y");
      }
      const ankle=joint(knee,name+"_ankle",[0,-1.2,0]);
      cylinder(ankle,steel,.14,.43,[0,.01,0]);
      block(ankle,frame,[.48,.12,.38],[0,-.075,0],"foot_base");
      // A continuous tapered toe shell, with no central split or side guards.
      loft(ankle,armor,[[-.05,.32,.06,-.08],[.43,.34,.0,-.095],[.60,.29,-.025,-.095]],[0,-.025,0]);
      loft(ankle,armor,[[-.42,.18,-.015,-.10],[-.05,.22,.07,-.10]],[0,-.015,0]);
      return {hip,knee,ankle};
    };
    this.legs={left:makeLeg(-1),right:makeLeg(1)};
    const makeArm=(side:number):Arm=>{
      const name=side<0?"left":"right";
      const shoulder=joint(this.torso,name+"_shoulder",[side*1.02,.08,.02]);
      const mantle=joint(this.torso,name+"_pauldron",[side*1.02,.08,.02]);
      cylinder(mantle,frame,.18,.28,[side*.03,0,0]);
      cylinder(mantle,steel,.13,.31,[side*.03,0,0]);
      // Gun carriages replace human upper arms, forearms and hands.
      const elbow=joint(shoulder,name+"_elbow",[side*.13,-.12,.21]);
      const wrist=joint(elbow,name+"_wrist",[0,0,.73]);
      block(elbow,frame,[.38,.28,.79],[0,0,.31],"gun_receiver");
      loft(elbow,armor,[[-.22,.23,.20,-.12],[.38,.21,.19,-.13],[.65,.14,.11,-.10]],[0,.04,.07]);
      strut(mantle,steel,.033,[0,-.15,-.05],[side*.11,-.32,.46]);
      for(const barrelSide of [-1,1]){
        cylinder(elbow,frame,.068,.59,[barrelSide*.10,-.04,.88],"z");
        cylinder(elbow,steel,.038,.95,[barrelSide*.10,-.04,1.00],"z");
        for(const z of [.72,1.03,1.40])cylinder(elbow,frame,.055,.055,[barrelSide*.10,-.04,z],"z");
        cylinder(elbow,frame,.028,.965,[barrelSide*.10,-.04,1.012],"z");
      }
      block(elbow,armor,[.29,.17,.07],[0,-.04,1.29]);
      cylinder(elbow,sensor,.021,.02,[0,.10,.70],"z");
      return {shoulder,elbow,wrist,mantle};
    };
    this.arms={left:makeArm(-1),right:makeArm(1)};
    this.sockets={
      camera:socket(this.head,"camera",[0,.03,.085]),
      muzzle:socket(this.arms.right.elbow,"muzzle",[.10,-.04,1.51]),
      leftMuzzle:socket(this.arms.left.elbow,"muzzle_left",[-.10,-.04,1.51]),
      offHand:socket(this.arms.left.elbow,"offhand",[-.10,-.04,1.51]),
      back:socket(this.torso,"back",[0,.25,-.95]),
      focus:socket(this,"focus",[0,1.65,.1]),
    };
    // Batch rigid details per material under each joint. Articulation and sockets stay intact.
    this.batchRigidMeshes();
    // Bake proportions into geometry and pivot offsets, not non-uniform joint scales.
    // This preserves rigid gun articulation, world-space sockets and portable GLB clips.
    const hull=new THREE.Vector3(...WALKER_PROPORTIONS.hullScale);
    const legs=new THREE.Vector3(...WALKER_PROPORTIONS.legScale);
    const feet=new THREE.Vector3(...WALKER_PROPORTIONS.footScale);
    const weapons=new THREE.Vector3(...WALKER_PROPORTIONS.weaponScale);
    const footRoots=new Set<THREE.Object3D>([this.legs.left.ankle,this.legs.right.ankle]);
    const gunRoots=new Set<THREE.Object3D>(Object.values(this.arms).flatMap(a=>[a.shoulder,a.mantle]));
    const bake=(parent:THREE.Object3D,factor:THREE.Vector3):void=>{
      for(const child of parent.children){
        child.position.multiply(factor);
        if(child instanceof THREE.Mesh){
          child.geometry.scale(factor.x,factor.y,factor.z);
          child.geometry.computeBoundingBox();child.geometry.computeBoundingSphere();
        }else bake(child,footRoots.has(child)?feet:gunRoots.has(child)?weapons:factor);
      }
    };
    bake(this.torso,hull);
    for(const leg of Object.values(this.legs))bake(leg.hip,legs);
    this.setPose();
    if(skin)this.applySkin(skin);
  }

  /** Updates the existing materials, preserving geometry, rig, pose and texture ownership. */
  applySkin(definition: WalkerSkin): void {
    if(this.disposed)throw new Error("Cannot skin a disposed walker");
    const validated=parseWalkerSkin(definition);
    const next=new WalkerGarnish(this,validated.garnish??[],WALKER_PROPORTIONS.hullScale);
    const skin=applyWalkerSkin(this.skinMaterials,validated);
    this.garnish?.dispose();this.garnish=next;
    this.skinMaterials.armor.roughnessMap=this.skinMaterials.trim.roughnessMap=this.roughness;
    this.skinMaterials.armor.needsUpdate=this.skinMaterials.trim.needsUpdate=true;
    this.userData.skinId=skin.id;
  }

  /** Attachments borrow these materials; only WalkerMech disposes them. */
  clearSkin():void {
    if(this.disposed)throw new Error("Cannot clear a disposed walker");
    this.garnish?.dispose();this.garnish=undefined;applyWalkerSkin(this.skinMaterials,this.baseSkin);
    this.skinMaterials.armor.roughnessMap=this.skinMaterials.trim.roughnessMap=null;
    this.skinMaterials.armor.needsUpdate=this.skinMaterials.trim.needsUpdate=true;
    this.userData.skinId="base";
  }
  getSkinMaterial(slot:WalkerSkinSlot):THREE.MeshStandardMaterial {return this.skinMaterials[slot];}

  setPose(pose: WalkerPose = {}): void {
    this.pose={...pose};
    const phase=pose.phase??0, walk=THREE.MathUtils.clamp(pose.walk??0,0,1);
    const aim=THREE.MathUtils.clamp(pose.aim??0,0,1), crouch=THREE.MathUtils.clamp(pose.crouch??0,0,1);
    this.pelvis.position.y=WALKER_PROPORTIONS.hipHeight-crouch*.24+(pose.airborne??0)*.14;
    this.pelvis.rotation.y=Math.sin(phase)*.045*walk;
    this.torso.rotation.set(.04*walk+Math.sin(phase)*.007*(1-walk),THREE.MathUtils.clamp(pose.aimYaw??0,-.8,.8),-Math.sin(phase)*.035*walk);
    this.head.rotation.set(0,0,0);
    for(const [side,leg] of [[-1,this.legs.left],[1,this.legs.right]] as const){
      const p=phase+(side>0?Math.PI:0);
      const u=((p/(Math.PI*2))%1+1)%1;
      // Half a cycle in contact: linear foot speed exactly opposes root travel.
      const sweep=u<.5 ? 1-4*u : -1+4*(u-.5);
      const stride=pose.stride??.24;
      const x=sweep*stride*walk*(pose.travelX??0)+(pose.legTrailX??0);
      const z=sweep*stride*walk*(pose.travelZ??1)+.025+(pose.legTrailZ??0);
      const air=pose.airborne??0;
      const y=.14+(u>=.5?Math.sin((u-.5)*Math.PI*2):0)*(pose.lift??.10)*walk+air*.02-this.pelvis.position.y;
      const upper=WALKER_PROPORTIONS.upperLegLength,lower=WALKER_PROPORTIONS.lowerLegLength,d=Math.min(upper+lower-.001,Math.hypot(x,y,z));
      const knee=-Math.acos(THREE.MathUtils.clamp((d*d-upper*upper-lower*lower)/(2*upper*lower),-1,1));
      leg.hip.rotation.order="ZXY";
      leg.hip.rotation.set(Math.atan2(-z,Math.hypot(x,y))-Math.atan2(lower*Math.sin(knee),upper+lower*Math.cos(knee)),0,Math.atan2(x,-y));
      leg.knee.rotation.x=knee;
      leg.ankle.quaternion.copy(leg.hip.quaternion).multiply(leg.knee.quaternion).invert();
    }
    const pitch=THREE.MathUtils.clamp(pose.aimPitch??0,-.65,.65);
    for(const [side,arm] of [[-1,this.arms.left],[1,this.arms.right]] as const){
      arm.shoulder.rotation.set((1-aim)*.075-pitch,side*.018,0);
      arm.elbow.rotation.set(0,0,0);
      arm.mantle.rotation.set(0,0,0);
      arm.wrist.rotation.set(0,0,0);
    }
    this.updateMatrixWorld(true);
  }

  /** Portable node animation clips for GLB export and AnimationMixer consumers. */
  createAnimationClips():THREE.AnimationClip[]{
    const saved={...this.pose};
    const nodes=[this.pelvis,this.torso,this.head,...Object.values(this.legs).flatMap(l=>[l.hip,l.knee,l.ankle]),...Object.values(this.arms).flatMap(a=>[a.shoulder,a.elbow,a.wrist,a.mantle])];
    const clips:THREE.AnimationClip[]=[];
    for(const [name,duration,walk,aim] of [["idle",2,0,0],["walk",1.5,1,0],["aim",2,0,1]] as const){
      const frames=32,times:number[]=[],values=nodes.map(()=>[] as number[]);
      for(let f=0;f<=frames;f++){
        const t=f/frames*duration;times.push(t);
        this.setPose({phase:f/frames*Math.PI*2,walk,aim});
        nodes.forEach((n,i)=>values[i].push(...n.quaternion.toArray()));
      }
      clips.push(new THREE.AnimationClip(name,duration,nodes.map((n,i)=>new THREE.QuaternionKeyframeTrack(n.name+".quaternion",times,values[i]))));
    }
    this.setPose(saved);
    return clips;
  }

  private batchRigidMeshes():void {
    const parents:THREE.Object3D[]=[];this.traverse(o=>{if(!(o instanceof THREE.Mesh))parents.push(o);});
    for(const parent of parents){
      const buckets=new Map<THREE.Material,THREE.Mesh[]>();
      for(const child of parent.children){
        if(!(child instanceof THREE.Mesh)||Array.isArray(child.material))continue;
        const list=buckets.get(child.material)??[];list.push(child);buckets.set(child.material,list);
      }
      for(const [mat,meshes] of buckets){
        // Bake even singleton transforms before applying the anatomical proportions.
        const transformed=meshes.map(m=>{m.updateMatrix();const g=m.geometry.clone();g.applyMatrix4(m.matrix);if(g.index){const flat=g.toNonIndexed();g.dispose();return flat;}return g;});
        const merged=mergeGeometries(transformed,false);
        transformed.forEach(g=>g.dispose());
        if(!merged)throw new Error("Incompatible walker geometry");
        this.geometries.add(merged);
        for(const m of meshes)parent.remove(m);
        const batch=new THREE.Mesh(merged,mat);batch.name=parent.name+"_panels";batch.castShadow=batch.receiveShadow=true;parent.add(batch);
      }
    }
    // Release build-time sources no longer used by the batched asset.
    const used=new Set<THREE.BufferGeometry>();this.traverse(o=>{if(o instanceof THREE.Mesh)used.add(o.geometry);});
    for(const geometry of this.geometries)if(!used.has(geometry)){geometry.dispose();this.geometries.delete(geometry);}
  }

  dispose():void {
    if(this.disposed)return;
    this.disposed=true;
    this.garnish?.dispose();
    this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.roughness.dispose();
    this.removeFromParent();
  }
}
