import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WalkerMech } from "../src/assets/WalkerMech";

describe("reusable walker asset",()=>{
  it("keeps the rotating hull above the fixed pelvic hip joints",()=>{
    const mech=new WalkerMech();
    try{
      for(const yaw of [-.8,0,.8]){
        mech.setPose({aimYaw:yaw});
        const hull=new THREE.Box3();
        mech.torso.children.forEach(n=>{if(n instanceof THREE.Mesh)hull.union(new THREE.Box3().setFromObject(n,true));});
        for(const leg of Object.values(mech.legs)){
          expect(leg.hip.parent).toBe(mech.pelvis);
          const hip=new THREE.Box3();leg.hip.children.forEach(n=>{if(n instanceof THREE.Mesh)hip.union(new THREE.Box3().setFromObject(n,true));});
          expect(hull.min.y-hip.max.y).toBeGreaterThan(.01);
        }
      }
    }finally{mech.dispose();}
  });
  it("keeps the feet above ground throughout the gait and crouch range",()=>{
    const mech=new WalkerMech({detail:"medium"});
    try{
      for(const crouch of [0,1])for(let i=0;i<16;i++){
        mech.setPose({phase:i/16*Math.PI*2,walk:1,crouch});
        for(const leg of Object.values(mech.legs)){
          const bounds=new THREE.Box3().setFromObject(leg.ankle);
          expect(bounds.min.y).toBeGreaterThanOrEqual(-.01);
          expect(bounds.min.y).toBeLessThan(.13);
        }
      }
    }finally{mech.dispose();}
  });
  it("provides animated world-space camera and forward muzzle sockets",()=>{
    const mech=new WalkerMech();
    try{
      mech.setPose({aim:1});
      const direction=mech.sockets.muzzle.getWorldDirection(new THREE.Vector3());
      expect(direction.z).toBeGreaterThan(.98);
      expect(mech.sockets.leftMuzzle.getWorldDirection(new THREE.Vector3()).z).toBeGreaterThan(.98);
      expect(mech.sockets.leftMuzzle.getWorldPosition(new THREE.Vector3()).x).toBeLessThan(mech.sockets.muzzle.getWorldPosition(new THREE.Vector3()).x);
      expect(mech.sockets.camera.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(2.1);
      const before=mech.sockets.muzzle.getWorldPosition(new THREE.Vector3());
      mech.position.x=10;mech.updateMatrixWorld(true);
      expect(mech.sockets.muzzle.getWorldPosition(new THREE.Vector3()).x-before.x).toBeCloseTo(10);
    }finally{mech.dispose();}
  });
  it("exports loopable articulated clips without changing the current pose",()=>{
    const mech=new WalkerMech();
    try{
      mech.setPose({walk:1,phase:.7,aimYaw:.3});
      const pose=mech.legs.left.hip.quaternion.clone();
      const clips=mech.createAnimationClips();
      expect(clips.map(c=>c.name)).toEqual(["idle","walk","aim"]);
      expect(mech.legs.left.hip.quaternion.angleTo(pose)).toBeLessThan(.000001);
      for(const clip of clips)for(const track of clip.tracks){
        expect(mech.getObjectByName(track.name.split(".")[0])).toBeDefined();
        const values=track.values;
        for(let i=0;i<4;i++)expect(values[i]).toBeCloseTo(values[values.length-4+i],5);
      }
    }finally{mech.dispose();}
  });
  it("owns independent resources and stays within the single-player asset budget",()=>{
    const a=new WalkerMech(),b=new WalkerMech();
    const mat=(m:WalkerMech)=>{let result:THREE.Material|undefined;m.traverse(o=>{if(o instanceof THREE.Mesh&&!Array.isArray(o.material))result=o.material;});return result!;};
    const materialA=mat(a),materialB=mat(b);let released=0;materialA.addEventListener("dispose",()=>released++);
    expect(materialA).not.toBe(materialB);
    let triangles=0,draws=0;b.traverse(o=>{if(o instanceof THREE.Mesh){draws++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
    expect(triangles).toBeLessThan(25000);expect(draws).toBeLessThan(90);
    a.dispose();a.dispose();expect(released).toBe(1);
    b.setPose({walk:1,phase:1});b.dispose();
  });
});
