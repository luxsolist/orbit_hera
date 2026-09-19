import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
import {loadMapCities,selectMapCities} from './map-city-config.mjs';
const cities=await loadMapCities();
for(const city of selectMapCities(cities,process.argv[2]??'all')){
const data=await readFile(`src/world/${city}-bundles.json`),index=JSON.parse(data),release=JSON.parse(await readFile(`config/map-releases/${city}.json`,'utf8'));
if(hash(data)!==release.bundleIndexSha256)throw new Error(`Publish the updated source snapshot with npm run maps:publish:city -- ${city} before release build`);
const manifest=JSON.parse(await readFile(`public/maps/${cities[city].join('/')}/tiles.json`,'utf8'));
const expected=new Set(manifest.chunks.map(c=>`${c.cx}_${c.cz}`)),seen=new Set();
if(index.cell.join('/')!==cities[city].join('/')||index.size!==2)throw new Error(`Invalid index: ${city}`);
let count=0;
for(const [key,e] of Object.entries(index.bundles)){
 const bytes=await readFile(`public/maps/bundles/${city}/${e.file}`);if(hash(bytes)!==e.sha256||bytes.length!==e.bytes)throw new Error(`Corrupt bundle ${key}`);
 const plain=gunzipSync(bytes),b=JSON.parse(plain);if(plain.length!==e.rawBytes||b.key!==key||e.chunks.some(k=>!b.chunks[k]?.raw))throw new Error(`Invalid bundle ${key}`);for(const k of e.chunks){const [x,z]=k.split('_').map(Number);if(seen.has(k)||!expected.has(k)||key!==`${Math.floor(x/2)}_${Math.floor(z/2)}`)throw new Error(`Invalid coverage: ${city}/${k}`);seen.add(k);}count+=e.chunks.length;
}
if(seen.size!==expected.size)throw new Error(`Missing chunks: ${city}`);
console.log(`Verified ${count} chunks against release ${release.tag}`);

}
