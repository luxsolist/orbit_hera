import {selectSpawn} from '../src/player/SpawnPlanner';
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


describe('safe spawn and protection',()=>{
 it('avoids enemies and impending waves while staying in the battle zone',()=>{
  const {player,view}=setup();player.setZone(200,0,0);
  const pos=selectSpawn(player,[{pos:new THREE.Vector3(0,2,0),radius:4,speed:17,range:3.2}],(x,z)=>x>0)!;
  expect(pos).not.toBeNull();expect(pos.length()).toBeGreaterThan(85);expect(pos.x).toBeLessThanOrEqual(0);expect(Math.hypot(pos.x,pos.z)).toBeLessThan(192);view.dispose();
 });
 it('rejects solid geometry and returns no position when every candidate is blocked',()=>{
  const {player,view,world}=setup();world.resolveCollision=(x,z)=>({x:x+5,z});
  expect(selectSpawn(player,[],()=>false)).toBeNull();view.dispose();
 });
 it('flyer clears tall roofs and walker avoids uneven support',()=>{
  const {player,view,world}=setup('flyer');world.topAt=()=>120;
  const pos=selectSpawn(player,[],()=>false)!;expect(pos.y).toBeGreaterThan(144);view.dispose();
  const walk=setup();walk.world.topAt=(x)=>x>1?20:0;
  const safe=selectSpawn(walk.player,[],()=>false)!;expect(Math.abs(safe.x)).toBeGreaterThan(2);walk.view.dispose();
 });
 it('respawns at the selected point, cancels momentum and blocks damage for three seconds',()=>{
  const {player,view,held}=setup();held.add('KeyW');for(let i=0;i<30;i++)player.update(1/60);
  player.respawn(3,new THREE.Vector3(30,2.2,40));held.clear();
  expect(player.worldPosition.toArray()).toEqual([30,2.2,40]);expect(player.motionState.velocityZ).toBe(0);
  expect(player.takeDamage(50)).toBe(false);player.update(2.9);expect(player.takeDamage(50)).toBe(false);
  player.update(.11);expect(player.takeDamage(50)).toBe(true);view.dispose();
 });
 it('manual cancellation removes protection immediately without leaving damage invulnerability',()=>{
  const {player,view}=setup();player.respawn();expect(player.takeDamage(50)).toBe(false);
  player.cancelSpawnProtection();expect(player.takeDamage(50)).toBe(true);view.dispose();
 });
 for(const id of ['walker','flyer'])it(`${id}: dead input stays still, respawn permits protected evasion`,()=>{
  const {player,view,held}=setup(id);player.hp=0;held.add('KeyW');
  const dead=player.worldPosition.clone();for(let i=0;i<30;i++)player.update(1/60);
  expect(player.worldPosition.distanceTo(dead)).toBe(0);
  const safe=selectSpawn(player,[],()=>false)!;player.respawn(3,safe);view.update(0,true);
  const start=player.worldPosition.clone();
  for(let i=0;i<30;i++){player.update(1/60);view.update(1/60);}
  expect(player.worldPosition.distanceTo(start)).toBeGreaterThan(1);
  expect(player.spawnProtection).toBeCloseTo(2.5);expect(player.takeDamage(50)).toBe(false);
  expect(view.camera.position.distanceTo(player.worldPosition)).toBeGreaterThan(1);
  expect(player.getMuzzles(2)!.every(p=>p.toArray().every(Number.isFinite))).toBe(true);
  player.cancelSpawnProtection();expect(player.takeDamage(50)).toBe(true);view.dispose();
 });

});
