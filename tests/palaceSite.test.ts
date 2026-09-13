import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {correctPalaceSite,palaceSiteBuilding,inPalace} from '../src/world/cities/PalaceSite';
import site from '../src/world/cities/gyeongbokgung-site.json';
import type {WorldChunk} from '../src/world/chunkManifest';
const chunk=(cx:number,cz:number)=>JSON.parse(readFileSync(`public/maps/37/126/${Math.floor(cx/16)}_${Math.floor(cz/16)}/${cx}_${cz}.json`,'utf8')) as WorldChunk;
it('preserves other cities and source inputs while converting matched palace buildings',()=>{
 const raw=chunk(84,45),before=JSON.stringify(raw);expect(correctPalaceSite([35,129],raw)).toBe(raw);
 const out=correctPalaceSite([37,126],raw);expect(correctPalaceSite([37,126],out)).toBe(out);expect(JSON.stringify(raw)).toBe(before);expect(out.objects.buildings.some(b=>b.palaceBuildingId)).toBe(true);
 expect(out.objects.buildings.length).toBeGreaterThanOrEqual(raw.objects.buildings.length);
});
it('keeps shared terrain edges equal and leaves vertices outside palace untouched',()=>{
 const a=chunk(84,45),b=chunk(84,46),aa=correctPalaceSite([37,126],a),bb=correctPalaceSite([37,126],b),n=a.terrain.size;
 for(let i=0;i<n;i++)expect(aa.terrain.heights[(n-1)*n+i]).toBeCloseTo(bb.terrain.heights[i],4);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++)if(!inPalace(84*1024+i*32,45*1024+j*32))expect(aa.terrain.heights[j*n+i]).toBe(a.terrain.heights[j*n+i]);
});
it('all matched compounds have finite roof geometry including courtyard holes',()=>{
 for(const b of site.buildings.filter(b=>b.match)){
  const g=palaceSiteBuilding(b.id,86000,46500,40)!;expect(g).toBeTruthy();expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);expect(g.getAttribute('position').count).toBeLessThan(100000);g.dispose();
 }
});
