import * as THREE from 'three';
import type {Input} from './Input';
import {CombatMetrics} from './CombatMetrics';
import type {PlayerController} from '../player/PlayerController';
import type {EnemyManager} from '../enemies/EnemyManager';
import type {MissionSpecV2} from '../game/missionV2';

/** Explicit development-only benchmark. Uses real input, weapons, AI and rendering. */
export class RiftBalanceReview {
 readonly seed:number;
 readonly mode:string;
 readonly drone:string;
 readonly autoDamageMultiplier:number;
 readonly metrics=new CombatMetrics();
 readonly mission:MissionSpecV2={id:'rift-review',name:'중력이상지대 비교 측정',brief:'자동 조준 비교 · 성장/캠페인 저장 제외',goal:{type:'survive',seconds:120},fail:{respawns:0,timeLimit:0,maxBuildingLoss:0,maxLandmarkLoss:0},deploy:{model:'roster',spawnRadius:180,units:[{role:'rusher',count:4,hp:240},{role:'kiter',count:4,hp:240},{role:'elite',count:1,hp:900}]},zoneRadius:1200};
 private output=document.createElement('pre');
 private panel=document.createElement('section');
 private active=false;
 private reason='대기';
 private priorHp=0;
 private damage=0;
 private firstActive:number|null=null;
 private firstShot:number|null=null;
 private firstHit:number|null=null;
 private firstKill:number|null=null;
 private shots=0;
 private exposure=0;
 private updateAt=0;
 private startPosition:number[]=[];
 private runId=0;
 constructor(start:()=>void){
  const q=new URLSearchParams(location.search);this.seed=Number(q.get('seed'))||19;this.mode=q.get('mode')||'stationary';this.drone=q.get('drone')==='flyer'?'flyer':'walker';this.autoDamageMultiplier=this.drone==='walker'&&q.get('boost')==='10'?1.1:1;
  if(this.mission.deploy.model==='roster')this.mission.deploy.spawnRadius=q.get('distance')==='far'?400:180;
  this.panel.id='riftBalanceReview';this.panel.style.cssText='position:fixed;left:10px;top:10px;z-index:10000;background:#07121ee8;color:#cfefff;padding:10px;font:12px monospace;max-width:420px;max-height:85vh;overflow:auto;pointer-events:auto';
  const title=document.createElement('div');title.textContent=`밸런스 측정 · ${this.drone} · ${this.mode} · seed ${this.seed} · 공격 ${this.autoDamageMultiplier}배`;
  const button=document.createElement('button');button.textContent='측정 시작';button.onclick=()=>{button.disabled=true;start();};
  this.panel.append(title,button);
  const collapse=document.createElement('button');collapse.textContent='측정값 접기';collapse.onclick=()=>{this.output.hidden=!this.output.hidden;collapse.textContent=this.output.hidden?'측정값 펼치기':'측정값 접기';};this.panel.append(collapse);
  for(const [label,drone,mode] of [['워커 정지','walker','stationary'],['워커 이동','walker','strafe'],['플라이어 이동','flyer','strafe'],['플라이어 정지','flyer','stationary'],['플라이어 고도 600m','flyer','high'],['플라이어 이상지대 통과','flyer','cross'],['이상지대 내부 화면','flyer','inside']]){
   const a=document.createElement('a');const u=new URL(location.href);u.searchParams.set('drone',drone);u.searchParams.set('mode',mode);a.href=u.href;a.textContent=label;a.style.cssText='color:#8edfff;display:inline-block;margin:6px';this.panel.append(a);
  }
  this.output.id='riftBalanceResult';this.output.style.cssText='white-space:pre-wrap;margin:6px 0';this.output.textContent='45초 또는 첫 파괴까지. 직접 입력/창 숨김 발생 시 중단.';this.panel.append(this.output);document.body.append(this.panel);
  window.addEventListener('keydown',()=>{if(this.active)this.stop('직접 키 입력으로 무효');});
  window.addEventListener('pointerdown',e=>{if(this.active&&!this.panel.contains(e.target as Node))this.stop('직접 포인터 입력으로 무효');});
  document.addEventListener('visibilitychange',()=>{if(this.active&&document.hidden)this.stop('백그라운드 전환으로 무효');});
 }
 random=()=>{this.runId=(this.runId+0x6D2B79F5)|0;let t=this.runId^this.seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
 prepare(p:PlayerController){if(this.mode==='high')p.worldPosition.y=p.gameWorld.heightAt(p.worldPosition.x,p.worldPosition.z)+600;}
 begin(p:PlayerController,e:EnemyManager){

  if((this.mode==='cross'||this.mode==='inside')&&e.gravitySites[0]){const s=e.gravitySites[0];p.worldPosition.set(s.x,s.y,s.z+(this.mode==='inside'?125:250));}
  this.startPosition=p.worldPosition.toArray();this.priorHp=p.hp;this.active=true;this.reason='측정 중';
 }
 fired(){if(this.active){this.shots++;this.firstShot??=this.metrics.simulationSeconds;}}
 drive(input:Input,p:PlayerController,e:EnemyManager,dt:number){
  if(!this.active)return;
  const origin=p.aimOrigin;let target:THREE.Vector3|undefined;let distance=Infinity;
  for(const enemy of e.aliveEnemies){const pos=enemy.group.position;if(p.gameWorld.segmentHitsBuilding(p.worldPosition.x,p.worldPosition.y,p.worldPosition.z,pos.x,pos.y,pos.z)<=1)continue;const d=origin.distanceToSquared(pos);if(d<distance){distance=d;target=enemy.group.position;}}
  // Same bounded aim policy for both drones. No manual fire / special / target damage injection.
  if(this.mode==='strafe'&&this.metrics.simulationSeconds>=8.2)input.syntheticKeyDown('KeyD');
  if(this.mode==='cross'||this.mode==='inside'){
   const site=e.gravitySites[0];if(site)target=new THREE.Vector3(site.x,site.y,site.z-300);
   if(this.metrics.simulationSeconds>=5)input.syntheticKeyDown('KeyW');
  }
  if(!target){const site=e.gravitySites[0];if(site)target=new THREE.Vector3(site.x,site.y,site.z);}
  if(target){const d=target.clone().sub(origin).normalize();const yaw=Math.atan2(-d.x,-d.z),pitch=Math.asin(d.y);const wrap=(x:number)=>Math.atan2(Math.sin(x),Math.cos(x));const limit=2.1*dt,s=p.spec.view.mouseSensitivity;
   input.addLookDelta(-THREE.MathUtils.clamp(wrap(yaw-p.viewYaw),-limit,limit)/s,-THREE.MathUtils.clamp(pitch-p.viewPitch,-limit,limit)/s);
  }
 }
 sample(frame:number,dt:number,p:PlayerController,e:EnemyManager,finishReason?:string):boolean{
  if(!this.active)return true;
  this.metrics.sample(frame,dt,e.killCount,p.freq/p.maxFreq);
  if(e.aliveEnemies.length)this.firstActive??=this.metrics.simulationSeconds;
  if(e.killCount)this.firstKill??=this.metrics.simulationSeconds;
  const loss=Math.max(0,this.priorHp-p.hp);this.damage+=loss;this.priorHp=p.hp;if(loss)this.firstHit??=this.metrics.simulationSeconds;
  if(e.gravitySites.some(s=>s.age>=4&&p.worldPosition.distanceTo(new THREE.Vector3(s.x,s.y,s.z))<s.radius))this.exposure+=dt;
  if(finishReason)this.stop(finishReason);
  else if(this.mode==='inside'&&this.exposure>=.5)this.stop('내부 화면 확인');
  else if(p.isDead){this.metrics.died();this.stop('기체 파괴');}else if(this.metrics.simulationSeconds>=45)this.stop('45초 완료');
  if(this.metrics.seconds>=this.updateAt||!this.active){this.updateAt=this.metrics.seconds+1;this.output.textContent=JSON.stringify({status:this.reason,drone:this.drone,mode:this.mode,seed:this.seed,autoDamageMultiplier:this.autoDamageMultiplier,spawnRadius:'spawnRadius' in this.mission.deploy?this.mission.deploy.spawnRadius:null,viewport:[innerWidth,innerHeight,devicePixelRatio],start:this.startPosition,seconds:this.metrics.simulationSeconds,wallSeconds:this.metrics.seconds,hp:p.hp,maxHp:p.maxHp,damage:this.damage,remaining:e.aliveEnemies.map(a=>({role:a.deployRole,hp:a.hp})),activeEnemies:e.aliveEnemies.length,visibleEnemies:e.aliveEnemies.filter(a=>p.gameWorld.segmentHitsBuilding(p.worldPosition.x,p.worldPosition.y,p.worldPosition.z,a.group.position.x,a.group.position.y,a.group.position.z)>1).length,kills:e.killCount,shots:this.shots,firstActive:this.firstActive,firstShot:this.firstShot,firstHit:this.firstHit,firstKill:this.firstKill,fps:this.metrics.fps,p95:this.metrics.p95FrameMs,lowFrequencyPercent:this.metrics.lowFrequencyPercent,riftExposureSeconds:this.exposure,position:p.worldPosition.toArray(),sites:e.gravitySites.map(s=>({x:s.x,y:s.y,z:s.z,r:s.radius}))},null,2);}
  return !this.active;
 }
 private stop(reason:string){this.active=false;this.reason=reason;try{const result=JSON.parse(this.output.textContent??'{}');result.status=reason;this.output.textContent=JSON.stringify(result,null,2);}catch{this.output.textContent=JSON.stringify({status:reason});}}
}
