import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'vite';
import {streetArtifacts} from './street-artifacts.mjs';
const [city='seoul',region='jongno-cheonggye']=process.argv.slice(2),base='build/streets/'+city+'-'+region;
const plans=streetArtifacts(base+'-plans.json'),routes=JSON.parse(readFileSync(base+'-routes.json','utf8'));
const cache=new Map();function plan(key){if(cache.has(key))return cache.get(key);if(!plans.keys.includes(key))return;const p=plans.read(key);cache.set(key,p);if(cache.size>5)cache.delete(cache.keys().next().value);return p;}
// Bucket line segments, not every sample, so large cities use bounded memory.
const buckets=new Map();for(const r of routes.filter(r=>!r.area))for(let i=1;i<r.p.length;i++){
 const a=r.p[i-1],b=r.p[i],record={a,b,prev:r.p[i-2],next:r.p[i+1],id:r.id,elevated:r.elevated,level:r.level??0};
 for(let x=Math.floor(Math.min(a[0],b[0])/1024);x<=Math.floor(Math.max(a[0],b[0])/1024);x++)for(let z=Math.floor(Math.min(a[1],b[1])/1024);z<=Math.floor(Math.max(a[1],b[1])/1024);z++){
  const k=x+'_'+z,list=buckets.get(k)??[];list.push(record);buckets.set(k,list);
 }
}
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {compiledStreetHeight}=await server.ssrLoadModule('/src/world/CompiledStreet.ts');
 const {CollisionWorld}=await server.ssrLoadModule('/src/world/CollisionWorld.ts');
 const {chunkTerrainEntry,sampleChunkHeight,sampleChunkLandHeight}=await server.ssrLoadModule('/src/world/chunkMesh.ts');
 const input=JSON.parse(readFileSync(base+'-resolved-input.json','utf8'));
 const terrains=new Map(input.chunks.map(c=>[c.cx+'_'+c.cz,chunkTerrainEntry(c,1024)])),supportCache=new WeakMap();
 function terrainFor(p){let t=supportCache.get(p);if(!t){const original=terrains.get(p.origin[0]/1024+'_'+p.origin[1]/1024);t={...original,compiledStreet:p,...(p.terrainHeights?{heights:new Float32Array(p.terrainHeights)}:{}),...(p.roadHeights?{roadHeights:new Float32Array(p.roadHeights)}:{})};supportCache.set(p,t);}return t;}
 function actualSupport(p,x,z){return compiledStreetHeight(p,x,z,Infinity,0)??sampleChunkHeight(terrainFor(p),x,z);}
 let samples=0,missing=0,insideBuilding=0,props=0,seamSamples=0,seamErrors=0,seamTerrainEdges=0;const failures=[];
 for(const [pi,key] of plans.keys.entries()){
 const p=plan(key),b=p.bounds,world=new CollisionWorld(),solidSupport=new CollisionWorld();for(const volume of p.supportVolumes??[])solidSupport.addFootprintBox(volume.p,volume.base,volume.top,true,volume.holes??[],volume.base,volume.topPlane);solidSupport.finalize();for(const building of p.buildings??[])world.addFootprintBox(building.p,0,building.h??10000,true,building.holes??[],building.groundClearance??-Infinity);for(const b of [...(p.resolvedStructures??[]).filter(b=>b.structureKind!=="platform"||b.roofed),...(p.resolvedBuildings??[]).filter(b=>b.groundClearance&&!b.landmarkModel&&!b.statueModel&&!b.palaceBuildingId&&!b.seoulArchitecture).map(b=>({...b,h:b.groundClearance}))])for(let i=0;i<(b.supportPoints?.length??0);i+=2){const x=b.supportPoints[i],z=b.supportPoints[i+1];const terrain=terrainFor(p),base=Math.max(...b.p.filter((_,j)=>j%2===0).map((_,j)=>sampleChunkHeight(terrain,b.p[j*2],b.p[j*2+1]))),top=base+Math.max(b.h??3,b.groundClearance??0);solidSupport.addFootprintBox([x-.1,z-.1,x+.1,z-.1,x+.1,z+.1,x-.1,z+.1],0,top,true,[],sampleChunkHeight(terrain,x,z));}world.finalize();solidSupport.finalize();
 for(const r of buckets.get(key)??[]){const a=r.a,c=r.b,length=Math.hypot(c[0]-a[0],c[1]-a[1]),count=Math.max(1,Math.ceil(length/3));
 for(let j=0;j<=count;j++){const x=a[0]+(c[0]-a[0])*j/count,z=a[1]+(c[1]-a[1])*j/count;if(x<b[0]+.02||x>b[2]-.02||z<b[1]+.02||z>b[3]-.02)continue;
  samples++;if(compiledStreetHeight(p,x,z,Infinity,r.level)===undefined){missing++;if(failures.length<20)failures.push({kind:'missing',id:r.id,x,z});}
  const expectedFloor=compiledStreetHeight(p,x,z,Infinity,r.level),floor=expectedFloor===undefined?undefined:(compiledStreetHeight(p,x,z,expectedFloor)??expectedFloor),relative=r.elevated&&floor!==undefined?floor-(sampleChunkLandHeight(terrains.get(key),x,z,true)??0)+.15:1;
  if(world.segmentBlocked(x,relative,z,x+.0001,relative,z)<=1||(floor!==undefined&&solidSupport.segmentBlocked(x,floor+.15,z,x+.0001,floor+.15,z)<=1)){insideBuilding++;if(failures.filter(f=>f.kind==='building').length<20)failures.push({kind:'building',key,id:r.id,x,z});}
 }}
 for(const q of p.props){props++;if(compiledStreetHeight(p,q.x,q.z)===undefined)throw Error('Unsupported street prop '+key);}
 const [cx,cz]=key.split('_').map(Number);
 for(const [neighbor,vertical] of [[(cx+1)+'_'+cz,true],[cx+'_'+(cz+1),false]]){
 const q=plan(neighbor);if(!q)continue;
 const fixed=vertical?p.bounds[2]:p.bounds[3];if(fixed!==(vertical?q.bounds[0]:q.bounds[1]))continue;
 const lo=vertical?Math.max(p.bounds[1],q.bounds[1]):Math.max(p.bounds[0],q.bounds[0]),hi=vertical?Math.min(p.bounds[3],q.bounds[3]):Math.min(p.bounds[2],q.bounds[2]);
 for(let u=lo+1;u<hi;u+=2){const x=vertical?fixed:u,z=vertical?u:fixed,streetH=compiledStreetHeight(p,x,z,Infinity,0),streetK=compiledStreetHeight(q,x,z,Infinity,0),h=actualSupport(p,x,z),k=actualSupport(q,x,z);if(streetH===undefined||streetK===undefined)seamTerrainEdges++;
  seamSamples++;if(h===undefined||k===undefined||Math.abs(h-k)>.03){seamErrors++;if(failures.filter(f=>f.kind==='seam').length<20)failures.push({kind:'seam',key,neighbor,x,z,h,k});}
 }
 // Upper decks are compared only where a route actually crosses the tile edge.
 const axis=vertical?0:1;
 for(const r of buckets.get(key)??[]){if(!r.elevated)continue;
  const da=r.a[axis]-fixed,db=r.b[axis]-fixed;
  if(da===db||da*db>0)continue;
  if(da===0&&(!r.prev||(r.prev[axis]-fixed)*db>=0))continue;
  if(db===0&&(!r.next||(r.next[axis]-fixed)*da>=0))continue;
  const t=-da/(db-da),x=r.a[0]+(r.b[0]-r.a[0])*t,z=r.a[1]+(r.b[1]-r.a[1])*t,u=vertical?z:x;
  if(u<lo||u>hi)continue;
  const h=compiledStreetHeight(p,x,z,Infinity,r.level),k=compiledStreetHeight(q,x,z,Infinity,r.level);seamSamples++;
  if(h===undefined||k===undefined||Math.abs(h-k)>.03){seamErrors++;if(failures.filter(f=>f.kind==='seam').length<20)failures.push({kind:'seam',level:r.level,id:r.id,key,neighbor,x,z,h,k});}
 }
 }
 if((pi+1)%100===0)console.log(JSON.stringify({auditedChunks:pi+1,samples,missing,insideBuilding,seamErrors}));
 }
 const result={planHash:plans.hash,samples,missing,insideBuilding,props,seamSamples,seamTerrainEdges,seamErrors,failures};
 writeFileSync(base+'-mesh-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(missing||insideBuilding||seamErrors)throw Error('Baked street geometry validation failed');
}finally{await server.close();}
