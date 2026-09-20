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
export interface CityAppearance {
 id:string;
 renderStyle?:'painted';
 environment:{night?:CityNightSettings;paintedSky?:PaintedSkyColors;clock?:{latitude:number;longitude:number;timeZone:string};sky:number;fog:number;light:{hemiSky:number;hemiGround:number;hemi:number;sunColor:number;sun:number;fillColor:number;fill:number}};
 buildings:{landmarkHighlight?:boolean;enabled:boolean; colors:readonly number[]; weights:readonly number[]; roofs:readonly number[];
  officeHeight:number; apartmentHeight:number; industrialArea:number;
  texturePath:string; windowContrast:number; windowSpacing:number; architectureStrength:number};
 ground:{waterColor?:string;enabled:boolean; apronColor:string; apronWidth:number; areas:Readonly<Record<string,string>>};
 street:{geometry?:boolean;curbHeight?:number;junctionMarkings?:boolean;wearStrength?:number;asphalt:string;pavement:string;curb:string;marking:string;center:string};
 props:{enabled:boolean; maxPerChunk:number; spacing:number; minSpacing:number; offset:number;
  trees:boolean; lamps:boolean; treeScale:number; lampHeight:number; metal:number;bark:number;leaves:number};
}
