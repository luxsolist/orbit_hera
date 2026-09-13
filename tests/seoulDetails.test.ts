import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {applySeoulDetail,seoulArchitectureGeometry,type SeoulDetail} from '../src/world/cities/SeoulDetail';
import index from '../src/world/cities/seoul-detail-index.json';
import {correctJamsilChunk} from '../src/world/cities/jamsilCorrection';
import {correctGyeongbokgungChunk} from '../src/world/cities/Gyeongbokgung';
import {correctPalaceSite} from '../src/world/cities/PalaceSite';
import type {WorldChunk} from '../src/world/chunkManifest';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const load=(key:string)=>{const [x,z]=key.split('_').map(Number);return read(`public/maps/37/126/${Math.floor(x/16)}_${Math.floor(z/16)}/${key}.json`) as WorldChunk;};
const detail=(key:string)=>read(`public/maps/details/seoul/${key}.json`) as SeoulDetail;
const corrected=(key:string)=>{const raw=load(key);return applySeoulDetail([37,126],correctPalaceSite([37,126],correctGyeongbokgungChunk([37,126],correctJamsilChunk([37,126],raw))),detail(key));};
describe('Seoul source-bound landmark detail',()=>{
 it('covers all registered targets and every advertised patch is readable',()=>{
  expect(index.targets).toHaveLength(37);
  for(const target of index.targets){expect(target.sha256).toMatch(/^[a-f0-9]{64}$/);const x=(target.lon-126)*88316.0938412203,z=(38-target.lat)*111320;expect(index.chunks).toContain(`${Math.floor(x/1024)}_${Math.floor(z/1024)}`);}
  for(const key of index.chunks)expect(detail(key).buildings).toBeInstanceOf(Array);
 });
 it('does not mutate source, unrelated cities or unknown heights',()=>{
  const raw=load('85_45'),d=detail('85_45'),before=JSON.stringify(raw);expect(applySeoulDetail([35,129],raw,d)).toBe(raw);
  const out=applySeoulDetail([37,126],raw,d);expect(applySeoulDetail([37,126],out,d)).toBe(out);expect(JSON.stringify(raw)).toBe(before);
  for(const b of raw.objects.buildings){const ref=d.buildings.find(a=>JSON.stringify(a.p)===JSON.stringify(b.p));if(ref&&!ref.h){const next=out.objects.buildings.find(a=>JSON.stringify(a.p)===JSON.stringify(b.p));expect(next?.h).toBe(b.h);}}
 });
 it('renders one Lotte tower instead of four nested 555m towers',()=>{
  const c=corrected('95_52');const towers=c.objects.buildings.filter(b=>b.seoulArchitecture?.kind==='lotte');expect(towers).toHaveLength(1);
  const g=seoulArchitectureGeometry(towers[0],95*1024,52*1024,20)!;g.computeBoundingBox();expect(g.boundingBox!.max.y-20).toBeCloseTo(555,2);g.dispose();
 });
 it('removes nested modern-looking extrusions from the Sungnyemun gate',()=>{
  const c=corrected('84_47');const gate=c.objects.buildings.find(b=>b.seoulArchitecture?.name==='숭례문');
  expect(gate).toBeTruthy();const d=detail('84_47');expect(d.remove!.length).toBeGreaterThanOrEqual(2);
  for(const p of d.remove!)expect(c.objects.buildings.some(b=>JSON.stringify(b.p)===JSON.stringify(p))).toBe(false);
 });
 it('preserves existing three palace assets and the palace terrain patch',()=>{
  for(const key of ['84_45','84_46']){const raw=correctPalaceSite([37,126],correctGyeongbokgungChunk([37,126],load(key))),out=applySeoulDetail([37,126],raw,detail(key));
   for(const b of raw.objects.buildings.filter(b=>b.landmarkModel||b.palaceBuildingId))expect(out.objects.buildings).toContain(b);
  }
 });
 it('every architectural replacement produces finite bounded geometry',()=>{
  let count=0;
  for(const key of index.chunks){const c=corrected(key);for(const b of c.objects.buildings){if(!b.seoulArchitecture)continue;const g=seoulArchitectureGeometry(b,c.cx*1024,c.cz*1024,30,29)!;
   expect(g,b.n).toBeTruthy();const positions=g.getAttribute('position');expect(positions.count,b.n).toBeLessThan(200000);expect(Array.from(positions.array).every(Number.isFinite),b.n).toBe(true);g.computeBoundingBox();expect(g.boundingBox!.max.y,b.n).toBeLessThan(900);g.dispose();count++;
  }}expect(count).toBeGreaterThan(300);
 },30000);
 it('water-bed corrections leave shared tile borders consistent',()=>{
  const cache=new Map(index.chunks.map(key=>[key,corrected(key)]));
  for(const [key,c] of cache){const n=c.terrain.size;const east=cache.get(`${c.cx+1}_${c.cz}`),south=cache.get(`${c.cx}_${c.cz+1}`);
   for(let i=0;i<n;i++){if(east)expect(c.terrain.heights[i*n+n-1],key+' east').toBeCloseTo(east.terrain.heights[i*n],2);if(south)expect(c.terrain.heights[(n-1)*n+i],key+' south').toBeCloseTo(south.terrain.heights[i],2);}
  }
 });
});
