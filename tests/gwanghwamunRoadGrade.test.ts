import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {correctGwanghwamunRoadGrade,gwanghwamunRoadGrade} from '../src/world/cities/GwanghwamunRoadGrade';
import {chunkTerrainEntry,sampleChunkHeight} from '../src/world/chunkMesh';
import type {WorldChunk} from '../src/world/chunkManifest';
const load=(cx:number,cz:number)=>JSON.parse(readFileSync(`public/maps/37/126/5_2/${cx}_${cz}.json`,'utf8')) as WorldChunk;
it('removes alternating road humps through the intersection and preserves original data',()=>{
 const raw=load(84,46),before=JSON.stringify(raw),out=correctGwanghwamunRoadGrade([37,126],raw),t=chunkTerrainEntry(out,1024)!;
 for(let z=47700;z<=48000;z+=8)expect(sampleChunkHeight(t,86300,z)).toBeCloseTo(gwanghwamunRoadGrade(86300,z),4);
 for(let x=86150;x<=86450;x+=8)expect(sampleChunkHeight(t,x,47845)).toBeCloseTo(gwanghwamunRoadGrade(x,47845),4);
 expect(JSON.stringify(raw)).toBe(before);expect(out.objects).toBe(raw.objects);
});
it('keeps adjacent tile borders identical and leaves other cities unchanged',()=>{
 const a=correctGwanghwamunRoadGrade([37,126],load(84,46)),b=correctGwanghwamunRoadGrade([37,126],load(84,47)),n=a.terrain.size;
 for(let i=0;i<n;i++)expect(a.terrain.heights[(n-1)*n+i]).toBeCloseTo(b.terrain.heights[i],5);
 const raw=load(84,46);expect(correctGwanghwamunRoadGrade([35,129],raw)).toBe(raw);
});
