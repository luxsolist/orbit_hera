import {auditRoadProfile} from './road-profile.mjs';
// Build-only network fairing. No city coordinates, DEM downloads, or runtime iteration.
export const NETWORK_GRADE_SETTINGS=Object.freeze({spacing:16,passes:96,fitPasses:96,maxAdjustment:15,joinSpacing:4});
export const surfaceRoad=r=>!r.bridge&&!r.tunnel&&(r.layer??0)===0;
/** Shared XY vertices connect only ground roads. Grade-separated crossings never join.
 * Inverse-length weights preserve a straight constant-grade two-neighbor road.
 */
export function fairRoadGraph(roads,sample,eligible,settings=NETWORK_GRADE_SETTINGS){
 const nodes=[],byKey=new Map(),edges=new Set();
 const add=(x,z)=>{const key=x.toFixed(2)+','+z.toFixed(2);if(byKey.has(key))return byKey.get(key);
  const h=sample(x,z),i=nodes.length;nodes.push({x,z,h,value:h,free:Number.isFinite(h)&&eligible(x,z),neighbors:[]});byKey.set(key,i);return i;};
 for(const r of roads){if(!surfaceRoad(r))continue;
  for(let i=2;i<r.p.length;i+=2){const [ax,az,bx,bz]=r.p.slice(i-2,i+2),len=Math.hypot(bx-ax,bz-az);if(len<.01)continue;
   const steps=Math.ceil(len/settings.spacing);let a=add(ax,az);
   for(let j=1;j<=steps;j++){const b=add(ax+(bx-ax)*j/steps,az+(bz-az)*j/steps),key=a<b?a+':'+b:b+':'+a;
    if(a!==b&&!edges.has(key)){edges.add(key);const d=Math.hypot(nodes[a].x-nodes[b].x,nodes[a].z-nodes[b].z);nodes[a].neighbors.push([b,1/d]);nodes[b].neighbors.push([a,1/d]);}a=b;
   }
  }
 }
 let current=Float64Array.from(nodes,n=>n.h),next=current.slice();
 for(let pass=0;pass<settings.passes;pass++){
  for(let i=0;i<nodes.length;i++){const n=nodes[i];if(!n.free||n.neighbors.length<2)continue;let sum=0,w=0;
   for(const [j,weight] of n.neighbors)if(Number.isFinite(current[j])){sum+=current[j]*weight;w+=weight;}
   if(w)next[i]=Math.max(n.h-settings.maxAdjustment,Math.min(n.h+settings.maxAdjustment,current[i]*.2+(sum/w)*.8));
  }[current,next]=[next,current];next.set(current);
 }
 nodes.forEach((n,i)=>n.value=current[i]);return {nodes,edges:edges.size};
}
/** Fit network targets to one cell-wide lattice. Borders between tiles are ordinary
 * shared vertices; protected water/authored/grade-separated vertices remain anchors.
 * Both terrain and street receive the SAME delta to retain their support relationship.
 */
export function fitNetworkSurface(source,mask,targets,targetWeights,width,height,settings=NETWORK_GRADE_SETTINGS){
 let out=source.slice(),next=out.slice();
 for(let pass=0;pass<settings.fitPasses;pass++){
  for(let z=1;z<height-1;z++)for(let x=1;x<width-1;x++){const k=z*width+x;if(!mask[k])continue;
   const near=[out[k-1],out[k+1],out[k-width],out[k+width]];if(!near.every(Number.isFinite))continue;
   const average=near.reduce((a,b)=>a+b,0)/4;
   const target=targetWeights[k]?targets[k]/targetWeights[k]:average;
   const desired=average*.9+target*.1;
   const value=out[k]+(desired-out[k])*.65*mask[k];
   next[k]=Math.max(source[k]-settings.maxAdjustment,Math.min(source[k]+settings.maxAdjustment,value));
  }[out,next]=[next,out];next.set(out);
 }
 return out;
}
/** Inspect bends across source-segment and chunk seams, not just within a segment. */
export function auditRoadJoins(roads,sample,spacing=4,{collectAll=false}={}){
 const ends=new Map(),seen=new Set();
 for(const r of roads){if(!surfaceRoad(r))continue;for(let i=2;i<r.p.length;i+=2){const a=r.p.slice(i-2,i),b=r.p.slice(i,i+2),key=[a.join(','),b.join(',')].sort().join(':');if(seen.has(key))continue;seen.add(key);
  for(const [p,q] of [[a,b],[b,a]]){const k=p.join(','),list=ends.get(k)??[];list.push(q);ends.set(k,list);}
 }}
 const out={joins:0,roughJoins:0,maxChange:0,examples:[]};
 for(const [key,arms] of ends){if(arms.length!==2)continue;const p=key.split(',').map(Number),dirs=arms.map(q=>{const d=Math.hypot(q[0]-p[0],q[1]-p[1]);return [(q[0]-p[0])/d,(q[1]-p[1])/d];});
  if(dirs[0][0]*dirs[1][0]+dirs[0][1]*dirs[1][1]>-.7)continue;
  const h=sample(...p),v=dirs.map(d=>sample(p[0]+d[0]*spacing,p[1]+d[1]*spacing));if(![h,...v].every(Number.isFinite))continue;
  const change=Math.abs((v[0]+v[1]-2*h)/spacing);out.joins++;out.maxChange=Math.max(out.maxChange,change);
  if(change>.12){out.roughJoins++;if(collectAll||out.examples.length<20)out.examples.push({p,change});}
 }return out;
}

