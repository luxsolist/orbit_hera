import {it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {EnemyManager} from '../src/enemies/EnemyManager';
import {DEFAULT_PLASMOID} from '../src/enemies/PlasmoidSpec';
import heavy from '../public/weapons/frequency-beam-heavy.json';
import light from '../public/weapons/frequency-beam-light.json';
function setup(){
 const scene=new THREE.Scene(),takeDamage=vi.fn(()=>true);
 const player={worldPosition:new THREE.Vector3(0,2,0),isDead:false,spec:{move:{mode:'walk'},vitals:{maxHp:120}},takeDamage,heal:vi.fn()} as any;
 const world={heightAt:()=>0,bounds:10000,topAt:()=>-Infinity,resolveCollision:(x:number,z:number)=>({x,z}),segmentHitsBuilding:()=>Infinity,buildings:null} as any;
 const manager=new EnemyManager(scene,world,[player],{...DEFAULT_PLASMOID,phase:undefined},()=>.5);
 manager.startRoster([{role:'elite',count:1,hp:1000}],100);
 const elite=manager.aliveEnemies[0];elite.group.position.set(0,2,40);
 const tick=(seconds:number)=>{for(let i=0;i<Math.round(seconds*60);i++)manager.update(1/60);};
 return {scene,player,manager,elite,takeDamage,tick};
}
it('manager routes elites through new patterns, not legacy dash/contact/leap',()=>{
 const {manager,elite,tick,takeDamage}=setup();
 elite.provoke(20);const legacyAttack=vi.spyOn(elite,'tryAttack'),legacyDash=vi.spyOn(elite,'startDash');
 tick(1);expect(takeDamage).not.toHaveBeenCalled();tick(4);
 expect(legacyAttack).not.toHaveBeenCalled();expect(legacyDash).not.toHaveBeenCalled();expect(elite.leapCastLeft).toBe(0);manager.clear();
});
it('disengagement removes an unfinished elite warning instead of blocking future boss attacks',()=>{
 const {manager,elite,tick,scene,player}=setup();
 const combat=(manager as any).combat;
 combat.step(elite,player.worldPosition,player,1.1);
 expect(scene.children.some(o=>o instanceof THREE.Line)).toBe(true);
 player.worldPosition.set(50000,2,0);tick(.1);
 expect(scene.children.some(o=>o instanceof THREE.Line)).toBe(false);manager.clear();
});
it('manager holds all boss projections and elites stationary during a blast, then clears it on reset',()=>{
 const {manager,player,tick,scene}=setup();
 manager.startBossDeploy({bossHp:10000,projections:2,escort:[{role:'elite',count:1,hp:1000}]},100);
 const actors=[...manager.aliveEnemies];actors.forEach((e,i)=>{e.group.position.set(10+i,2,0);e.provoke(20);});
 const combat=(manager as any).combat;combat.tick(5,actors,[player]);expect(combat.bossBusy).toBe(true);
 const before=actors.map(e=>e.group.position.clone());tick(.5);
 actors.forEach((e,i)=>expect(e.group.position).toEqual(before[i]));
 manager.clear();expect(combat.bossBusy).toBe(false);
 expect(scene.children.some(o=>o instanceof THREE.Mesh&&o.geometry.type==='SphereGeometry'&&(o.geometry as THREE.SphereGeometry).parameters.radius===30)).toBe(false);
});
it('a fresh deploy cannot receive a previous deployments delayed blast',()=>{
 const {manager,player,takeDamage,tick}=setup();manager.startBossDeploy({bossHp:10000,projections:1},100);
 const boss=manager.aliveEnemies[0];boss.group.position.set(10,2,0);
 (manager as any).combat.tick(5,[boss],[player]);manager.start(false);tick(4);expect(takeDamage).not.toHaveBeenCalled();manager.clear();
});
it('shipped primary beams retain damage and observation tools without automatic freeze',()=>{
 for(const weapon of [heavy,light]){expect(weapon).not.toHaveProperty('zeno');expect(weapon.auto.damage).toBeGreaterThan(0);expect(weapon.manual.pinSec).toBeGreaterThan(0);}
 expect(heavy.manual.decohere).toBe(true);
});
