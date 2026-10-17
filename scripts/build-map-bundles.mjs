import {completeCityChunks} from './complete-map-chunks.mjs';
import {validateCitySurfaces} from './validate-city-surfaces.mjs';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {loadMapCities,selectMapCities} from './map-city-config.mjs';
import {execFileSync} from 'node:child_process';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const cities=await loadMapCities(),selected=selectMapCities(cities,process.argv[2]);
for(const city of selected){
// Validate before writing any bundle or replacing the index. publish uses this same path.
validateCitySurfaces(city);
await completeCityChunks(city);
const cell=cities[city],grid=cell.join('/');
const root='public/maps',out=`${root}/bundles/${city}`;await mkdir(out,{recursive:true});
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const optional=async p=>{try{return await read(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const manifest=await read(`${root}/${grid}/tiles.json`),groups=new Map();
for(const {cx,cz} of manifest.chunks){const key=`${Math.floor(cx/2)}_${Math.floor(cz/2)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({cx,cz});}
const index={version:1,completedChunkVersion:1,cell,size:2,bundles:{}};let bytes=0,rawBytes=0;
for(const [key,coords] of groups){
 const chunks={};
 for(const {cx,cz} of coords){const k=`${cx}_${cz}`,block=manifest.block??16;
 chunks[k]={raw:await read(`${root}/${grid}/${Math.floor(cx/block)}_${Math.floor(cz/block)}/${k}.json`),detail:await optional(`${root}/details/${city}/${k}.json`),roadGrade:await optional(`${root}/road-grade/${grid}/${k}.json`),appearance:await optional(`${root}/landmark-appearance/${city}/${k}.json`)};
 }
 const raw=Buffer.from(JSON.stringify({version:1,cell,key,chunks})),compressed=gzipSync(raw,{level:6});
 const hash=createHash('sha256').update(compressed).digest('hex'),file=`${key}.${hash.slice(0,16)}.bin`;
 await writeFile(`${out}/${file}`,compressed);index.bundles[key]={file,bytes:compressed.length,rawBytes:raw.length,sha256:hash,chunks:Object.keys(chunks)};bytes+=compressed.length;rawBytes+=raw.length;
}
const indexPath=`src/world/${city}-bundles.json`,previous=await readFile(indexPath,'utf8').catch(()=>null);
await writeFile(`${indexPath}.next`,JSON.stringify(index,null,2)+'\n');await rename(`${indexPath}.next`,indexPath);
// Regression gate on what the game will render: floating deck ends, missing ramps, trees on roads
// (scripts/audit-elevated-roads.mjs, ceilings in config/map-quality/elevated-roads.json).
// A failing build keeps the previous playable index and drops the bundles it just wrote.
try{execFileSync(process.execPath,['--max-old-space-size=3072',fileURLToPath(new URL('./audit-elevated-roads.mjs',import.meta.url)),city,'--strict'],{stdio:'inherit'});}
catch(error){
 const keep=new Set(previous?Object.values(JSON.parse(previous).bundles).map(e=>e.file):[]);
 for(const e of Object.values(index.bundles))if(!keep.has(e.file))await unlink(`${out}/${e.file}`).catch(()=>{});
 if(previous!==null)await writeFile(indexPath,previous);
 throw new Error(`Elevated road / roadside tree gate failed for ${city}; previous bundles kept (build/${city}-elevated-audit.json)`);
}
console.log(JSON.stringify({city,chunks:manifest.chunks.length,bundles:groups.size,rawBytes,gzipBytes:bytes}));

}
