import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root='public/maps',out=`${root}/bundles/seoul`;await mkdir(out,{recursive:true});
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const optional=async p=>{try{return await read(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const manifest=await read(`${root}/37/126/tiles.json`),groups=new Map();
for(const {cx,cz} of manifest.chunks){const key=`${Math.floor(cx/2)}_${Math.floor(cz/2)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({cx,cz});}
const index={version:1,cell:[37,126],size:2,bundles:{}};let bytes=0,rawBytes=0;
for(const [key,coords] of groups){
 const chunks={};
 for(const {cx,cz} of coords){const k=`${cx}_${cz}`,block=manifest.block??16;
 chunks[k]={raw:await read(`${root}/37/126/${Math.floor(cx/block)}_${Math.floor(cz/block)}/${k}.json`),detail:await optional(`${root}/details/seoul/${k}.json`),roadGrade:await optional(`${root}/road-grade/37/126/${k}.json`),appearance:await optional(`${root}/landmark-appearance/seoul/${k}.json`)};
 }
 const raw=Buffer.from(JSON.stringify({version:1,cell:[37,126],key,chunks})),compressed=gzipSync(raw,{level:6});
 const hash=createHash('sha256').update(compressed).digest('hex'),file=`${key}.${hash.slice(0,16)}.bin`;
 await writeFile(`${out}/${file}`,compressed);index.bundles[key]={file,bytes:compressed.length,rawBytes:raw.length,sha256:hash,chunks:Object.keys(chunks)};bytes+=compressed.length;rawBytes+=raw.length;
}
await writeFile('src/world/seoul-bundles.json',JSON.stringify(index,null,2)+'\n');
console.log(JSON.stringify({chunks:manifest.chunks.length,bundles:groups.size,rawBytes,gzipBytes:bytes}));
