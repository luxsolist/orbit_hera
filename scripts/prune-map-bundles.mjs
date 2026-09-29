import {readFileSync,readdirSync,mkdirSync,renameSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {loadMapCities,selectMapCities} from './map-city-config.mjs';
const cities=await loadMapCities(),hash=b=>createHash('sha256').update(b).digest('hex');
for(const city of selectMapCities(cities,process.argv[2])){
 const data=readFileSync('src/world/'+city+'-bundles.json'),index=JSON.parse(data),release=JSON.parse(readFileSync('config/map-releases/'+city+'.json'));
 if(hash(data)!==release.bundleIndexSha256)throw Error('Publish/verify current map before cleanup: '+city);
 const dir=resolve('public/maps/bundles',city),keep=new Set();
 for(const entry of Object.values(index.bundles)){if(!/^-?\d+_-?\d+\.[a-f0-9]{16}\.bin$/.test(entry.file))throw Error('Invalid bundle filename');const data=readFileSync(join(dir,entry.file));if(hash(data)!==entry.sha256)throw Error('Invalid active bundle '+entry.file);keep.add(entry.file);}
 const obsolete=readdirSync(dir).filter(n=>/^-?\d+_-?\d+\.[a-f0-9]{16}\.bin$/.test(n)&&!keep.has(n));
 const parent=resolve('build/map-bundle-cache',city);mkdirSync(parent,{recursive:true});const cache=obsolete.length?mkdtempSync(join(parent,'replaced-')):null;
 for(const name of obsolete){const from=resolve(dir,name),to=resolve(cache,name);if(dirname(from)!==dir||dirname(to)!==cache)throw Error('Unsafe cache move');renameSync(from,to);}
 console.log(JSON.stringify({city,active:keep.size,cached:obsolete.length,cache}));
}
