import { cameraBoomFraction } from '../src/player/ThirdPersonCamera';
import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {PlayerController} from '../src/player/PlayerController';
import {DronePresentation} from '../src/player/DronePresentation';
import {CollisionWorld} from '../src/world/CollisionWorld';
import {fireEmitters,type EmitterContext} from '../src/weapons/beamFx';
import type {DroneSpec} from '../src/player/DroneSpec';
import type {GameWorld} from '../src/world/GameWorld';
import type {Input} from '../src/core/Input';

function setup(id='walker'){
 const collision=new CollisionWorld();collision.finalize();
 const world={spawn:{x:0,z:0,yaw:0},bounds:10000,heightAt:()=>0,topAt:(x:number,z:number)=>collision.topAt(x,z),resolveCollision:(...a:Parameters<CollisionWorld['resolveCollision']>)=>collision.resolveCollision(...a),segmentHitsBuilding:(...a:Parameters<CollisionWorld['segmentBlocked']>)=>collision.segmentBlocked(...a)} as GameWorld;
 const held=new Set<string>(), pressed=new Set<string>();const input={isDown:(k:string)=>held.has(k),wasPressed:(k:string)=>pressed.has(k),consumeMouse:()=>({dx:0,dy:0}),moveScale:1} as unknown as Input;
 const spec=JSON.parse(readFileSync(`public/drones/${id}.json`,'utf8')) as DroneSpec;
 const player=new PlayerController(input,world,16/9,spec);
 const view=new DronePresentation(new THREE.Scene(),player);
 return {player,view,world,collision,held,pressed};
}

describe('third-person gameplay',()=>{
 for(const id of ['walker','flyer'])it(`${id}: camera, physical body and sockets stay independent`,()=>{
  const {player,view}=setup(id),pos=player.worldPosition.clone();
  expect(view.camera.position.distanceTo(pos)).toBeGreaterThan(4);
  view.camera.position.addScalar(100);
  expect(player.worldPosition.toArray()).toEqual(pos.toArray());
  expect(player.getAimDirection().toArray()).toEqual([-0,0,-1]);
  view.update(1/60);
  const muzzles=player.getMuzzles(2)!;
  expect(muzzles[0].distanceTo(muzzles[1])).toBeGreaterThan(1);
  expect(muzzles.every(m=>m.distanceTo(pos)<4)).toBe(true);
  view.dispose();expect(player.renderCamera).toBeUndefined();
 });
 it('wall retracts camera and recovery is smooth',()=>{
  const {player,view,collision}=setup();
  collision.addAabbBox(-10,10,3,4,20);collision.finalize();view.update(1/60);
  expect(view.camera.position.z).toBeLessThan(3);
  expect(player.worldPosition.z).toBe(0);
  view.dispose();
 });
 it('dash-sized movement keeps body on screen instead of trailing behind',()=>{
  const {player,view}=setup();player.worldPosition.x+=20;view.update(.05);
  expect(view.camera.position.x).toBeCloseTo(20);
  const ndc=view.model.position.clone().add(new THREE.Vector3(0,2,0)).project(view.camera);
  expect(Math.abs(ndc.x)).toBeLessThan(1);expect(Math.abs(ndc.y)).toBeLessThan(1);view.dispose();
 });
 it.each([2,30])('physical emitters converge at %sm and a blocked lens contributes no damage',(targetDistance)=>{
  const sphere=new THREE.Mesh(new THREE.SphereGeometry(2),new THREE.MeshBasicMaterial());sphere.position.set(0,0,-targetDistance);sphere.updateMatrixWorld();
  const damage:number[]=[];const beams:{from:THREE.Vector3,to:THREE.Vector3}[]=[];
  const enemy={group:sphere,isPhased:false,applyFrequencyHit:(n:number)=>{damage.push(n);return false;}};
  const ctx={raycaster:new THREE.Raycaster(),enemies:{hitMeshes:[sphere],enemyFromHit:()=>enemy,provokeNear:()=>{}},damageNumbers:{spawn:()=>{}},beamPool:{spawn:(from:THREE.Vector3,to:THREE.Vector3)=>beams.push({from:from.clone(),to:to.clone()})},world:{segmentHitsBuilding:(x:number)=>x<-.5?.001:Infinity}} as unknown as EmitterContext;
  ctx.raycaster.far=100;
  fireEmitters(ctx,{origin:new THREE.Vector3(0,2,6),dir:new THREE.Vector3(0,-2,-(targetDistance+6)).normalize(),muzzleOffsets:[-1,1],physicalMuzzles:[new THREE.Vector3(-1,0,0),new THREE.Vector3(1,0,0)],baseDamage:100,falloff:{refDist:100,maxMult:1,minMult:1},range:100,style:{beamColor:0,glowColor:0,radius:1,glowScale:1}});
  expect(damage).toEqual([100]);expect(beams).toHaveLength(2);expect(beams[0].from.toArray()).toEqual([-1,0,0]);expect(beams[0].to.z).toBeGreaterThan(-2);
 });
});



