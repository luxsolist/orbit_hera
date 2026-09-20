import {busanNight} from './night';
import {seoulAppearance} from './seoul';
import type {CityAppearance} from './types';
/** Photo-directed coastal palette. Sources and interpretation: docs/busan-art-direction.md. */
export const paintedBusan:CityAppearance={
 ...seoulAppearance,id:'busan-painted',renderStyle:'painted',
 buildings:{...seoulAppearance.buildings,landmarkHighlight:false,
  colors:[0xf0f3ef,0xe1e9e8,0xd2dddf,0xc4d2d8,0xa8c2cf,0x8eb2c3,0xf2ecdc,0xe3dfd2,0xc1c8cb,0xb4c6c7,0xd4e8e0,0xb9d9cf,0xe6c5b6,0xeacfae,0xc6d4e8,0xdccfdf],
  weights:[20,16,12,9,7,4,9,5,5,3,3,2,2,1,1,1],
  roofs:[0xaebfc2,0x899fa8,0xbcc6c5,0x8dafaa,0xc6c6ba],
  windowContrast:.95,windowSpacing:1.06,architectureStrength:1.05},
 ground:{...seoulAppearance.ground,waterColor:'#378fa9',apronColor:'#adb9b8',
  areas:{...seoulAppearance.ground.areas,pavement:'#d5dad5',sand:'#ecdfbf',rock:'#a5afaf',park:'#729b7c',garden:'#97b58b',grass:'#91ae85',wood:'#497c69',scrub:'#719681',pitch:'#83aa8a'}},
 street:{...seoulAppearance.street,asphalt:'#637b88',pavement:'#d7dbd3',curb:'#b1c3c5',marking:'#f7f1dd',center:'#e9cd88',wearStrength:.025},
 props:{...seoulAppearance.props,metal:0x607f8d,bark:0x766754,leaves:0x59846c},
 environment:{night:busanNight,clock:{latitude:35.1796,longitude:129.0756,timeZone:'Asia/Seoul'},
  sky:0xa1d4eb,fog:0xbad8e3,
  paintedSky:{horizon:[.61,.82,.93],zenith:[.12,.46,.79]},
  light:{hemiSky:0xb7d9ed,hemiGround:0xd1d2be,hemi:1.3,sunColor:0xfff4e0,sun:2.2,fillColor:0xaedbed,fill:.38}}
};
