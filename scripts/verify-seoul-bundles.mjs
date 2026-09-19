import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
const data=await readFile('src/world/seoul-bundles.json'),index=JSON.parse(data),release=JSON.parse(await readFile('config/map-releases/seoul.json','utf8'));
if(hash(data)!==release.bundleIndexSha256)throw new Error('Publish the updated source snapshot with npm run maps:publish before release build');
let count=0;
for(const [key,e] of Object.entries(index.bundles)){
 const bytes=await readFile(`public/maps/bundles/seoul/${e.file}`);if(hash(bytes)!==e.sha256||bytes.length!==e.bytes)throw new Error(`Corrupt bundle ${key}`);
 const plain=gunzipSync(bytes),b=JSON.parse(plain);if(plain.length!==e.rawBytes||b.key!==key||e.chunks.some(k=>!b.chunks[k]?.raw))throw new Error(`Invalid bundle ${key}`);count+=e.chunks.length;
}
console.log(`Verified ${count} chunks against release ${release.tag}`);
