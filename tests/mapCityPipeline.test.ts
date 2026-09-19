import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
it('builds and verifies a newly registered city with negative coordinates and non-default source blocks',()=>{
 const root=mkdtempSync(join(tmpdir(),'map-city-'));
 const put=(p:string,value:unknown)=>{const path=join(root,p);mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,JSON.stringify(value));};
 const run=(script:string,...args:string[])=>spawnSync(process.execPath,[resolve('scripts',script),...args],{cwd:root,encoding:'utf8'});
 try{
  put('config/map-cities.json',{'test-city':[12,34]});
  put('public/maps/12/34/tiles.json',{cell:[12,34],block:8,chunks:[{cx:-9,cz:1},{cx:-10,cz:1}]});
  for(const cx of [-9,-10])put(`public/maps/12/34/-2_0/${cx}_1.json`,{cx,cz:1});
  put('public/maps/details/test-city/-9_1.json',{custom:'preserved'});
  mkdirSync(join(root,'src/world'),{recursive:true});
  expect(run('build-map-bundles.mjs','all').status).toBe(0);
  const bytes=readFileSync(join(root,'src/world/test-city-bundles.json')),index=JSON.parse(bytes.toString());
  expect(Object.keys(index.bundles)).toEqual(['-5_0']);
  const entry=index.bundles['-5_0'],bundle=JSON.parse(gunzipSync(readFileSync(join(root,'public/maps/bundles/test-city',entry.file))).toString());
  expect(bundle.chunks['-9_1'].detail).toEqual({custom:'preserved'});
  put('config/map-releases/test-city.json',{tag:'test',bundleIndexSha256:createHash('sha256').update(bytes).digest('hex')});
  expect(run('verify-map-bundles.mjs','all').status).toBe(0);
  put('public/maps/12/34/tiles.json',{cell:[12,34],chunks:[{cx:-9,cz:1},{cx:-10,cz:1},{cx:0,cz:0}]});
  expect(run('verify-map-bundles.mjs','all').stderr).toContain('Missing chunks');
  put('config/map-cities.json',{'test-city':[12,34],duplicate:[12,34]});
  expect(run('build-map-bundles.mjs','all').stderr).toContain('duplicate map cell');
 }finally{rmSync(root,{recursive:true,force:true});}
});
