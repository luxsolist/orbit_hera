import {readFile} from 'node:fs/promises';
export async function loadMapCities(){
 const cities=JSON.parse(await readFile('config/map-cities.json','utf8')),seen=new Set();
 for(const [city,cell] of Object.entries(cities)){
  if(!/^[a-z][a-z0-9-]*$/.test(city)||!Array.isArray(cell)||cell.length!==2||!cell.every(Number.isInteger)||cell[0]<-90||cell[0]>89||cell[1]<-180||cell[1]>179||seen.has(cell.join('/')))throw new Error(`Invalid or duplicate map cell: ${city}`);
  seen.add(cell.join('/'));
 }
 return cities;
}
export function selectMapCities(cities,selection){
 if(selection==='all')return Object.keys(cities);
 if(!selection||!Object.hasOwn(cities,selection))throw new Error('Specify a registered city or all');
 return [selection];
}

/** Build operations never modify unowned legacy chunks in a shared, stamped cell. */
export function ownedCityChunks(manifest,city){
 const stamped=manifest.chunks.some(c=>c.m),owned=manifest.chunks.filter(c=>!stamped||c.m===city+'-stream');
 if(!owned.length)throw new Error('No owned chunks for '+city);return owned;
}
