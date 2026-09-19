import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const cities=JSON.parse(await readFile('config/map-cities.json','utf8')),city=process.argv[2]??'seoul';
if(!cities[city])throw new Error('Unknown map city: '+city);
const cell=cities[city],grid=cell.join('/');
const root='public/maps',out=`${root}/bundles/${city}`;await mkdir(out,{recursive:true});
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const optional=async p=>{try{return await read(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const manifest=await read(`${root}/${grid}/tiles.json`),groups=new Map();
for(const {cx,cz} of manifest.chunks){const key=`${Math.floor(cx/2)}_${Math.floor(cz/2)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({cx,cz});}
const index={version:1,cell,size:2,bundles:{}};let bytes=0,rawBytes=0;
for(const [key,coords] of groups){
 const chunks={};
 for(const {cx,cz} of coords){const k=`${cx}_${cz}`,block=manifest.block??16;
 chunks[k]={raw:await read(`${root}/${grid}/${Math.floor(cx/block)}_${Math.floor(cz/block)}/${k}.json`),detail:await optional(`${root}/details/${city}/${k}.json`),roadGrade:await optional(`${root}/road-grade/${grid}/${k}.json`),appearance:await optional(`${root}/landmark-appearance/${city}/${k}.json`)};
 }
 const raw=Buffer.from(JSON.stringify({version:1,cell,key,chunks})),compressed=gzipSync(raw,{level:6});
 const hash=createHash('sha256').update(compressed).digest('hex'),file=`${key}.${hash.slice(0,16)}.bin`;
 await writeFile(`${out}/${file}`,compressed);index.bundles[key]={file,bytes:compressed.length,rawBytes:raw.length,sha256:hash,chunks:Object.keys(chunks)};bytes+=compressed.length;rawBytes+=raw.length;
}
await writeFile(`src/world/${city}-bundles.json`,JSON.stringify(index,null,2)+'\n');
console.log(JSON.stringify({chunks:manifest.chunks.length,bundles:groups.size,rawBytes,gzipBytes:bytes}));
