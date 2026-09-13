import {LIGHT,SKY_COLOR,FOG_COLOR} from '../palette';
import * as THREE from 'three';
import palette from '../seoulFacadePalette.json';
import type {CityAppearance} from './types';
/** Original photo samples remain in JSON; these are neutralized, exposure-adjusted paint colors. */
const colors = palette.colors.map((sample,index) => {
  const color=new THREE.Color(sample.hex);
  const grey=color.r*.2126+color.g*.7152+color.b*.0722;
  const light=[0,2,8,12].includes(index);
  color.lerp(new THREE.Color(grey,grey,grey),light?.65:.3);
  return color.lerp(new THREE.Color(0xffffff),light?.10:.08).getHex();
});
// 67% light walls. Dark glass/shadow samples are accents rather than equal-probability paint.
const weights = [14,6,23,6,3,1,1,4,5,1,2,1,25,4,2,2];
const roofs = [0xaab0b0,0xb9bcb7,0x84988d,0x8c9da4,0xc5c3b9];
export const seoulAppearance:CityAppearance={
 id:'seoul',environment:{sky:SKY_COLOR,fog:FOG_COLOR,light:{...LIGHT}},
 buildings:{enabled:true,colors,weights,roofs,officeHeight:55,apartmentHeight:18,industrialArea:900,
 texturePath:'textures/city/seoul',windowContrast:1,windowSpacing:1,architectureStrength:1},
 ground:{enabled:true,apronColor:'#999c99',apronWidth:6,areas:{pavement:'#bcb8ae',sand:'#d5c7ac',rock:'#999a94',park:'#859478',garden:'#859478',grass:'#859478',pitch:'#819779',wood:'#657c61',scrub:'#75846b'}},
 street:{geometry:true,curbHeight:.12,junctionMarkings:true,wearStrength:.07,asphalt:'#555b61',pavement:'#bcb8ae',curb:'#8b8e90',marking:'#e0ddd0',center:'#cbb16a'},
 props:{enabled:true,maxPerChunk:48,spacing:45,minSpacing:14,offset:1.4,trees:true,lamps:true,treeScale:1,lampHeight:6,metal:0x727b80,bark:0x716253,leaves:0x647954}
};