describe('third-person movement integration',()=>{
 it('walker run, dash and repeated jump stay attached to the real body',()=>{
  const {player,view,held,pressed}=setup();
  held.add('KeyW');
  for(let i=0;i<120;i++){player.update(1/60);view.update(1/60);}
  expect(Math.hypot(player.motionState.velocityX,player.motionState.velocityZ)).toBeCloseTo(13.89,1);
  pressed.add('ShiftLeft');player.update(1/60);pressed.clear();
  for(let i=0;i<25;i++){player.update(1/60);view.update(1/60);}
  expect(player.motionState.dashing).toBe(true);
  expect(player.motionState.velocityZ).toBeCloseTo(-83.333,1);
  for(let jump=0;jump<2;jump++){
   pressed.add('Space');player.update(1/60);pressed.clear();view.update(1/60);
   expect(player.motionState.velocityY).toBeGreaterThan(25);
  }
  expect(view.model.position.y).toBeCloseTo(player.worldPosition.y-player.spec.body.eyeHeight);
  view.dispose();
 });
 it('flyer descent cannot creep through the hover altitude floor',()=>{
  const {player,view,held}=setup('flyer');held.add('ShiftLeft');
  for(let i=0;i<600;i++)player.update(1/60);
  expect(player.worldPosition.y).toBeCloseTo(20,4);
  view.update(1/60);expect(view.model.position.y).toBeCloseTo(20,4);view.dispose();
 });
});


describe('urban camera and body regression',()=>{
 it('camera clears a thin pillar crossing its diagonal envelope',()=>{
  const {player,view,world,collision}=setup();
  collision.addAabbBox(.20,.30,3,4,20);collision.finalize();
  const end=new THREE.Vector3(0,3.7,7.5);
  expect(world.segmentHitsBuilding(0,2.2,0,0,3.7,7.5)).toBe(Infinity);
  expect(cameraBoomFraction(world,player.worldPosition,end,view.camera,new THREE.Vector3(0,0,-1))).toBeLessThan(.4);
  view.dispose();
 });
 it('camera cannot descend through terrain when aiming upward',()=>{
  const {player,view,world}=setup();
  const end=new THREE.Vector3(0,-3,5),aim=new THREE.Vector3(0,5.2,-5).normalize();
  const t=cameraBoomFraction(world,player.worldPosition,end,view.camera,aim);
  expect(t).toBeLessThan(.42);
  expect(player.worldPosition.clone().lerp(end,t).y).toBeGreaterThan(.1);view.dispose();
 });
 it('flyer nose stops before the wall even at maximum forward speed',()=>{
  const {player,view,collision,held}=setup('flyer');
  collision.addAabbBox(-20,20,-6,-5,200);collision.finalize();held.add('KeyW');
  for(let i=0;i<120;i++)player.update(1/60);
  expect(player.worldPosition.z).toBeGreaterThanOrEqual(-3.551);
  expect(Math.abs(player.motionState.velocityZ)).toBeLessThan(.01);
  view.dispose();
 });
 it('camera gradually returns after its obstacle is removed',()=>{
  const {player,view,collision}=setup();collision.addAabbBox(-10,10,3,4,20);collision.finalize();view.update(.016);
  const close=view.camera.position.distanceTo(player.worldPosition);
  collision.openBuildingAt(0,3.5);view.update(.016);
  expect(view.camera.position.distanceTo(player.worldPosition)).toBeGreaterThan(close);
  expect(view.camera.position.distanceTo(player.worldPosition)).toBeLessThan(4);
  for(let i=0;i<120;i++)view.update(1/60);
  expect(view.camera.position.distanceTo(player.worldPosition)).toBeGreaterThan(7);view.dispose();
 });
});


