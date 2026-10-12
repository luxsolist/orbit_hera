import {it,expect} from 'vitest';
// @ts-expect-error build script module
import {fitDeckSlots,createElevatedStreetSampler,DECK_HEADROOM} from '../scripts/street-elevation.mjs';
const sq=(x0:number,z0:number,x1:number,z1:number)=>[x0,z0,x1,z0,x1,z1,x0,z1];
it('fits deck-split slots to the baked deck height',()=>{
 const strip={level:2,p:sq(0,40,100,50)},deck=()=>45;
 const parts=[{osmId:'a',deckSplit:'a#0',passageRole:'upper-volume',groundClearance:41,h:200,p:sq(0,0,100,100),deckStrips:[strip]},
  {osmId:'a',deckSplit:'a#0',passageRole:'ground-pier',h:41,p:sq(0,0,100,40)},{osmId:'a',deckSplit:'a#0',passageRole:'deck-podium',h:30,p:strip.p},{osmId:'b',h:9,p:sq(200,0,210,10)}];
 const out=fitDeckSlots(parts,deck,[()=>0,()=>2]);
 expect(out[0].groundClearance).toBeCloseTo(45+.15+DECK_HEADROOM);expect(out[1].h).toBeCloseTo(45+.15+DECK_HEADROOM);expect(out[2].h).toBe(30);expect(out[3]).toBe(parts[3]);
 // Deck above most of the tower: the upper volume disappears, piers keep the source height.
 const tall=fitDeckSlots(parts,()=>196,[()=>0]);expect(tall.filter(b=>b.passageRole==='upper-volume')).toHaveLength(0);expect(tall[0].h).toBe(200);
});
it('raises roof decks over terrain cresting inside the footprint',()=>{
 const sample=createElevatedStreetSampler((x:number,z:number)=>Math.abs(x-50)<10&&Math.abs(z-50)<10?8:0,[{p:sq(0,0,100,100),h:10}]);
 expect(sample(50,50,1)).toBeGreaterThanOrEqual(18.15);
});
