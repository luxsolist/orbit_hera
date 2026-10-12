import {it,expect} from 'vitest';
// @ts-expect-error build script module
import {coastIndex,coastSide,applyCoastline} from '../scripts/coastline.mjs';
// Lattice frame: x east, z south. OSM coastlines keep land on the left (north-up).
it('classifies sea and land from coastline direction',()=>{
 const east=coastIndex([[-1000,0,1000,0]]);
 expect(coastSide(east,0,-100)).toBe(true);expect(coastSide(east,0,100)).toBe(false);expect(coastSide(east,0,5000)).toBeNull();
 // Island: counter-clockwise when north is up = clockwise in x/z-south.
 const island=coastIndex([[0,0,0,-400,400,-400,400,0,0,0]]);
 const ccw=coastIndex([[0,0,400,0,400,-400,0,-400,0,0]]);
 expect(coastSide(ccw,200,-200)).toBe(true);expect(coastSide(ccw,-50,50)).toBe(false);expect(coastSide(ccw,450,-450)).toBe(false);
 expect(coastSide(island,200,-200)).toBe(false);
 // Bay: a concave notch keeps land on both sides of a reflex vertex.
 const bay=coastIndex([[-500,0,0,0,0,-300,100,-300,100,0,600,0]]);
 expect(coastSide(bay,50,-100)).toBe(false);expect(coastSide(bay,-50,-100)).toBe(true);expect(coastSide(bay,150,-100)).toBe(true);expect(coastSide(bay,50,100)).toBe(false);
});
it('lowers noisy sea and raises coastal land without touching hills',()=>{
 const L={size:3,orig:-100,step:100,grid:new Float32Array([40,3,0, 2,4,-2, 3,0,1])};
 const r=applyCoastline(L,[[-1000,0,1000,0]]);
 expect(Array.from(L.grid)).toEqual([40,3,1, -1,-1,-2, -1,-1,-1]);expect(r).toEqual({sea:5,land:1}); // samples on the line count as sea
});