it('flyer rises smoothly over a roof without dropping below its physical surface',()=>{
 const {player,view,world}=setup('flyer');player.worldPosition.y=20;player.update(1/60);
 world.topAt=()=>10;player.update(1/60);
 expect(player.worldPosition.y).toBeGreaterThan(20);
 expect(player.worldPosition.y).toBeLessThan(22);
 for(let i=0;i<120;i++)player.update(1/60);
 expect(player.worldPosition.y).toBeCloseTo(30,2);view.dispose();
});

describe('walker weapon target tracking',()=>{
 it('both mounts track the beam target before muzzle sampling and recover without turning the body',()=>{
  const {player,view,world}=setup();player.update(1/60);view.update(1/60);
  const target=new THREE.Mesh(new THREE.SphereGeometry(2),new THREE.MeshBasicMaterial());target.position.set(35,25,-70);target.updateMatrixWorld();
  const bodyYaw=player.viewYaw,old=player.getMuzzles(2)!.map(v=>v.clone());
  const enemy={group:target,isPhased:false,applyFrequencyHit:()=>false};const starts:THREE.Vector3[]=[];
  const ctx={raycaster:new THREE.Raycaster(),world,enemies:{hitMeshes:[target],enemyFromHit:()=>enemy,provokeNear:()=>{}},damageNumbers:{spawn:()=>{}},beamPool:{spawn:(v:THREE.Vector3)=>starts.push(v.clone())}} as unknown as EmitterContext;
  ctx.raycaster.far=200;
  fireEmitters(ctx,{origin:player.aimOrigin,dir:target.position.clone().sub(player.aimOrigin).normalize(),aimMuzzles:t=>{player.weaponAimProvider!(t);return player.getMuzzles(2)!;},bodyOrigin:player.worldPosition,muzzleOffsets:[0],baseDamage:10,falloff:{refDist:100,maxMult:1,minMult:1},range:200,style:{beamColor:0,glowColor:0,radius:1,glowScale:1}});
  const model=view.model as import('../src/assets/WalkerMech').WalkerMech;
  for(const arm of Object.values(model.arms)){
   const direction=new THREE.Vector3(0,0,1).applyQuaternion(arm.shoulder.getWorldQuaternion(new THREE.Quaternion()));
   const wanted=target.position.clone().sub(arm.shoulder.getWorldPosition(new THREE.Vector3())).normalize();
   expect(direction.dot(wanted)).toBeGreaterThan(.9999);
  }
  const current=player.getMuzzles(2)!;expect(starts).toHaveLength(2);
  starts.forEach((p,i)=>expect(p.distanceTo(current[i])).toBeLessThan(1e-6));
  expect(current.some((p,i)=>p.distanceTo(old[i])>.2)).toBe(true);
  expect(player.viewYaw).toBe(bodyYaw);
  for(let i=0;i<90;i++){player.update(1/60);view.update(1/60);}
  const recovered=player.getMuzzles(2)!;
  recovered.forEach((p,i)=>expect(p.distanceTo(old[i])).toBeLessThan(.05));
  view.dispose();expect(player.weaponAimProvider).toBeUndefined();target.geometry.dispose();target.material.dispose();
 });
});
