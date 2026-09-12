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
 let mouse={dx:0,dy:0};
 const held=new Set<string>(), pressed=new Set<string>();const input={isDown:(k:string)=>held.has(k),wasPressed:(k:string)=>pressed.has(k),consumeMouse:()=>{const m=mouse;mouse={dx:0,dy:0};return m;},moveScale:1} as unknown as Input;
 const spec=JSON.parse(readFileSync(`public/drones/${id}.json`,'utf8')) as DroneSpec;
 const player=new PlayerController(input,world,16/9,spec);
 const view=new DronePresentation(new THREE.Scene(),player);
 return {player,view,world,collision,held,pressed,aimAt:(target:THREE.Vector3)=>{
 const d=target.clone().sub(player.aimOrigin).normalize();
 const yaw=Math.atan2(-d.x,-d.z),pitch=Math.asin(d.y);
 mouse={dx:(player.viewYaw-yaw)/spec.view.mouseSensitivity,dy:(player.viewPitch-pitch)/spec.view.mouseSensitivity};
 }};
}


describe('walker moving fire at a fixed target',()=>{
 for(const fps of [30,60])for(const mode of ['strafe','jump','dash','wall'])it(`${mode} at ${fps} FPS uses animated lenses and respects cover`,()=>{
  const {player,view,world,collision,held,pressed,aimAt}=setup();
  const target=new THREE.Mesh(new THREE.SphereGeometry(3),new THREE.MeshBasicMaterial());
  target.position.set(0,12,-120);target.updateMatrixWorld();
  let hits=0,beamCount=0;let muzzle:THREE.Vector3;
  const enemy={group:target,isPhased:false,applyFrequencyHit:()=>{hits++;return false;}};
  const ctx={raycaster:new THREE.Raycaster(),world,enemies:{hitMeshes:[target],enemyFromHit:()=>enemy,provokeNear:()=>{}},damageNumbers:{spawn:()=>{}},beamPool:{spawn:(from:THREE.Vector3)=>{beamCount++;expect(from.distanceTo(muzzle)).toBeLessThan(1e-8);}}} as unknown as EmitterContext;
  ctx.raycaster.far=200;
  player.update(1/fps);view.update(1/fps);
  if(mode==='wall'){collision.addAabbBox(-200,200,-70,-65,100);collision.finalize();}
  held.add('KeyD');
  if(mode==='jump')pressed.add('Space');
  if(mode==='dash')pressed.add('ShiftLeft');
  let shots=0;
  for(let frame=0;frame<fps*2;frame++){
   if(frame===fps){held.clear();held.add('KeyA');}
   aimAt(target.position);player.update(1/fps);pressed.clear();view.update(1/fps);
   if(frame<5||frame%5)continue;
   muzzle=player.getMuzzles(1)![0];shots++;
   fireEmitters(ctx,{origin:player.aimOrigin,dir:player.getAimDirection(),bodyOrigin:player.worldPosition,physicalMuzzles:[muzzle],muzzleOffsets:[0],baseDamage:100,falloff:{refDist:100,maxMult:1,minMult:1},range:200,style:{beamColor:0,glowColor:0,radius:1,glowScale:1}});
  }
  expect(beamCount).toBe(shots);
  expect(hits).toBe(mode==='wall'?0:shots);
  view.dispose();target.geometry.dispose();target.material.dispose();
 });
});

describe('flyer moving fire at a fixed target',()=>{
 for(const fps of [30,60])for(const mode of ['turn','ascend','descend','wall'])it(`${mode} at ${fps} FPS uses animated lenses and respects cover`,()=>{
  const {player,view,world,collision,held,pressed,aimAt}=setup('flyer');
  const target=new THREE.Mesh(new THREE.SphereGeometry(3),new THREE.MeshBasicMaterial());
  target.position.set(0,120,-600);target.updateMatrixWorld();
  let hits=0,beamCount=0;let muzzles:THREE.Vector3[]=[];
  const enemy={group:target,isPhased:false,applyFrequencyHit:()=>{hits++;return false;}};
  const ctx={raycaster:new THREE.Raycaster(),world,enemies:{hitMeshes:[target],enemyFromHit:()=>enemy,provokeNear:()=>{}},damageNumbers:{spawn:()=>{}},beamPool:{spawn:(from:THREE.Vector3)=>{beamCount++;expect(muzzles.some(m=>from.distanceTo(m)<1e-8)).toBe(true);}}} as unknown as EmitterContext;
  ctx.raycaster.far=1000;
  player.update(1/fps);view.update(1/fps);
  if(mode==='wall'){collision.addAabbBox(-1000,1000,-350,-345,1000);collision.finalize();}
  held.add('KeyW');
  if(mode==='turn')held.add('KeyD');
  if(mode==='ascend')held.add('Space');
  if(mode==='descend')held.add('ShiftLeft');
  let shots=0;
  for(let frame=0;frame<fps*2;frame++){
   if(frame===fps && mode==='turn'){held.delete('KeyD');held.add('KeyA');}
   aimAt(target.position);player.update(1/fps);pressed.clear();view.update(1/fps);
   if(frame<5||frame%5)continue;
   muzzles=player.getMuzzles(2)!;shots++;
   fireEmitters(ctx,{origin:player.aimOrigin,dir:player.getAimDirection(),bodyOrigin:player.worldPosition,physicalMuzzles:muzzles,muzzleOffsets:[0],baseDamage:100,falloff:{refDist:100,maxMult:1,minMult:1},range:1000,style:{beamColor:0,glowColor:0,radius:1,glowScale:1}});
  }
  expect(beamCount).toBe(shots*2);
  expect(hits).toBe(mode==='wall'?0:shots*2);
  view.dispose();target.geometry.dispose();target.material.dispose();
 });
});
