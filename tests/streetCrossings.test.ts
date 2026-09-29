import {it,expect} from 'vitest';
// @ts-expect-error common build helper
import {crossingHeight} from '../scripts/street-crossings.mjs';
it('bridges a depressed river bed with a bank-to-bank profile without lifting adjacent land',()=>{
 const roads=[{p:[0,0,20,0],w:6}],sample=(x:number)=>x<0?10:x>20?12:-4;
 expect(crossingHeight(roads,sample,10,0,-4)).toBe(11);
 expect(crossingHeight(roads,sample,10,20,-4)).toBe(-4);
 expect(crossingHeight(roads,sample,10,0,15)).toBe(15);
});
