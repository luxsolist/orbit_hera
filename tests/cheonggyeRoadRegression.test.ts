import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {applyRoadGradePatch} from '../src/world/RoadGradePatch';
import {chunkTerrainEntry,sampleChunkHeight} from '../src/world/chunkMesh';
import {applySeoulDetail} from '../src/world/cities/SeoulDetail';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
it('repairs the reported 37.568149,126.987684 road after runtime Seoul overrides',()=>{
 const raw=read('public/maps/37/126/5_2/85_46.json'),patch=read('public/maps/road-grade/37/126/85_46.json');
 const corrected=applySeoulDetail([37,126],applyRoadGradePatch(raw,patch),read('public/maps/details/seoul/85_46.json'));
 const terrain=chunkTerrainEntry(corrected,1024)!,before=chunkTerrainEntry(raw,1024)!;
 const x=(126.987684-126)*88316.0938412203,z=(38-37.568149)*111320;
 const samples=Array.from({length:13},(_,i)=>sampleChunkHeight(terrain,x,48000+i*8));
 expect(Math.max(...samples)-Math.min(...samples)).toBeLessThan(5);
 for(let i=1;i<samples.length;i++)expect(Math.abs(samples[i]-samples[i-1])/8).toBeLessThan(.11);
 expect(sampleChunkHeight(before,x,48032)-sampleChunkHeight(terrain,x,48032)).toBeGreaterThan(18);
 expect(sampleChunkHeight(terrain,x,z)).toBeLessThan(42);
});

it('removes the 37.570548,126.982971 peak after runtime Seoul overrides',()=>{
 const raw=read('public/maps/37/126/5_2/84_46.json'),patch=read('public/maps/road-grade/37/126/84_46.json');
 const corrected=applySeoulDetail([37,126],applyRoadGradePatch(raw,patch),read('public/maps/details/seoul/84_46.json'));
 const terrain=chunkTerrainEntry(corrected,1024)!,before=chunkTerrainEntry(raw,1024)!;
 const x=(126.982971-126)*88316.0938412203,z=(38-37.570548)*111320;
 expect(sampleChunkHeight(before,x,z)).toBeGreaterThan(100);
 expect(sampleChunkHeight(terrain,x,z)).toBeGreaterThan(38);
 expect(sampleChunkHeight(terrain,x,z)).toBeLessThan(46);
 const samples=Array.from({length:17},(_,i)=>sampleChunkHeight(terrain,x,47744+i*8));
 expect(Math.max(...samples)-Math.min(...samples)).toBeLessThan(6);
 for(let i=1;i<samples.length;i++)expect(Math.abs(samples[i]-samples[i-1])/8).toBeLessThan(.12);
 // Cross-street approaches must also remain continuous, not just the exact point.
 const cross=Array.from({length:9},(_,i)=>sampleChunkHeight(terrain,86784+i*8,z));
 for(let i=1;i<cross.length;i++)expect(Math.abs(cross[i]-cross[i-1])/8).toBeLessThan(.13);
});
