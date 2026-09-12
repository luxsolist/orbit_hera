import { cameraBoomFraction } from "./ThirdPersonCamera";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { PlayerController } from "./PlayerController";
import { WalkerMech } from "../assets/WalkerMech";
import { WalkerMotionAnimator } from "../assets/WalkerMotion";
import { WalkerThrusters } from "../assets/WalkerThrusters";
import { FlyerDrone } from "../assets/FlyerDrone";
import { loadWalkerSkins } from "../assets/WalkerSkin";
import { loadFlyerSkins } from "../assets/FlyerSkin";

/** Camera, cosmetics and sockets only: never writes the controller's physical position. */
const HIT_COLOR=new THREE.Color(0xff4938);

export class DronePresentation {
  readonly camera: THREE.PerspectiveCamera;
  readonly model: WalkerMech | FlyerDrone;
  private animator = new WalkerMotionAnimator();
  private thrusters?: WalkerThrusters;
  private distance = 0;
  private yaw: number;
  private lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  private alternate = 0;
  private disposed = false;
  private mats: { material: THREE.MeshStandardMaterial; opacity: number; transparent: boolean; emissive: THREE.Color; intensity: number }[] = [];
  private shield=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshBasicMaterial({color:0x65ccff,transparent:true,opacity:.14,wireframe:true,depthWrite:false}));
  private flash = 0;
  private weaponTarget: THREE.Vector3 | null=null;
  private weaponHold=0;
  private weaponRotations=[new THREE.Quaternion(),new THREE.Quaternion()];
  private weaponReturning=false;
  private environment?: THREE.WebGLRenderTarget;
  private previousEnvironment: THREE.Texture | null;

  constructor(private scene: THREE.Scene, private player: PlayerController, renderer?: THREE.WebGLRenderer) {
    this.previousEnvironment=scene.environment;
    if(renderer && !scene.environment){const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();this.environment=pmrem.fromScene(room);room.dispose();pmrem.dispose();}
    const walker = player.spec.move.mode === "walk";
    this.model = walker ? new WalkerMech() : new FlyerDrone();
    this.model.name = "player_drone";
    this.scene.add(this.model);
    this.scene.add(this.shield);
    this.camera = player.camera.clone();
    this.yaw = player.viewYaw;
    if (this.model instanceof WalkerMech) this.thrusters = new WalkerThrusters(this.model);
    player.renderCamera = this.camera;
    player.muzzleProvider = count => this.muzzles(count);
    player.weaponAimProvider = target => {
      if(!(this.model instanceof WalkerMech))return;
      this.weaponTarget=target.clone();this.weaponHold=.28;this.weaponReturning=true;
      this.model.aimWeaponsAt(target);
      Object.values(this.model.arms).forEach((arm,i)=>this.weaponRotations[i].copy(arm.shoulder.quaternion));
    };
    this.captureMaterials();
    this.update(0, true);
  }

  /** Shared catalogs: skins cannot alter movement or hit volumes. */
  async setSkin(id: string): Promise<void> {
    if (this.model instanceof WalkerMech) {
      const {skins} = await loadWalkerSkins();
      if (this.disposed) return;
      const skin = skins.find(s => s.id === id);
      if (skin) this.model.applySkin(skin); else this.model.clearSkin();
    } else {
      const skins = await loadFlyerSkins();
      if (this.disposed) return;
      const skin = skins.find(s => s.id === id);
      if (skin) this.model.applySkin(skin); else this.model.clearSkin();
    }
    this.captureMaterials();
  }

  private captureMaterials() {
    this.mats = [];
    const seen = new Set<THREE.Material>();
    this.model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m instanceof THREE.MeshStandardMaterial && !seen.has(m)) {
          if(this.environment){m.envMap=this.environment.texture;m.envMapIntensity=.6;m.needsUpdate=true;}
          seen.add(m); this.mats.push({material:m, opacity:m.opacity, transparent:m.transparent, emissive:m.emissive.clone(), intensity:m.emissiveIntensity});
        }
      }
    });
  }

  private muzzles(count: number): THREE.Vector3[] {
    this.model.updateMatrixWorld(true);
    const pair = this.model instanceof WalkerMech
      ? [this.model.sockets.muzzle, this.model.sockets.leftMuzzle]
      : [this.model.sockets.socket_muzzle, this.model.sockets.socket_muzzle_left];
    if (count === 1) return [pair[this.alternate++ % 2].getWorldPosition(new THREE.Vector3())];
    return Array.from({length:count}, (_, i) => pair[i % 2].getWorldPosition(new THREE.Vector3()));
  }

  hit(): void { this.flash = .16; }

  update(dt: number, reset = false): void {
    const p = this.player, pos = p.worldPosition, state = p.motionState;
    const walker = this.model instanceof WalkerMech;
    reset ||= this.lastPosition.distanceToSquared(pos) > 10000;
    if (reset) { this.yaw = p.viewYaw; this.animator = new WalkerMotionAnimator(); }
    const delta = Math.atan2(Math.sin(p.viewYaw-this.yaw),Math.cos(p.viewYaw-this.yaw));
    this.yaw += delta * (reset ? 1 : 1-Math.exp(-dt*12));
    // Keep the pelvis inside the torso articulation range after a fast mouse turn.
    this.yaw = p.viewYaw - THREE.MathUtils.clamp(p.viewYaw-this.yaw, -.65, .65);
    this.model.position.copy(pos);
    if (this.model instanceof WalkerMech) {
      this.model.position.y -= p.spec.body.eyeHeight;
      this.model.rotation.set(0, this.yaw+Math.PI, 0);
      const pose={...this.animator.update(dt,{...state,yaw:this.yaw}), aim:1,
        aimYaw:Math.atan2(Math.sin(p.viewYaw-this.yaw),Math.cos(p.viewYaw-this.yaw)), aimPitch:p.viewPitch};
      this.model.setPose(pose);
      if(state.grounded){
        const heights={left:0,right:0};
        for(const side of ["left","right"] as const){
          const foot=this.model.legs[side].ankle.getWorldPosition(new THREE.Vector3());
          const ground=p.gameWorld.heightAt(foot.x,foot.z),roof=p.gameWorld.topAt(foot.x,foot.z);
          const surface=roof>ground && roof<=this.model.position.y+.4?roof:ground;
          heights[side]=THREE.MathUtils.clamp(surface-this.model.position.y,-.35,.35);
        }
        this.model.setPose({...pose,footHeights:heights});
      }
      this.thrusters!.update(dt,state);
    } else {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.viewPitch,p.viewYaw,0,"YXZ"));
      this.model.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
      this.model.rotateZ(-p.visualRoll);
      this.model.setThrottle(Math.min(1,Math.hypot(state.velocityX,state.velocityZ)/p.spec.move.speed));
    }
    this.model.updateMatrixWorld(true);

    if(this.model instanceof WalkerMech && this.weaponReturning){
      this.weaponHold=Math.max(0,this.weaponHold-dt);
      if(this.weaponHold>0 && this.weaponTarget){
        this.model.aimWeaponsAt(this.weaponTarget);
        Object.values(this.model.arms).forEach((arm,i)=>this.weaponRotations[i].copy(arm.shoulder.quaternion));
      }else{
        let remaining=0;
        Object.values(this.model.arms).forEach((arm,i)=>{
          this.weaponRotations[i].slerp(arm.shoulder.quaternion,1-Math.exp(-dt*14));
          remaining+=this.weaponRotations[i].angleTo(arm.shoulder.quaternion);
          arm.shoulder.quaternion.copy(this.weaponRotations[i]);
        });
        this.weaponReturning=remaining>.001;
      }
      this.model.updateMatrixWorld(true);
    }
    this.shield.visible=p.spawnProtection>0;
    this.shield.position.copy(pos);
    this.shield.scale.set(walker?2.5:2,walker?3:1.2,walker?2.5:2.5);
    const aim = p.getAimDirection();
    // Parallel view direction preserves mouse aim; elevated pivot puts the drone below the reticle.
    const pivot = pos.clone().add(new THREE.Vector3(0,walker ? 1.5 : 1.3,0));
    const nominal = walker ? 7.5 : 5.2;
    const end = pivot.clone().addScaledVector(aim,-nominal);
    const allowed = nominal * cameraBoomFraction(p.gameWorld,pos,end,this.camera,aim);
    // Obstacles retract immediately. Recovery is smooth; no lag proportional to dash velocity.
    this.distance = reset || allowed < this.distance ? allowed : THREE.MathUtils.lerp(this.distance,allowed,1-Math.exp(-dt*5));
    this.camera.position.copy(pos).lerp(end,this.distance/nominal);
    this.camera.lookAt(this.camera.position.clone().add(aim));
    this.camera.updateMatrixWorld(true);
    this.model.visible=this.distance>.25;
    const fade=THREE.MathUtils.clamp((this.distance-.3)/2.2,.12,1);
    this.flash=Math.max(0,this.flash-dt);
    for(const {material,opacity,transparent,emissive,intensity} of this.mats){
      material.emissive.copy(emissive).lerp(HIT_COLOR,this.flash/.16*.35);
      material.emissiveIntensity = this.flash > 0 ? Math.max(.5,intensity) : intensity;
      const blended=transparent || fade<.99;
      if(material.transparent!==blended){material.transparent=blended;material.needsUpdate=true;}
      material.opacity=opacity*fade;
    }
    this.lastPosition.copy(pos);
  }

  dispose(): void {
    this.disposed = true;
    this.shield.removeFromParent();this.shield.geometry.dispose();this.shield.material.dispose();
    this.player.renderCamera=undefined; this.player.muzzleProvider=undefined; this.player.weaponAimProvider=undefined;
    if(this.environment){this.scene.environment=this.previousEnvironment;this.environment.dispose();}
    this.thrusters?.dispose(); this.model.dispose(); this.model.removeFromParent();
  }
}
