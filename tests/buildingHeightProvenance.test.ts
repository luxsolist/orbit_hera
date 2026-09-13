import {expect,it} from 'vitest';
// @ts-ignore build-time JS helpers
import {buildingHeightProvenance,interpolateBuildingHeights} from '../scripts/osm.mjs';
import catalog from '../scripts/data/landmark-catalog.json';
it('distinguishes tagged heights, level estimates, type defaults and unknowns',()=>{
 expect(buildingHeightProvenance({height:'75'},'way/1')).toEqual({osmId:'way/1',heightSource:'osm-height',heightTag:'75'});
 expect(buildingHeightProvenance({height:'9999','building:levels':'4'})).toEqual({heightSource:'levels-estimate',levelsTag:'4'});
 expect(buildingHeightProvenance({building:'shed'}).heightSource).toBe('type-estimate');
 expect(buildingHeightProvenance({building:'yes'}).heightSource).toBe('default-estimate');
});
it('records neighbor estimation only when enough references exist',()=>{
 const b=(x:number,h:number,source:string)=>({p:[x,0,x+4,0,x+4,4,x,4],h,heightSource:source});
 const buildings=[b(0,9,'default-estimate'),b(20,30,'osm-height'),b(40,40,'levels-estimate'),b(60,50,'osm-height'),b(1000,9,'default-estimate')];
 interpolateBuildingHeights(buildings,[true,false,false,false,true]);
 expect(buildings[0]).toMatchObject({h:40,heightSource:'neighbor-estimate'});
 expect(buildings[1]).toMatchObject({h:30,heightSource:'osm-height'});
 expect(buildings[4]).toMatchObject({h:9,heightSource:'default-estimate'});
});
it('N Seoul Tower points to the reviewed tower footprint, not the southern viewpoint',()=>{
 const tower=catalog.cities['서울'].find(l=>l.name==='남산(N서울타워)')!;
 expect(tower.lat).toBeCloseTo(37.551199595,7);expect(tower.lon).toBeCloseTo(126.988221445,7);
 expect(tower.geocodeSource.osmId).toBe(370286010);
});
