export interface PaintedSkyColors { horizon:readonly [number,number,number]; zenith:readonly [number,number,number] }
export interface CityAppearance {
 id:string;
 renderStyle?:'painted';
 environment:{paintedSky?:PaintedSkyColors;clock?:{latitude:number;longitude:number;timeZone:string};sky:number;fog:number;light:{hemiSky:number;hemiGround:number;hemi:number;sunColor:number;sun:number;fillColor:number;fill:number}};
 buildings:{landmarkHighlight?:boolean;enabled:boolean; colors:readonly number[]; weights:readonly number[]; roofs:readonly number[];
  officeHeight:number; apartmentHeight:number; industrialArea:number;
  texturePath:string; windowContrast:number; windowSpacing:number; architectureStrength:number};
 ground:{waterColor?:string;enabled:boolean; apronColor:string; apronWidth:number; areas:Readonly<Record<string,string>>};
 street:{geometry?:boolean;curbHeight?:number;junctionMarkings?:boolean;wearStrength?:number;asphalt:string;pavement:string;curb:string;marking:string;center:string};
 props:{enabled:boolean; maxPerChunk:number; spacing:number; minSpacing:number; offset:number;
  trees:boolean; lamps:boolean; treeScale:number; lampHeight:number; metal:number;bark:number;leaves:number};
}
