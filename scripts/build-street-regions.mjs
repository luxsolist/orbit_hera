import {streetRegions} from './street-config.mjs';
import {restoreMapBuildInputs} from './complete-map-chunks.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {auditStreetRegion} from './audit-street-region.mjs';
import {streetArtifacts} from './street-artifacts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),read=p=>JSON.parse(readFileSync(p,'utf8'));
export function buildStreetRegions(city,selectedRegion,options={complete:true}){
 const config=streetRegions(city,selectedRegion,{requireSource:true});
 if(options.publish!==false)restoreMapBuildInputs(city);
 if(selectedRegion&&!config[selectedRegion])throw Error('Unknown street region: '+selectedRegion);
 for(const region of selectedRegion?[selectedRegion]:Object.keys(config)){
  if(!selectedRegion&&config[region].enabled===false)continue;
  execFileSync(process.execPath,['scripts/prepare-street-region.mjs',city,region],{cwd:root,stdio:'inherit'});
  try{execFileSync(process.env.MAP_PYTHON??'python3',['scripts/street_compile.py',city,region],{cwd:root,stdio:'inherit'});}catch(error){
   if(existsSync('build/streets/'+city+'-'+region+'-guide-audit.json'))execFileSync(process.env.MAP_PYTHON??'python3',['scripts/classify-street-conflicts.py',city,region],{cwd:root,stdio:'inherit'});
   throw error;
  }
  execFileSync(process.env.MAP_PYTHON??'python3',['scripts/audit-street-structures.py',city,region],{cwd:root,stdio:'inherit'});
  const design=read('build/streets/'+city+'-'+region+'-audit.json');
  if(design.guideFailures?.length&&existsSync('build/streets/'+city+'-'+region+'-guide-audit.json'))execFileSync(process.env.MAP_PYTHON??'python3',['scripts/classify-street-conflicts.py',city,region],{cwd:root,stdio:'inherit'});
  if(design.walkingMissing||design.walkingUncoveredMeters>.01||design.missingRouteSamples||design.uncoveredRouteMeters>.01||design.buildingOverlap>.01||design.surfaceOverlap>.01)throw Error('Street design gate failed: '+city+'/'+region+'; see build/streets audit');
  execFileSync(process.execPath,['scripts/bake-street-region.mjs',city,region],{cwd:root,stdio:'inherit'});
  execFileSync(process.env.MAP_PYTHON??'python3',['scripts/audit-street-meshes.py',city,region],{cwd:root,stdio:'inherit'});
  execFileSync(process.execPath,['scripts/audit-baked-streets.mjs',city,region],{cwd:root,stdio:'inherit'});
  if(options.publish!==false)publishStreetRegion(city,region);
  else console.log(JSON.stringify({...auditStreetRegion(city,region),staged:true}));
 }
 if(options.complete&&options.publish!==false)execFileSync(process.execPath,["scripts/complete-map-chunks.mjs",city],{cwd:root,stdio:"inherit"});
}
export function publishStreetRegion(city,region){
 const report=auditStreetRegion(city,region);
 const plans=streetArtifacts('build/streets/'+city+'-'+region+'-plans.json'),cell=read('config/map-cities.json')[city],staged=[];
 for(const key of plans.keys){const streetPlan=plans.read(key);
  const file='public/maps/road-grade/'+cell.join('/')+'/'+key+'.json';
  let old;if(existsSync(file))old=read(file);else{const [cx,cz]=key.split('_').map(Number),raw=read('public/maps/'+cell.join('/')+'/'+Math.floor(cx/16)+'_'+Math.floor(cz/16)+'/'+key+'.json');old={version:1,size:raw.terrain.size,points:[]};}
  const backup='build/streets/backup-'+city+'-'+key+'.json';
  try{writeFileSync(backup,JSON.stringify(old),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
  writeFileSync(file+'.staged',JSON.stringify({...old,streetPlan}));staged.push(file);
 }
 for(const file of staged)renameSync(file+'.staged',file);
 const indexFile='public/maps/road-grade/index.json',index=read(indexFile);
 index.cells[cell.join('/')]=[...new Set([...(index.cells[cell.join('/')]??[]),...plans.keys])];
 writeFileSync(indexFile+'.staged',JSON.stringify(index));renameSync(indexFile+'.staged',indexFile);
 console.log(JSON.stringify(report));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const city=process.argv[2]??'seoul';
 if(process.argv.includes('--publish-staged')){restoreMapBuildInputs(city);publishStreetRegion(city,process.argv[3]??'jongno-cheonggye');execFileSync(process.execPath,['scripts/complete-map-chunks.mjs',city],{cwd:root,stdio:'inherit'});}
 else {const staged=process.argv.includes('--stage-only');buildStreetRegions(city,process.argv[3],{complete:!staged,publish:!staged});}
}
