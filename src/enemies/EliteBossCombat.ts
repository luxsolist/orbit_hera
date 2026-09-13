import * as THREE from 'three';
import type {CoreEnemy} from './CoreEnemy';
import type {PlayerController} from '../player/PlayerController';

export const ELITE_COMBAT={near:18,rangedMin:25,rangedMax:70,shotWarn:1.2,shotCooldown:3.5,shotDamage:8,leapWarn:1.5,leapCooldown:7.5,recover:1,contactDamage:14} as const;
export const BOSS_BLAST={radius:30,warn:3,recover:2.5,cooldown:15,damage:24,safeHalfAngle:Math.PI/4} as const;
/** A 90-degree refuge remains open through all altitudes. The warning mesh uses this same sector. */
export function insideBossBlast(point:THREE.Vector3,center:THREE.Vector3):boolean {
 const d=point.clone().sub(center);
 return d.length()<=BOSS_BLAST.radius && (Math.hypot(d.x,d.z)<.001?false:Math.abs(Math.atan2(d.z,d.x))>BOSS_BLAST.safeHalfAngle);
}
type State={kind:'idle'|'shot'|'leap'|'rush'|'recover';left:number;leapCd:number;shotCd:number;aim:THREE.Vector3;fx?:THREE.Object3D};
type Blast={enemy:CoreEnemy;center:THREE.Vector3;left:number;fired:boolean;fx:THREE.Mesh};
export interface CombatHooks {

