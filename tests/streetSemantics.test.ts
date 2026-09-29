import {readMapFixture} from './mapFixture';
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error build tooling shared rules
import {surfaceBuildingKind,buildingHeightInfo,roadWidthInfo,buildingVerticalFields,structureFields} from '../scripts/osm.mjs';
import {fitStreetWidths} from '../src/world/streetSpace.mjs';
import {streetPlatform} from '../src/world/StreetPlatform';
import {applyMapCorrections} from '../src/world/MapCorrections';
import type {Ring} from '../src/world/MapData';
it('uses facility tags before generic building tags and preserves ground-level facilities',()=>{
 expect(surfaceBuildingKind({building:'yes',public_transport:'platform',bus:'yes'})).toBe('platform');
 expect(surfaceBuildingKind({building:'yes',level:'-1'})).toBe('underground');
 expect(surfaceBuildingKind({building:'yes',level:'-2;-1'})).toBe('underground');
 expect(surfaceBuildingKind({building:'yes',level:'-1;0'})).toBe('building');
 expect(surfaceBuildingKind({building:'yes',level:'unknown'})).toBe('building');
 expect(surfaceBuildingKind({building:'no'})).toBe('underground');
 expect(buildingHeightInfo({building:'yes',height:'32'}).h).toBe(32);
});
it('uses carriageway-specific width and never doubles tagged directional lane counts',()=>{
 expect(roadWidthInfo({highway:'primary',oneway:'yes',lanes:'3'})).toEqual({w:10.6,widthSource:'lanes'});
 expect(roadWidthInfo({highway:'primary',oneway:'yes',lanes:'4'}).w).toBe(13.8);
 expect(roadWidthInfo({highway:'primary',lanes:'3',width:'12'})).toEqual({w:12,widthSource:'tag'});
 expect(roadWidthInfo({highway:'primary',oneway:'yes'}).w).toBe(14);
 expect(roadWidthInfo({highway:'primary',lanes:'-2'}).w).toBe(28);
});
it('fits inferred asphalt to parallel walls without moving walls or pinching crossings and bridges',()=>{
 const road:Ring={p:[0,0,0,100],w:28,widthSource:'lanes'},wall:Ring={p:[10,10,10,90],w:.4};
 const input={roads:[road],walls:[wall],buildings:[]},out=fitStreetWidths(input);
 expect(out.roads[0].w).toBe(17.6);expect(out.walls).toBe(input.walls);expect(road.w).toBe(28);
 expect(fitStreetWidths(out)).toEqual(out);
 expect(fitStreetWidths({...input,roads:[{...road,bridge:true}]}).roads[0].w).toBe(28);
 expect(fitStreetWidths({...input,roads:[{...road,widthSource:'tag'}]}).roads[0].w).toBe(28);
 expect(fitStreetWidths({...input,walls:[{p:[-20,50,20,50],w:.4}]}).roads[0].w).toBe(28);
});
it('builds a low open platform with only post collisions, not an office-sized wall',()=>{
 const asset=streetPlatform({p:[0,0,21,0,21,3,0,3],structureKind:'platform',roofed:true},0,0,()=>10);
 asset.geometry.computeBoundingBox();expect(asset.geometry.boundingBox!.max.y).toBeCloseTo(13.09,4);
 expect(asset.walls.length).toBeGreaterThan(2);expect(asset.walls.every(w=>w.x1-w.x0<.3&&w.z1-w.z0<.3)).toBe(true);asset.geometry.dispose();
});
it('keeps the reported Sejong-daero road clear of the east wall and west platforms',()=>{
 const raw=readMapFixture('public/maps/37/126/5_2/84_46.json');
 const c=applyMapCorrections([37,126],raw,{detail:null,roadGrade:null,appearance:null});
 expect(c.objects.buildings.some(b=>['way/1551642256','way/1551642257','way/380883714'].includes(b.osmId??''))).toBe(false);
 expect(c.objects.structures?.filter(b=>b.structureKind==='platform')).toHaveLength(2);
 const z=47501.9138,intervals:number[][]=[];
 for(const r of c.objects.roads)for(let i=2;i<r.p.length;i+=2){const [ax,az,bx,bz]=r.p.slice(i-2,i+2);if((az-z)*(bz-z)>0||Math.abs(bz-az)<10)continue;const x=ax+(bx-ax)*(z-az)/(bz-az);if(x<86290||x>86315)continue;intervals.push([x-(r.w??6)/2,x+(r.w??6)/2]);}
 expect(intervals.length).toBeGreaterThanOrEqual(2);
 // Bus platform east edge x=86284; embassy wall center x=86317.615.
 expect(Math.min(...intervals.map(p=>p[0]))).toBeGreaterThan(86285);
 expect(Math.max(...intervals.map(p=>p[1]))).toBeLessThan(86316.4);
});

it('classifies toll roofs and preserves the source of vertical clearance',()=>{
 expect(surfaceBuildingKind({building:'yes',barrier:'toll_booth'})).toBe('tollgate');
 expect(structureFields({building:'yes',barrier:'toll_booth'}).structureKind).toBe('canopy');
 expect(buildingVerticalFields({layer:'1',min_height:'8'})).toMatchObject({groundClearance:8,clearanceSource:'min-height'});
 expect(buildingVerticalFields({layer:'1'})).toMatchObject({groundClearance:5,clearanceSource:'layer-estimate'});
 expect(buildingVerticalFields({})).toEqual({layer:0});
});
it('uses planned canopy supports without recreating posts in the carriageway',()=>{
 const asset=streetPlatform({p:[0,0,20,0,20,10,0,10],structureKind:'canopy',h:7,supportPoints:[0,0,20,0]},0,0,()=>0);
 expect(asset.walls).toHaveLength(2);asset.geometry.dispose();
});
