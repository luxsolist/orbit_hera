import type {Ring} from './MapData';
export function fitStreetWidths<T extends {roads:Ring[];buildings?:Ring[];walls?:Ring[]}>(objects:T):T;
