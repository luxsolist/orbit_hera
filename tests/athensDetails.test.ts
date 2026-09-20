import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {applyAthensDetail} from '../src/world/cities/AthensDetail';
import {athensArchitectureGeometry,athensSiteGeometry} from '../src/world/cities/AthensArchitecture';
import index from '../src/world/cities/athens-detail-index.json';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
it('binds Athens source footprints once, keeps terrain/roads intact and leaves other cities untouched',()=>{
 let buildings=0,sites=0;
 for(const key of index.chunks){const [x,z]=key.split('_').map(Number),raw=read(`public/maps/37/23/${Math.floor(x/16)}_${Math.floor(z/16)}/${key}.json`),d=read(`public/maps/details/athens/${key}.json`),before=JSON.stringify(raw);
  expect(applyAthensDetail([41,12],raw,d)).toBe(raw);
  const result=applyAthensDetail([37,23],raw,d);expect(JSON.stringify(raw)).toBe(before);expect(result.terrain.heights).toEqual(raw.terrain.heights);expect(result.objects.roads).toEqual(raw.objects.roads);expect(applyAthensDetail([37,23],result,d)).toBe(result);
  for(const b of result.objects.buildings){if(!b.seoulArchitecture?.kind.startsWith('athens-'))continue;buildings++;
   const g=athensArchitectureGeometry(b,x*1024,z*1024,0)!;expect(g).toBeTruthy();expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);expect(g.getAttribute('position').count).toBeLessThan(200000);g.computeBoundingBox();expect(g.boundingBox!.max.y,b.n).toBeLessThanOrEqual(b.seoulArchitecture.h+.5);expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-.01);g.dispose();
  }
  for(const site of d.athensSites??[]){sites++;const g=athensSiteGeometry(site,x*1024,z*1024,()=>20)!;expect(g).toBeTruthy();expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);g.computeBoundingBox();expect(g.boundingBox!.max.y,site.name).toBeLessThanOrEqual(20.1+site.h+.5);g.dispose();}
  for(const p of d.remove)expect(result.objects.buildings.some(b=>JSON.stringify(b.p)===JSON.stringify(p))).toBe(false);
 }
 expect(buildings).toBe(5);expect(sites).toBe(5);
});
