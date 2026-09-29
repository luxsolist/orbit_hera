import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mapBuildVersion,assertCurrentChunk} from '../scripts/map-build-version.mjs';
it('invalidates the build when an indirect geometry dependency or city policy changes',()=>{
 const root=mkdtempSync(join(tmpdir(),'map-version-'));
 try{
  mkdirSync(join(root,'config'));writeFileSync(join(root,'config/street-regions.json'),JSON.stringify({test:{halo:100}}));writeFileSync(join(root,'config/street-profiles.json'),'{}');
  mkdirSync(join(root,'scripts'));writeFileSync(join(root,'scripts/child.py'),'revision=1');
  writeFileSync(join(root,'entry.ts'),"import {geometry} from './geometry'; const child='scripts/child.py';");writeFileSync(join(root,'geometry.ts'),'export const geometry=1');
  const hash=()=>mapBuildVersion('test',root,['entry.ts']);const before=hash();expect(hash()).toBe(before);
  writeFileSync(join(root,'scripts/child.py'),'revision=2');expect(hash()).not.toBe(before);
  writeFileSync(join(root,'geometry.ts'),'export const geometry=2');expect(hash()).not.toBe(before);const next=hash();
  writeFileSync(join(root,'config/street-regions.json'),JSON.stringify({test:{halo:200}}));expect(hash()).not.toBe(next);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('rejects missing or stale stamps instead of accepting old completed chunks',()=>{
 expect(()=>assertCurrentChunk({mapBuild:{version:1}},'new')).toThrow('Stale');
 expect(()=>assertCurrentChunk({mapBuild:{buildVersion:'new'},compiledStreet:{compilerVersion:'old'}},'new')).toThrow('Stale street');
 expect(()=>assertCurrentChunk({mapBuild:{buildVersion:'new'},compiledStreet:{compilerVersion:'new'}},'new')).not.toThrow();
});
