import {it, expect} from 'vitest';
// @ts-expect-error build-time JS helpers
import {waterMetadata, normalizeWaterFeature, auditWaterFeatures, auditWaterRoadCrossings, waterChunkPieces, taggedWaterWidth} from '../scripts/water-build.mjs';
// @ts-expect-error shared build geometry
import {waterContains} from '../scripts/road-grade.mjs';
// @ts-expect-error shared OSM helper
import {mergeStrokes, surfaceWaterways, isUndergroundWaterway} from '../scripts/osm.mjs';

it('classifies each feature independently and never assumes a city stream is engineered', () => {
  const natural = waterMetadata({waterway:'stream',name:'Urban creek',width:'9.5 m'},'way/1',true);
  expect(natural).toMatchObject({w:9.5,osmId:'way/1',waterInfo:{style:'natural',styleSource:'default',widthSource:'tag'}});
  expect(waterMetadata({waterway:'canal'},'way/2',true).waterInfo.style).toBe('canal');
  expect(waterMetadata({water:'river',channelized:'yes'}).waterInfo).toMatchObject({style:'engineered',widthSource:'outline'});
  expect(waterMetadata({waterway:'river',channelized:'no'},'',true).waterInfo.style).toBe('natural');
  expect(waterMetadata({water:'lake'}).waterInfo.kind).toBe('lake');
  expect(taggedWaterWidth('20 ft')).toBe(6.1);
  for(const value of ['8-16', '-4', '0', 'unknown', '100000']) expect(taggedWaterWidth(value)).toBeNull();
});

it('keeps bends, variable-width outlines and an island through tile boundaries without land/water flips', () => {
  const source = {p:[2,2, 35,2, 35,8, 22,8, 22,29, 5,29, 5,15, 2,15],
    holes:[[8,19,12,19,12,23,8,23]], ...waterMetadata({water:'river'},'relation/3')};
  const before = structuredClone(source);
  const pieces:any[] = [...waterChunkPieces(source,(p:number[])=>p,10)];
  expect(pieces.length).toBeGreaterThan(5);
  for(let z=.37;z<32;z+=.73)for(let x=.31;x<39;x+=.71){
    const own=pieces.filter((c:any)=>c.cx===Math.floor(x/10)&&c.cz===Math.floor(z/10));
    expect(own.some((c:any)=>waterContains(x,z,c.water)), `${x},${z}`).toBe(waterContains(x,z,source));
  }
  expect(source).toEqual(before);
  for(const p of pieces)expect(p.water).toMatchObject({osmId:'relation/3',waterInfo:source.waterInfo});
});

it('keeps line-river width across tiles that contain only its bank, including meanders', () => {
  const source={p:[2,9, 8,9, 17,11, 26,7], ...waterMetadata({waterway:'stream',width:'4'},'way/4',true)};
  const pieces:any[]=[...waterChunkPieces(source,(p:number[])=>p,10)];
  expect(pieces.some((c:any)=>c.cx===0&&c.cz===1)).toBe(true);
  for(let z=4.13;z<15;z+=.37)for(let x=.17;x<29;x+=.41){
    const own=pieces.filter((c:any)=>c.cx===Math.floor(x/10)&&c.cz===Math.floor(z/10));
    expect(own.some((c:any)=>waterContains(x,z,c.water)),`${x},${z}`).toBe(waterContains(x,z,source));
  }
});

it('preserves narrow polygon branches and small islands instead of rounding them to whole metres',()=>{
  const source={p:[1,.2,19,.2,19,.6,1,.6],holes:[[9.8,.3,10.2,.3,10.2,.5,9.8,.5]],...waterMetadata({waterway:'canal'},'way/5')};
  const pieces:any[]=[...waterChunkPieces(source,(p:number[])=>p,10)];
  expect(pieces).toHaveLength(2);
  for(const x of [9.85,10.15]){
    const part=pieces.find((c:any)=>c.cx===Math.floor(x/10)).water;
    expect(waterContains(x,.4,part)).toBe(false);
    expect(waterContains(x,.25,part)).toBe(true);
  }
});

it('does not merge a ground approach, bridge or tunnel even when widths and tangents match',()=>{
  const roads=[
    {p:[0,0,10,0],w:8,bridge:false,layer:0},
    {p:[10,0,20,0],w:8,bridge:true,layer:1},
    {p:[20,0,30,0],w:8,bridge:true,layer:1},
    {p:[30,0,40,0],w:8,tunnel:true,layer:-1},
    {p:[40,0,50,0],w:8,layer:0},
  ];
  const merged:any[]=mergeStrokes(roads);
  expect(merged).toHaveLength(4);
  expect(merged.find(r=>r.bridge)).toMatchObject({layer:1});
  expect(merged.find(r=>r.bridge).p).toHaveLength(6);
  expect(merged.find(r=>r.tunnel)).toMatchObject({layer:-1});
});

it('hides only a culvert and keeps the natural river upstream and downstream',()=>{
  const parts=[{p:[0,0,10,0],culverted:false,stream:true},{p:[10,0,20,0],culverted:true,stream:true},{p:[20,0,30,0],culverted:false,stream:true}];
  expect(surfaceWaterways(parts)).toEqual([parts[0],parts[2]]);
  expect(isUndergroundWaterway({tunnel:'no'})).toBe(false);
});

it('reports missing ground crossings but excludes bridges, tunnels and roads on islands',()=>{
  const water=[{p:[0,0,20,0,20,20,0,20],holes:[[7,7,13,7,13,13,7,13]],...waterMetadata({water:'river'},'relation/8')}];
  const p=[-10,4,30,4], roads=[{p,w:8},{p,w:8,bridge:true,layer:1},{p,w:8,tunnel:true},{p:[8,10,12,10],w:2}];
  const audit=auditWaterRoadCrossings(water,roads);
  expect(audit.groundRoadConflicts).toBe(1);
  expect(audit.gradeSeparatedRoads).toBe(2);
  expect(audit.unclassifiedRoads).toBe(2);
  expect(audit.examples[0]).toMatchObject({road:0,water:'relation/8'});
});

it('marks old data honestly and rejects broken water input before a map rebuild',()=>{
  const source={p:[0,0,10,0],w:6}, legacy=normalizeWaterFeature(source);
  expect(legacy.waterInfo).toMatchObject({style:'natural',styleSource:'legacy',widthSource:'legacy'});
  expect(source).not.toHaveProperty('waterInfo');
  const good=auditWaterFeatures([legacy]);expect(good.errors).toEqual([]);expect(good.legacy).toBe(1);
  const bad=auditWaterFeatures([{...legacy,p:[0,NaN,10,0]},{...legacy,w:-1},{...legacy,waterInfo:{...legacy.waterInfo,style:'concrete-everywhere'}}]);
  expect(bad.errors).toHaveLength(3);
});
