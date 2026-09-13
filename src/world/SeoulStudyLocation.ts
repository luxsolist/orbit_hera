import * as THREE from 'three';
import type {ChunkBuild} from './chunkMesh';
export const SEOUL_STUDY_URL='/maps/37/126/4_2/79_47.json';
export const SEOUL_STUDY_ORIGIN={x:79.5*1024,z:47.5*1024};
/** Shared deterministic anchor for the comparison and cinematic street. */
export function seoulStudyTarget(chunk:ChunkBuild):THREE.Vector3 {
 const markings=chunk.group.getObjectByName('street_lane_lines') as THREE.Mesh;
 const pos=markings.geometry.getAttribute('position'),target=new THREE.Vector3(pos.getX(0),pos.getY(0),pos.getZ(0));
 // Pick one fixed, open junction away from tall foreground roofs, identically for both scenes.
 const tall=chunk.buildings.filter(b=>b.top-b.baseY>35).map(b=>({x0:Math.min(...b.poly.filter((_,i)=>i%2===0)),x1:Math.max(...b.poly.filter((_,i)=>i%2===0)),z0:Math.min(...b.poly.filter((_,i)=>i%2===1)),z1:Math.max(...b.poly.filter((_,i)=>i%2===1))}));
 let best=-1;
 for(let i=0;i<pos.count;i+=60){const x=pos.getX(i),z=pos.getZ(i);if(Math.abs(x)>330||Math.abs(z)>330)continue;const clearance=Math.min(...tall.map(b=>Math.hypot(Math.max(b.x0-x,0,x-b.x1),Math.max(b.z0-z,0,z-b.z1))));if(clearance>best){best=clearance;target.set(x,pos.getY(i),z);}}
 return target;
}
