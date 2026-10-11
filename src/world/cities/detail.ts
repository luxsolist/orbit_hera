import {paintedSeoul} from './painted';
import {paintedRome} from './rome';
import {paintedAthens} from './athens';
import type {CityAppearance,CityDetailSettings,FacadeGrammarSettings,GrammarRule} from './types';
// 도시별 상세 단계 파라미터. 렌더러는 공통이고 도시 특성(물·하늘·수종·나무 밀도·외관 권역·간판 밀도)은
// 여기서만 정한다. 값은 아트 디렉션 추정이며 측량/식생 조사 자료가 아니다. 근거: docs/city-detail-tier.md.

/** Korean commercial sign panels read from the Seoul reference photos (red, yellow, navy, white, green, orange). */
const KOREAN_SIGNS=[0xd8342c,0xf2c230,0x1f4f9f,0xf4f1e8,0x2f9b5a,0xe86a1c,0x6b3fa0,0x15181c];
const shops:GrammarRule={minHeight:0,mix:[['streetCommercial',1]]};

export const seoulGrammar:FacadeGrammarSettings={
 cell:[37,126],minArea:25,signs:KOREAN_SIGNS,
 zones:[
  // Myeongdong first: it overlaps the southern edge of the old-downtown rectangle.
  {id:'myeongdong',south:37.5595,north:37.5665,west:126.9790,east:126.9900,signDensity:1,
   rules:[{minHeight:45,mix:[['glassTower',.5],['stoneOffice',.5]]},{minHeight:8,mix:[['retailFlagship',.45],['streetCommercial',.55]]},shops]},
  {id:'jongno',south:37.5660,north:37.5785,west:126.9750,east:127.0120,signDensity:.7,
   rules:[{minHeight:50,mix:[['glassTower',.5],['stoneOffice',.5]]},{minHeight:9,mix:[['stoneOffice',.4],['streetCommercial',.6]]},shops]},
  {id:'gangnam',south:37.4940,north:37.5125,west:127.0240,east:127.0660,signDensity:.45,
   rules:[{minHeight:40,mix:[['glassTower',.78],['stoneOffice',.22]]},{minHeight:13,mix:[['stoneOffice',.45],['glassTower',.15],['streetCommercial',.4]]},shops]},
 ],
 // Elsewhere towers follow the office references; apartment-height slabs (18–55m) keep the base pattern.
 fallback:{signDensity:.3,rules:[{minHeight:55,mix:[['glassTower',.55],['stoneOffice',.45]]},{minHeight:0,maxHeight:18,mainStreet:true,mix:[['streetCommercial',.7]]}]},
 paint:{
  glassTower:[0x6f9aa3,0x7f9fb4,0x8aa6a6,0x5e7f96,0x9cb2b8,0x6b8d8a],
  stoneOffice:[0xd9cfbd,0xc9c3b8,0xb9ad9a,0xe3dccd,0xa99f92,0xcdbfa6],
  streetCommercial:[0xd8d2c6,0xc7c2b8,0xb7a596,0xe4ded2,0xa9aaa4,0xcbb7a5,0xd2c8b0],
  retailFlagship:[0xeeece6,0xd7d9da,0x3b3f44,0xe8e2d6,0xc9ced2]},
};
const mobileSafe={hazeStart:.32,contactShade:.22,parkFurniture:true};
const vegetationBase={enabled:true,streetSpacing:9,minRoadWidth:10,parkSpacing:36,woodSpacing:8.5,gardenSpacing:26,maxPerChunk:4200,nearDistance:320,farDistance:1400};

export const seoulDetail:CityDetailSettings={...mobileSafe,
 water:{enabled:true,deep:[.045,.11,.135],ripple:.075},clouds:{enabled:true,coverage:.5},grammar:seoulGrammar,
 // Ginkgo / plane street trees; pine-oak mountain forest; palace groves keep a third pine.
 vegetation:{...vegetationBase,leaves:[0x5f7f3f,0x6d8c45,0x4f6f3c,0x7a9550,0x587a48],bark:0x6e5a45,streetCrown:[.72,1.15],
  species:{street:{broadleaf:1},forest:{broadleaf:.45,conifer:.55},open:{broadleaf:.88,conifer:.12},authored:{broadleaf:.65,conifer:.35}}},
};
export const romeDetail:CityDetailSettings={...mobileSafe,hazeStart:.38,
 // Tiber: green, slow. No facade grammar — the historic core keeps the Rome architecture modules.
 water:{enabled:true,deep:[.05,.09,.07],ripple:.05},clouds:{enabled:true,coverage:.3},
 // Plane-tree boulevards, stone-pine villas (Villa Borghese/Pincio), cypress accents.
 vegetation:{...vegetationBase,streetSpacing:10,leaves:[0x5a7348,0x667d4c,0x4e6a45,0x748a55,0x5d7550],bark:0x7a6650,streetCrown:[1,1.05],
  species:{street:{broadleaf:.8,umbrella:.2},forest:{umbrella:.45,broadleaf:.35,cypress:.2},open:{umbrella:.4,broadleaf:.4,cypress:.2},authored:{umbrella:.5,broadleaf:.3,cypress:.2}}},
};
export const athensDetail:CityDetailSettings={...mobileSafe,hazeStart:.35,
 // Aegean blue; mostly clear summer sky. No facade grammar (own architecture modules).
 water:{enabled:true,deep:[.02,.08,.14],ripple:.08},clouds:{enabled:true,coverage:.18},
 // Small bitter-orange street trees, sparse dry Aleppo-pine hills, cypress in gardens.
 vegetation:{...vegetationBase,streetSpacing:11,woodSpacing:10.5,parkSpacing:40,maxPerChunk:3200,leaves:[0x6b7a4a,0x7a8752,0x5c6c45,0x8a915c,0x6f7d50],bark:0x7b6c54,streetCrown:[.6,.75],
  species:{street:{broadleaf:1},forest:{conifer:.55,cypress:.2,broadleaf:.25},open:{broadleaf:.5,cypress:.3,conifer:.2},authored:{conifer:.4,cypress:.3,broadleaf:.3}}},
};

/** Street trees come from the vegetation layer, so the shared prop trees are switched off. */
const withDetail=(base:CityAppearance,id:string,detail:CityDetailSettings,fog?:number):CityAppearance=>({
 ...base,id,props:{...base.props,trees:false},detail,...(fog!==undefined?{environment:{...base.environment,fog}}:{}),
});
export const detailedSeoul=withDetail(paintedSeoul,'seoul-detailed',seoulDetail,0xc4d3e3);
export const detailedRome=withDetail(paintedRome,'rome-detailed',romeDetail);
export const detailedAthens=withDetail(paintedAthens,'athens-detailed',athensDetail);
