import {it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {GravityRifts,RIFT_RULES,riftExposure,sphereInterval} from '../src/enemies/GravityRifts';
import {EnemyManager} from '../src/enemies/EnemyManager';
import {DEFAULT_PLASMOID} from '../src/enemies/PlasmoidSpec';
import {PlayerController} from '../src/player/PlayerController';
import {projectLensPoints} from '../src/fx/lensDistort';
const center={x:0,y:0,z:0,radius:100,age:10};
it('measures fast through crossings, stationary exposure and tangent misses without overlap stacking',()=>{
 expect(sphereInterval({x:-200,y:0,z:0},{x:200,y:0,z:0},center,100)).toEqual([.25,.75]);
 expect(riftExposure({x:-200,y:0,z:0},{x:200,y:0,z:0},[center,center],1)).toBe(.5);
 expect(riftExposure(center,center,[center],1)).toBe(1);
 expect(sphereInterval({x:-200,y:100,z:0},{x:200,y:100,z:0},center,100)).toBeNull();
 expect(riftExposure(center,center,[{...center,age:4.25}],1)).toBe(.25);
 expect(riftExposure(center,center,[{...center,age:3}],1)).toBe(0);
});
it('gives the same exposure at 30, 60 and 120 FPS',()=>{
 for(const fps of [30,60,120]){let total=0;for(let i=0;i<fps*4;i++)total+=riftExposure({x:-200+i/fps*100,y:0,z:0},{x:-200+(i+1)/fps*100,y:0,z:0},[center],1/fps);expect(total).toBeCloseTo(2,8);}
});
function setup(){
 let seed=17;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
 const scene=new THREE.Scene();
 const player={worldPosition:new THREE.Vector3(0,100,0),isDead:false,spec:{move:{mode:'fly'},vitals:{maxHp:60}},takeEnvironmentalDamage:vi.fn(()=>true),takeDamage:vi.fn(()=>true),heal:vi.fn()} as any;
 const world={heightAt:()=>0,topAt:()=>-Infinity,bounds:10000,buildings:null,segmentHitsBuilding:()=>Infinity,resolveCollision:(x:number,z:number)=>({x,z})} as any;
 const manager=new EnemyManager(scene,world,[player],{...DEFAULT_PLASMOID,phase:undefined},random);manager.enableGravityRifts();manager.setZone(0,0,1000);
 return {manager,scene,world,player,random};
}
it('routes roster and boss projections through protected rifts without clearing the mission early',()=>{
 const {manager,scene}=setup();manager.startRoster([{role:'rusher',count:2,hp:1000},{role:'elite',count:1,hp:1000},{role:'boss',count:1,hp:10000}],300);
 expect(manager.gravitySites).toHaveLength(2);expect(manager.aliveEnemies).toHaveLength(0);expect(manager.fieldCleared).toBe(false);
 const enemies=(manager as any).enemies;
 expect(enemies.length).toBeGreaterThan(3);
 for(const e of enemies){expect(e.spawning).toBe(true);expect(e.applyFrequencyHit(100000,{decohere:true})).toBe(false);expect(manager.gravitySites.some(s=>e.group.position.distanceTo(new THREE.Vector3(s.x,s.y,s.z))<=s.radius)).toBe(true);}
 for(let i=0;i<60*9;i++)manager.update(1/60);
 expect(enemies.every((e:any)=>!e.spawning)).toBe(true);expect(manager.aliveEnemies.length).toBe(enemies.length);
 manager.start(false);expect(manager.gravitySites).toHaveLength(0);expect(scene.getObjectByName('gravity-rifts')).toBeUndefined();expect(manager.gravityWarning).toBe('');manager.clear();
});
it('keeps the sphere above buildings and applies continuous basic-HP damage with throttled feedback',()=>{
 const {scene,world,player,random}=setup();world.topAt=()=>500;
 const rifts=new GravityRifts(scene,world,[player],random);
 const enemy={state:'alive',group:new THREE.Group(),spawning:false,color:0xffffff,stagger:vi.fn()} as any;
 rifts.enqueue(enemy,0,0,1500);expect(rifts.sites.every(s=>s.y-s.radius>=520)).toBe(true);
 const site=rifts.sites[0];player.worldPosition.set(site.x,site.y,site.z);
 const hit=vi.fn();rifts.onHit=hit;
 for(let i=0;i<60*5;i++)rifts.update(1/60);
 const damage=player.takeEnvironmentalDamage.mock.calls.reduce((sum:number,args:number[])=>sum+args[0],0);
 expect(damage).toBeCloseTo(60*RIFT_RULES.damageFractionPerSecond,5);expect(hit.mock.calls.length).toBeLessThanOrEqual(4);
 expect(rifts.warning).toContain('내부');rifts.dispose();
});
it('continuous damage respects respawn protection without hit-mercy frame-rate dependence',()=>{
 const p={hp:60,spawnProtection:1,isDead:false,sinceHit:4} as any;
 expect(PlayerController.prototype.takeEnvironmentalDamage.call(p,7.2)).toBe(false);
 p.spawnProtection=0;p.invuln=1;
 expect(PlayerController.prototype.takeEnvironmentalDamage.call(p,7.2)).toBe(true);expect(p.hp).toBeCloseTo(52.8);expect(p.invuln).toBe(1);
 expect(PlayerController.prototype.takeEnvironmentalDamage.call(p,NaN)).toBe(false);
});
it('keeps a bounded lens effect when the camera is inside a rift',()=>{
 const camera=new THREE.PerspectiveCamera();camera.updateMatrixWorld();
 const points=projectLensPoints([{x:0,y:0,z:0,radiusWorld:100,strength:.35,volume:true}],camera);
 expect(points).toEqual([{x:.5,y:.5,radius:.4,strength:.15}]);
});

it('pending reinforcements keep the mission open and all later arrivals use a rift',()=>{
 const {manager}=setup();manager.startHorde(5,1000,200,{concurrentCap:2,reinforceInterval:.1});
 expect(manager.reinforceQueuedCount).toBe(3);expect(manager.fieldCleared).toBe(false);
 const initial=[...(manager as any).enemies];for(const e of initial)e.forceDissolve();
 manager.update(.2);
 expect(manager.reinforceQueuedCount).toBe(2);
 expect((manager as any).enemies.some((e:any)=>!initial.includes(e)&&e.spawning)).toBe(true);
 manager.startRoster([{role:'marker',count:1,hp:1000}],200,undefined,false);
 expect(manager.fieldCleared).toBe(false);manager.clear();
});
it('teleport discontinuities do not count as crossing a hazard',()=>{
 const {scene,world,player,random}=setup();const rifts=new GravityRifts(scene,world,[player],random);
 const enemy={state:'alive',group:new THREE.Group(),spawning:false,color:0xffffff,stagger:vi.fn()} as any;
 rifts.enqueue(enemy,0,0,1500);rifts.update(5);
 const s=rifts.sites[0];player.worldPosition.set(s.x-200,s.y,s.z);player.teleportRevision=1;rifts.update(.01);
 player.takeEnvironmentalDamage.mockClear();player.worldPosition.x=s.x+200;player.teleportRevision=2;rifts.update(.01);
 expect(player.takeEnvironmentalDamage).not.toHaveBeenCalled();rifts.dispose();
});
