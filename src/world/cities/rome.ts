import {romeNight} from './night';
import {seoulAppearance} from './seoul';
import type {CityAppearance} from './types';
/** Rome photo direction: docs/rome-art-direction.md. Shared renderer, independent palette. */
export const paintedRome:CityAppearance={
 ...seoulAppearance,id:'rome-painted',renderStyle:'painted',
 buildings:{...seoulAppearance.buildings,landmarkHighlight:false,
  colors:[0xf1e7d4,0xe7dbc5,0xf4eddf,0xddc9aa,0xe7cfaa,0xd8b98c,0xe8c5ad,0xd6aa94,0xe5c4b7,0xc49781,0xd5cebd,0xc8c8be,0xe1d6bc,0xc1b5a2,0xd5dcd8,0xbbc7c9],
  weights:[18,14,12,10,8,5,7,4,5,3,4,3,3,2,1,1],
  roofs:[0xb78268,0xc39476,0xa6725d,0xd0a182,0x9e8170,0xbdb6a6],
  officeHeight:75,apartmentHeight:28,industrialArea:1800,
  windowContrast:.9,windowSpacing:1.12,architectureStrength:1.05},
 ground:{...seoulAppearance.ground,waterColor:'#718f83',apronColor:'#b5ad9e',
  areas:{...seoulAppearance.ground.areas,pavement:'#cfc4af',sand:'#e4d4b3',rock:'#b6ad99',park:'#849467',garden:'#9cac79',grass:'#99a777',wood:'#5b7454',scrub:'#7e8e61',pitch:'#8e9f73'}},
 street:{...seoulAppearance.street,asphalt:'#737879',pavement:'#cfc4b0',curb:'#b5b4a7',marking:'#f0eadb',center:'#ece4d2',wearStrength:.03},
 props:{...seoulAppearance.props,metal:0x616b64,bark:0x796650,leaves:0x57724e},
 environment:{night:romeNight,clock:{latitude:41.9028,longitude:12.4964,timeZone:'Europe/Rome'},
  sky:0xb7d4e9,fog:0xd4dbdf,
  paintedSky:{horizon:[.70,.83,.94],zenith:[.23,.49,.81]},
  light:{hemiSky:0xc4d8e8,hemiGround:0xd8c7ab,hemi:1.3,sunColor:0xffefd8,sun:2.2,fillColor:0xb9d2eb,fill:.36}}
};
