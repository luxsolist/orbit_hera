import {SpecialBarrage} from '../src/weapons/SpecialBarrage';
import {SpecialStream} from '../src/weapons/SpecialStream';
import {describe,it,expect,vi} from 'vitest';
import {FrequencyBeam} from '../src/weapons/FrequencyBeam';

// Exercise the real update/fire gates without allocating canvas-backed visual effects.
function beam(state:{isDead:boolean;spawnProtection:number}) {
 const fireAt=vi.fn(),fireManual=vi.fn(),acquireAutoFireTarget=vi.fn(()=>({}));
 const weapon=Object.assign(Object.create(FrequencyBeam.prototype),{
  player:{...state,freq:120,maxFreq:120},cooldown:0,autoCooldown:0,
  spec:{auto:{freqFloor:.25,freqCost:4,damage:45,fireInterval:.2},manual:{fireInterval:.15}},
  acquireAutoFireTarget,fireAt,fireManual,damageNumbers:{update(){}},beamPool:{update(){}},flashes:[],sparks:[],
 });
 return {weapon,fireAt,fireManual,acquireAutoFireTarget};
}
describe('respawn firing gates',()=>{
 it('does not acquire or fire while dead, even with manual input held',()=>{
  const b=beam({isDead:true,spawnProtection:0});b.weapon.update(.1,true);
  expect(b.acquireAutoFireTarget).not.toHaveBeenCalled();expect(b.fireAt).not.toHaveBeenCalled();expect(b.fireManual).not.toHaveBeenCalled();
 });
 it('suppresses automatic fire during protection, and resumes after cancellation',()=>{
  const b=beam({isDead:false,spawnProtection:3});b.weapon.update(.1,false);
  expect(b.acquireAutoFireTarget).not.toHaveBeenCalled();
  b.weapon.player.spawnProtection=0;b.weapon.update(.1,true);
  expect(b.fireAt).toHaveBeenCalledOnce();expect(b.fireManual).toHaveBeenCalledOnce();
 });
});

for(const Weapon of [SpecialBarrage,SpecialStream])it(`${Weapon.name} aborts while dead and ignores trigger`,()=>{
 const abort=vi.fn(),step=vi.fn(()=>({active:false,drain:0,fire:false}));
 const weapon=Object.assign(Object.create(Weapon.prototype),{player:{isDead:true,freq:120,freqRegenSuppressed:true},cycle:{abort,step},damageNumbers:{update(){}},beamPool:{update(){}}});
 weapon.update(.1,true);expect(abort).toHaveBeenCalledOnce();expect(step).toHaveBeenCalledWith(.1,false,120);expect(weapon.player.freqRegenSuppressed).toBe(false);
});
