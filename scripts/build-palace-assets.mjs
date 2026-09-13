import {writeFileSync} from 'node:fs';
import {refinedPalaces} from './palace-refined.mjs';
const assets=Object.fromEntries(Object.entries(refinedPalaces).map(([id,build])=>[id,build()]));
writeFileSync('src/world/cities/gyeongbokgung-models.json',JSON.stringify(assets,(_key,value)=>typeof value==='number'?Math.round(value*10000)/10000:value)+'\n');
