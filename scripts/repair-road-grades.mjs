import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {repairUrbanSpikes,repairLattice,ROAD_GRADE_VERSION,waterContains,auditRoadLattice} from './road-grade.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const atomic=(p,data)=>{mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p+'.tmp',JSON.stringify(data));renameSync(p+'.tmp',p);};
export function repairRoadGrades({root='public/maps',cellFilter=null,write=true}={}){
 const base=resolve(root),out=join(base,'road-grade');
 const catalog=read(join(base,'index.json')).filter(c=>c.stream);
 const manifests=[];for(const lat of readdirSync(base,{withFileTypes:true}))if(lat.isDirectory()&&/^-?\d+$/.test(lat.name))for(const lon of readdirSync(join(base,lat.name),{withFileTypes:true}))if(lon.isDirectory()&&/^-?\d+$/.test(lon.name)){
  const key=lat.name+'/'+lon.name,p=join(base,key,'tiles.json');if(existsSync(p)&&(!cellFilter||cellFilter===key))manifests.push([key,p]);
 }
 const index=cellFilter&&existsSync(join(out,'index.json'))?read(join(out,'index.json')):{version:ROAD_GRADE_VERSION,cells:{}};
 const report={version:ROAD_GRADE_VERSION,generatedAt:new Date().toISOString(),cities:catalog.map(c=>({id:c.id,name:c.name,cell:Math.floor(c.lat)+'/'+Math.floor(c.lon)})),cells:[],totals:{chunks:0,roads:0,changedChunks:0,changedSamples:0,protectedRoads:0,unclassifiedRoads:0}};
 for(const [cellKey,file] of manifests){
  const m=read(file),chunks=m.chunks,C=m.chunkSize,n=m.terrainSize??33,stride=n-1,step=C/stride;
  const xmin=Math.min(...chunks.map(c=>c.cx)),xmax=Math.max(...chunks.map(c=>c.cx)),zmin=Math.min(...chunks.map(c=>c.cz)),zmax=Math.max(...chunks.map(c=>c.cz));
  const width=(xmax-xmin+1)*stride+1,height=(zmax-zmin+1)*stride+1;
  if(width*height>30000000)throw new Error('Cell lattice too large: '+cellKey);
  const grid=new Float32Array(width*height).fill(NaN),mask=new Uint8Array(grid.length),protect=new Uint8Array(grid.length),urban=new Uint8Array(grid.length);
  const path=c=>join(base,cellKey,Math.floor(c.cx/(m.block??16))+'_'+Math.floor(c.cz/(m.block??16)),c.cx+'_'+c.cz+'.json');
  const stats={cell:cellKey,chunks:chunks.length,roads:0,changedChunks:0,changedSamples:0,protectedRoads:0,unclassifiedRoads:0,maxDelta:0};
  const rect=(minX,minZ,maxX,maxZ,fn)=>{
   const i0=Math.max(0,Math.floor((minX-xmin*C)/step)),i1=Math.min(width-1,Math.ceil((maxX-xmin*C)/step));
   const j0=Math.max(0,Math.floor((minZ-zmin*C)/step)),j1=Math.min(height-1,Math.ceil((maxZ-zmin*C)/step));
   for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)fn(j*width+i,xmin*C+i*step,zmin*C+j*step);
  };
  for(const c of chunks){
   const raw=read(path(c)),t=raw.terrain;if(t.size!==n||t.heights.length!==n*n)continue;
   for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const k=((c.cz-zmin)*stride+j)*width+(c.cx-xmin)*stride+i,h=t.heights[j*n+i];
    if(Number.isFinite(grid[k])&&Math.abs(grid[k]-h)>.05)throw new Error('Source border mismatch '+cellKey+' '+c.cx+','+c.cz);
    grid[k]=h;
   }
   for(const r of raw.objects.roads??[]){
    stats.roads++;const tagged=r.bridge||r.tunnel||(Number(r.layer)||0)!==0;
    if(tagged)stats.protectedRoads++;if(r.bridge==null&&r.tunnel==null&&r.layer==null)stats.unclassifiedRoads++;
    const radius=(r.w??6)/2+step*1.5;
    for(let q=2;q<r.p.length;q+=2){const ax=r.p[q-2],az=r.p[q-1],bx=r.p[q],bz=r.p[q+1],dx=bx-ax,dz=bz-az,len2=dx*dx+dz*dz;if(!len2)continue;
     rect(Math.min(ax,bx)-radius,Math.min(az,bz)-radius,Math.max(ax,bx)+radius,Math.max(az,bz)+radius,(k,x,z)=>{
      const u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/len2)),d=Math.hypot(x-ax-u*dx,z-az-u*dz);
      if(d>radius)return;if(tagged){protect[k]=1;return;}
      const w=Math.round(255*Math.max(0,Math.min(1,(radius-d)/step)));mask[k]=Math.max(mask[k],w);
     });
    }
   }
   // Buildings supply context only; actual terrain and road anchors decide repair.
   for(const b of raw.objects.buildings??[]){if(b.p.length<6)continue;
    const xs=b.p.filter((_,i)=>i%2===0),zs=b.p.filter((_,i)=>i%2===1);
    rect(Math.min(...xs)-64,Math.min(...zs)-64,Math.max(...xs)+64,Math.max(...zs)+64,k=>{urban[k]=1;});
   }
   // Bounding boxes only accelerate lookup; protect the actual water surface.
   for(const water of raw.objects.water??[]){if(water.p.length<4)continue;const xs=water.p.filter((_,i)=>i%2===0),zs=water.p.filter((_,i)=>i%2===1),pad=(water.w??0)/2;
    rect(Math.min(...xs)-pad,Math.min(...zs)-pad,Math.max(...xs)+pad,Math.max(...zs)+pad,(k,x,z)=>{if(waterContains(x,z,water))protect[k]=1;});
   }
  }
  stats.before=auditRoadLattice(grid,mask,protect,width,height,step);
  const spikes=repairUrbanSpikes(grid,mask,protect,urban,width,height);
  const first=repairLattice(spikes.grid,mask,protect,width,height);
  const repaired=repairLattice(first.grid,mask,protect,width,height);
  repaired.maxDelta=0;
  for(let k=0;k<grid.length;k++)if(Number.isFinite(grid[k])){const limit=spikes.evidence.has(k)?80:30;repaired.grid[k]=Math.max(grid[k]-limit,Math.min(grid[k]+30,repaired.grid[k]));repaired.maxDelta=Math.max(repaired.maxDelta,Math.abs(repaired.grid[k]-grid[k]));}
  stats.algorithmRevision=3;stats.urbanPeaks=spikes.evidence.size;stats.urbanExclusions=spikes.reasons;stats.after=auditRoadLattice(repaired.grid,mask,protect,width,height,step,{originX:xmin*C,originZ:zmin*C,locations:true,exclusions:spikes.exclusions});
  if(write)atomic(join(out,'issues-'+cellKey.replace('/','-')+'.json'),{cell:cellKey,generatedAt:report.generatedAt,algorithmRevision:3,step,coordinateSystem:'cell-local metres; x east from floor(lon), z south from floor(lat)+1',edges:stats.after.locations});
  delete stats.after.locations;
  stats.qualityPassed=stats.after.steepEdges===0;stats.maxDelta=Math.round(repaired.maxDelta*100)/100;
  const keys=[];
  for(const c of chunks){const raw=read(path(c)),t=raw.terrain;if(t.size!==n||t.heights.length!==n*n)continue;const points=[],urbanEvidence=[];
   for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=((c.cz-zmin)*stride+j)*width+(c.cx-xmin)*stride+i,v=repaired.grid[k],old=t.heights[j*n+i];if(Math.abs(v-old)>=.05){points.push([j*n+i,old,Math.round(v*100)/100]);if(spikes.evidence.has(k))urbanEvidence.push({index:j*n+i,...spikes.evidence.get(k)});}}
   if(!points.length)continue;const key=c.cx+'_'+c.cz;keys.push(key);stats.changedChunks++;stats.changedSamples+=points.length;
   if(write)atomic(join(out,cellKey,key+'.json'),{version:ROAD_GRADE_VERSION,size:n,points,...(urbanEvidence.length?{algorithmRevision:3,urbanEvidence}:{})});
  }
  index.cells[cellKey]=keys;report.cells.push(stats);for(const k of Object.keys(report.totals))report.totals[k]+=stats[k];
  console.log(JSON.stringify(stats));
 }
 if(write){atomic(join(out,'index.json'),index);atomic(join(out,cellFilter?'report-'+cellFilter.replace('/','-')+'.json':'report.json'),report);}
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))repairRoadGrades({cellFilter:process.argv.includes('--cell')?process.argv[process.argv.indexOf('--cell')+1]:null,write:!process.argv.includes('--check')});
