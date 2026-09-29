import {ownedCityChunks} from './map-city-config.mjs';
import {createServer} from 'vite';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
const city=process.argv[2],read=p=>JSON.parse(readFileSync(p,'utf8')),optional=p=>existsSync(p)?read(p):null;
const cell=read('config/map-cities.json')[city],root='public/maps/'+cell.join('/'),m=read(root+'/tiles.json'),edges=new Map();
const result={city,chunks:0,patches:0,points:0,errors:[],preexistingSeams:0};
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {applyMapCorrections}=await server.ssrLoadModule('/src/world/MapCorrections.ts');
 const {applyRoadNetworkPatch}=await server.ssrLoadModule('/src/world/RoadGradePatch.ts');
 for(const {cx,cz} of ownedCityChunks(m,city)){const key=cx+'_'+cz,raw=read(`${root}/${Math.floor(cx/(m.block??16))}_${Math.floor(cz/(m.block??16))}/${key}.json`),overlays={roadGrade:optional(`public/maps/road-grade/${cell.join('/')}/${key}.json`),detail:optional(`public/maps/details/${city}/${key}.json`),appearance:optional(`public/maps/landmark-appearance/${city}/${key}.json`)};
  // Validate the legacy network recipe against its own input stage.
  // The compiled street plan replaces heights later and has separate mesh/seam gates.
  const legacyOverlays={...overlays,roadGrade:overlays.roadGrade?{...overlays.roadGrade,streetPlan:undefined}:null};
  const base=applyMapCorrections(cell,raw,legacyOverlays,{roadNetwork:false}),final=applyRoadNetworkPatch(base,overlays.roadGrade),net=overlays.roadGrade?.network,n=raw.terrain.size;result.chunks++;
  if(net){result.patches++;result.points+=net.points.length;
   const ids=new Set();for(const [i,g,s,d] of net.points){
    if(ids.has(i)||!Number.isInteger(i)||i<0||i>=n*n||![g,s,d].every(Number.isFinite)||Math.abs(d)>15.001||Math.abs(base.terrain.heights[i]-g)>.002||Math.abs((base.roadHeights??base.terrain.heights)[i]-s)>.002||Math.abs(final.terrain.heights[i]-g-d)>.002)result.errors.push(`${key}: stale/invalid/unused point ${i}`);ids.add(i);
   }
   if(applyRoadNetworkPatch(final,overlays.roadGrade)!==final)result.errors.push(key+': not idempotent');
  }
  for(let z=0;z<n;z++)for(let x=0;x<n;x++)if(!x||!z||x===n-1||z===n-1){const i=z*n+x,k=(cx*(n-1)+x)+','+(cz*(n-1)+z),before=[base.terrain.heights[i],(base.roadHeights??base.terrain.heights)[i]],after=[final.terrain.heights[i],(final.roadHeights??final.terrain.heights)[i]],prior=edges.get(k);
   if(prior)for(let j=0;j<2;j++){const old=Math.abs(prior.before[j]-before[j]),now=Math.abs(prior.after[j]-after[j]);if(old>.002)result.preexistingSeams++;if(now>old+.002)result.errors.push('new land/street seam '+k);}
   edges.set(k,{before,after});
  }
 }
 writeFileSync(`build/${city}-road-network-validation.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,errors:result.errors.slice(0,10)}));if(result.errors.length)process.exitCode=1;
}finally{await server.close();}
