import {it,expect} from 'vitest';
// @ts-expect-error build tooling is JavaScript
import {relationPolys,interpolateBuildingHeights} from '../scripts/osm.mjs';
const geometry=[{lat:0,lon:0},{lat:0,lon:10},{lat:10,lon:10},{lat:10,lon:0},{lat:0,lon:0}];
it('building relations do not extrude each part to total building height',()=>{
 const result=relationPolys({tags:{type:'building'},members:[{type:'way',role:'outline',geometry},{type:'way',role:'part',geometry:geometry.map(p=>({lat:p.lat+20,lon:p.lon}))}]},(lat:number,lon:number)=>[lon,lat]);expect(result).toHaveLength(1);
});

it('supertall reference copies cannot assign tower heights to unknown buildings',()=>{
 const box=(x:number)=>[x,0,x+2,0,x+2,2,x,2];
 const buildings=[...Array.from({length:20},(_,i)=>({p:box(i),h:555})),{p:box(50),h:6},{p:box(70),h:9},{p:box(90),h:12},{p:box(100),h:9}];
 interpolateBuildingHeights(buildings,buildings.map((_,i)=>i===23));expect(buildings[23].h).toBe(9);expect(buildings[0].h).toBe(555);
});
it('duplicate nearby references do not override independent neighbors',()=>{
 const box=(x:number)=>[x,0,x+2,0,x+2,2,x,2];
 const buildings=[...Array.from({length:10},()=>({p:box(0),h:120})),{p:box(50),h:6},{p:box(70),h:12},{p:box(90),h:9}];
 interpolateBuildingHeights(buildings,buildings.map((_,i)=>i===12));expect(buildings[12].h).toBe(12);
});
