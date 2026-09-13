// Conservative DEM spike repair. Uses a cell-wide lattice so tile borders share results.
export const ROAD_GRADE_VERSION=1;
export function median(values){const a=values.slice().sort((a,b)=>a-b);return a[Math.floor(a.length/2)];}
export function correctedRoadSample(center,neighbors,weight=1){
 if(!Number.isFinite(center)||center<=3||neighbors.length<16||weight<=0)return center;
 const mid=median(neighbors),lo=Math.min(...neighbors),hi=Math.max(...neighbors);
 // Do not regrade steep mountain terrain or sea/river margins automatically.
 if(lo<=1||hi-lo>45)return center;
 const residual=center-mid;
 if(Math.abs(residual)<=3)return center;
 const blend=Math.min(1,(Math.abs(residual)-3)/3)*weight;
 return Math.round((center-Math.max(-30,Math.min(30,residual))*blend)*100)/100;
}
export function repairLattice(grid,mask,protectedMask,width,height){
 const result=grid.slice();let changed=0,maxDelta=0;
 for(let j=2;j<height-2;j++)for(let i=2;i<width-2;i++){
  const k=j*width+i;if(!mask[k]||protectedMask[k]||!Number.isFinite(grid[k]))continue;
  const near=[];
  for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){const q=(j+dz)*width+i+dx;if(Number.isFinite(grid[q])&&!protectedMask[q])near.push(grid[q]);}

  const value=correctedRoadSample(grid[k],near,mask[k]/255),delta=Math.abs(value-grid[k]);
  if(delta>=.05){result[k]=value;changed++;maxDelta=Math.max(maxDelta,delta);}
 }
 return {grid:result,changed,maxDelta};
}

/** Exact water geometry, including holes; a long bent stream must not exclude a whole rectangle. */
export function insideRing(x,z,p){let hit=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])hit=!hit;return hit;}
export function waterContains(x,z,w){
 if(w.w!=null){for(let i=2;i<w.p.length;i+=2){const ax=w.p[i-2],az=w.p[i-1],dx=w.p[i]-ax,dz=w.p[i+1]-az,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(x-ax-u*dx,z-az-u*dz)<=w.w/2)return true;}return false;}
 return insideRing(x,z,w.p)&&!(w.holes??[]).some(p=>insideRing(x,z,p));
}
/** Report residual terrain slopes under the road influence, including excluded areas. */
export function auditRoadLattice(grid,mask,protect,width,height,step,options={}){
 const report={steepEdges:0,protectedSteepEdges:0,maxGrade:0,reasons:{},worst:[]};
 const locations=[];
 for(let j=0;j<height-1;j++)for(let i=0;i<width-1;i++){
  const k=j*width+i;if(mask[k]<128)continue;
  for(const q of [k+1,k+width]){
   if(mask[q]<128||!Number.isFinite(grid[k])||!Number.isFinite(grid[q]))continue;
   const grade=Math.abs(grid[k]-grid[q])/step;if(grade<=.15)continue;
   report.steepEdges++;const protectedEdge=protect[k]||protect[q];
   if(protectedEdge)report.protectedSteepEdges++;
   report.maxGrade=Math.max(report.maxGrade,grade);
   const reason=protectedEdge?'protected-water-or-structure':options.exclusions?.get(k)??options.exclusions?.get(q)??'residual-grade';
   report.reasons[reason]=(report.reasons[reason]??0)+1;
   if(options.locations){
    const x=(options.originX??0)+i*step,z=(options.originZ??0)+j*step;
    locations.push({x,z,axis:q===k+1?'x':'z',grade:Math.round(grade*10000)/10000,reason});
   }
  }
 }
 if(options.locations){report.worst=locations.slice().sort((a,b)=>b.grade-a.grade).slice(0,20);report.locations=locations;}
 return report;
}

/** Large positive urban DEM anomalies need a wider reference than the 5x5 filter.
 * Require built surroundings, a low-relief enclosing ring and road support on
 * that ring. Water/bridge/tunnel samples never serve as anchors or targets.
 * This estimates bare ground; it is not a surveyed elevation measurement.
 */
export function repairUrbanSpikes(grid,mask,protect,urban,width,height){
 const result=grid.slice(),evidence=new Map(),exclusions=new Map(),reasons={};
 const reject=(k,reason)=>{reasons[reason]=(reasons[reason]??0)+1;exclusions.set(k,reason);};
 for(let j=8;j<height-8;j++)for(let i=8;i<width-8;i++){
  const k=j*width+i;
  if(!mask[k]||!Number.isFinite(grid[k])||grid[k]<=3)continue;
  const local=[];
  for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){const v=grid[(j+dz)*width+i+dx];if(Number.isFinite(v))local.push(v);}
  if(local.length<16||grid[k]-median(local)<6)continue;
  if(protect[k]){reject(k,'protected');continue;}
  if(!urban[k]){reject(k,'no-built-surroundings');continue;}
  const ring=[],sectors=[[],[],[],[]];let roads=0,blocked=false;
  for(let dz=-4;dz<=4;dz++)for(let dx=-4;dx<=4;dx++){
   if(Math.max(Math.abs(dx),Math.abs(dz))<3)continue;
   const q=(j+dz)*width+i+dx,v=grid[q];
   if(protect[q]||!Number.isFinite(v)||v<=1){blocked=true;continue;}
   ring.push(v);sectors[(dz<0?0:2)+(dx<0?0:1)].push(v);if(mask[q]>=128)roads++;
  }
  if(blocked||ring.length<48){reject(k,'incomplete-or-protected-ring');continue;}
  const sorted=ring.slice().sort((a,b)=>a-b),target=median(ring),anchors=sectors.map(median);
  if(sorted[Math.floor(sorted.length*.9)]-sorted[Math.floor(sorted.length*.1)]>24||Math.max(...anchors)-Math.min(...anchors)>18){reject(k,'non-flat-surroundings');continue;}
  if(roads<16){reject(k,'insufficient-road-anchors');continue;}
  const excess=grid[k]-target;
  if(excess<18){reject(k,'small-anomaly');continue;}
  if(excess>80){reject(k,'exceeds-urban-limit');continue;}
  // A natural hill can have a level ring around its summit. Require the terrain
  // to have settled at the same level again 192-256m away, not keep descending.
  const outer=[];
  for(let dz=-8;dz<=8;dz++)for(let dx=-8;dx<=8;dx++){
   if(Math.max(Math.abs(dx),Math.abs(dz))<6)continue;
   const q=(j+dz)*width+i+dx;
   if(!protect[q]&&Number.isFinite(grid[q])&&grid[q]>1)outer.push(grid[q]);
  }
  if(outer.length<144){reject(k,'insufficient-outer-ground');continue;}
  const outerMedian=median(outer);
  if(Math.abs(target-outerMedian)>10){reject(k,'continuing-hillside');continue;}
  const value=Math.round((grid[k]-excess*mask[k]/255)*100)/100;
  result[k]=value;evidence.set(k,{reason:'isolated-urban-peak',target,outerMedian,ringLow:sorted[Math.floor(sorted.length*.1)],ringHigh:sorted[Math.floor(sorted.length*.9)],roadAnchors:roads});
 }
 return {grid:result,evidence,reasons,exclusions};
}
