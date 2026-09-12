import * as THREE from 'three';
import type {GameWorld} from '../world/GameWorld';

const right=new THREE.Vector3(),up=new THREE.Vector3(),offset=new THREE.Vector3();
const a=new THREE.Vector3(),b=new THREE.Vector3(),sample=new THREE.Vector3();
const worldUp=new THREE.Vector3(0,1,0);

/** Sweeps a conservative near-plane envelope, including diagonal corners and terrain. */
export function cameraBoomFraction(world: GameWorld, origin: THREE.Vector3, end: THREE.Vector3,
  camera: THREE.PerspectiveCamera, aim: THREE.Vector3): number {
  right.crossVectors(aim,worldUp).normalize();
  up.crossVectors(right,aim).normalize();
  const halfHeight=Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.near;
  const padX=Math.max(.25,halfHeight*camera.aspect+.1),padY=Math.max(.25,halfHeight+.1);
  const length=origin.distanceTo(end);
  if(length<1e-6)return 0;
  let fraction=1;
  for(const x of [-1,0,1])for(const y of [-1,0,1]){
    offset.copy(right).multiplyScalar(x*padX).addScaledVector(up,y*padY);
    a.copy(origin).add(offset); b.copy(end).add(offset);
    const hit=world.segmentHitsBuilding(a.x,a.y,a.z,b.x,b.y,b.z);
    if(hit<=1)fraction=Math.min(fraction,Math.max(0,hit-.15/length));
    const steps=Math.ceil(length/.2);
    for(let i=0;i<=steps;i++){
      const t=i/steps;
      if(t>fraction)break;
      sample.copy(a).lerp(b,t);
      if(sample.y<world.heightAt(sample.x,sample.z)+.1){fraction=Math.min(fraction,Math.max(0,t-.2/length));break;}
    }
  }
  return fraction;
}
