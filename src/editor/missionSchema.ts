import type {MissionSpecV2} from '../game/missionV2';
import {runnableV2,deployKillCredits} from '../game/missionV2';
export const roles={rusher:'거머리',kiter:'모기',marker:'소인체',elite:'정예',boss:'보스'};
export const goals:Record<string,object>={purge:{type:'purge',count:6},'purge-all':{type:'purge-all'},'purge-role':{type:'purge-role',role:'rusher'},survive:{type:'survive',seconds:180},guard:{type:'guard',target:'landmarks',hold:180},experiment:{type:'experiment',targets:2,hold:10},'free-roam':{type:'free-roam'}};
export const goalNames:Record<string,string>={purge:'섬멸 수량 달성','purge-all':'전체 섬멸','purge-role':'특정 종류 섬멸',survive:'시간 생존',guard:'도시 / 랜드마크 방어',experiment:'동시 관측 유지','free-roam':'자유 탐방'};
export const deployments:Record<string,object>={roster:{model:'roster',units:[{role:'rusher',count:6,hp:1000}],spawnRadius:200},pyramid:{model:'pyramid',count:6,totalHp:168182,bossHp:100000,concurrentCap:3,reinforceInterval:1.5,spawnRadius:1500},horde:{model:'horde',count:20,unitHp:1000,concurrentCap:10,reinforceInterval:2,spawnRadius:400},boss:{model:'boss',bossHp:100000,projections:1,escort:[],spawnRadius:300},phased:{model:'phased',phases:[{deploy:{model:'roster',units:[{role:'rusher',count:6,hp:1000}],spawnRadius:200}}]},none:{model:'none'}};
export function validateMission(value:unknown,cities:string[]):asserts value is MissionSpecV2 {
 const m=value as MissionSpecV2;
 const fail=(message:string):never=>{throw new Error(message);};
 if(!m||typeof m!=='object'||! /^[a-z0-9][a-z0-9_-]{0,79}$/.test(m.id))fail('ID는 영문 소문자·숫자·하이픈으로 입력하세요.');
 if(typeof m.name!=='string'||!m.name.trim()||m.name.length>200)fail('미션 이름을 입력하세요.');
 if(m.brief!==undefined&&(typeof m.brief!=='string'||m.brief.length>4000))fail('설명은 4000자 이내입니다.');
 if(m.cityId&&!cities.includes(m.cityId))fail('등록된 도시를 선택하세요.');
 const num=(v:unknown,label:string,min=0,max=1e9,integer=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(integer&&!Number.isInteger(v)))fail(label+' 값이 올바르지 않습니다.');};
 num(m.stage??1,'단계',1,1000,true);num(m.zoneRadius,'작전 반경');
 if(!m.fail||!m.goal||!m.deploy)fail('종료 조건과 투입 구성이 필요합니다.');
 num(m.fail.respawns,'리스폰',-1,1000,true);for(const k of ['timeLimit','maxBuildingLoss','maxLandmarkLoss'] as const)num(m.fail[k],k);
 const g=m.goal;if(!goals[g.type])fail('현재 게임에서 지원하지 않는 미션 종류입니다.');
 if(g.type==='purge')num(g.count,'격파 수',1,100000,true);
 if(g.type==='survive')num(g.seconds,'생존 시간',1);
 if(g.type==='guard'){if(!['landmarks','buildings'].includes(g.target))fail('방어 대상 오류');num(g.hold,'방어 시간',1);}
 if(g.type==='experiment'){num(g.targets,'관측 대상 수',1,2048,true);num(g.hold,'관측 유지 시간',.1);}
 if(g.type==='purge-role'&&!Object.keys(roles).includes(g.role))fail('대상 종류 오류');
 function units(list:any){if(!Array.isArray(list)||list.length>100)fail('유닛 목록 오류');list.forEach((u:any,i:number)=>{if(!u||!Object.keys(roles).includes(u.role))fail('플라즈모이드 종류 오류');num(u.count,'수량',1,2048,true);num(u.hp,'체력',1);if(u.shield!==undefined)num(u.shield,'방어 배율',0,1);if(u.formation&&!['cluster','ring','line'].includes(u.formation))fail('진형 오류');if(u.behavior&&!['hunt','hold','patrol','escort'].includes(u.behavior))fail('행동 오류');if(u.behavior==='escort')num(u.anchor,'호위 대상',0,i-1,true);});}
 function deploy(d:any,depth=0){if(!d||!deployments[d.model])fail('투입 방식 오류');if(d.model==='none')return;if(d.model==='phased'){if(depth||!Array.isArray(d.phases)||!d.phases.length||d.phases.length>50)fail('페이즈 구성 오류');d.phases.forEach((p:any)=>{if(!p.deploy||['phased','none'].includes(p.deploy.model))fail('페이즈 투입 오류');if(p.afterSec!==undefined)num(p.afterSec,'투입 시각');deploy(p.deploy,1);});return;}num(d.spawnRadius,'스폰 반경');if(d.model==='roster'){units(d.units);if(!d.units.length)fail('유닛을 추가하세요.');}if(d.model==='boss'){num(d.bossHp,'보스 체력',1);if(d.projections!==undefined)num(d.projections,'투영 수',1,20,true);if(d.groups!==undefined)num(d.groups,'보스 그룹',1,20,true);if(d.escort)units(d.escort);if(d.emit){units([d.emit]);num(d.emit.interval,'분출 간격',.1);}if(d.healLink){num(d.healLink.range,'회복 거리');num(d.healLink.rate,'회복량');}}if(['horde','pyramid'].includes(d.model)){num(d.count,'투입 수',1,100000,true);num(d.concurrentCap,'동시 투입 수',0,2048,true);num(d.reinforceInterval,'증원 간격',.01);if(d.model==='horde')num(d.unitHp,'체력',1);else{num(d.totalHp,'총 체력',1);num(d.bossHp,'보스 체력',1);}}}
 deploy(m.deploy);
 if(m.modifiers){
  const mod=m.modifiers;
  for(const k of ['sweepPeriodMul','freqRegenMul','leapChanceMul','leapCdMul','offTargetPenalty'] as const)if(mod[k]!==undefined)num(mod[k],k,0,10000);
  if(mod.aggro&&!['player','landmark','building'].includes(mod.aggro))fail('공격 대상 오류');
  if(mod.buildingBrands!==undefined&&typeof mod.buildingBrands!=='boolean')fail('건물 낙인 설정 오류');
  if(mod.zoneShrink){num(mod.zoneShrink.everySec,'구역 축소 주기',.1);num(mod.zoneShrink.step,'축소 거리',0);num(mod.zoneShrink.minRadius,'최소 반경',0);}
 }

 if(!runnableV2(m))fail('승리 조건과 투입 구성이 호환되지 않습니다. 대상 종류 / 보스 분출 설정을 확인하세요.');
 if(g.type==='purge'&&g.count>deployKillCredits(m.deploy))fail('격파 목표가 총 투입 수보다 많습니다.');
}
