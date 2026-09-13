import {it,expect} from 'vitest';
import * as THREE from 'three';
import {PlasmoidVisual} from '../src/assets/PlasmoidVisual';
import {EnemyPlasmoidRenderer} from '../src/enemies/EnemyPlasmoidRenderer';
import {EnemyVisibility} from '../src/enemies/EnemyVisibility';
it('distance compensation is bounded and reverses without accumulating scale',()=>{
 const v=new PlasmoidVisual('skeeter');const part=v.children[0].children.find(n=>n.userData.feature)!;const base=part.scale.clone();
 for(let i=0;i<100;i++)v.setDistance(1000);
 expect(part.scale.x/base.x).toBeCloseTo(1.4);v.setDistance(0);expect(part.scale).toEqual(base);expect(v.hitRadius).toBe(1);v.dispose();
});
it('existing instance batches follow day and night changes without recreation',()=>{
 const scene=new THREE.Scene(),renderer=new EnemyPlasmoidRenderer(scene,4,new EnemyVisibility());
 const e={state:'alive',hitMesh:new THREE.Mesh(),role:'marker',deployRole:'marker',group:new THREE.Group(),glow:1,flash:0,color:0x62cfff} as any;
 scene.userData.cityDaylight=1;renderer.update([e],0,()=> 'idle');
 const meshes=scene.children as THREE.InstancedMesh[];
 expect(meshes.length).toBeGreaterThan(0);expect(meshes.every(m=>(m.material as THREE.ShaderMaterial).uniforms.daylight.value===1)).toBe(true);
 scene.userData.cityDaylight=.25;renderer.update([e],1,()=> 'idle');expect(scene.children).toEqual(meshes);expect(meshes.every(m=>(m.material as THREE.ShaderMaterial).uniforms.daylight.value===.25)).toBe(true);
 scene.userData.cityDaylight=0;renderer.update([e],2,()=> 'idle');expect(meshes.every(m=>(m.material as THREE.ShaderMaterial).uniforms.daylight.value===0)).toBe(true);renderer.dispose();
});