 visible(a:THREE.Vector3,b:THREE.Vector3):boolean;
 destination(target:THREE.Vector3):THREE.Vector3|null;
 hit(player:PlayerController,amount:number,from:THREE.Vector3):void;
 beam(a:THREE.Vector3,b:THREE.Vector3,color:number):void;
}
/** Owns attack timing and warnings; CoreEnemy still owns damage, visuals and ordinary steering. */
export class EliteBossCombat {
 private states=new Map<CoreEnemy,State>();
 private blast?:Blast;
 private bossCooldown=5;
 private quiet=0;
 constructor(private scene:THREE.Scene,private hooks:CombatHooks){}
 hold(enemy:CoreEnemy,target:THREE.Vector3,dt:number){const position=enemy.group.position.clone();enemy.update(dt,target,0);enemy.group.position.copy(position);}
 cancel(enemy:CoreEnemy){const state=this.states.get(enemy);if(state){this.remove(state.fx);this.states.delete(enemy);}}
 visualEmphasis(e:CoreEnemy):'front'|'tail'|'both'{const s=this.states.get(e);return s?.kind==='shot'?'tail':s?.kind==='rush'||s?.kind==='leap'?'front':'both';}
 visualPose(e:CoreEnemy):'idle'|'charge'|'attack'|'recover' {
  if(this.blast?.enemy===e)return !this.blast.fired?'charge':this.blast.left>BOSS_BLAST.recover-.3?'attack':'recover';
  const s=this.states.get(e);
  return s?.kind==='recover'?'recover':s&&s.kind!=='idle'?'charge':'idle';
 }
 get bossBusy(){return !!this.blast||this.quiet>0;}
 private remove(fx?:THREE.Object3D){if(!fx)return;fx.removeFromParent();fx.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)m.geometry.dispose();if(m.material){const materials=Array.isArray(m.material)?m.material:[m.material];materials.forEach(v=>v.dispose());}});}
 private line(a:THREE.Vector3,b:THREE.Vector3,color:number){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]),new THREE.LineBasicMaterial({color,transparent:true,opacity:.8,depthTest:false}));this.scene.add(line);return line;}
 tick(dt:number,enemies:readonly CoreEnemy[],players:readonly PlayerController[]){
  this.quiet=Math.max(0,this.quiet-dt);this.bossCooldown-=dt;
  for(const [e,s] of this.states)if(e.state!=='alive'||!enemies.includes(e)){this.remove(s.fx);this.states.delete(e);}
  if(this.blast){
   const b=this.blast;
   if(b.enemy.state!=='alive'||b.enemy.isPhased||!enemies.includes(b.enemy)){this.remove(b.fx);this.blast=undefined;this.quiet=1;return;}
   b.left-=dt;
   (b.fx.material as THREE.MeshBasicMaterial).opacity=b.fired?.08:.12+.12*(.5+.5*Math.sin(b.left*12));
   if(b.left<=0){
    if(!b.fired){
     b.fired=true;b.left=BOSS_BLAST.recover;
     for(const p of players)if(!p.isDead&&insideBossBlast(p.worldPosition,b.center))this.hooks.hit(p,Math.min(BOSS_BLAST.damage,p.spec.vitals.maxHp*.25),b.center);
    }else{this.remove(b.fx);this.blast=undefined;this.bossCooldown=BOSS_BLAST.cooldown;this.quiet=1;}
   }
   return;
  }
  if(this.bossCooldown>0||this.quiet>0)return;
  // One warning at a time, even for shared-health or twin bosses. Do not overlap an elite's committed attack.
  if([...this.states.values()].some(s=>s.kind==='leap'||s.kind==='shot'||s.kind==='rush'))return;
  const boss=enemies.find(e=>e.deployRole==='boss'&&e.state==='alive'&&!e.isPhased&&!e.isStaggered&&players.some(p=>!p.isDead&&p.worldPosition.distanceTo(e.group.position)<55));
  if(!boss)return;
  const c=boss.group.position.clone();
  // SphereGeometry has x=-cos(phi), z=sin(phi). Omit the +X refuge wedge.
  const fx=new THREE.Mesh(new THREE.SphereGeometry(BOSS_BLAST.radius,48,24,-Math.PI*3/4,Math.PI*1.5),new THREE.MeshBasicMaterial({color:0xff643d,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false}));
  fx.position.copy(c);this.scene.add(fx);this.blast={enemy:boss,center:c,left:BOSS_BLAST.warn,fired:false,fx};
 }
 /** True means handled: the manager must not also run legacy contact/dash/leap attacks. */
 step(e:CoreEnemy,target:THREE.Vector3,player:PlayerController,dt:number):boolean {
  if(e.deployRole==='boss'){
   if(this.bossBusy){this.hold(e,target,dt);return true;}
   return false;
  }
  if(e.deployRole!=='elite')return false;
  let s=this.states.get(e);if(!s){s={kind:'idle',left:0,leapCd:2,shotCd:1,aim:new THREE.Vector3()};this.states.set(e,s);}
  s.leapCd-=dt;s.shotCd-=dt;
  if(this.bossBusy||e.isPhased||e.isStaggered||player.isDead){this.remove(s.fx);s.fx=undefined;s.kind='recover';s.left=ELITE_COMBAT.recover;this.hold(e,target,dt);return true;}
  const pos=e.group.position;
  if(s.kind!=='idle'){
   this.hold(e,target,dt);s.left-=dt;
   if(s.left>0)return true;
   if(s.kind!=='recover')e.visualAttackLeft=.3;
   if(s.kind==='shot'){
    // Shot direction is committed during warning; lateral movement or cover defeats it.
    const a=s.aim.clone().sub(pos),p=target.clone().sub(pos),length=a.length();a.normalize();
    const along=p.dot(a),miss=p.clone().addScaledVector(a,-along).length();
    if(along>0&&along<=length+3&&miss<2&&this.hooks.visible(pos,target))this.hooks.hit(player,ELITE_COMBAT.shotDamage,pos);
    this.hooks.beam(pos,s.aim,e.color);
   }else if(s.kind==='rush'){
    const end=s.aim.clone(),delta=end.clone().sub(pos),length=delta.length(),dir=delta.clone().normalize();
    const toPlayer=target.clone().sub(pos),along=Math.max(0,Math.min(length,toPlayer.dot(dir)));
    const closest=pos.clone().addScaledVector(dir,along);
    if(this.hooks.visible(pos,end)){
     if(closest.distanceTo(target)<3&&this.hooks.visible(pos,target))this.hooks.hit(player,ELITE_COMBAT.contactDamage,pos);
     this.hooks.beam(pos,end,e.color);pos.copy(end);
    }
   }else if(s.kind==='leap'){
    if(this.hooks.visible(s.aim,target)&&s.aim.distanceTo(target)>=12){this.hooks.beam(pos,s.aim,e.color);pos.copy(s.aim);e.resetZenoExposure();}
    s.leapCd=ELITE_COMBAT.leapCooldown;
   }
   this.remove(s.fx);s.fx=undefined;
   if(s.kind==='recover')s.kind='idle';else{s.kind='recover';s.left=ELITE_COMBAT.recover;}
   return true;
  }
  const distance=pos.distanceTo(target);
  if(s.leapCd<=0&&distance>ELITE_COMBAT.near){
   const dest=this.hooks.destination(target);
   if(dest){s.aim.copy(dest);s.kind='leap';s.left=ELITE_COMBAT.leapWarn;s.fx=this.line(pos,dest,0xb49aff);const marker=new THREE.Mesh(new THREE.TorusGeometry(2,.12,6,32),new THREE.MeshBasicMaterial({color:0xb49aff}));marker.rotation.x=Math.PI/2;marker.position.copy(dest);this.scene.add(marker);s.fx.add(marker);marker.position.sub(s.fx.position);this.hold(e,target,dt);return true;}
   s.leapCd=2;
  }
  if(distance>=ELITE_COMBAT.rangedMin&&distance<=ELITE_COMBAT.rangedMax&&s.shotCd<=0&&this.hooks.visible(pos,target)){
   s.kind='shot';s.left=ELITE_COMBAT.shotWarn;s.shotCd=ELITE_COMBAT.shotCooldown;s.aim.copy(target);s.fx=this.line(pos,target,0xffc467);this.hold(e,target,dt);return true;
  }
  if(distance<=ELITE_COMBAT.near&&s.shotCd<=0&&this.hooks.visible(pos,target)){
   s.kind='rush';s.left=1.2;s.shotCd=3;s.aim.copy(target);s.fx=this.line(pos,target,0xff7850);this.hold(e,target,dt);return true;
  }
  e.update(dt,target,1);

  return true;
 }
 clear(){for(const s of this.states.values())this.remove(s.fx);this.states.clear();this.remove(this.blast?.fx);this.blast=undefined;this.bossCooldown=5;this.quiet=0;}
}
