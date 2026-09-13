import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {correctGyeongbokgungChunk,palaceGeometry} from '../src/world/cities/Gyeongbokgung';
import placements from '../src/world/cities/gyeongbokgung-placement.json';
import type {WorldChunk} from '../src/world/chunkManifest';
for(const entry of placements)it(entry.name+' replaces exactly one mapped building and produces finite colored geometry',()=>{
 const raw=JSON.parse(readFileSync(`public/maps/37/126/${Math.floor(entry.cx/16)}_${Math.floor(entry.cz/16)}/${entry.cx}_${entry.cz}.json`,'utf8')) as WorldChunk;
 const before=JSON.stringify(raw);const result=correctGyeongbokgungChunk([37,126],raw);
 expect(result.objects.buildings.filter(b=>b.landmarkModel===entry.id)).toHaveLength(1);
 expect(result.objects.buildings.length).toBe(raw.objects.buildings.length);
 expect(JSON.stringify(raw)).toBe(before);expect(correctGyeongbokgungChunk([35,129],raw)).toBe(raw);
 const geometry=palaceGeometry(entry.id,entry.x,entry.z,30)!;
 expect(geometry.getAttribute('position').count).toBeGreaterThan(100);
 expect(geometry.getAttribute('position').count).toBeLessThan(100000);
 expect(Array.from(geometry.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
 expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
 expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
 geometry.computeBoundingBox();expect(geometry.boundingBox!.min.y).toBeCloseTo(30,3);
 expect(geometry.boundingBox!.max.y).toBeGreaterThan(40);geometry.dispose();
});

import {StructureBuilder} from '../src/world/StructureBuilder';
it('rejects incomplete or non-finite custom triangles',()=>{const builder=new StructureBuilder();expect(builder.partGeometry({g:'mesh',m:0,vertices:[0,0,0]})).toBeNull();expect(builder.partGeometry({g:'mesh',m:0,vertices:[0,0,0,1,0,0,0,NaN,0]})).toBeNull();});

it('extends stone support down to uneven ground without changing the roof height',()=>{
 const id=placements[0].id,a=palaceGeometry(id,0,0,40)!,b=palaceGeometry(id,0,0,40,32)!;
 a.computeBoundingBox();b.computeBoundingBox();expect(b.boundingBox!.min.y).toBeCloseTo(32);expect(b.boundingBox!.max.y).toBeCloseTo(a.boundingBox!.max.y);a.dispose();b.dispose();
});
