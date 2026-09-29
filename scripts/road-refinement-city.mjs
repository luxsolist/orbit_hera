import {ownedCityChunks} from './map-city-config.mjs';
import {readFileSync,existsSync} from 'node:fs';
export const read=p=>JSON.parse(readFileSync(p,'utf8'));
const optional=p=>existsSync(p)?read(p):null;
export async function loadRefinementCity(city,server,{compiled=true}={}){
 const cell=read('config/map-cities.json')[city];if(!cell)throw new Error('Unknown city '+city);
 const root='public/maps/'+cell.join('/'),manifest=read(root+'/tiles.json');
 const {applyMapCorrections}=await server.ssrLoadModule('/src/world/MapCorrections.ts');
 const {chunkTerrainEntry,sampleStreetHeight}=await server.ssrLoadModule('/src/world/chunkMesh.ts');
 const owned=new Set(ownedCityChunks(manifest,city).map(c=>c.cx+'_'+c.cz));
 const entries=new Map(),terrain=new Map();
 for(const c of manifest.chunks){const key=c.cx+'_'+c.cz,path=`public/maps/road-grade/${cell.join('/')}/${key}.json`;
  const raw=read(`${root}/${Math.floor(c.cx/(manifest.block??16))}_${Math.floor(c.cz/(manifest.block??16))}/${key}.json`);
  const overlays={roadGrade:optional(path),detail:optional(`public/maps/details/${city}/${key}.json`),appearance:optional(`public/maps/landmark-appearance/${city}/${key}.json`)};
  // Audit an intermediate recipe before the final compiled plan replaces its heights.
  if(!compiled&&overlays.roadGrade)overlays.roadGrade={...overlays.roadGrade,streetPlan:undefined};
  const base=applyMapCorrections(cell,raw,overlays,{localRefinement:false});
  entries.set(key,{key,path,raw,overlays,base,owned:owned.has(key)});terrain.set(key,chunkTerrainEntry(base,manifest.chunkSize));
 }
 const sample=(x,z)=>{const t=terrain.get(Math.floor(x/manifest.chunkSize)+'_'+Math.floor(z/manifest.chunkSize));return t?sampleStreetHeight(t,x,z):NaN;};
 return {cell,manifest,entries,terrain,sample,applyMapCorrections};
}
export function neighboringRoads(entries,cx,cz){
 const seen=new Set(),roads=[];
 for(let z=cz-1;z<=cz+1;z++)for(let x=cx-1;x<=cx+1;x++)for(const r of entries.get(x+'_'+z)?.base.objects.roads??[])
  for(let i=2;i<r.p.length;i+=2){const p=r.p.slice(i-2,i+2),k=p.join(',')+':'+(r.w??6);if(!seen.has(k)){seen.add(k);roads.push({...r,p});}}
 return roads;
}
