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


describe('responsive movement with real drone specs',()=>{
 for(const fps of [30,60,120])for(const id of ['walker','flyer'])it(`${id} at ${fps} FPS responds, reverses and stops promptly`,()=>{
  const {player,view,held}=setup(id);const dt=1/fps;
  player.update(dt);held.add('KeyW');
  let t=0;while(t<.17){player.update(dt);t+=dt;}
  expect(-player.motionState.velocityZ/player.spec.move.speed).toBeGreaterThan(.9);
  held.clear();held.add('KeyS');t=0;
  while(t<.1){player.update(dt);t+=dt;}
  expect(player.motionState.velocityZ).toBeGreaterThan(0);
  held.clear();t=0;while(t<.25){player.update(dt);t+=dt;}
  expect(Math.abs(player.motionState.velocityZ)/player.spec.move.speed).toBeLessThan(.03);
  view.dispose();
 });
 it('walker strafing reverses within 70ms without exceeding 4m/s',()=>{
  const {player,view,held}=setup();player.update(1/60);held.add('KeyD');
  for(let i=0;i<60;i++)player.update(1/60);
  expect(player.motionState.velocityX).toBeCloseTo(4,3);
  held.clear();held.add('KeyA');for(let i=0;i<4;i++)player.update(1/60);
  expect(player.motionState.velocityX).toBeLessThan(0);expect(player.motionState.velocityX).toBeGreaterThan(-4);view.dispose();
 });
 it('walker air input reaches 90% within 250ms and repeated jump stays available',()=>{
  const {player,view,held,pressed}=setup();player.update(1/60);pressed.add('Space');player.update(1/60);pressed.clear();held.add('KeyW');
  for(let i=0;i<15;i++)player.update(1/60);
  expect(player.motionState.grounded).toBe(false);
  expect(-player.motionState.velocityZ/player.spec.move.speed).toBeGreaterThan(.9);
  pressed.add('Space');player.update(1/60);expect(player.motionState.velocityY).toBeGreaterThan(25);view.dispose();
 });
 it('dash starts on the input frame and returns to sideways control',()=>{
  const {player,view,held,pressed}=setup();player.update(1/60);pressed.add('ShiftLeft');player.update(1/60);pressed.clear();
  expect(player.motionState.dashPowered).toBe(true);expect(player.motionState.velocityZ).toBeLessThan(0);
  held.add('KeyD');for(let i=0;i<65;i++)player.update(1/60);
  expect(player.motionState.dashing).toBe(false);expect(player.motionState.velocityX).toBeCloseTo(4,1);
  expect(player.motionState.velocityZ).toBeCloseTo(0,1);view.dispose();
 });
});
