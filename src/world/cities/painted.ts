import {seoulAppearance} from './seoul';
import type {CityAppearance} from './types';
/** Shared clear animation palette; cities retain independent profiles. */
export const paintedSeoul:CityAppearance={
 ...seoulAppearance,id:'seoul-painted',renderStyle:'painted',
 buildings:{...seoulAppearance.buildings,
 // Visually matched to public/art-direction/seoul-painted-reference-v1.png (not pixel samples).
 // Ivory/stone dominate; terracotta, sage and slate are accents, not equal-probability colors.
 colors:[0xf3ead7,0xe6d8bd,0xe5e9df,0xa4b1b7,0xd7c8af,0xb7b6a6,0xb88f77,0xeee3cc,0xc9cec4,0xc5a58e,0x94a7ab,0xb3bdc7,0xfff0d8,0xc1c8c5,0xc6b4a3,0xe9dfc6],
 weights:[18,10,16,5,5,3,3,10,5,3,3,3,10,2,2,2],
 roofs:[0x8d9897,0x9da5a3,0xa39381,0x829591,0xb4b3a8],windowContrast:1.05,windowSpacing:1.06,architectureStrength:1.05},
 ground:{...seoulAppearance.ground,apronColor:'#aaa99d',areas:{...seoulAppearance.ground.areas,park:'#7e905f',garden:'#98a56b',grass:'#8f9f6c',wood:'#4e6c58',scrub:'#71815a',pitch:'#8c9a66'}},
 street:{...seoulAppearance.street,asphalt:'#667981',pavement:'#d2cbb9',curb:'#a6aaa2',marking:'#f4e8cd',center:'#e4c47c',wearStrength:.025},
 props:{...seoulAppearance.props,metal:0x687c80,bark:0x756148,leaves:0x667f49},
 environment:{clock:{latitude:37.5665,longitude:126.978,timeZone:'Asia/Seoul'},sky:0xb3cde2,fog:0xc8d2df,light:{hemiSky:0xbfcfdf,hemiGround:0xc9bda2,hemi:1.3,sunColor:0xfff0d7,sun:2.2,fillColor:0xadcbe8,fill:.35}}
};

export const paintedBusan:CityAppearance={
 ...paintedSeoul,id:'busan-painted',
 buildings:{...paintedSeoul.buildings,colors:[...paintedSeoul.buildings.colors],weights:[...paintedSeoul.buildings.weights],roofs:[...paintedSeoul.buildings.roofs]},
 ground:{...paintedSeoul.ground,areas:{...paintedSeoul.ground.areas}},
 street:{...paintedSeoul.street},props:{...paintedSeoul.props},
 environment:{...paintedSeoul.environment,clock:{latitude:35.1796,longitude:129.0756,timeZone:'Asia/Seoul'},light:{...paintedSeoul.environment.light}}
};
