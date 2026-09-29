import type {Ring} from './MapData';
export const STREET_SECTION:Readonly<{version:number;sidewalk:number;minSidewalk:number;minCarriageway:number;facadeGap:number;curb:number;furnitureInset:number;furnitureRadius:number;maxMiter:number;widthSlope:number}>;
export function planStreetSections<T extends {roads:Ring[];buildings?:Ring[];structures?:Ring[];walls?:Ring[];water?:Ring[]}>(objects:T):T;
export function streetSidewalk(r:Pick<Ring,'w'|'streetSection'>):number;
