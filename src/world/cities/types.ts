export interface CityNightSettings {
 /** Fractions by facade kind: low-rise, apartment, office, industrial. */
 occupancy:readonly [number,number,number,number];
 windowColors:readonly [number,number];
 coolShare:number;
 windowIntensity:number;
 brightnessRange:readonly [number,number];
 shopOccupancy:number;
 lampColor:number;
 lampIntensity:number;
 /** Base linear RGB; shared exposure is applied only to the night sky. */
 sky:readonly [number,number,number];
 skyBrightness:number;
 horizonBrightness:number;
 fog:number;
 ambient:number;
 fill:number;
 surfaceTint:readonly [number,number,number];
}
export interface PaintedSkyColors { horizon:readonly [number,number,number]; zenith:readonly [number,number,number] }
/** Tree templates shared by every city; mixes are weights (normalised at use). */
export type TreeSpecies='broadleaf'|'conifer'|'umbrella'|'cypress';
export type SpeciesMix=Readonly<Partial<Record<TreeSpecies,number>>>;
export type GrammarName='glassTower'|'stoneOffice'|'streetCommercial'|'retailFlagship';
/** First rule whose height band (and main-street condition) matches wins; weights below 1 leave the base shell. */
export interface GrammarRule {minHeight:number;maxHeight?:number;mainStreet?:boolean;mix:readonly (readonly [GrammarName,number])[]}
/** Art-direction district in degrees; not an administrative boundary. */
export interface GrammarZone {id:string;south:number;north:number;west:number;east:number;signDensity:number;rules:readonly GrammarRule[]}
export interface FacadeGrammarSettings {
 /** Map cell (floor lat, floor lon) used to convert zones to cell-local metres. */
 cell:readonly [number,number];
 zones:readonly GrammarZone[];
 fallback:{signDensity:number;rules:readonly GrammarRule[]};
 /** Wall paint per archetype (sRGB hex). */
 paint:Readonly<Record<GrammarName,readonly number[]>>;
 /** Sign / fascia panel colours (sRGB hex). */
 signs:readonly number[];
 /** Footprints smaller than this (m²) keep the base shell. */
 minArea:number;
}
/** Mobile-safe detail tier: material/scene work only, no extra full-screen passes or render targets. */
export interface CityDetailSettings {
 /** Ripples, Fresnel sky reflection and sun glint on water baked into the ground texture. */
 water:{enabled:boolean;deep:readonly [number,number,number];ripple:number};
 /** Fog start as a fraction of the view radius; aerial perspective instead of a late boundary veil. */
 hazeStart:number;
 /** Sun-shaded cumulus on the painted sky dome; coverage 0 (clear) … 1 (overcast). */
 clouds:{enabled:boolean;coverage:number};
 /** Baked ground contact shade around buildings and under tree canopies (alpha 0..1). */
 contactShade:number;
 /**
  * woodSpacing: forest canopy grid. parkSpacing/gardenSpacing: open-green grove grid (sparse lone trees).
  * species: per land-cover mix; street trees use streetCrown proportions.
  */
 vegetation:{enabled:boolean;streetSpacing:number;minRoadWidth:number;parkSpacing:number;woodSpacing:number;gardenSpacing:number;maxPerChunk:number;nearDistance:number;farDistance:number;leaves:readonly number[];bark:number;
  streetCrown:readonly [number,number];species:{street:SpeciesMix;forest:SpeciesMix;open:SpeciesMix;authored:SpeciesMix}};
 /** District facade grammar for generic buildings; omitted where a city keeps its own architecture. */
 grammar?:FacadeGrammarSettings;
 /** Benches and lanterns along park footpaths. */
 parkFurniture:boolean;
}
export interface CityAppearance {
 id:string;
 renderStyle?:'painted';
 detail?:CityDetailSettings;
 environment:{night?:CityNightSettings;paintedSky?:PaintedSkyColors;clock?:{latitude:number;longitude:number;timeZone:string};sky:number;fog:number;light:{hemiSky:number;hemiGround:number;hemi:number;sunColor:number;sun:number;fillColor:number;fill:number}};
 buildings:{landmarkHighlight?:boolean;enabled:boolean; colors:readonly number[]; weights:readonly number[]; roofs:readonly number[];
  officeHeight:number; apartmentHeight:number; industrialArea:number;
  texturePath:string; windowContrast:number; windowSpacing:number; architectureStrength:number};
 ground:{waterColor?:string;enabled:boolean; apronColor:string; apronWidth:number; areas:Readonly<Record<string,string>>};
 street:{geometry?:boolean;curbHeight?:number;junctionMarkings?:boolean;wearStrength?:number;asphalt:string;pavement:string;curb:string;marking:string;center:string};
 props:{enabled:boolean; maxPerChunk:number; spacing:number; minSpacing:number; offset:number;
  trees:boolean; lamps:boolean; treeScale:number; lampHeight:number; metal:number;bark:number;leaves:number};
}
