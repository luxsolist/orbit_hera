import {mapBuildVersion} from './map-build-version.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {streetBuildHash} from './street-build-hash.mjs';
import {streetArtifacts} from './street-artifacts.mjs';
export function auditStreetRegion(city,region){
 const base='build/streets/'+city+'-'+region,read=p=>JSON.parse(readFileSync(p,'utf8'));
 const a=read(base+'-audit.json'),plans=streetArtifacts(base+'-plans.json');
 const errors=[];
 const structures=read(base+'-structure-audit.json');
 const resolvedBytes=readFileSync(base+'-resolved-input.json'),resolvedHash=createHash('sha256').update(resolvedBytes).digest('hex');
 const terrainSizes=new Map(JSON.parse(resolvedBytes).chunks.map(c=>[c.cx+'_'+c.cz,c.terrain.size*c.terrain.size]));
 if(structures.inputHash!==resolvedHash)errors.push('Stale structure classification audit');
 if(structures.errors?.length)errors.push('Invalid structure classification');
 const hash=createHash('sha256').update(readFileSync(base+'-plans.json')).digest('hex');
 for(const suffix of ['surface-audit','mesh-audit']){
  const check=read(base+'-'+suffix+'.json');
  if(check.planHash!==hash)errors.push('Stale '+suffix);
  if(check.errors?.length||check.missing||check.insideBuilding||check.seamErrors)errors.push('Failed '+suffix);
 }
 if(a.walkingMissing||a.walkingUncoveredMeters>.01)errors.push('Disconnected pedestrian routes: '+a.walkingUncoveredMeters+'m');
 if(a.guideFailures?.length)errors.push('Unresolved route guides: '+a.guideFailures.length);
 if(a.uncoveredRouteMeters>.01)errors.push('Disconnected route length: '+a.uncoveredRouteMeters);
 if(a.missingRouteSamples)errors.push('Final street route samples absent: '+a.missingRouteSamples);
 if(a.buildingOverlap>.01||a.surfaceOverlap>.01)errors.push('Surface ownership overlaps');
 const cfg=read('config/street-regions.json')[city]?.[region];
 if(cfg?.coverage==='manifest'){
  const cell=read('config/map-cities.json')[city],expected=read('public/maps/'+cell.join('/')+'/tiles.json').chunks.map(c=>c.cx+'_'+c.cz);
  if(expected.length!==plans.keys.length||expected.some(k=>!plans.keys.includes(k)))errors.push('City manifest coverage mismatch');
 }
 const sourceHash=streetBuildHash(base),compilerVersion=mapBuildVersion(city);
 let triangles=0;
 for(const key of plans.keys){const p=plans.read(key);
  if(p.compilerVersion!==compilerVersion)errors.push('Stale compiler '+key);
  if(p.sourceHash!==sourceHash)errors.push('Stale build source '+key);
  for(const field of ['terrainHeights','roadHeights'])if(p[field]&&(p[field].length!==terrainSizes.get(key)||!p[field].every(Number.isFinite)))errors.push('Invalid baked terrain '+key+'/'+field);
  if(!!p.terrainHeights!==!!p.roadHeights)errors.push('Incomplete baked terrain pair '+key);
  if(p.version!==1||!p.sourceHash||p.bounds.length!==4)errors.push('Invalid plan '+key);
  for(const m of p.meshes){
   if(m.position.length%3||(m.index?.length??0)%3||!m.position.every(Number.isFinite)||m.index?.some(i=>!Number.isInteger(i)||i<0||i>=m.position.length/3))errors.push('Invalid geometry '+key);
   triangles+=(m.index?.length??m.position.length/3)/3;
  }
 }
 if(errors.length)throw Error(errors.join('\n'));
 return {city,region,chunks:plans.keys.length,triangles,routeSamples:a.routeSamples,overlap:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(auditStreetRegion(process.argv[2]??'seoul',process.argv[3]??'jongno-cheonggye')));
