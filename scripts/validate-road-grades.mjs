import {readFileSync,writeFileSync,existsSync} from 'node:fs';
function validUrbanEvidence(revision,e,old,value){
 return revision===3&&e?.reason==='isolated-urban-peak'&&
  [e.target,e.outerMedian,e.ringLow,e.ringHigh,e.roadAnchors].every(Number.isFinite)&&
  Math.abs(e.target-e.outerMedian)<=10&&e.ringLow>1&&e.ringHigh>=e.ringLow&&e.ringHigh-e.ringLow<=24&&
  e.target>=e.ringLow&&e.target<=e.ringHigh&&e.roadAnchors>=16&&
  old-e.target>=18&&old-e.target<=80&&old-value<=80.01&&value<=old&&Math.abs(value-e.target)<=30.01;
}
const root='public/maps' ,read=p=>JSON.parse(readFileSync(p,'utf8'));
const index=read(root+'/road-grade/index.json');const cellFilter=process.argv.includes('--cell')?process.argv[process.argv.indexOf('--cell')+1]:null;if(cellFilter)index.cells=Object.fromEntries(Object.entries(index.cells).filter(([cell])=>cell===cellFilter));let patches=0,points=0,maxDelta=0;const errors=[];
for(const [cell,keys] of Object.entries(index.cells)){
 const m=read(`${root}/${cell}/tiles.json`),edgeValues=new Map(),cache=new Map();
 const cached=p=>{if(!cache.has(p))cache.set(p,read(p));return cache.get(p);};
 for(const key of keys){const [cx,cz]=key.split('_').map(Number),p=cached(`${root}/road-grade/${cell}/${key}.json`),raw=cached(`${root}/${cell}/${Math.floor(cx/(m.block??16))}_${Math.floor(cz/(m.block??16))}/${key}.json`),n=raw.terrain.size;
  if(p.version!==1||p.size!==n)errors.push(cell+'/'+key+' schema');
  const evidence=new Map((p.urbanEvidence??[]).map(e=>[e.index,e]));
  if(evidence.size!==(p.urbanEvidence??[]).length)errors.push(cell+'/'+key+' duplicate evidence');
  const surfaceIds=new Set();
  if(p.surfacePoints?.length&&p.surfaceRevision!==1)errors.push(cell+'/'+key+' surface revision');
  for(const [i,old,value] of p.surfacePoints??[]){
   if(surfaceIds.has(i)||!Number.isInteger(i)||i<0||i>=n*n||old!==raw.terrain.heights[i]||!Number.isFinite(value)||Math.abs(value-old)>30.01)errors.push(cell+'/'+key+' surface point '+i);
   surfaceIds.add(i);
  }
  const ids=new Set();for(const [i,old,value] of p.points){
   if(ids.has(i)||!Number.isInteger(i)||i<0||i>=n*n||old!==raw.terrain.heights[i]||!Number.isFinite(value)||Math.abs(value-old)>30.01&&!validUrbanEvidence(p.algorithmRevision,evidence.get(i),old,value))errors.push(cell+'/'+key+' point '+i);
   ids.add(i);points++;maxDelta=Math.max(maxDelta,Math.abs(value-old));
   const x=i%n,z=Math.floor(i/n);if(x===0||z===0||x===n-1||z===n-1){const k=(cx*(n-1)+x)+','+(cz*(n-1)+z),prior=edgeValues.get(k);if(prior!=null&&Math.abs(prior-value)>.01)errors.push(cell+' seam '+k);edgeValues.set(k,value);}
  }
  for(let j=0;j<n;j++)for(let i=0;i<n;i++)if(i===0||j===0||i===n-1||j===n-1){
   const idx=j*n+i,k=(cx*(n-1)+i)+','+(cz*(n-1)+j);
   const ground=p.points.find(q=>q[0]===idx)?.[2]??raw.terrain.heights[idx];
   if(!edgeValues.has(k))edgeValues.set(k,ground);
  }
  patches++;
 }
 // Verify all shared edges against patched OR unpatched neighbor data.
 const keySet=new Set(m.chunks.map(c=>`${c.cx}_${c.cz}`));
 for(const [k,value] of edgeValues){const [gx,gz]=k.split(',').map(Number),stride=m.terrainSize-1;
  const xs=gx%stride===0?[gx/stride-1,gx/stride]:[Math.floor(gx/stride)],zs=gz%stride===0?[gz/stride-1,gz/stride]:[Math.floor(gz/stride)];
  for(const cx of xs)for(const cz of zs){const key=cx+'_'+cz;if(!keySet.has(key))continue;const raw=cached(`${root}/${cell}/${Math.floor(cx/(m.block??16))}_${Math.floor(cz/(m.block??16))}/${key}.json`),i=(gz-cz*stride)*m.terrainSize+gx-cx*stride,pth=`${root}/road-grade/${cell}/${key}.json`;
   const p=keys.includes(key)&&existsSync(pth)?cached(pth):null,match=p?.points.find(q=>q[0]===i),actual=match?match[2]:raw.terrain.heights[i];if(Math.abs(actual-value)>.01)errors.push(cell+' adjacent seam '+k);
  }
 }
}
// Surface-only differences must also match unpatched neighbors, including tile corners.
for(const [cell,keys] of Object.entries(index.cells)){
 const m=read(`${root}/${cell}/tiles.json`),edge=new Map();
 for(const c of m.chunks){
  const key=c.cx+'_'+c.cz,n=m.terrainSize,raw=read(`${root}/${cell}/${Math.floor(c.cx/(m.block??16))}_${Math.floor(c.cz/(m.block??16))}/${key}.json`);
  const p=keys.includes(key)?read(`${root}/road-grade/${cell}/${key}.json`):null;
  const ground=new Map((p?.points??[]).map(q=>[q[0],q[2]])),surface=new Map((p?.surfacePoints??[]).map(q=>[q[0],q[2]]));
  for(let j=0;j<n;j++)for(let i=0;i<n;i++)if(i===0||j===0||i===n-1||j===n-1){
   const idx=j*n+i,k=(c.cx*(n-1)+i)+','+(c.cz*(n-1)+j),v=surface.get(idx)??ground.get(idx)??raw.terrain.heights[idx];
   if(edge.has(k)&&Math.abs(edge.get(k)-v)>.01)errors.push(cell+' street seam '+k);edge.set(k,v);
  }
 }
}
const roadQuality=[];
for(const cell of Object.keys(index.cells)){
 const file=`${root}/road-grade/report-${cell.replace('/','-')}.json`,global=`${root}/road-grade/report.json`;
 const specific=existsSync(file)?read(file):null,all=existsSync(global)?read(global):null;
 const latest=specific&&(!all||specific.generatedAt>all.generatedAt)?specific:all;
 const stats=latest?.cells.find(c=>c.cell===cell);
 roadQuality.push({cell,assessed:!!stats?.after,remainingSteepEdges:stats?.after?.steepEdges??null,protectedSteepEdges:stats?.after?.protectedSteepEdges??null,remainingStreetSteepEdges:stats?.surfaceAfter?.steepEdges??null,surfaceDesign:stats?.surfaceDesign??null});
}
const result={patches,points,maxDelta,errors,roadQuality,roadQualityPassed:roadQuality.every(c=>c.assessed&&c.remainingSteepEdges===0&&(c.remainingStreetSteepEdges==null||c.remainingStreetSteepEdges===0))};writeFileSync(root+'/road-grade/'+(cellFilter?'validation-'+cellFilter.replace('/','-')+'.json':'validation.json'),JSON.stringify(result));console.log(JSON.stringify({...result,errors:errors.slice(0,20),roadQuality:roadQuality.filter(c=>c.assessed)}));if(errors.length)process.exitCode=1;

if(process.argv.includes('--strict-quality')&&!result.roadQualityPassed)process.exitCode=1;
