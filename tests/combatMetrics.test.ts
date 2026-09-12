import {describe,it,expect} from 'vitest';
import {CombatMetrics} from '../src/core/CombatMetrics';
describe('CombatMetrics',()=>{
  it('uses real frame time rather than capped simulation time',()=>{
    const m=new CombatMetrics();for(let i=0;i<60;i++)m.sample(.1,.05,6,.2);
    expect(m.seconds).toBeCloseTo(6);expect(m.simulationSeconds).toBeCloseTo(3);
    expect(m.fps).toBeCloseTo(10);expect(m.killsPerMinute).toBeCloseTo(60);
    expect(m.lowFrequencyPercent).toBeCloseTo(100);expect(m.p95FrameMs).toBe(100);
  });
  it('reports weighted low frequency time and preserves first death',()=>{
    const m=new CombatMetrics();m.sample(1,.05,0,.1);m.died();
    m.sample(3,.05,1,.8);m.died();
    expect(m.lowFrequencyPercent).toBe(25);expect(m.firstDeathSeconds).toBe(1);expect(m.deaths).toBe(2);
  });
  it('rejects invalid samples and starts an independent new run',()=>{
    const m=new CombatMetrics();for(const t of [0,-1,NaN,Infinity])m.sample(t,0,0,0);
    expect(m.frames).toBe(0);expect(m.fps).toBe(0);expect(m.p95FrameMs).toBe(0);
    m.sample(1,1,2,1);const next=new CombatMetrics();expect(next.kills).toBe(0);
  });
});
