import {expect,it} from 'vitest';
// @ts-expect-error shared build-time JavaScript policy
import {constrainEstimatedBuildingHeight,estimatedFootprintHeightLimit,interpolateBuildingHeights,auditEstimatedBuildingHeights} from '../scripts/osm.mjs';
const box=(area:number,x=0)=>[x,0,x+area/5,0,x+area/5,5,x,5];
it('caps anonymous tiny footprints even when tall neighbors dominate or no seeds exist',()=>{
 const b=[{p:box(13),h:9,heightSource:'default-estimate'},...[20,40,60].map((x,i)=>({p:box(144,x),h:40+i*10,heightSource:'osm-height'}))];
 interpolateBuildingHeights(b,[true,false,false,false]);expect(b[0]).toMatchObject({h:3.5,heightSource:'footprint-estimate'});
 const isolated=[{p:box(13),h:9,heightSource:'default-estimate'}];interpolateBuildingHeights(isolated,[true]);expect(isolated[0].h).toBe(3.5);
});
it('repairs the reported complete 13 m² Seoul footprint and is idempotent',()=>{
 const b={osmId:'way/1551642466',p:[86336,48064,86336,48068,86334,48067,86332,48067,86332,48064],h:18.5,heightSource:'neighbor-estimate'};
 expect(auditEstimatedBuildingHeights([b])).toHaveLength(1);
 expect(constrainEstimatedBuildingHeight(b)).toBe(true);expect(b.h).toBe(3.5);
 expect(constrainEstimatedBuildingHeight(b)).toBe(false);expect(auditEstimatedBuildingHeights([b])).toEqual([]);
});
it('preserves evidence, typed houses, landmarks, facilities and missing provenance',()=>{
 for(const extra of [{heightSource:'osm-height'},{heightSource:'levels-estimate'},{heightSource:'type-estimate'},{heightSource:undefined},{heightTag:'25'},{levelsTag:'7'},{lm:'civil'},{landmarkModel:'tower'},{palaceBuildingId:'gate'},{facilityKind:'utility'}]){
  const b={p:box(13),h:25,heightSource:'neighbor-estimate',...extra};expect(constrainEstimatedBuildingHeight(b)).toBe(false);expect(b.h).toBe(25);
 }
});
it('bounds the policy by footprint area, interpolates its upper limit and never raises a low structure',()=>{
 const b=(area:number,h=20)=>({p:box(area),h,heightSource:'neighbor-estimate'});
 expect(estimatedFootprintHeightLimit(b(25))).toBe(3.5);expect(estimatedFootprintHeightLimit(b(37.5))).toBe(5);
 expect(estimatedFootprintHeightLimit(b(50))).toBe(6.5);expect(estimatedFootprintHeightLimit(b(50.01))).toBe(Infinity);
 expect(constrainEstimatedBuildingHeight(b(13,2))).toBe(false);
 expect(constrainEstimatedBuildingHeight({...b(13),p:[0,0,NaN,5,3,5]})).toBe(false);
 expect(constrainEstimatedBuildingHeight({...b(13),p:[0,0,0,0,0,0]})).toBe(false);
});
