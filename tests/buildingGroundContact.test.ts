import {it,expect} from 'vitest';
import {buildingGroundRange,buildChunkMesh,disposeChunkGroup,type ChunkTerrain} from '../src/world/chunkMesh';
const terrain=(h:number[],size=3):ChunkTerrain=>({size,step:10,cellX0:0,cellZ0:0,heights:new Float32Array(h)});
it('finds a valley between wall corners',()=>{
 const t=terrain([10,-8,10,10,-8,10,10,-8,10]);
 expect(buildingGroundRange(t,[0,0,20,0,20,20,0,20])).toEqual({min:-8,max:10});
});
it('samples diagonal triangle crossings between grid lines',()=>{
 const t=terrain([0,10,10,0],2);
 const r=buildingGroundRange(t,[1,1,9,9,9,8]);
 expect(r.max).toBeCloseTo(10);expect(r.min).toBeCloseTo(2);
});
it('finds interior peaks and works after coordinate translation',()=>{
 const t=terrain([0,0,0,0,20,0,0,0,0]);
 expect(buildingGroundRange(t,[0,0,20,0,20,20,0,20]).max).toBe(20);
 t.cellX0=80000;t.cellZ0=47000;
 expect(buildingGroundRange(t,[80000,47000,80020,47000,80020,47020,80000,47020]).max).toBe(20);
});
it('keeps rendered roof and collision top together without changing terrain',()=>{
 const heights=[10,-8,10,10,-8,10,10,-8,10];
 const chunk={cx:0,cz:0,terrain:{size:3,seaLevel:0,heights},objects:{buildings:[{p:[0,0,20,0,20,20,0,20],h:3}],roads:[],water:[]},underground:null};
 const built=buildChunkMesh(chunk,20,0,0);
 try {
  expect(built.buildings[0].baseY).toBeCloseTo(-8.6);
  expect(built.buildings[0].top).toBeCloseTo(12.8);
  const pos=built.buildingMesh!.geometry.getAttribute('position');
  let max=-Infinity;for(let i=0;i<pos.count;i++)max=Math.max(max,pos.getY(i));
  expect(max).toBeCloseTo(built.buildings[0].top);expect(chunk.terrain.heights).toEqual(heights);
 } finally {disposeChunkGroup(built.group);}
});
it('flat terrain retains original roof height',()=>{
 expect(buildingGroundRange(terrain(Array(9).fill(5)),[1,1,19,1,19,19,1,19])).toEqual({min:5,max:5});
});
