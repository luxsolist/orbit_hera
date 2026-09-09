import {describe,it,expect} from "vitest";
import * as THREE from "three";
import {WalkerMech} from "../src/assets/WalkerMech";
import {WalkerThrusters} from "../src/assets/WalkerThrusters";
describe("directional body rocket exhaust",()=>{
 it.each([[0,1],[0,-1],[1,0],[-1,0]])("sustains air-control exhaust opposite (%s,%s) and stops on release",(x,z)=>{
  const mech=new WalkerMech({detail:"medium"}),jets=new WalkerThrusters(mech);
  try{
   const state={dashPowered:false,dashDirectionX:0,dashDirectionZ:0,airMoveX:x,airMoveZ:z};
   for(let i=0;i<60;i++)jets.update(1/60,state);
   mech.updateMatrixWorld(true);
   const lit=jets.ports.filter(p=>p.flame.visible);expect(lit).toHaveLength(2);
   for(const port of lit){expect(port.normal.y).toBe(0);expect(port.flame.getWorldDirection(new THREE.Vector3()).dot(new THREE.Vector3(-x,0,-z))).toBeCloseTo(1);expect(port.shells[0].scale.z).toBeLessThan(1);}
   jets.update(.1,{...state,airMoveX:0,airMoveZ:0});expect(jets.ports.some(p=>p.flame.visible)).toBe(false);
  }finally{jets.dispose();mech.dispose();}
 });
 it("fires one centered larger belly jet downward for each jump pulse",()=>{
  const mech=new WalkerMech({detail:"medium"}),jets=new WalkerThrusters(mech);
  try{
   mech.setPose({dash:1,aimYaw:.4});
   const state={dashPowered:false,dashDirectionX:0,dashDirectionZ:0,jumpThrust:1};
   for(let i=0;i<2;i++){
    jets.update(.01,state);mech.updateMatrixWorld(true);
    const lit=jets.ports.filter(p=>p.flame.visible);expect(lit).toHaveLength(1);expect(lit[0].flame.parent!.position.x).toBe(0);expect(lit[0].flame.parent!.position.z).toBeCloseTo(-.12);
    for(const port of lit){
     expect(port.normal.y).toBe(-1);expect(port.shells[0].scale.x).toBeCloseTo(1.8);
     expect(port.flame.getWorldDirection(new THREE.Vector3()).y).toBeCloseTo(-1,5);
    }
    jets.update(.3,{...state,jumpThrust:0});expect(jets.ports.some(p=>p.flame.visible)).toBe(false);
   }
  }finally{jets.dispose();mech.dispose();}
 });
 it.each([[0,1],[0,-1],[1,0],[-1,0],[.707,.707]])("emits opposite dash (%s,%s), then extinguishes",(x,z)=>{
  const mech=new WalkerMech({detail:"medium"}),jets=new WalkerThrusters(mech);
  try{
   mech.rotation.y=.7;mech.setPose({dash:1,aimYaw:.25});
   jets.update(.05,{dashPowered:true,dashDirectionX:x,dashDirectionZ:z});mech.updateMatrixWorld(true);
   const lit=jets.ports.filter(p=>p.flame.visible);expect(lit.length).toBeGreaterThanOrEqual(2);
   const expected=new THREE.Vector3(-x,0,-z).normalize();
   for(const p of lit)expect(p.flame.getWorldDirection(new THREE.Vector3()).dot(expected)).toBeGreaterThan(.999);
   jets.update(.1,{dashPowered:false,dashDirectionX:x,dashDirectionZ:z});expect(jets.ports.some(p=>p.flame.visible)).toBe(false);
  }finally{jets.dispose();mech.dispose();}
 });
});
