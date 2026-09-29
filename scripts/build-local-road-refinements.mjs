import {createServer} from 'vite';
import {writeFileSync,readFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {loadRefinementCity,neighboringRoads,read} from './road-refinement-city.mjs';
import {LOCAL_ROAD_SETTINGS as settings,scopeAt,refineLocalSurface} from './local-road-refinement.mjs';
import {auditRoadProfile} from './road-profile.mjs';
const city=process.argv[2],scope=read(`build/${city}-road-network-scope.json`);
if(scope.city!==city)throw new Error('Wrong scope report');
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {cell,manifest:m,entries,sample}=await loadRefinementCity(city,server),C=m.chunkSize;
 if(C!==1024||m.terrainSize!==33)throw new Error('Unsupported terrain lattice; refusing implicit resampling');
 const {refinementSource,subdivideHeights}=await server.ssrLoadModule('/src/world/RoadRefinement.ts');
 const report={city,settings,generatedAt:new Date().toISOString(),reasonCounts:{},candidates:[],selected:[],outcomes:{},remaining:[]};
 const ranked=[];const seen=new Set();
 for(const [key,e] of entries){if(!e.owned)continue;const c=e.base,codes=scope.chunks[key];if(!codes||scope.sources?.[key]!==refinementSource(c))throw new Error('Missing or stale exclusion provenance; rebuild road network: '+key);
  const audit=auditRoadProfile(c.objects.roads,sample);let best=null;
  for(const issue of audit.issues){const id=issue.p.join(',')+':'+issue.w;if(seen.has(id))continue;seen.add(id);
   const [x,z]=issue.location,ox=c.cx*C,oz=c.cz*C,flags=scopeAt(codes,33,x,z,ox,oz,32),reasons=[];
   for(const [bit,name] of Object.entries(scope.legend))if(flags&Number(bit))reasons.push(name);
   if(issue.bridge||issue.layer)reasons.push('grade-separated-deck-review');
   if(!reasons.length)reasons.push('coarse-grid-or-existing-slope');
   for(const reason of reasons)report.reasonCounts[reason]=(report.reasonCounts[reason]??0)+1;
   report.remaining.push({p:issue.p,w:issue.w,chunk:key,flags,reasons,maxGrade:issue.maxGrade,maxChange:issue.maxChange});
   if(flags&63||issue.bridge||issue.layer||(!issue.rough&&issue.maxGrade<.35)||x<ox+96||x>ox+C-96||z<oz+96||z>oz+C-96)continue;
   const score=issue.maxGrade+issue.maxChange+issue.reversals*.05;
   if(!best||score>best.score)best={key,x,z,score};
  }if(best)ranked.push(best);
 }
 ranked.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const results=new Map();
 for(const focus of ranked.slice(0,settings.maxCandidates)){
  if(results.size>=settings.maxChunks)break;
  const e=entries.get(focus.key),c=e.base,ox=c.cx*C,oz=c.cz*C,n=settings.size,codes=scope.chunks[focus.key];
  const source=Float64Array.from(subdivideHeights(c.roadHeights??c.terrain.heights,33,n)),mask=new Float64Array(n*n),roads=neighboringRoads(entries,c.cx,c.cz);
  for(let z=4;z<n-4;z++)for(let x=4;x<n-4;x++){
   const wx=ox+x*8,wz=oz+z*8,d=Math.hypot(wx-focus.x,wz-focus.z);if(d>settings.radius||scopeAt(codes,33,wx,wz,ox,oz,32)&63)continue;
   mask[z*n+x]=Math.min(1,(settings.radius-d)/64,(x-4)/4,(z-4)/4,(n-5-x)/4,(n-5-z)/4);
  }
  const result=refineLocalSurface(source,mask,roads,ox,oz,sample);
  if(!result){report.candidates.push({...focus,status:'no-safe-improvement'});continue;}
  const deltas=[];for(let i=0;i<n*n;i++){const d=Math.round((result.surface[i]-source[i])*10000)/10000;if(d)deltas.push([i,d]);}
  const refinement={version:1,size:n,source:refinementSource(c),deltas};results.set(focus.key,refinement);
  const detail={...focus,lat:cell[0]+1-focus.z/111320,lon:cell[1]+focus.x/m.mLon,points:deltas.length,removedWarnings:result.removed,steepBefore:result.before.steepSegments,steepAfter:result.after.steepSegments,roughBefore:result.before.roughSegments,roughAfter:result.after.roughSegments,joinsBefore:result.joinsBefore,joinsAfter:result.joinsAfter,blend:result.blend,guard:result.guard};
  report.selected.push(detail);report.candidates.push({...focus,status:'selected'});console.log(JSON.stringify(detail));
 }
 const backup=`build/road-refinement-backups/${city}/${Date.now()}`;mkdirSync(backup,{recursive:true});report.backup=backup;
 const indexPath='public/maps/road-grade/index.json',index=read(indexPath),keys=new Set(index.cells[cell.join('/')]??[]);
 for(const [key,e] of entries){if(!e.owned)continue;const patch=e.overlays.roadGrade??{version:1,size:33,points:[]},refinement=results.get(key);
  if(!refinement&&!patch.refinement)continue;
  if(existsSync(e.path))writeFileSync(backup+'/'+key+'.json',readFileSync(e.path));
  if(refinement)patch.refinement=refinement;else delete patch.refinement;
  mkdirSync(e.path.substring(0,e.path.lastIndexOf('/')),{recursive:true});writeFileSync(e.path+'.tmp',JSON.stringify(patch));renameSync(e.path+'.tmp',e.path);keys.add(key);
 }
 index.cells[cell.join('/')]=[...keys].sort();writeFileSync(indexPath,JSON.stringify(index));
 report.outcomes={eligibleChunks:ranked.length,attempted:report.candidates.length,selected:results.size,remainingUnattempted:ranked.length-report.candidates.length};
 writeFileSync(`build/${city}-road-refinement-build.json`,JSON.stringify(report));console.log(JSON.stringify({city,...report.outcomes,reasonCounts:report.reasonCounts}));
}finally{await server.close();}
