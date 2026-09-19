import {it,expect} from 'vitest';
import {solarState,cityDateAtHour,cityDateForPreset} from '../src/world/CityTime';
import {paintedSeoul,paintedBusan} from '../src/world/cities/painted';
const city=paintedSeoul.environment.clock!;
it('maps Korean civil time across UTC dates',()=>{
 expect(cityDateAtHour(new Date('2026-09-12T18:00:00Z'),0,'Asia/Seoul').toISOString()).toBe('2026-09-12T15:00:00.000Z');
});
it('separates day, night and seasons with a normalized east/south sun vector',()=>{
 const noon=solarState(new Date('2026-06-21T03:00:00Z'),city),night=solarState(new Date('2026-06-21T15:00:00Z'),city);
 expect(noon.elevation).toBeGreaterThan(70);expect(noon.night).toBe(0);expect(night.night).toBe(1);
 expect(Math.hypot(noon.x,noon.y,noon.z)).toBeCloseTo(1);
 expect(solarState(new Date('2026-12-21T03:00:00Z'),city).elevation).toBeLessThan(32);
 expect(solarState(new Date('2026-06-21T00:00:00Z'),city).x).toBeGreaterThan(0);
 expect(solarState(new Date('2026-06-21T09:00:00Z'),city).x).toBeLessThan(0);
});
it('reflects Busan latitude/longitude and transitions continuously',()=>{
 const date=new Date('2026-09-13T09:30:00Z'),a=solarState(date,city),b=solarState(date,paintedBusan.environment.clock!);
 expect(a.elevation).not.toBe(b.elevation);
 const next=solarState(new Date(+date+1000),city);expect(Math.abs(next.night-a.night)).toBeLessThan(.01);
});

it('viewer presets restore live time and select clear day/night and seasonal evening conditions',()=>{
 for(const clock of [city,paintedBusan.environment.clock!])for(const month of ['06','12']){
  const now=new Date(`2026-${month}-21T03:00:00Z`);
  expect(cityDateForPreset(now,'live',clock)).toBeUndefined();
  expect(solarState(cityDateForPreset(now,'day',clock)!,clock).dayLight).toBe(1);
  expect(solarState(cityDateForPreset(now,'night',clock)!,clock).night).toBe(1);
  const evening=cityDateForPreset(now,'twilight',clock)!;
  const state=solarState(evening,clock);
  expect(Math.abs(state.elevation-3)).toBeLessThan(1);
  expect(state.twilight).toBeGreaterThan(.9);
  expect(solarState(new Date(+evening+300000),clock).elevation).toBeLessThan(state.elevation);
 }
});
