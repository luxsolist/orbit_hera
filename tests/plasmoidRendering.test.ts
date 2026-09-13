import {it,expect} from 'vitest';
import * as THREE from 'three';
import {EnemyManager} from '../src/enemies/EnemyManager';
import {DEFAULT_PLASMOID} from '../src/enemies/PlasmoidSpec';
import {plasmoidKind} from '../src/enemies/EnemyPlasmoidRenderer';
function setup(){
 const scene=new THREE.Scene();
 const player={worldPosition:new THREE.Vector3(0,2,0),isDead:false,spec:{move:{mode:'walk'},vitals:{maxHp:120}},takeDamage:()=>true} as any;
 const world={heightAt:()=>0,bounds:10000,topAt:()=>-Infinity,resolveCollision:(x:number,z:number)=>({x,z}),segmentHitsBuilding:()=>Infinity,buildings:null} as any;
 const manager=new EnemyManager(scene,world,[player],{...DEFAULT_PLASMOID,phase:undefined},()=>.5);
 return {manager,scene};
}
it('energy visuals preserve legacy ray hits and exclude decorations from targeting',()=>{
 const {manager,scene}=setup();manager.startRoster([{role:'marker',count:1,hp:1000}],100);
 const e=manager.aliveEnemies[0];e.group.position.set(0,2,-10);manager.update(0);
 const ray=new THREE.Raycaster(new THREE.Vector3(0,2,0),new THREE.Vector3(0,0,-1));scene.updateMatrixWorld(true);
 const hit=ray.intersectObjects(manager.hitMeshes,false)[0];expect(manager.enemyFromHit(hit)).toBe(e);
 const visuals=scene.children.filter(o=>o instanceof THREE.InstancedMesh&&o.material instanceof THREE.ShaderMaterial) as THREE.InstancedMesh[];
 expect(visuals.length).toBeGreaterThan(4);expect(visuals.some(v=>v.count>0)).toBe(true);
 expect(manager.hitMeshes.some(m=>visuals.includes(m as THREE.InstancedMesh))).toBe(false);
 e.forceDissolve();manager.update(.1);expect(e.hitMesh.visible).toBe(false);expect(manager.aliveEnemies).toHaveLength(0);
 manager.clear();expect(visuals.every(v=>v.count===0)).toBe(true);
});
it('elite and boss select independent appearances despite shared rusher behavior',()=>{
 const {manager}=setup();manager.startBossDeploy({bossHp:10000,projections:1,escort:[{role:'elite',count:1,hp:1000}]},100);
 expect(manager.aliveEnemies.map(plasmoidKind).sort()).toEqual(['boss','elite']);manager.clear();
});
