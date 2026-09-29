import {it,expect} from 'vitest';
// @ts-expect-error common build helpers are JavaScript
import {surfaceBuildingKind,structureFields,buildingHeightInfo,buildingHeightProvenance,interpolateBuildingHeights,auditStructureRecords} from '../scripts/osm.mjs';
import {applyMapCorrections} from '../src/world/MapCorrections';
import {streetPlatform} from '../src/world/StreetPlatform';
import type {WorldChunk} from '../src/world/chunkManifest';
it.each([
 [{building:'yes',amenity:'toilets'},'toilets',3.2],
 [{building:'public',amenity:'toilets'},'toilets',3.2],
 [{building:'yes',amenity:'shelter'},'shelter',3],
 [{building:'yes',shop:'kiosk'},'kiosk',3],
 [{building:'garage'},'garage',3],
 [{building:'shed'},'shed',3],
 [{building:'service'},'utility',3.5],
 [{building:'roof'},'canopy',3],
] as const)('classifies %j before estimating ordinary building height',(tags,kind,h)=>{
 expect(surfaceBuildingKind(tags)).toBe(kind);expect(structureFields(tags).facilityKind).toBe(kind);
 expect(buildingHeightInfo(tags)).toEqual({h,estimated:false});
 expect(auditStructureRecords([{osmId:'test',...structureFields(tags),...buildingHeightProvenance(tags),h}]).errors).toEqual([]);
});
it('preserves houses, mixed-use buildings and explicit height evidence',()=>{
 expect(surfaceBuildingKind({building:'house'})).toBe('building');
 expect(surfaceBuildingKind({building:'apartments',amenity:'toilets'})).toBe('building');
 expect(surfaceBuildingKind({building:'office',shop:'kiosk'})).toBe('building');
 expect(buildingHeightInfo({building:'yes',amenity:'toilets',height:'5.5'}).h).toBe(5.5);
 const tall={h:20,facilityKind:'toilets',heightSource:'osm-height'};
 expect(auditStructureRecords([tall]).errors).toEqual([]);expect(auditStructureRecords([tall]).review).toHaveLength(1);
 expect(auditStructureRecords([{...tall,heightSource:'neighbor-estimate'}]).errors.length).toBeGreaterThan(0);
});
it('excludes small facilities as both recipients and seeds of neighboring office height estimates',()=>{
 const box=(x:number)=>[x,0,x+12,0,x+12,12,x,12];
 const b=[{p:box(0),h:3.2,facilityKind:'toilets'},{p:box(20),h:40},{p:box(40),h:50},{p:box(60),h:60}];
 interpolateBuildingHeights(b,[true,false,false,false]);expect(b[0].h).toBe(3.2);
 const seeds=[{p:box(0),h:3.2,facilityKind:'toilets'},{p:box(20),h:3,facilityKind:'shed'},{p:box(40),h:3,facilityKind:'garage'},{p:box(60),h:9}];
 interpolateBuildingHeights(seeds,[false,false,false,true]);expect(seeds[3].h).toBe(9);
});
it('keeps enclosed facilities and authored models in their own render path, separates only open shelters',()=>{
 const p=[0,0,6,0,6,4,0,4];const c={cx:0,cz:0,terrain:{size:2,heights:[0,0,0,0]},objects:{roads:[],water:[],buildings:[{p,h:3.2,facilityKind:'toilets'},{p,h:3,structureKind:'shelter',facilityKind:'shelter'},{p,h:7,structureKind:'canopy',facilityKind:'canopy',palaceBuildingId:'reviewed'}]}} as unknown as WorldChunk;
 const out=applyMapCorrections([0,0],c,{detail:null,roadGrade:null,appearance:null});
 expect(out.objects.buildings).toHaveLength(2);expect(out.objects.structures).toHaveLength(1);
 expect(out.objects.buildings.some(b=>b.palaceBuildingId==='reviewed')).toBe(true);
 expect(applyMapCorrections([0,0],out,{detail:null,roadGrade:null,appearance:null}).objects.structures).toHaveLength(1);
});
it('preserves a concave canopy footprint rather than filling its bounding rectangle',()=>{
 const asset=streetPlatform({p:[0,0,10,0,10,2,2,2,2,10,0,10],structureKind:'canopy',h:4},0,0,()=>0);
 const pos=asset.geometry.getAttribute('position');let topArea=0;
 for(let i=0;i<pos.count;i+=3)if([0,1,2].every(k=>Math.abs(pos.getY(i+k)-4.18)<.001)){
  topArea+=Math.abs((pos.getX(i+1)-pos.getX(i))*(pos.getZ(i+2)-pos.getZ(i))-(pos.getZ(i+1)-pos.getZ(i))*(pos.getX(i+2)-pos.getX(i)))/2;
 }
 expect(topArea).toBeCloseTo(36,3);asset.geometry.dispose();
});
