import {athensNight} from './night';
import {seoulAppearance} from './seoul';
import type {CityAppearance} from './types';
/** Photo-informed animation palette; reference choices and limits: docs/athens-art-direction.md. */
export const paintedAthens:CityAppearance={
 ...seoulAppearance,id:'athens-painted',renderStyle:'painted',
 buildings:{...seoulAppearance.buildings,landmarkHighlight:false,
  // Pale plaster/concrete dominate. Warm historic facades are accents, not a city-wide ochre wash.
  colors:[0xf1eee3,0xe9e7df,0xf4efdf,0xe3e3dc,0xe8dfcc,0xd9dcd7,0xeee5d2,0xd6d3c8,0xe3d3b5,0xe7cdbb,0xd8bd9d,0xd8c6b8,0xc5ced0,0xcbd3c8,0xb6c4ca,0xe9dfd7],
  weights:[20,16,13,12,9,7,6,4,3,2,2,1,1,1,1,2],
  // Mostly pale flat rooftops, with one subdued terracotta swatch among eight choices.
  roofs:[0xc5c4b9,0xd1cec1,0xb9bfba,0xc7c9c1,0xb6b7ae,0xd8d1be,0xc2b8a7,0xb7846b],
  officeHeight:65,apartmentHeight:15,industrialArea:1600,
  windowContrast:.92,windowSpacing:1.08,architectureStrength:1.05},
 ground:{...seoulAppearance.ground,waterColor:'#548f9f',apronColor:'#bbb9aa',
  areas:{...seoulAppearance.ground.areas,pavement:'#d9d1be',sand:'#e1d3ad',rock:'#c7bba0',park:'#899366',garden:'#9faa79',grass:'#b1b181',wood:'#586f4e',scrub:'#95996b',pitch:'#91a276'}},
 street:{...seoulAppearance.street,asphalt:'#717b80',pavement:'#d9d2c0',curb:'#b9bdb4',marking:'#f0eddd',center:'#e8dfbf',wearStrength:.025},
 props:{...seoulAppearance.props,metal:0x687477,bark:0x7b6c54,leaves:0x60774b},
 environment:{night:athensNight,clock:{latitude:37.9838,longitude:23.7275,timeZone:'Europe/Athens'},
  sky:0xa9cfe9,fog:0xcbdce5,
  paintedSky:{horizon:[.70,.85,.95],zenith:[.20,.49,.82]},
  light:{hemiSky:0xc0d7e9,hemiGround:0xd5cbb4,hemi:1.3,sunColor:0xfff2df,sun:2.2,fillColor:0xaccdec,fill:.36}}
};
