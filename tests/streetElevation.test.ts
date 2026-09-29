import {it,expect} from 'vitest';
// @ts-ignore build-only module
import {createElevatedStreetSampler} from '../scripts/street-elevation.mjs';
it('keeps decks above overlapping roofs and gives continuous approach heights',()=>{
 const sample=createElevatedStreetSampler(()=>10,[{p:[0,0,20,0,20,20,0,20],h:12}]);
 expect(sample(10,10,1)).toBeGreaterThan(22);
 expect(sample(10,10,2)-sample(10,10,1)).toBeCloseTo(5);
 expect(sample(300,10,1)).toBe(15);
 expect(sample(300,10,2)).toBe(20);
 for(let x=20;x<100;x++)expect(Math.abs(sample(x+1,10,1)-sample(x,10,1))).toBeLessThanOrEqual(1/6+1e-9);
});
