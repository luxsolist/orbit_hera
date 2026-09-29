import {execFileSync} from 'node:child_process';
import {streetSupportPrism,walkAccessOffset} from './street-supports.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {mapBuildVersion} from './map-build-version.mjs';
import {streetBuildHash} from './street-build-hash.mjs';
import {createServer} from 'vite';
import {streetArtifacts,writeStreetPart} from './street-artifacts.mjs';
import {createElevatedStreetSampler} from './street-elevation.mjs';
import {crossingHeight} from './street-crossings.mjs';
import {createStreetSeamSampler,reconcileStreetTerrain} from './street-seams.mjs';
const [city='seoul',region='jongno-cheonggye']=process.argv.slice(2),read=p=>JSON.parse(readFileSync(p,'utf8'));
execFileSync(process.env.MAP_PYTHON??'python3',['scripts/street_walk_access.py',city,region],{stdio:'inherit'});
const base='build/streets/'+city+'-'+region,inputText=readFileSync(base+'-input.json','utf8'),input=JSON.parse(readFileSync(base+'-resolved-input.json','utf8')),regions=streetArtifacts(base+'-regions.json');
const hash=streetBuildHash(base),compilerVersion=mapBuildVersion(city);
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {terrainFootprint}=await server.ssrLoadModule('/src/world/StreetGeometry.ts');
 const {chunkTerrainEntry,sampleChunkLandHeight}=await server.ssrLoadModule('/src/world/chunkMesh.ts');
 const {inPilot,pilotStreetHeight}=await server.ssrLoadModule('/src/world/cities/CheonggyePilot.ts');
 const terrains=new Map(input.chunks.map(c=>[c.cx+'_'+c.cz,chunkTerrainEntry(c,1024)]));
 const crossings=new Map(regions.keys.map(key=>[key,regions.read(key).crossings??[]]));
 const sourceGround=(x,z)=>{const t=terrains.get(Math.floor(x/1024)+'_'+Math.floor(z/1024));return t?sampleChunkLandHeight(t,x,z,true):undefined;};
 const reconciled=reconcileStreetTerrain(terrains,(t,x,z)=>crossingHeight(crossings.get(Math.floor(x/1024)+'_'+Math.floor(z/1024))??[],sourceGround,x,z,t.streetPilot&&inPilot(x,z)?pilotStreetHeight(x,z):sampleChunkLandHeight(t,x,z,true)));
 for(const [key,grids] of reconciled){const t=terrains.get(key);t.heights=new Float32Array(grids.land);t.roadHeights=new Float32Array(grids.road);}
 const ground=(x,z)=>{const t=terrains.get(Math.floor(x/1024)+'_'+Math.floor(z/1024));return t?sampleChunkLandHeight(t,x,z,true):undefined;};
 const deck=(x,z,y)=>crossingHeight(crossings.get(Math.floor(x/1024)+'_'+Math.floor(z/1024))??[],ground,x,z,y);
 // The final physical edge grid already includes crossing support. Reapplying
 // deck interpolation here would raise only road vertices above neighbouring land.
 const seamHeight=createStreetSeamSampler(terrains,(t,x,z)=>sampleChunkLandHeight(t,x,z,true));
 const elevatedHeight=createElevatedStreetSampler((x,z)=>seamHeight(x,z)??ground(x,z),read(base+'-elevated-roofs.json'));
 const output={},sharded=input.coverage==='manifest';let totalTriangles=0,totalBytes=0;
 for(const chunk of input.chunks){const key=chunk.cx+'_'+chunk.cz,part=regions.keys.includes(key)?regions.read(key):null;if(!part)continue;
 const origin=[chunk.cx*1024,chunk.cz*1024],terrain=terrains.get(key);if(terrain)delete terrain.compiledStreet;
 const layers=new Map(),supportVolumes=[];
 for(const r of part.regions){const level=r.kind==='walkdeck'?1:r.kind.startsWith('deck-')?Number(r.kind.slice(5)):0,layer=r.kind==='walkdeck'?1:level?3:{pavement:1,asphalt:3,curb:2,center:4}[r.kind],meshKey=layer+':'+level,pos=layers.get(meshKey)??[];
 for(const triangle of r.triangles){const poly=[[triangle[0],triangle[1]],[triangle[2],triangle[3]],[triangle[4],triangle[5]]];let area=0;for(let k=0;k<3;k++)area+=poly[k][0]*poly[(k+1)%3][1]-poly[(k+1)%3][0]*poly[k][1];if(area<0)poly.reverse();
 const data=terrainFootprint(poly,terrain,...origin,true,true,false);for(let k=0;k<data.length;k+=3){const x=data[k]+origin[0],z=data[k+2]+origin[1];data[k+1]=deck(x,z,data[k+1]);if(sharded)data[k+1]=seamHeight(x,z)??data[k+1];if(r.kind==='walkdeck'){
 const profile=r.profile;if(profile.offset!=null)data[k+1]+=walkAccessOffset(profile.offset,x,z,profile.accessAnchors);
 else {const levels=profile.levels??[1],p=profile.path;let distance=Infinity,along=0,total=0;for(let j=2;j<p.length;j+=2)total+=Math.hypot(p[j]-p[j-2],p[j+1]-p[j-1]);let walked=0;for(let j=2;j<p.length;j+=2){const dx=p[j]-p[j-2],dz=p[j+1]-p[j-1],length=Math.hypot(dx,dz),t=length?Math.max(0,Math.min(1,((x-p[j-2])*dx+(z-p[j-1])*dz)/(length*length))):0,d=Math.hypot(x-p[j-2]-t*dx,z-p[j-1]-t*dz);if(d<distance){distance=d;along=walked+t*length;}walked+=length;}const t=total?along/total:0;const offsets=profile.offsets??levels.map(v=>v*3.3);data[k+1]+=offsets[0]+(offsets.at(-1)-offsets[0])*t;}
 }else if(level)data[k+1]=elevatedHeight(x,z,level);}for(let k=0;k<data.length;k++)pos.push(Math.round((data[k]+(k%3===1&&(layer===1||layer===2)?(layer===2?.10:.025):0))*10000)/10000);
 if(r.kind==='walkdeck'&&r.profile.offset!=null)for(let k=0;k<data.length;k+=9){
  const v=data.slice(k,k+9).map((value,j)=>Math.round((value+(j%3===1?.025:0))*10000)/10000+(j%3===0?origin[0]:j%3===2?origin[1]:0));
  const volume=streetSupportPrism(v,r.profile.offset+.025);if(volume)supportVolumes.push(volume);
 }
 }
 if(r.kind==='walkdeck'&&r.profile.offset!=null){
  for(const ring of [r.p,...(r.holes??[])])for(let j=0;j<ring.length;j+=2){const k=(j+2)%ring.length,ax=ring[j],az=ring[j+1],bx=ring[k],bz=ring[k+1],ay=seamHeight(ax,az)??ground(ax,az)??0,by=seamHeight(bx,bz)??ground(bx,bz)??0,ha=walkAccessOffset(r.profile.offset,ax,az,r.profile.accessAnchors)+.025,hb=walkAccessOffset(r.profile.offset,bx,bz,r.profile.accessAnchors)+.025;
   pos.push(ax-origin[0],ay,az-origin[1],bx-origin[0],by+hb,bz-origin[1],ax-origin[0],ay+ha,az-origin[1],ax-origin[0],ay,az-origin[1],bx-origin[0],by,bz-origin[1],bx-origin[0],by+hb,bz-origin[1]);
  }
 }
 layers.set(meshKey,pos);
 }
 const plan={version:1,region,terrainHeights:reconciled.get(key)?.land,roadHeights:reconciled.get(key)?.road,bounds:part.bounds,origin,sourceHash:hash,compilerVersion,supportVolumes,meshes:[...layers].sort((a,b)=>a[0].localeCompare(b[0])).map(([meshKey,source])=>{const [layer,level]=meshKey.split(':').map(Number);const position=[],index=[],keys=new Map();for(let i=0;i<source.length;i+=3){const p=source.slice(i,i+3),key=p.join();if(!keys.has(key)){keys.set(key,position.length/3);position.push(...p);}index.push(keys.get(key));}return {layer,level,position,index};}),props:part.props,resolvedSites:part.resolvedSites,walls:part.walls,resolvedWater:part.resolvedWater,resolvedBuildings:part.resolvedBuildings,resolvedStructures:part.resolvedStructures,buildings:(part.resolvedBuildings??chunk.objects.buildings).filter(b=>b.osmId&&!b.walkableProfile).flatMap(b=>b.passageGroundParts?[{id:b.osmId,p:b.p,h:b.h,holes:b.holes,groundClearance:b.passageClearance},...b.passageGroundParts.map(p=>({id:b.osmId,h:b.passageClearance,...p}))]:[{id:b.osmId,p:b.p,h:b.h,holes:b.holes,groundClearance:b.groundClearance}])};
 totalTriangles+=plan.meshes.reduce((s,m)=>s+(m.index?.length??m.position.length/3)/3,0);totalBytes+=Buffer.byteLength(JSON.stringify(plan));
 output[key]=sharded?writeStreetPart(base+'-plans',key,plan):plan;
 if(Object.keys(output).length%100===0)console.log(JSON.stringify({bakedChunks:Object.keys(output).length,triangles:totalTriangles}));
 }
 writeFileSync(base+'-plans.json',JSON.stringify(sharded?{format:'chunk-files',chunks:output}:output));
 console.log(JSON.stringify({chunks:Object.keys(output).length,bytes:totalBytes,triangles:totalTriangles,sourceHash:hash}));
}finally{await server.close();}
