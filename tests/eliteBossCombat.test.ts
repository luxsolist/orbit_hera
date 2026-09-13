import {it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {EliteBossCombat,insideBossBlast,BOSS_BLAST} from '../src/enemies/EliteBossCombat';
const enemy=(role:string,pos=new THREE.Vector3())=>({deployRole:role,state:'alive',isPhased:false,isStaggered:false,group:{position:pos},color:0xff0000,update:vi.fn(),resetZenoExposure:vi.fn()} as any);
function setup(){const hit=vi.fn();const scene=new THREE.Scene();const combat=new EliteBossCombat(scene,{visible:()=>true,destination:t=>t.clone().add(new THREE.Vector3(20,0,0)),hit,beam:vi.fn()});const player={isDead:false,spec:{vitals:{maxHp:120}},worldPosition:new THREE.Vector3(-10,0,0)} as any;return {hit,scene,combat,player};}
it('blast has exact sphere boundary and a safe wedge at ground and flight altitudes',()=>{
 const o=new THREE.Vector3();expect(insideBossBlast(new THREE.Vector3(-30,0,0),o)).toBe(true);
 expect(insideBossBlast(new THREE.Vector3(-30.1,0,0),o)).toBe(false);
 expect(insideBossBlast(new THREE.Vector3(10,10,0),o)).toBe(false);
 expect(insideBossBlast(new THREE.Vector3(-10,10,0),o)).toBe(true);
});
it('boss warns, hits once, recovers, and cancels on death',()=>{
 const {combat,player,hit,scene}=setup(),boss=enemy('boss');
 combat.tick(5,[boss],[player]);expect(combat.bossBusy).toBe(true);expect(hit).not.toHaveBeenCalled();
 combat.tick(BOSS_BLAST.warn-.01,[boss],[player]);expect(hit).not.toHaveBeenCalled();
 combat.tick(.02,[boss],[player]);expect(hit).toHaveBeenCalledTimes(1);
 combat.tick(1,[boss],[player]);expect(hit).toHaveBeenCalledTimes(1);
 boss.state='dead';combat.tick(.1,[boss],[player]);expect(scene.children).toHaveLength(0);
});
it('elite ranged warning locks aim and can be dodged',()=>{
 const {combat,player,hit}=setup(),e=enemy('elite',new THREE.Vector3(0,0,40));
 combat.step(e,player.worldPosition,player,1.1);expect(hit).not.toHaveBeenCalled();
 player.worldPosition.x+=15;combat.step(e,player.worldPosition,player,1.3);expect(hit).not.toHaveBeenCalled();
});
it('elite leap commits destination and never deals arrival contact damage',()=>{
 const {combat,player,hit}=setup(),e=enemy('elite',new THREE.Vector3(0,0,100));
 combat.step(e,player.worldPosition,player,2.1);const before=e.group.position.clone();
 combat.step(e,player.worldPosition,player,1);expect(e.group.position.equals(before)).toBe(true);
 combat.step(e,player.worldPosition,player,.6);expect(e.group.position.distanceTo(player.worldPosition)).toBe(20);expect(hit).not.toHaveBeenCalled();
});
it('boss pauses elite and cleanup removes telegraphs',()=>{
 const {combat,player,hit,scene}=setup(),boss=enemy('boss'),elite=enemy('elite',new THREE.Vector3(0,0,40));
 combat.tick(5,[boss,elite],[player]);combat.step(elite,player.worldPosition,player,3);
 expect(hit).not.toHaveBeenCalled();combat.clear();expect(scene.children).toHaveLength(0);expect(combat.bossBusy).toBe(false);
});
it('a committed elite shot delays the next boss warning',()=>{
 const {combat,player}=setup(),boss=enemy('boss'),elite=enemy('elite',new THREE.Vector3(0,0,40));
 combat.step(elite,player.worldPosition,player,1.1);combat.tick(5,[boss,elite],[player]);expect(combat.bossBusy).toBe(false);
});

it('boss damage respects flyer base durability',()=>{
 const {combat,player,hit}=setup(),boss=enemy('boss');player.spec.vitals.maxHp=60;
 combat.tick(5,[boss],[player]);combat.tick(3,[boss],[player]);expect(hit.mock.calls[0][1]).toBe(15);
});

function controlled(){
 const scene=new THREE.Scene(),hit=vi.fn(),visible=vi.fn(()=>true),destination=vi.fn((t:THREE.Vector3)=>t.clone().add(new THREE.Vector3(20,0,0)));
 const combat=new EliteBossCombat(scene,{visible,destination,hit,beam:vi.fn()});
 const player={isDead:false,spec:{vitals:{maxHp:120}},worldPosition:new THREE.Vector3(0,2,0)} as any;
 return {scene,hit,visible,destination,combat,player};
}
it.each([30,60,120])('boss warning lasts three seconds at %i fps and strikes only once',fps=>{
 const {combat,hit,player}=controlled(),boss=enemy('boss',new THREE.Vector3(10,2,0));
 combat.tick(5,[boss],[player]);
 for(let i=0;i<3*fps-1;i++)combat.tick(1/fps,[boss],[player]);
 expect(hit).not.toHaveBeenCalled();
 combat.tick(2/fps,[boss],[player]);expect(hit).toHaveBeenCalledTimes(1);
 for(let i=0;i<2*fps;i++)combat.tick(1/fps,[boss],[player]);expect(hit).toHaveBeenCalledTimes(1);
 combat.clear();
});
it('safe sector boundary, translated origin and spherical altitude are respected',()=>{
 const origin=new THREE.Vector3(100,30,-50),at=(x:number,y:number,z:number)=>origin.clone().add(new THREE.Vector3(x,y,z));
 expect(insideBossBlast(at(10,0,9.99),origin)).toBe(false);
 expect(insideBossBlast(at(10,0,10.01),origin)).toBe(true);
 expect(insideBossBlast(at(10,0,-10.01),origin)).toBe(true);
 expect(insideBossBlast(at(-10,29,0),origin)).toBe(false);
});
it('warning mesh leaves the same safe wedge as damage detection',()=>{
 const {combat,scene,player}=controlled(),boss=enemy('boss',new THREE.Vector3(10,2,0));combat.tick(5,[boss],[player]);
 const warning=scene.children[0] as THREE.Mesh;
 const positions=warning.geometry.getAttribute('position');
 for(let i=0;i<positions.count;i++){
  const x=positions.getX(i),z=positions.getZ(i);
  if(Math.hypot(x,z)>.01)expect(Math.abs(Math.atan2(z,x))).toBeGreaterThanOrEqual(Math.PI/4-1e-5);
 }
 combat.clear();
});
it('blast checks current player positions and excludes dead players',()=>{
 const {combat,hit,player}=controlled(),boss=enemy('boss',new THREE.Vector3(10,2,0));
 const dead={...player,isDead:true},safe={...player,worldPosition:new THREE.Vector3(20,2,0)};
 combat.tick(5,[boss],[player,dead,safe]);player.worldPosition.set(-100,2,0);
 combat.tick(3,[boss],[player,dead,safe]);expect(hit).not.toHaveBeenCalled();
});
it('two bosses produce only one blast and cooldown prevents an immediate repeat',()=>{
 const {combat,hit,scene,player}=controlled(),bosses=[enemy('boss',new THREE.Vector3(10,2,0)),enemy('boss',new THREE.Vector3(15,2,0))];
 combat.tick(5,bosses,[player]);expect(scene.children).toHaveLength(1);
 combat.tick(3,bosses,[player]);expect(hit).toHaveBeenCalledTimes(1);
 combat.tick(2.5,bosses,[player]);combat.tick(14.9,bosses,[player]);expect(scene.children).toHaveLength(0);
 combat.tick(.2,bosses,[player]);expect(scene.children).toHaveLength(1);combat.clear();
});
it.each(['death','phase','removed'])('boss warning is cancelled on %s',cause=>{
 const {combat,hit,scene,player}=controlled(),boss=enemy('boss',new THREE.Vector3(10,2,0));combat.tick(5,[boss],[player]);
 if(cause==='death')boss.state='dead';if(cause==='phase')boss.isPhased=true;
 combat.tick(3,cause==='removed'?[]:[boss],[player]);expect(hit).not.toHaveBeenCalled();expect(scene.children).toHaveLength(0);
});
it('elite shot hits only after warning and respects newly introduced cover',()=>{
 const {combat,hit,visible,player}=controlled(),e=enemy('elite',new THREE.Vector3(0,2,40));
 combat.step(e,player.worldPosition,player,1.1);combat.step(e,player.worldPosition,player,1);
 expect(hit).not.toHaveBeenCalled();visible.mockReturnValue(false);
 combat.step(e,player.worldPosition,player,.3);expect(hit).not.toHaveBeenCalled();combat.clear();
});
it('elite shot hits a stationary exposed player once, then recovers',()=>{
 const {combat,hit,player}=controlled(),e=enemy('elite',new THREE.Vector3(0,2,40));
 combat.step(e,player.worldPosition,player,1.1);combat.step(e,player.worldPosition,player,1.3);
 expect(hit).toHaveBeenCalledTimes(1);expect(hit.mock.calls[0][1]).toBe(8);
 combat.step(e,player.worldPosition,player,.9);expect(hit).toHaveBeenCalledTimes(1);combat.clear();
});
it.each(['dodge','cover','hit'])('elite committed rush outcome: %s',outcome=>{
 const {combat,hit,visible,player}=controlled(),e=enemy('elite',new THREE.Vector3(0,2,10));
 combat.step(e,player.worldPosition,player,1.1);expect(hit).not.toHaveBeenCalled();
 if(outcome==='dodge')player.worldPosition.x=8;if(outcome==='cover')visible.mockReturnValue(false);
 combat.step(e,player.worldPosition,player,1.3);expect(hit).toHaveBeenCalledTimes(outcome==='hit'?1:0);
 if(outcome==='cover')expect(e.group.position.z).toBe(10);combat.clear();
});
it.each(['too-close','blocked','no-destination'])('invalid elite leap never teleports: %s',reason=>{
 const {combat,hit,visible,destination,player}=controlled(),e=enemy('elite',new THREE.Vector3(0,2,100)),before=e.group.position.clone();
 if(reason==='no-destination')destination.mockReturnValue(null as any);
 combat.step(e,player.worldPosition,player,2.1);
 if(reason==='too-close')player.worldPosition.x=20;if(reason==='blocked')visible.mockReturnValue(false);
 combat.step(e,player.worldPosition,player,1.6);
 expect(e.group.position).toEqual(before);expect(hit).not.toHaveBeenCalled();combat.clear();
});
it.each(['phase','stagger','player-dead'])('elite pending shot cancels on %s',reason=>{
 const {combat,hit,scene,player}=controlled(),e=enemy('elite',new THREE.Vector3(0,2,40));combat.step(e,player.worldPosition,player,1.1);
 if(reason==='phase')e.isPhased=true;if(reason==='stagger')e.isStaggered=true;if(reason==='player-dead')player.isDead=true;
 combat.step(e,player.worldPosition,player,2);expect(hit).not.toHaveBeenCalled();expect(scene.children).toHaveLength(0);
});
it('clear disposes warning geometry/material and resets the initial cooldown',()=>{
 const {combat,scene,player}=controlled(),e=enemy('elite',new THREE.Vector3(0,2,40));combat.step(e,player.worldPosition,player,1.1);
 const line=scene.children[0] as THREE.Line,geometry=vi.spyOn(line.geometry,'dispose'),material=vi.spyOn(line.material as THREE.Material,'dispose');
 combat.clear();combat.clear();expect(geometry).toHaveBeenCalledTimes(1);expect(material).toHaveBeenCalledTimes(1);
 const boss=enemy('boss',new THREE.Vector3(10,2,0));combat.tick(4.9,[boss],[player]);expect(scene.children).toHaveLength(0);combat.tick(.2,[boss],[player]);expect(scene.children).toHaveLength(1);combat.clear();
});
