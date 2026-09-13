import {it,expect} from 'vitest';
import {correctJamsilChunk} from '../src/world/cities/jamsilCorrection';
import spec from '../src/world/cities/jamsil-correction.json';
import type {WorldChunk} from '../src/world/chunkManifest';
const [x,z]=spec.center;
const box=(r:number)=>[x-r,z-r,x+r,z-r,x+r,z+r,x-r,z+r];
const chunk=(cx=95,cz=52):WorldChunk=>({cx,cz,terrain:{size:33,seaLevel:0,heights:Array.from({length:1089},(_,i)=>10+i%31)},objects:{buildings:[{p:box(35),h:555},{p:box(5),h:555,lm:'relay',n:'Lotte World Tower'},{p:box(3).map(v=>v+300),h:61}],roads:[],water:[]},underground:null});
it('consolidates malformed tower parts, preserves neighboring heights and landmark',()=>{
 const raw=chunk(),out=correctJamsilChunk([37,126],raw);
 expect(out.objects.buildings).toHaveLength(2);expect(out.objects.buildings[0]).toMatchObject({h:555,lm:'relay',n:'Lotte World Tower'});
 expect(out.objects.buildings[1].h).toBe(61);expect(raw.objects.buildings).toHaveLength(3);
});
it('does not modify other cells or distant terrain',()=>{
 const raw=chunk();expect(correctJamsilChunk([35,129],raw)).toBe(raw);const far=chunk(1,1);expect(correctJamsilChunk([37,126],far)).toBe(far);
});
it('road correction keeps shared chunk edges identical and does not mutate raw heights',()=>{
 const a=chunk(94,52),b=chunk(95,52);a.terrain.heights.fill(35);b.terrain.heights.fill(35);
 const aa=correctJamsilChunk([37,126],a),bb=correctJamsilChunk([37,126],b);
 for(let j=0;j<33;j++)expect(aa.terrain.heights[j*33+32]).toBeCloseTo(bb.terrain.heights[j*33],8);
 expect(a.terrain.heights.every(h=>h===35)).toBe(true);
 expect(bb.terrain.heights.some(h=>h===spec.roadHeight)).toBe(true);
});

it('removes orphan tower parts from the adjacent tile without requiring the main outline',()=>{
 const raw=chunk(95,53);raw.objects.buildings=[{p:box(5),h:555},{p:box(3).map(v=>v+300),h:61}];
 expect(correctJamsilChunk([37,126],raw).objects.buildings).toEqual([raw.objects.buildings[1]]);
});
it('repairs only the three audited footprints and keeps changed source heights intact',()=>{
 for(const fix of spec.heightOverrides){
  const raw=chunk(fix.cx,fix.cz);raw.objects.buildings=[{p:[...fix.poly],h:555}];
  expect(correctJamsilChunk([37,126],raw).objects.buildings[0].h).toBe(fix.height);
  raw.objects.buildings[0].h=12;
  expect(correctJamsilChunk([37,126],raw).objects.buildings[0].h).toBe(12);
 }
});
