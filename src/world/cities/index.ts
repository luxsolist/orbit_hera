import {detailedSeoul,detailedRome,detailedAthens} from './detail';
import {LIGHT,SKY_COLOR,FOG_COLOR} from '../palette';
import type {CityAppearance} from './types';
export type {CityAppearance} from './types';
export {seoulAppearance} from './seoul';
/** Fallback for map ids without a city profile (tests, tools). No city detailing leaks into it. */
export const defaultAppearance:CityAppearance={
 id:'default',environment:{sky:SKY_COLOR,fog:FOG_COLOR,light:{...LIGHT}},
 buildings:{enabled:false,colors:[0xb0b3b5],weights:[1],roofs:[0xaab0b0],officeHeight:55,apartmentHeight:18,industrialArea:900,
 texturePath:'textures/city/seoul',windowContrast:1,windowSpacing:1,architectureStrength:1},
 ground:{enabled:false,apronColor:'#999c99',apronWidth:6,areas:{}},
 street:{asphalt:'#363a3f',pavement:'#bcb8ae',curb:'#8b8e90',marking:'#e0ddd0',center:'#cbb16a'},
 props:{enabled:false,maxPerChunk:48,spacing:45,minSpacing:14,offset:1.4,trees:true,lamps:true,treeScale:1,lampHeight:6,metal:0x727b80,bark:0x716253,leaves:0x647954}
};
const cities:Readonly<Record<string,CityAppearance>>={'seoul-stream':detailedSeoul,'rome-stream':detailedRome,'athens-stream':detailedAthens};
export function cityAppearance(mapId?:string):CityAppearance{return cities[mapId??'']??defaultAppearance;}

const handheld=new WeakMap<CityAppearance,CityAppearance>();
/**
 * Handheld budget for the detail tier: half the trees, shorter LOD ranges. Shading features are kept
 * (they add no passes). Same object for desktop, so materials stay shared.
 */
export function deviceAppearance(profile:CityAppearance,coarseOnly:boolean):CityAppearance {
 const d=profile.detail;if(!coarseOnly||!d)return profile;
 let result=handheld.get(profile);
 if(!result){const v=d.vegetation;result={...profile,detail:{...d,vegetation:{...v,maxPerChunk:Math.round(v.maxPerChunk*.5),nearDistance:Math.min(v.nearDistance,200),farDistance:Math.min(v.farDistance,900),streetSpacing:v.streetSpacing*1.3,woodSpacing:v.woodSpacing*1.3,parkSpacing:v.parkSpacing*1.2}}};handheld.set(profile,result);}
 return result;
}
/** Touch-only devices (no fine pointer anywhere); ?detail=handheld forces the budget for review. */
export function coarsePointerOnly():boolean {
 if(typeof window==='undefined'||typeof matchMedia==='undefined')return false;
 if(new URLSearchParams(location.search).get('detail')==='handheld')return true;
 return matchMedia('(pointer: coarse)').matches&&!matchMedia('(any-pointer: fine)').matches;
}
