import {it,expect} from 'vitest';
import * as THREE from 'three';
import {terrainFootprint,addStreetGeometry,junctions} from '../src/world/StreetGeometry';
import {seoulAppearance} from '../src/world/cities';
import type {ChunkTerrain} from '../src/world/chunkMesh';
const terrain:ChunkTerrain={size:2,step:10,cellX0:0,cellZ0:0,heights:new Float32Array([0,4,8,20])};
it('clips road surfaces exactly to both terrain triangles, including nonplanar slopes and chunk borders',()=>{
 const vertices=terrainFootprint([[-2,-2],[12,-2],[12,12],[-2,12]],terrain,0,0);
 let area=0;
 for(let i=0;i<vertices.length;i+=9){
  const a=new THREE.Vector3(...vertices.slice(i,i+3) as [number,number,number]),b=new THREE.Vector3(...vertices.slice(i+3,i+6) as [number,number,number]),c=new THREE.Vector3(...vertices.slice(i+6,i+9) as [number,number,number]);
  const cross=b.clone().sub(a).cross(c.clone().sub(a));expect(cross.y).toBeGreaterThan(0);area+=cross.y/2;
 }
 expect(area).toBeCloseTo(100);
 for(let i=0;i<vertices.length;i+=3){const [x,y,z]=vertices.slice(i,i+3);expect(x).toBeGreaterThanOrEqual(0);expect(x).toBeLessThanOrEqual(10);expect(z).toBeGreaterThanOrEqual(0);expect(z).toBeLessThanOrEqual(10);expect(y).toBeCloseTo(x+z<=10?x*.4+z*.8:20-12*(1-x/10)-16*(1-z/10));}
 const shifted=terrainFootprint([[-2,-2],[12,-2],[12,12],[-2,12]],terrain,100,200);
 for(let i=0;i<vertices.length;i+=3){expect(shifted[i]+100).toBeCloseTo(vertices[i]);expect(shifted[i+1]).toBe(vertices[i+1]);expect(shifted[i+2]+200).toBeCloseTo(vertices[i+2]);}
});
it('draws intersections above all sidewalk layers with bounded draw calls',()=>{
 const group=new THREE.Group();const t={...terrain,size:2,step:100,heights:new Float32Array(4)};
 addStreetGeometry(group,[{p:[0,50,100,50],w:8},{p:[50,0,50,100],w:8}],t,0,0,{...seoulAppearance.street,curbHeight:0,junctionMarkings:false});
 expect(group.children.length).toBe(4);
 const asphalt=group.getObjectByName('street_asphalt') as THREE.Mesh;
 const pavement=group.getObjectByName('street_pavement') as THREE.Mesh;
 expect(asphalt.renderOrder).toBeGreaterThan(pavement.renderOrder);
 expect((asphalt.material as THREE.MeshStandardMaterial).polygonOffsetFactor).toBeLessThan((pavement.material as THREE.MeshStandardMaterial).polygonOffsetFactor);
 for(const child of group.children){const mesh=child as THREE.Mesh;expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);mesh.geometry.dispose();}
});
it('ignores malformed and zero-length road segments',()=>{
 const group=new THREE.Group();addStreetGeometry(group,[{p:[3,3,3,3],w:6},{p:[0,0,10,10],w:-2}],terrain,0,0,seoulAppearance.street);expect(group.children).toHaveLength(0);
});

it('finds perpendicular and oblique junctions but ignores straight continuation',()=>{
 const s={ax:0,az:50,bx:100,bz:50,len:100,w:16};
 expect(junctions(s,[{ax:50,az:0,bx:50,bz:100,len:100,w:10}])).toEqual([{distance:50,clearance:6}]);
 expect(junctions(s,[{ax:100,az:50,bx:200,bz:50,len:100,w:10}])).toEqual([]);
 expect(junctions(s,[{ax:0,az:0,bx:100,bz:100,len:Math.sqrt(20000),w:10}])[0].clearance).toBeCloseTo(6*Math.sqrt(2));
});
it('clears intersection paint, adds approach crossings and keeps raised curbs out of the junction',()=>{
 const group=new THREE.Group(),t={...terrain,step:100,heights:new Float32Array(4)};
 addStreetGeometry(group,[{p:[0,50,100,50],w:16},{p:[50,0,50,100],w:16}],t,0,0,seoulAppearance.street);
 const curbs=group.getObjectByName('street_raised_curbs') as THREE.Mesh;
 curbs.geometry.computeBoundingBox();expect(curbs.geometry.boundingBox!.max.y).toBeCloseTo(.12);
 for(const name of ['street_center_lines','street_lane_lines','street_raised_curbs']){
  const mesh=group.getObjectByName(name) as THREE.Mesh;expect(mesh).toBeDefined();
  const pos=mesh.geometry.getAttribute('position');
  for(let i=0;i<pos.count;i++)expect(Math.abs(pos.getX(i)-50)<8&&Math.abs(pos.getZ(i)-50)<8).toBe(false);
 }
 const asphalt=group.getObjectByName('street_asphalt') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
 expect(asphalt.material.color.getHexString()).toBe('555b61');
 for(const child of group.children)(child as THREE.Mesh).geometry.dispose();
});
