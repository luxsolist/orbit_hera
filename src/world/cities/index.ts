import {paintedSeoul,paintedBusan} from './painted';
import {LIGHT,SKY_COLOR,FOG_COLOR} from '../palette';
import type {CityAppearance} from './types';
export type {CityAppearance} from './types';
export {seoulAppearance} from './seoul';
/** Unconfigured cities retain their legacy appearance. No Seoul detailing leaks into them. */
export const defaultAppearance:CityAppearance={
 id:'default',environment:{sky:SKY_COLOR,fog:FOG_COLOR,light:{...LIGHT}},
 buildings:{enabled:false,colors:[0xb0b3b5],weights:[1],roofs:[0xaab0b0],officeHeight:55,apartmentHeight:18,industrialArea:900,
 texturePath:'textures/city/seoul',windowContrast:1,windowSpacing:1,architectureStrength:1},
 ground:{enabled:false,apronColor:'#999c99',apronWidth:6,areas:{}},
 street:{asphalt:'#363a3f',pavement:'#bcb8ae',curb:'#8b8e90',marking:'#e0ddd0',center:'#cbb16a'},
 props:{enabled:false,maxPerChunk:48,spacing:45,minSpacing:14,offset:1.4,trees:true,lamps:true,treeScale:1,lampHeight:6,metal:0x727b80,bark:0x716253,leaves:0x647954}
};
const cities:Readonly<Record<string,CityAppearance>>={'seoul-stream':paintedSeoul,'busan-stream':paintedBusan};
export function cityAppearance(mapId?:string):CityAppearance{return cities[mapId??'']??defaultAppearance;}
