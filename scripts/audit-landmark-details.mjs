// Shared source-binding audit; intentionally independent of raw chunk Releases registration.
import {readFile} from 'node:fs/promises';
const city=process.argv[2];if(!/^[a-z][a-z0-9-]*$/.test(city??''))throw new Error('Specify city');
// The streaming catalog is the city/cell source of truth.
const catalog=JSON.parse(await readFile('public/maps/index.json','utf8')),entry=catalog.find(c=>c.id===city+'-stream');
const cell=entry&&Number.isFinite(entry.lat)&&Number.isFinite(entry.lon)?[Math.floor(entry.lat),Math.floor(entry.lon)]:undefined;
if(!cell)throw new Error('Unknown city');
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const index=await read(`src/world/cities/${city}-detail-index.json`),manifest=await read(`public/maps/${cell.join('/')}/tiles.json`),block=manifest.block??16,errors=[];
let buildings=0,surfaces=0;
const polygon=(p,id)=>{if(!Array.isArray(p)||p.length<6||p.length%2||!p.every(Number.isFinite))errors.push(`Invalid polygon ${id}`);};
for(const key of index.chunks){
 const [x,z]=key.split('_').map(Number),raw=await read(`public/maps/${cell.join('/')}/${Math.floor(x/block)}_${Math.floor(z/block)}/${key}.json`),d=await read(`public/maps/details/${city}/${key}.json`);
 const available=new Set([...raw.objects.buildings,...(d.add??[])].map(b=>JSON.stringify(b.p))),ids=new Set();
 for(const b of d.buildings){polygon(b.p,b.id);for(const p of b.holes??[])polygon(p,b.id);if(!available.has(JSON.stringify(b.p)))errors.push(`Unbound building ${key}/${b.id}`);if(ids.has(b.id))errors.push(`Duplicate building ${key}/${b.id}`);ids.add(b.id);if(b.h!=null&&(!Number.isFinite(b.h)||b.h<=0||b.h>1000))errors.push(`Invalid height ${b.id}`);buildings++;}
 for(const a of [...d.areas,...d.water]){polygon(a.p,a.id);surfaces++;}
 for(const [i,y] of d.terrain)if(!Number.isInteger(i)||i<0||i>=raw.terrain.heights.length||!Number.isFinite(y))errors.push(`Invalid terrain ${key}`);
 for(const site of d.romeSites??[])if(site.p.length<(site.kind==='rome-mask'?2:4)||!site.p.every(Number.isFinite))errors.push(`Invalid site ${site.id}`);
}
if(errors.length)throw new Error(errors.join('\n'));
console.log(JSON.stringify({city,chunks:index.chunks.length,buildings,surfaces,status:'passed'}));
