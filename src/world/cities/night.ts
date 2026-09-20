import * as THREE from 'three';
import type {CityNightSettings} from './types';
export const NIGHT_SKY_EXPOSURE=.60;
/** Art-direction starting points, not measured occupancy or photometric values. */
export const defaultCityNight:CityNightSettings={
 occupancy:[.36,.36,.36,.36],windowColors:[0xffd798,0xffd798],coolShare:0,
 windowIntensity:1.5,brightnessRange:[1,1],shopOccupancy:.36,
 lampColor:0xffd69a,lampIntensity:2.5,sky:[.025,.045,.095],skyBrightness:1,horizonBrightness:1.4,fog:0x1a263d,
 ambient:.32,fill:.18,surfaceTint:[.22,.30,.48]
};
// Independent objects allow each city to evolve without changing the shared renderer.
export const seoulNight:CityNightSettings={...defaultCityNight};
export const busanNight:CityNightSettings={...defaultCityNight};
export const romeNight:CityNightSettings={...defaultCityNight,
 occupancy:[.20,.23,.34,.12],windowColors:[0xffc987,0xffead4],coolShare:.18,
 windowIntensity:.90,brightnessRange:[.35,1],shopOccupancy:.62,
 lampColor:0xffcc89,lampIntensity:2.7,sky:[.020,.030,.057],skyBrightness:1.08,fog:0x1c2331,
 ambient:.27,fill:.14,surfaceTint:[.24,.28,.37]
};
export const athensNight:CityNightSettings={...defaultCityNight,
 occupancy:[.24,.28,.40,.14],windowColors:[0xffd5a1,0xe2edff],coolShare:.38,
 windowIntensity:.98,brightnessRange:[.40,1],shopOccupancy:.68,
 lampColor:0xffdfb1,lampIntensity:2.6,sky:[.021,.036,.071],skyBrightness:1.08,fog:0x1c273a,
 ambient:.28,fill:.16,surfaceTint:[.22,.29,.42]
};

/** One source for the shader sky and background fallback. Values remain linear. */
export function cityNightSky(settings:CityNightSettings=defaultCityNight){
 const zenith=new THREE.Vector3(...settings.sky).multiplyScalar(NIGHT_SKY_EXPOSURE*settings.skyBrightness);
 return {zenith,horizon:zenith.clone().multiplyScalar(settings.horizonBrightness)};
}
