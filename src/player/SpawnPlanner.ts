import * as THREE from 'three';
import type {PlayerController} from './PlayerController';
export interface SpawnThreat {pos:THREE.Vector3; radius:number; speed:number; range:number}
/** Finite candidate search: solid geometry is mandatory, threat clearance ranks valid fallback sites. */
export function selectSpawn(player:PlayerController,threats:readonly SpawnThreat[],hazard:(x:number,z:number)=>boolean,initial=false):THREE.Vector3|null {
 const w=player.gameWorld,zone=player.zone,eye=player.spec.body.eyeHeight,fly=player.spec.move.mode==='fly';
 const origins=initial?[w.spawn]:[{x:player.worldPosition.x,z:player.worldPosition.z},w.spawn];
 let best:THREE.Vector3|null=null,bestScore=-Infinity;
 for(const origin of origins)for(const radius of [0,24,48,96,160,240])for(let i=0;i<(radius?16:1);i++){
  const x=origin.x+Math.cos(i*Math.PI/8)*radius,z=origin.z+Math.sin(i*Math.PI/8)*radius;
  if(Math.abs(x)>w.bounds-8||Math.abs(z)>w.bounds-8||zone&&Math.hypot(x-zone.cx,z-zone.cz)>zone.radius-8)continue;
  const ground=w.heightAt(x,z),surface=Math.max(ground,w.topAt(x,z));
  const y=fly?surface+Math.max(24,player.spec.move.mode==='fly'?(player.spec.move.minAltitude??24):24)+eye:surface+eye;
  if(!Number.isFinite(y))continue;
  let valid=true;
  for(const [dx,dz] of [[0,0],[-2,-2],[-2,2],[2,-2],[2,2]]){
   const top=Math.max(w.heightAt(x+dx,z+dz),w.topAt(x+dx,z+dz));
   if(!fly&&Math.abs(top-surface)>.35){valid=false;break;}
   const q=w.resolveCollision(x+dx,z+dz,player.spec.body.radius,y-eye);
   if(Math.hypot(q.x-x-dx,q.z-z-dz)>.01){valid=false;break;}
  }
  if(!valid)continue;
  let escapes=0;
  for(let a=0;a<4;a++){
   const ex=x+Math.cos(a*Math.PI/2)*(fly?25:12),ez=z+Math.sin(a*Math.PI/2)*(fly?25:12);
   if(zone&&Math.hypot(ex-zone.cx,ez-zone.cz)>zone.radius-4)continue;
   if(w.segmentHitsBuilding(x,y,z,ex,y,ez)>1 && (fly||Math.abs(Math.max(w.heightAt(ex,ez),w.topAt(ex,ez))-surface)<.5))escapes++;
  }
  if(!escapes)continue;
  const pos=new THREE.Vector3(x,y,z);let clearance=500;
  for(const e of threats)clearance=Math.min(clearance,pos.distanceTo(e.pos)-Math.max(e.radius,e.range)-e.speed*5);
  const dangerous=hazard(x,z);
  const score=clearance-(dangerous?10000:0)-radius*.05+escapes;
  if(score>bestScore){bestScore=score;best=pos;}
  if(clearance>0&&!dangerous)return pos;
 }
 return best;
}