/** A candidate may remove warnings but must not add steep/rough warnings to a
 * previously acceptable road. Defer only lattice vertices supporting regressions;
 * shared global vertices keep tile seams intact. Recheck after every deferral.
 */
export function rejectNewRoadWarnings(roads,source,candidate,width,height,step,ox,oz,{maxPasses=32}={}){
 const values=candidate.slice(),key=r=>r.p.join(',')+':'+(r.w??6);
 const corners=(x,z)=>{const gx=(x-ox)/step,gz=(z-oz)/step,i=Math.floor(gx),j=Math.floor(gz);if(i<0||j<0||i>=width-1||j>=height-1)return [];
  const fx=gx-i,fz=gz-j,k=j*width+i;return fx+fz<=1?[[k,1-fx-fz],[k+1,fx],[k+width,fz]]:[[k+width+1,fx+fz-1],[k+width,1-fx],[k+1,1-fz]];
 };
 const sample=grid=>(x,z)=>{const c=corners(x,z);return c.length?c.reduce((h,[k,w])=>h+Math.fround(grid[k])*w,0):NaN;};
 // Keep bridges in this guard too: a ground edit beside an approach must not worsen them.
 const baseline=auditRoadProfile(roads,sample(source)),before=new Map(baseline.issues.map(i=>[key(i),i]));
 const result={passes:0,deferredVertices:0,initialRegressions:0,remainingRegressions:0};
 for(let pass=0;pass<=maxPasses;pass++){
  const audit=auditRoadProfile(roads,sample(values));
  const regressions=audit.issues.filter(i=>{const b=before.get(key(i));return i.steep&&!b?.steep||i.rough&&!b?.rough||b&&(i.maxGrade>b.maxGrade+.002||i.maxChange>b.maxChange+.002||i.reversals>b.reversals);});
  result.remainingRegressions=regressions.length;if(!pass)result.initialRegressions=regressions.length;
  if(!regressions.length)return {surface:values,report:result};
  if(pass===maxPasses)throw new Error('Network road correction still introduces '+regressions.length+' warnings');
  let changed=0;
  for(const r of regressions){const [ax,az,bx,bz]=r.p,len=Math.hypot(bx-ax,bz-az),steps=Math.max(2,Math.ceil(len/4));
   for(const side of [-.4,0,.4])for(let j=0;j<=steps;j++){
    const x=ax+(bx-ax)*j/steps-(bz-az)/len*(r.w??6)*side,z=az+(bz-az)*j/steps+(bx-ax)/len*(r.w??6)*side;
    for(const [k] of corners(x,z))if(values[k]!==source[k]){values[k]=source[k];changed++;}
   }
  }
  result.passes++;result.deferredVertices+=changed;if(!changed)throw new Error('Unresolvable road regression');
 }
}

/** Guard values need sub-millimetre agreement, not long decimal JSON tails.
 * Runtime applies delta to its own source, so this does not quantize the terrain. */
export const networkPatchPoint=(i,land,street,delta)=>[i,Math.round(land*10000)/10000,Math.round(street*10000)/10000,delta];
