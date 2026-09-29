import {createServer} from 'vite';
import {writeFileSync} from 'node:fs';
import {loadRefinementCity,neighboringRoads} from './road-refinement-city.mjs';
import {auditRoadProfile} from './road-profile.mjs';
import {auditRoadJoins} from './road-network-grade.mjs';
import {compareRoadAudits,LOCAL_ROAD_SETTINGS} from './local-road-refinement.mjs';
const city=process.argv[2],result={city,patches:0,points:0,removedWarnings:0,errors:[]};
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {entries,manifest:m,cell,sample,applyMapCorrections}=await loadRefinementCity(city,server,{compiled:false});
 const {chunkTerrainEntry,sampleStreetHeight}=await server.ssrLoadModule('/src/world/chunkMesh.ts');
 const {applyRoadRefinement}=await server.ssrLoadModule('/src/world/RoadRefinement.ts');
 const finals=new Map();
 for(const [key,e] of entries){if(!e.owned)continue;const r=e.overlays.roadGrade?.refinement;if(!r)continue;
  result.patches++;result.points+=r.deltas.length;const c=applyMapCorrections(cell,e.raw,e.overlays),t=chunkTerrainEntry(c,m.chunkSize);finals.set(key,t);
  if(c.terrain.size!==129||c.roadRefinementSource!==r.source){result.errors.push(key+': stale, invalid or unused refinement');continue;}
  if(applyRoadRefinement(c,r)!==c)result.errors.push(key+': duplicate application');
  // Inspect every fine edge vertex against the old triangular surface, including intermediate seam points.
  const base=chunkTerrainEntry(e.base,m.chunkSize);
  for(let z=0;z<129;z++)for(let x=0;x<129;x++)if(x<4||z<4||x>124||z>124){
   const wx=e.raw.cx*m.chunkSize+x*8,wz=e.raw.cz*m.chunkSize+z*8;
   if(Math.abs(sampleStreetHeight(t,wx,wz)-sampleStreetHeight(base,wx,wz))>.0001)result.errors.push(key+': changed border '+x+','+z);
  }
 }
 if(result.patches>LOCAL_ROAD_SETTINGS.maxChunks)result.errors.push('Refinement budget exceeded');
 const finalSample=(x,z)=>{const t=finals.get(Math.floor(x/m.chunkSize)+'_'+Math.floor(z/m.chunkSize));return t?sampleStreetHeight(t,x,z):sample(x,z);};
 const roads=[],seen=new Set();
 for(const key of finals.keys()){const e=entries.get(key);for(const r of neighboringRoads(entries,e.raw.cx,e.raw.cz)){const k=r.p.join(',')+':'+r.w;if(!seen.has(k)){seen.add(k);roads.push(r);}}}
 const before=auditRoadProfile(roads,sample),after=auditRoadProfile(roads,finalSample),comparison=compareRoadAudits(before,after);result.removedWarnings=comparison.removed;
 if(comparison.regressions)result.errors.push(comparison.regressions+' road regressions');
 const a=auditRoadJoins(roads,sample,4,{collectAll:true}),b=auditRoadJoins(roads,finalSample,4,{collectAll:true}),old=new Map(a.examples.map(v=>[v.p.join(','),v.change]));
 if(b.examples.some(v=>!old.has(v.p.join(','))||v.change>old.get(v.p.join(','))+.002))result.errors.push('Joined-road regression');
 result.joinsBefore=a.roughJoins;result.joinsAfter=b.roughJoins;
 writeFileSync(`build/${city}-road-refinement-validation.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.errors.length)process.exitCode=1;
}finally{await server.close();}
