import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {PlayerController} from "../src/player/PlayerController";
import type {Input} from "../src/core/Input";
import type {GameWorld} from "../src/world/GameWorld";
import {WalkerMotionAnimator} from "../src/assets/WalkerMotion";
import {WalkerMech} from "../src/assets/WalkerMech";
import * as THREE from "three";
const spec=JSON.parse(readFileSync("public/drones/walker.json","utf8"));
function fixture(){
 const held=new Set<string>(),pressed=new Set<string>();
 const input={moveScale:1,consumeMouse:()=>({dx:0,dy:0}),isDown:(k:string)=>held.has(k),wasPressed:(k:string)=>pressed.has(k)} as Input;
 const world={spawn:{x:0,z:0,yaw:0},bounds:10000,heightAt:()=>0,topAt:()=>0,resolveCollision:(x:number,z:number)=>({x,z})} as unknown as GameWorld;
 const player=new PlayerController(input,world,1,spec);
 const step=()=>{player.update(1/120);pressed.clear();return player.motionState;};
 return {player,held,pressed,step};
}
describe("walker motion driven by game controller",()=>{
 it.each([[0,-20],[0,20],[-20,0],[20,0]])("trails legs opposite dash (%s,%s) without lowering the chassis",(vx,vz)=>{
   const mech=new WalkerMech({detail:"medium"}),a=new WalkerMotionAnimator();
   const state={velocityX:vx,velocityZ:vz,velocityY:0,grounded:true,dashing:true,dashPowered:true,dashDirectionX:vx,dashDirectionZ:vz,dashRemaining:1,yaw:0};
   try{
     const height=mech.pelvis.position.y;
     let pose=a.update(0,state);
     for(let i=0;i<50;i++){pose=a.update(1/120,state);mech.setPose(pose);expect(mech.pelvis.position.y).toBeCloseTo(height,6);}
     expect(pose.legTrailX!*vx+pose.legTrailZ!*vz).toBeGreaterThan(4);
     const peak=Math.hypot(pose.legTrailX!,pose.legTrailZ!);
     for(let i=0;i<30;i++)pose=a.update(1/120,{...state,dashRemaining:(29-i)/120});
     expect(Math.hypot(pose.legTrailX!,pose.legTrailZ!)).toBeLessThan(peak*.5);
     for(let i=0;i<90;i++)pose=a.update(1/120,{...state,dashing:false,dashPowered:false});
     expect(Math.hypot(pose.legTrailX!,pose.legTrailZ!)).toBeLessThan(.001);
   }finally{mech.dispose();}
 });
 it.each([true,false])("blends dash braking into movement (held=%s) without a stance snap",held=>{
   const f=fixture(),a=new WalkerMotionAnimator();f.held.add("KeyW");
   for(let i=0;i<240;i++)a.update(1/120,f.step());
   f.pressed.add("ShiftLeft");if(!held)f.held.clear();
   let previous=a.update(1/120,f.step()),sawRecovery=false;
   for(let i=0;i<420;i++){
     const state=f.step(),pose=a.update(1/120,state);
     expect(Math.abs(pose.dash!-previous.dash!)).toBeLessThan(.15);
     if(state.dashing&&!state.dashPowered&&pose.walk!>.15)sawRecovery=true;
     if(!state.dashing)expect(Math.abs(pose.walk!-previous.walk!)).toBeLessThan(.09);
     previous=pose;
   }
   expect(sawRecovery).toBe(true);expect(previous.dash!).toBeLessThan(.001);
   expect(previous.walk!).toBeCloseTo(held?1:0,3);
 });
 it("extends airborne knees, compresses on landing, then smoothly recovers",()=>{
   const mech=new WalkerMech({detail:"medium"}),a=new WalkerMotionAnimator();
   const ground={velocityX:0,velocityZ:0,velocityY:0,grounded:true,dashing:false,yaw:0};
   try{
     a.apply(mech,1/60,ground);const idle=Math.abs(mech.legs.left.knee.rotation.x),height=mech.pelvis.position.y;
     for(let i=0;i<45;i++)a.apply(mech,1/60,{...ground,grounded:false,velocityY:-2});
     expect(Math.abs(mech.legs.left.knee.rotation.x)).toBeLessThan(idle);
     let deepest=0,minHeight=Infinity;
     for(let i=0;i<45;i++){
       a.apply(mech,1/60,ground);deepest=Math.max(deepest,Math.abs(mech.legs.left.knee.rotation.x));minHeight=Math.min(minHeight,mech.pelvis.position.y);
       expect(new THREE.Box3().setFromObject(mech.legs.left.ankle).min.y).toBeGreaterThan(-.02);
     }
     expect(deepest).toBeGreaterThan(idle+.1);expect(minHeight).toBeLessThan(height-.2);
     expect(mech.pelvis.position.y).toBeCloseTo(height,3);expect(Math.abs(mech.legs.left.knee.rotation.x)).toBeCloseTo(idle,3);
   }finally{mech.dispose();}
 });
 it.each([["KeyW",4.8],["KeyS",2.7],["KeyA",3.0],["KeyD",3.0]] as const)("%s reaches configured directional speed",(key,speed)=>{
  const f=fixture();f.held.add(key);for(let i=0;i<360;i++)f.step();
  expect(Math.hypot(f.player.motionState.velocityX,f.player.motionState.velocityZ)).toBeCloseTo(speed,4);
 });
 it("uses configured jump arc, terminal fall and landing",()=>{
  const f=fixture();f.pressed.add("Space");let apex=0,air=false;
  for(let i=0;i<180;i++){const s=f.step();air ||= !s.grounded;apex=Math.max(apex,f.player.worldPosition.y-spec.body.eyeHeight);expect(s.velocityY).toBeGreaterThanOrEqual(-spec.move.jump.fallTerminal);}
  expect(air).toBe(true);expect(apex).toBeGreaterThan(1.4);expect(apex).toBeLessThan(1.55);expect(f.player.motionState.grounded).toBe(true);
 });
 it.each([["KeyW",20],["KeyS",20],["KeyA",20],["KeyD",20]] as const)("ramps %s dash at standing height and brakes without velocity discontinuities",(key,maximum)=>{
  const f=fixture();f.held.add(key);for(let i=0;i<360;i++)f.step();
  let prev=f.player.motionState,peak=0,air=false;
  f.pressed.add("ShiftLeft");
  for(let i=0;i<240;i++){
    const state=f.step(),speed=Math.hypot(state.velocityX,state.velocityZ);
    peak=Math.max(peak,speed);air ||= !state.grounded;
    if(state.dashing)expect(Math.hypot(state.velocityX-prev.velocityX,state.velocityZ-prev.velocityZ)).toBeLessThanOrEqual(30/120+1e-6);
    if(i===10)f.pressed.add("ShiftLeft");
    prev=state;
  }
  expect(air).toBe(false);expect(peak).toBeCloseTo(maximum,3);expect(f.player.motionState.dashing).toBe(false);
 });
 it("restarts vertical impulse and thrust on midair repeated jumps",()=>{
   const f=fixture();f.pressed.add("Space");f.step();for(let i=0;i<30;i++)f.step();
   const vy=f.player.motionState.velocityY;f.pressed.add("Space");const state=f.step();expect(state.velocityY).toBeGreaterThan(vy);expect(state.jumpThrust).toBe(1);
 });
 it("limits leg cadence to 2.5 total footfalls per second",()=>{
   const a=new WalkerMotionAnimator();a.update(.1,{velocityX:20,velocityZ:0,velocityY:0,grounded:true,dashing:false,yaw:0});
   expect(a.phase/(Math.PI*2)/.1).toBeLessThanOrEqual(1.25);
 });
 it("advances phase by distance, reverses travel and suspends gait in air/dash",()=>{
  const a=new WalkerMotionAnimator();const state={velocityX:0,velocityZ:-3.2,velocityY:0,grounded:true,dashing:false,yaw:0};
  const pose=a.update(.01,state);expect(pose.travelZ).toBe(1);expect(a.phase).toBeCloseTo(.01*3.2/(4*pose.stride!)*Math.PI*2);
  expect(a.update(0,{...state,velocityZ:10}).travelZ).toBe(-1);
  const phase=a.phase;expect(a.update(.1,{...state,grounded:false,velocityY:20}).walk).toBe(0);expect(a.phase).toBe(phase);
  expect(a.update(.01,state).crouch).toBe(0);
  expect(a.update(.12,state).crouch).toBeGreaterThan(.9);
  const landingPhase=a.phase;expect(a.update(.1,{...state,dashing:true}).dash).toBeGreaterThan(.8);expect(a.phase).toBe(landingPhase);
 });
 it("keeps the sole level and above ground in forward, reverse and strafe poses",()=>{
  const mech=new WalkerMech({detail:"medium"});const a=new WalkerMotionAnimator();
  try{for(const [vx,vz] of [[0,-4.8],[0,2.7],[3.0,0],[-3.0,0]])for(let i=0;i<40;i++){
    a.apply(mech,1/120,{velocityX:vx,velocityZ:vz,velocityY:0,grounded:true,dashing:false,yaw:0});
    for(const leg of Object.values(mech.legs)){
      expect(new THREE.Box3().setFromObject(leg.ankle).min.y).toBeGreaterThan(-.02);
      const up=new THREE.Vector3(0,1,0).applyQuaternion(leg.ankle.getWorldQuaternion(new THREE.Quaternion()));expect(up.y).toBeCloseTo(1,4);
    }
  }}finally{mech.dispose();}
 });
});
