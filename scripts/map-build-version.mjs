import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
const ENTRIES=['scripts/street_checkpoint.py','scripts/street_compile.py','scripts/prepare-street-region.mjs','scripts/bake-street-region.mjs','scripts/build-city-surfaces.mjs','scripts/build-road-network-grades.mjs','scripts/build-local-road-refinements.mjs','scripts/rebuild-building-heights.mjs','scripts/osm.mjs','scripts/build-world.mjs','src/world/CompleteMapChunk.ts','src/world/chunkMesh.ts','scripts/map-build-version.mjs'];
/** Conservative transitive dependency fingerprint. Never stamp old output as current. */
export function mapBuildVersion(city,root=process.cwd(),entries=ENTRIES){
 const codeRoot=entries===ENTRIES?fileURLToPath(new URL('../',import.meta.url)):root,files=new Set();
 function visit(file){
  const absolute=resolve(codeRoot,file);if(files.has(absolute))return;
  files.add(absolute);const text=readFileSync(absolute,'utf8');
  // Child build commands and Vite SSR entrypoints are dependencies too.
  for(const match of text.matchAll(/['"](scripts\/[^'"$]+\.(?:mjs|py)|\/src\/[^'"$]+\.ts)['"]/g)){const child=match[1].replace(/^\//,'');if(existsSync(resolve(codeRoot,child)))visit(child);}
  if(!/\.(?:ts|js|mjs)$/.test(absolute))return;
  for(const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)){
   const base=resolve(dirname(absolute),match[1]);
   const found=[base,...['.ts','.mjs','.js','.json','/index.ts'].map(ext=>base+ext)].find(p=>existsSync(p)&&extname(p));
   if(found)visit(found);
  }
 }
 for(const entry of entries)visit(entry);
 const hash=createHash('sha256');
 for(const file of [...files].sort())hash.update(file.slice(resolve(codeRoot).length)).update(readFileSync(file));
 const registry=JSON.parse(readFileSync(resolve(root,'config/street-regions.json'),'utf8'));
 hash.update(JSON.stringify(registry[city]??null));hash.update(readFileSync(resolve(root,'config/street-profiles.json')));
 return hash.digest('hex');
}
export function assertCurrentChunk(chunk,version,key='chunk'){
 if(chunk.mapBuild?.buildVersion!==version)throw Error('Stale completed map build '+key+'; rebuild required');
 if((chunk.compiledStreet||chunk.objects?.roads?.length)&&chunk.compiledStreet?.compilerVersion!==version)throw Error('Stale street compiler '+key+'; rebuild required');
}
