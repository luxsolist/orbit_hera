import {hongKongNight} from './night';
import {seoulAppearance} from './seoul';
import type {CityAppearance} from './types';
/**
 * Hong Kong base palette (art direction, not measured paint): pale tiled and concrete towers with
 * pastel residential accents, grey-green flat roofs, humid hazy sky. Detail tier: cities/detail.ts.
 */
export const paintedHongKong:CityAppearance={
 ...seoulAppearance,id:'hong-kong-painted',renderStyle:'painted',
 buildings:{...seoulAppearance.buildings,landmarkHighlight:false,
  colors:[0xe9e7e1,0xdcdbd5,0xd2d4d0,0xe6dfd0,0xc9cdcb,0xbfc6c8,0xe9d8cf,0xe8e1c4,0xd2ddd3,0xd5dbe3,0xb4bcc0,0xa6b3b9,0xefe9de,0xcfc5b8,0xc2ccc4,0xe3d3d8],
  weights:[18,15,13,9,8,7,4,4,4,4,3,3,4,2,1,1],
  roofs:[0x9aa3a2,0xa8aeaa,0x8e9a96,0xb2b4ad,0x87918f],
  officeHeight:90,apartmentHeight:25,industrialArea:1500,
  windowContrast:1.05,windowSpacing:.95,architectureStrength:1.05},
 ground:{...seoulAppearance.ground,waterColor:'#3f7f95',apronColor:'#a9aca4',
  areas:{...seoulAppearance.ground.areas,pavement:'#c4c2ba',sand:'#ddd2b6',rock:'#9da09a',park:'#6f9161',garden:'#87a46c',grass:'#86a06a',wood:'#3f6b4c',scrub:'#62835a',pitch:'#7f9e68'}},
 street:{...seoulAppearance.street,asphalt:'#4f565b',pavement:'#c7c4bb',curb:'#a3a7a2',marking:'#f2ecd8',center:'#e3c472',wearStrength:.03},
 props:{...seoulAppearance.props,metal:0x5f6d70,bark:0x6a5b48,leaves:0x4f7a46},
 environment:{night:hongKongNight,clock:{latitude:22.2819,longitude:114.1583,timeZone:'Asia/Hong_Kong'},
  sky:0xaccbe0,fog:0xc2d1da,
  paintedSky:{horizon:[.66,.79,.88],zenith:[.22,.46,.76]},
  light:{hemiSky:0xbfd2e2,hemiGround:0xc6c5b0,hemi:1.3,sunColor:0xfff1dc,sun:2.1,fillColor:0xaccbe6,fill:.38}}
};
