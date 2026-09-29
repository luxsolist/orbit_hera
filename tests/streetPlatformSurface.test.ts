import {it,expect} from 'vitest';
import * as THREE from 'three';
import {streetPlatform} from '../src/world/StreetPlatform';
it('keeps the concave platform and roof out of the street and uses planned posts',()=>{
 const asset=streetPlatform({p:[0,0,10,0,10,2,2,2,2,10,0,10],h:3,structureKind:'platform',roofed:true,supportPoints:[1,1]},0,0,()=>0);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(asset.geometry,material);mesh.updateMatrixWorld();
 const ray=new THREE.Raycaster(new THREE.Vector3(8,10,8),new THREE.Vector3(0,-1,0));expect(ray.intersectObject(mesh)).toHaveLength(0);
 ray.set(new THREE.Vector3(1,10,8),new THREE.Vector3(0,-1,0));expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
 expect(asset.walls).toHaveLength(1);expect(asset.walls[0].x0).toBeCloseTo(.9);
 asset.geometry.dispose();material.dispose();
});
