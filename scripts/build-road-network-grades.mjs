import {ownedCityChunks} from './map-city-config.mjs';
import {createServer} from 'vite';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {fairRoadGraph,fitNetworkSurface,NETWORK_GRADE_SETTINGS,surfaceRoad,rejectNewRoadWarnings,networkPatchPoint} from './road-network-grade.mjs';
import {waterContains} from './road-grade.mjs';
const city=process.argv[2],read=p=>JSON.parse(readFileSync(p,'utf8')),optional=p=>existsSync(p)?read(p):null;
const cell=read('config/map-cities.json')[city];if(!cell)throw new Error('Unknown city '+city);
const base='public/maps',root=base+'/'+cell.join('/'),manifest=read(root+'/tiles.json'),C=manifest.chunkSize,n=manifest.terrainSize,stride=n-1,step=C/stride;
const selected=ownedCityChunks(manifest,city);if(!selected.length)throw new Error('No owned chunks for '+city);
const minX=Math.min(...selected.map(c=>c.cx)),minZ=Math.min(...selected.map(c=>c.cz)),maxX=Math.max(...selected.map(c=>c.cx)),maxZ=Math.max(...selected.map(c=>c.cz));
const width=(maxX-minX+1)*stride+1,height=(maxZ-minZ+1)*stride+1,ox=minX*C,oz=minZ*C,N=width*height;
if(N>30000000)throw new Error('City lattice too large');
const land=new Float64Array(N).fill(NaN),surface=land.slice(),built=new Uint8Array(N),protect=new Uint8Array(N),mask=new Float64Array(N),targets=new Float64Array(N),weights=new Float64Array(N);
const reasons=new Uint8Array(N);
const chunks=new Map(),patches=new Map(),roads=[];let disagreements=0;
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {applyMapCorrections}=await server.ssrLoadModule('/src/world/MapCorrections.ts');
 const {refinementSource}=await server.ssrLoadModule('/src/world/RoadRefinement.ts');
 const {applyRoadNetworkPatch}=await server.ssrLoadModule('/src/world/RoadGradePatch.ts');
 const {pilotWeight}=await server.ssrLoadModule('/src/world/cities/CheonggyePilot.ts');
 const eachRect=(p,pad,fn)=>{if(!p.length)return;let x1=Infinity,z1=Infinity,x2=-Infinity,z2=-Infinity;for(let i=0;i<p.length;i+=2){x1=Math.min(x1,p[i]);x2=Math.max(x2,p[i]);z1=Math.min(z1,p[i+1]);z2=Math.max(z2,p[i+1]);}
  const a=Math.max(0,Math.floor((x1-pad-ox)/step)),b=Math.min(width-1,Math.ceil((x2+pad-ox)/step)),c=Math.max(0,Math.floor((z1-pad-oz)/step)),d=Math.min(height-1,Math.ceil((z2+pad-oz)/step));
  for(let z=c;z<=d;z++)for(let x=a;x<=b;x++)fn(z*width+x,ox+x*step,oz+z*step);
 };
 for(const c of selected){const key=c.cx+'_'+c.cz,raw=read(`${root}/${Math.floor(c.cx/(manifest.block??16))}_${Math.floor(c.cz/(manifest.block??16))}/${key}.json`);
  const patch=optional(`${base}/road-grade/${cell.join('/')}/${key}.json`)??{version:1,size:n,points:[]};patches.set(key,patch);
  const cooked=applyMapCorrections(cell,raw,{roadGrade:patch,detail:optional(`${base}/details/${city}/${key}.json`),appearance:optional(`${base}/landmark-appearance/${city}/${key}.json`)},{roadNetwork:false});chunks.set(key,cooked);
  const h=cooked.terrain.heights,s=cooked.roadHeights??h,authored=new Set((cooked.seoulDetail?.terrain??[]).map(v=>v[0]));
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const local=z*n+x,k=((c.cz-minZ)*stride+z)*width+(c.cx-minX)*stride+x;
   if(Number.isFinite(surface[k])&&(Math.abs(surface[k]-s[local])>.002||Math.abs(land[k]-h[local])>.002)){protect[k]=1;reasons[k]|=8;disagreements++;}
   land[k]=h[local];surface[k]=s[local];
   if(authored.has(local)||cooked.palaceSite||cooked.busanDetail||cooked.romeDetail||cooked.athensDetail||(cooked.streetPilot&&pilotWeight(ox+(k%width)*step,oz+Math.floor(k/width)*step)>0)){protect[k]=1;reasons[k]|=1;}
  }
  for(const b of cooked.objects.buildings)eachRect(b.p,96,k=>built[k]=1);
  for(const w of cooked.objects.water??[])eachRect(w.p,(w.w??0)/2+step,(k,x,z)=>{if(waterContains(x,z,w)){protect[k]=1;reasons[k]|=2;}});
  for(const r of cooked.objects.roads){roads.push(r);if(r.tunnel)continue;
   for(let j=2;j<r.p.length;j+=2){const p=r.p.slice(j-2,j+2),[ax,az,bx,bz]=p,dx=bx-ax,dz=bz-az,len2=dx*dx+dz*dz;if(!len2)continue;const radius=(r.w??6)/2+64;
    eachRect(p,radius,(k,x,z)=>{const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/len2)),d=Math.hypot(x-ax-t*dx,z-az-t*dz);if(d>radius)return;
     if(!surfaceRoad(r)){protect[k]=1;reasons[k]|=4;}else mask[k]=Math.max(mask[k],Math.min(1,(radius-d)/32));
    });
   }
  }
 }
 // One-cell halo prevents triangles beside a protected river or landmark from moving it.
 const locked=protect.slice(),originalReasons=reasons.slice();for(let z=1;z<height-1;z++)for(let x=1;x<width-1;x++){const k=z*width+x;
  if(protect[k])for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){locked[k+dz*width+dx]=1;reasons[k+dz*width+dx]|=originalReasons[k];}
 }
 for(let z=0;z<height;z++)for(let x=0;x<width;x++){const k=z*width+x;
  if(!built[k])reasons[k]|=16;
  if(!x||!z||x===width-1||z===height-1||!Number.isFinite(surface[k])||land[k]<=1)reasons[k]|=32;
  if(!x||!z||x===width-1||z===height-1||!built[k]||locked[k]||!Number.isFinite(surface[k])||land[k]<=1)mask[k]=0;
 }
 const nearest=(x,z)=>Math.max(0,Math.min(height-1,Math.round((z-oz)/step)))*width+Math.max(0,Math.min(width-1,Math.round((x-ox)/step)));
 const sample=(x,z)=>{const gx=(x-ox)/step,gz=(z-oz)/step,i=Math.floor(gx),j=Math.floor(gz);if(i<0||j<0||i>=width-1||j>=height-1)return NaN;
  const fx=gx-i,fz=gz-j,k=j*width+i,a=surface[k],b=surface[k+1],c=surface[k+width],d=surface[k+width+1];return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
 };
 console.log(`${city}: ${chunks.size} chunks, ${roads.length} roads; solving connected ground roads`);
 const graph=fairRoadGraph(roads,sample,(x,z)=>mask[nearest(x,z)]>0);
 for(const node of graph.nodes)if(node.free){const gx=(node.x-ox)/step,gz=(node.z-oz)/step,i=Math.floor(gx),j=Math.floor(gz),fx=gx-i,fz=gz-j;
  for(const [dx,dz,w] of [[0,0,(1-fx)*(1-fz)],[1,0,fx*(1-fz)],[0,1,(1-fx)*fz],[1,1,fx*fz]]){if(i+dx<0||j+dz<0||i+dx>=width||j+dz>=height)continue;const k=(j+dz)*width+i+dx;if(mask[k]&&w>0){targets[k]+=node.value*w;weights[k]+=w;}}
 }
 const proposed=fitNetworkSurface(surface,mask,targets,weights,width,height);
 console.log(`${city}: rejecting newly introduced road warnings before writing`);
 // Match serialized delta precision and the Float32 height buffers used by rendering/movement.
 for(let k=0;k<proposed.length;k++)if(Number.isFinite(proposed[k]))proposed[k]=surface[k]+Math.round((proposed[k]-surface[k])*10000)/10000;
 const guarded=rejectNewRoadWarnings(roads,surface,proposed,width,height,step,ox,oz);
 const fitted=guarded.surface;
 for(let k=0;k<N;k++){if(Math.abs(proposed[k]-surface[k])>=14.999)reasons[k]|=64;if(Math.abs(proposed[k]-fitted[k])>.001)reasons[k]|=128;}
 console.log(JSON.stringify(guarded.report));
 const backup=`build/road-network-backups/${city}/${Date.now()}`;mkdirSync(backup,{recursive:true});
 const indexPath=base+'/road-grade/index.json',index=read(indexPath),keys=new Set(index.cells[cell.join('/')]??[]);
 const report={city,regressionGuard:guarded.report,settings:NETWORK_GRADE_SETTINGS,chunks:chunks.size,nodes:graph.nodes.length,edges:graph.edges,activeNodes:graph.nodes.filter(n=>n.free).length,existingSeamDisagreements:disagreements,changedChunks:0,changedSamples:0,maxDelta:0,backup};
 const scope={version:1,city,step,legend:{1:"authored-terrain",2:"water",4:"elevated-road",8:"existing-seam",16:"no-nearby-buildings",32:"coverage-or-sea",64:"adjustment-limit",128:"regression-deferred"},chunks:{},sources:{}};
 for(const [key,c] of chunks){scope.chunks[key]=Array.from({length:n*n},(_,i)=>reasons[((c.cz-minZ)*stride+Math.floor(i/n))*width+(c.cx-minX)*stride+i%n]);const p=patches.get(key),points=[];
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x,k=((c.cz-minZ)*stride+z)*width+(c.cx-minX)*stride+x,d=Math.round((fitted[k]-surface[k])*10000)/10000;
   if(Math.abs(d)<.005)continue;if(!Number.isFinite(d)||Math.abs(d)>15.001)throw new Error('Invalid solved height '+key);
   points.push(networkPatchPoint(i,c.terrain.heights[i],(c.roadHeights??c.terrain.heights)[i],d));report.maxDelta=Math.max(report.maxDelta,Math.abs(d));
  }
  scope.sources[key]=refinementSource(applyRoadNetworkPatch(c,{...p,network:points.length?{version:1,points}:undefined}));
  const path=`${base}/road-grade/${cell.join('/')}/${key}.json`;if(!points.length&&!p.network)continue;
  if(existsSync(path))writeFileSync(`${backup}/${key}.json`,readFileSync(path));
  if(points.length)p.network={version:1,points};else delete p.network;
  mkdirSync(`${base}/road-grade/${cell.join('/')}`,{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(p));renameSync(path+'.tmp',path);keys.add(key);report.changedChunks++;report.changedSamples+=points.length;
 }
 index.cells[cell.join('/')]=[...keys].sort();writeFileSync(indexPath,JSON.stringify(index));
 writeFileSync(`build/${city}-road-network-scope.json`,JSON.stringify(scope));
 writeFileSync(`build/${city}-road-network-build.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await server.close();}
