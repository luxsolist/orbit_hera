import {readMapFixture} from './mapFixture';
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {STATUES,correctGwanghwamunStatues,statueGeometry} from '../src/world/cities/GwanghwamunStatues';
import type {WorldChunk} from '../src/world/chunkManifest';
it('replaces the false building and inserts both statues exactly once without changing neighbors',()=>{
 const raw=readMapFixture('public/maps/37/126/5_2/84_46.json') as WorldChunk;
 // Keep the historical misclassified outline in the fixture even after source maps improve.
 const old=[86268,47545,86268,47557,86280,47557,86280,47545,86277,47545,86277,47546,86277,47547,86274,47547,86271,47547,86271,47546,86271,47545];
 raw.objects.buildings=raw.objects.buildings.filter(b=>!b.statueModel&&JSON.stringify(b.p)!==JSON.stringify(old));
 raw.objects.buildings.push({p:old,h:10,n:'Gwanghwamun Square'});
 const out=correctGwanghwamunStatues([37,126],raw),twice=correctGwanghwamunStatues([37,126],out);
 expect(out.objects.buildings.filter(b=>b.statueModel)).toHaveLength(2);expect(twice).toEqual(out);
 expect(out.objects.buildings.length).toBe(raw.objects.buildings.length+1);
 expect(out.objects.buildings.some(b=>b.n==='Gwanghwamun Square')).toBe(false);
 expect(out.objects.buildings.filter(b=>!b.statueModel).every(b=>raw.objects.buildings.includes(b))).toBe(true);
 expect(correctGwanghwamunStatues([35,129],raw)).toBe(raw);
});
it('matches published total heights and bounds mesh complexity',()=>{
 for(const s of STATUES){const g=statueGeometry(s.id,s.x,s.z,30)!;g.computeBoundingBox();expect(g.boundingBox!.min.y).toBeCloseTo(30,3);expect(g.boundingBox!.max.y).toBeCloseTo(30+s.base+s.figure,3);expect(g.getAttribute('position').count).toBeLessThan(100000);expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);g.dispose();}
});
