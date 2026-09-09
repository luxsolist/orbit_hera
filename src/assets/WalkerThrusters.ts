import * as THREE from "three";
import type { WalkerMech } from "./WalkerMech";

export interface WalkerThrustState {
  dashPowered: boolean;
  jumpThrust?: number;
  airMoveX?: number;
  airMoveZ?: number;
  dashDirectionX: number;
  dashDirectionZ: number;
}

/** Runtime-only body jets. Kept separate from GLB geometry and portable idle clips. */
export class WalkerThrusters {
  readonly root = new THREE.Group();
  readonly ports: {normal: THREE.Vector3; flame: THREE.Group; shells: THREE.Mesh[]; light: THREE.PointLight}[] = [];
  private time = 0;
  private envelope = 0;
  private active = false;
  private direction = new THREE.Vector3();
  private local = new THREE.Vector3();
  private inverse = new THREE.Quaternion();
  private forward = new THREE.Vector3(0,0,1);
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  constructor(private mech: WalkerMech) {
    this.root.name="walker_body_thrusters";mech.torso.add(this.root);
    const nozzle=new THREE.TorusGeometry(.105,.032,6,16);
    const outer=new THREE.ConeGeometry(.16,1,16,1,true);
    outer.rotateX(Math.PI/2);outer.translate(0,0,.5);
    const housing=new THREE.CylinderGeometry(.13,.19,.22,8);
    housing.rotateX(Math.PI/2);housing.translate(0,0,-.08);
    this.geometries.push(nozzle,outer,housing);
    // Intersect the finished, proportion-adjusted hull, not its old bounding dimensions.
    mech.updateMatrixWorld(true);
    const hull=mech.torso.children.filter((node):node is THREE.Mesh=>node instanceof THREE.Mesh);
    const ray=new THREE.Raycaster();
    const hullRotation=mech.torso.getWorldQuaternion(new THREE.Quaternion());
    const metal=new THREE.MeshStandardMaterial({color:0x323c44,metalness:.85,roughness:.35});this.materials.push(metal);
    for(const normal of [new THREE.Vector3(0,0,-1),new THREE.Vector3(0,0,1),new THREE.Vector3(-1,0,0),new THREE.Vector3(1,0,0),new THREE.Vector3(0,-1,0)]){
      for(const side of normal.y<0?[0]:[-1,1]){
        const port=new THREE.Group();
        const underside=normal.y<0;
        const origin=underside?new THREE.Vector3(0,-2,-.12):new THREE.Vector3(normal.x*2+(normal.z?side*.28:0),normal.z?.25:.32,normal.z*2+(normal.x?side*.25:0));
        ray.set(mech.torso.localToWorld(origin),normal.clone().negate().applyQuaternion(hullRotation));
        const surfaces=underside?[...hull,...mech.pelvis.children.filter((node):node is THREE.Mesh=>node instanceof THREE.Mesh)]:hull;
        const hit=ray.intersectObjects(surfaces,false)[0];
        if(!hit)throw new Error("Walker thruster mount must intersect the hull");
        port.position.copy(mech.torso.worldToLocal(hit.point)).addScaledVector(normal,.035);
        port.name=underside?"belly_jump_thruster_mount":"hull_thruster_mount";
        const mount=new THREE.Group();if(underside)mount.scale.setScalar(1.8);mount.quaternion.setFromUnitVectors(this.forward,normal);port.add(mount);
        const collar=new THREE.Mesh(housing,metal);collar.castShadow=collar.receiveShadow=true;mount.add(collar);
        const rim=new THREE.Mesh(nozzle,metal);rim.castShadow=rim.receiveShadow=true;mount.add(rim);
        const flame=new THREE.Group();flame.visible=false;port.add(flame);
        const shells:THREE.Mesh[]=[];
        for(const [color,width,length,opacity] of [[0xff6520,1,1,.65],[0xffca72,.65,.75,.85],[0xdff8ff,.33,.52,1]]){
          const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
          this.materials.push(material);
          const shell=new THREE.Mesh(outer,material);shell.scale.set(width*(underside?1.8:1),width*(underside?1.8:1),length);shell.userData.opacity=opacity;shell.userData.length=length;
          flame.add(shell);shells.push(shell);
        }
        const light=new THREE.PointLight(0xffac5c,0,3,2);flame.add(light);light.position.z=.18;
        this.root.add(port);this.ports.push({normal,flame,shells,light});
      }
    }
  }
  update(dt:number,state:WalkerThrustState):void {
    const airStrength=Math.min(1,Math.hypot(state.airMoveX??0,state.airMoveZ??0));
    const powered=state.dashPowered||airStrength>.001;
    if(powered){
      if(!this.active)this.time=0;
      const x=state.dashPowered?state.dashDirectionX:(state.airMoveX??0);
      const z=state.dashPowered?state.dashDirectionZ:(state.airMoveZ??0);
      this.direction.set(-x,0,-z).normalize();
      this.time+=dt;this.envelope=state.dashPowered?1:.45*airStrength;
    }else this.envelope=Math.max(0,this.envelope-dt/.09);
    this.active=powered;
    this.mech.updateMatrixWorld(true);
    this.inverse.copy(this.mech.torso.getWorldQuaternion(this.inverse)).invert();
    this.local.copy(this.direction).applyQuaternion(this.inverse);
    const down=new THREE.Vector3(0,-1,0).applyQuaternion(this.inverse);
    const pulse=1+.10*Math.sin(this.time*137)+.06*Math.sin(this.time*251);
    const ignition=state.dashPowered?1+.5*Math.exp(-this.time*18):1;
    for(const port of this.ports){
      const underside=port.normal.y<0;
      const strength=underside?THREE.MathUtils.clamp(state.jumpThrust??0,0,1):Math.max(0,port.normal.dot(this.local))*this.envelope;
      const exhaust=underside?down:this.local;
      port.flame.visible=strength>.04;
      port.flame.quaternion.setFromUnitVectors(this.forward,exhaust.lengthSq()>.01?exhaust:this.forward);
      const length=(underside?2.1:1.65)*pulse*(underside?1+.4*strength:ignition)*strength;
      for(const shell of port.shells){
        shell.scale.z=shell.userData.length*length;
        (shell.material as THREE.MeshBasicMaterial).opacity=shell.userData.opacity*strength;
      }
      port.light.intensity=5*strength*pulse;
    }
  }
  dispose():void {this.root.removeFromParent();this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());}
}
