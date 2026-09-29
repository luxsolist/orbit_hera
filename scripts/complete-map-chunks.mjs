import {mapBuildVersion,assertCurrentChunk} from './map-build-version.mjs';
import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
export function cityChunkFiles(city){
 const cell=read('config/map-cities.json')[city];if(!cell)throw Error('Unknown city '+city);
 const grid=cell.join('/'),manifestPath='public/maps/'+grid+'/tiles.json',manifest=read(manifestPath);
 return {cell,grid,manifest,manifestPath,rows:manifest.chunks.map(({cx,cz})=>{const key=cx+'_'+cz;return {key,file:'public/maps/'+grid+'/'+Math.floor(cx/(manifest.block??16))+'_'+Math.floor(cz/(manifest.block??16))+'/'+key+'.json',overlays:{detail:'public/maps/details/'+city+'/'+key+'.json',roadGrade:'public/maps/road-grade/'+grid+'/'+key+'.json',appearance:'public/maps/landmark-appearance/'+city+'/'+key+'.json'}};})};
}
/** Legacy design stages operate on clean inputs, never previously corrected output. */
export function restoreMapBuildInputs(city){
 const data=cityChunkFiles(city);let restored=0;
 for(const row of data.rows){const c=read(row.file);if(!c.mapBuild)continue;const input=structuredClone(c.mapBuild.input);
  if(c.compiledStreet)input.roadGrade={...(input.roadGrade??{version:1,size:c.terrain.size,points:[]}),streetPlan:{...c.compiledStreet,terrainHeights:c.terrain.heights,roadHeights:c.roadHeights,resolvedSites:c.objects.sites,resolvedBuildings:c.objects.buildings,resolvedStructures:c.objects.structures,resolvedWater:c.objects.water,walls:c.objects.walls}};
  for(const [field,file] of Object.entries(row.overlays)){if(input[field]){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(input[field]));}else if(existsSync(file))unlinkSync(file);}
  writeFileSync(row.file,JSON.stringify(input.raw));restored++;
 }
 if(restored){const path='public/maps/road-grade/index.json';if(existsSync(path)){const index=read(path);index.cells[data.grid]=data.rows.filter(row=>existsSync(row.overlays.roadGrade)).map(row=>row.key);writeFileSync(path,JSON.stringify(index));}delete data.manifest.completedChunkVersion;writeFileSync(data.manifestPath,JSON.stringify(data.manifest));}
 return restored;
}
export async function completeCityChunks(city){
 const data=cityChunkFiles(city),server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
 const buildVersion=mapBuildVersion(city),staged=[];let bytes=0,already=0;
 try{const {completeMapChunk,compactMapChunk}=await server.ssrLoadModule('/src/world/CompleteMapChunk.ts');const {applyMapCorrections}=await server.ssrLoadModule('/src/world/MapCorrections.ts');
  for(const row of data.rows){const raw=read(row.file);
   if(raw.mapBuild?.version===1){assertCurrentChunk(raw,buildVersion,row.key);already++;continue;}
   const input={raw};for(const [field,file] of Object.entries(row.overlays))input[field]=existsSync(file)?read(file):null;
   const chunk=completeMapChunk(data.cell,input),expected=compactMapChunk(applyMapCorrections(data.cell,structuredClone(raw),structuredClone(input)));
   if(JSON.stringify(compactMapChunk(chunk))!==JSON.stringify(expected))throw Error('Completed chunk differs from legacy rendering: '+row.key);
   if((chunk.compiledStreet||chunk.objects.roads.length)&&chunk.compiledStreet?.compilerVersion!==buildVersion)throw Error('Rebuild street plan before completing '+row.key);
   chunk.mapBuild.buildVersion=buildVersion;
   const encoded=JSON.stringify(chunk);if(JSON.stringify(applyMapCorrections(data.cell,chunk,{detail:null,roadGrade:null,appearance:null}))!==encoded)throw Error('Corrections reapplied '+row.key);
   writeFileSync(row.file+'.complete-next',encoded);staged.push(row);bytes+=Buffer.byteLength(encoded);
   if(staged.length%100===0)console.log(JSON.stringify({completed:staged.length,bytes}));
  }
  // Validate every staged file before replacing any output; runtime bundles stay immutable.
  for(const row of staged)renameSync(row.file+'.complete-next',row.file);
  for(const row of data.rows)for(const file of Object.values(row.overlays))if(existsSync(file))unlinkSync(file);
  const indexPath='public/maps/road-grade/index.json';if(existsSync(indexPath)){const index=read(indexPath);delete index.cells[data.grid];writeFileSync(indexPath,JSON.stringify(index));}
  data.manifest.completedChunkVersion=1;writeFileSync(data.manifestPath,JSON.stringify(data.manifest));
  mkdirSync('build/completed-maps',{recursive:true});
  for(const kind of ['details','landmark-appearance'])for(const name of ['audit.json','runtime-audit.json']){const file='public/maps/'+kind+'/'+city+'/'+name;if(existsSync(file)){writeFileSync('build/completed-maps/'+city+'-'+kind+'-'+name,readFileSync(file));unlinkSync(file);}}
  const report={city,chunks:data.rows.length,rebuilt:staged.length,already,bytes,equivalent:true,sidecars:0};
  writeFileSync('build/completed-maps/'+city+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));return report;
 }finally{await server.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const city=process.argv[2];if(process.argv.includes('--inputs'))console.log({restored:restoreMapBuildInputs(city)});else await completeCityChunks(city);}
