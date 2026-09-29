import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const json=p=>JSON.parse(readFileSync(p,'utf8'));
export function streetArtifacts(path){
 const root=json(path),files=root.format==='chunk-files';
 const keys=Object.keys(files?root.chunks:root);
 return {keys,read(key){const entry=files?root.chunks[key]:root[key];if(!files)return entry;
  const file=typeof entry==='string'?entry:entry.file,bytes=readFileSync(file);
  if(entry.sha256&&createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Street artifact changed: '+file);
  return JSON.parse(bytes);},hash:createHash('sha256').update(readFileSync(path)).digest('hex')};
}
export function writeStreetPart(directory,key,value){mkdirSync(directory,{recursive:true});const file=directory+'/'+key+'.json',bytes=Buffer.from(JSON.stringify(value));writeFileSync(file,bytes);return {file,sha256:createHash('sha256').update(bytes).digest('hex')};}
