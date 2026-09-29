import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import index from '../src/world/seoul-bundles.json';
import busan from '../src/world/busan-bundles.json';
import rome from '../src/world/rome-bundles.json';
import athens from '../src/world/athens-bundles.json';
it.each([{city:'seoul',grid:'37/126',index,count:400,chunks:1600},{city:'busan',grid:'35/129',index:busan,count:420,chunks:1600},{city:'rome',grid:'41/12',index:rome,count:441,chunks:1640},{city:'athens',grid:'37/23',index:athens,count:441,chunks:1640}])('packs all $city chunks and overlays without changing data',({city,grid,index,count,chunks})=>{
 const seen=new Set<string>();expect(Object.keys(index.bundles)).toHaveLength(count);
 for(const [key,entry] of Object.entries(index.bundles)){
  const bytes=readFileSync(`public/maps/bundles/${city}/${entry.file}`);expect(bytes.length).toBe(entry.bytes);
  const data=gunzipSync(bytes);expect(data.length).toBe(entry.rawBytes);const bundle=JSON.parse(data.toString());expect(bundle.key).toBe(key);
  for(const [k,value] of Object.entries(bundle.chunks) as [string,any][]){
   expect(seen.has(k)).toBe(false);seen.add(k);const [x,z]=k.split('_').map(Number);
   const original=JSON.parse(readFileSync(`public/maps/${grid}/${Math.floor(x/16)}_${Math.floor(z/16)}/${k}.json`,'utf8'));expect(createHash('sha256').update(JSON.stringify(value.raw)).digest('hex')).toBe(createHash('sha256').update(JSON.stringify(original)).digest('hex'));
   for(const [field,path] of [['detail',`details/${city}/${k}`],['roadGrade',`road-grade/${grid}/${k}`],['appearance',`landmark-appearance/${city}/${k}`]]){
    const p=`public/maps/${path}.json`;expect(value[field]).toEqual(existsSync(p)?JSON.parse(readFileSync(p,'utf8')):null);
   }
  }
 }expect(seen.size).toBe(chunks);
},300000);
