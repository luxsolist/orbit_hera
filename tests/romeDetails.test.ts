import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {applyRomeDetail} from '../src/world/cities/RomeDetail';
import {romeArchitectureGeometry,romeSiteGeometry} from '../src/world/cities/RomeArchitecture';
import index from '../src/world/cities/rome-detail-index.json';
import catalog from '../scripts/data/landmark-catalog.json';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
it('preserves original terrain and binds Rome models once without leaking to other cities',()=>{
 let models=0,sites=0;
 for(const key of index.chunks){const [x,z]=key.split('_').map(Number),raw=read(`public/maps/41/12/${Math.floor(x/16)}_${Math.floor(z/16)}/${key}.json`),d=read(`public/maps/details/rome/${key}.json`),snapshot=JSON.stringify(raw);
  expect(applyRomeDetail([37,126],raw,d)).toBe(raw);
  const result=applyRomeDetail([41,12],raw,d);expect(JSON.stringify(raw)).toBe(snapshot);expect(result.terrain.heights).toEqual(raw.terrain.heights);expect(result.objects.roads).toEqual(raw.objects.roads);expect(applyRomeDetail([41,12],result,d)).toBe(result);
  for(const b of result.objects.buildings){if(!b.seoulArchitecture?.kind.startsWith('rome-'))continue;models++;const g=romeArchitectureGeometry(b,x*1024,z*1024,0)!;expect(g).toBeTruthy();const positions=g.getAttribute('position');expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);expect(positions.count).toBeLessThan(400000);g.computeBoundingBox();expect(g.boundingBox!.min.y,b.n).toBeGreaterThanOrEqual(-.01);expect(g.boundingBox!.max.y,b.n).toBeLessThanOrEqual(b.n==='산타 마리아 마조레 대성당'?75.1:b.seoulArchitecture.h+.1);g.dispose();}
  for(const site of d.romeSites??[]){sites++;const g=romeSiteGeometry(site,x*1024,z*1024,()=>20)!;expect(g).toBeTruthy();expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);g.dispose();}
 }
 expect(models).toBe(11);expect(sites).toBe(3);
});
it('identifies the Vatican basilica rather than the similarly named church in Monti',()=>{
 const r=catalog.cities['로마'].find(r=>r.name==='산 피에트로 대성당')!;
 expect(r.geocodeSource?.osmId).toBe(244159210);expect(r.lon).toBeLessThan(12.46);expect(r.lat).toBeGreaterThan(41.9);
});
