import {it,expect} from 'vitest';
import {streetSupportPrism,walkAccessOffset} from '../scripts/street-supports.mjs';
it('bounds terrace rise from a ground entry without increasing the authored surface',()=>{
 expect(walkAccessOffset(9,0,0,[[0,0]])).toBe(.18);
 expect(walkAccessOffset(9,2,0,[[0,0]])).toBeCloseTo(1.08);
 expect(walkAccessOffset(.1,2,0,[[0,0]])).toBe(.1);
 expect(walkAccessOffset(9,30,0,[[0,0]])).toBe(9);
});
it('support ceiling follows the actual sloping triangle',()=>{
 const p=streetSupportPrism([0,10,0,10,20,0,0,10,10],4)!;
 expect(p.topPlane).toEqual([1,0,10]);expect(p.base).toBe(6);
});
