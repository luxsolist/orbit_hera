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


/** Shared city-wide road surface policy, in metres. These are visual design limits,
 * not surveying claims. Fits retain a continuous hillside's slope rather than
 * flattening every road to a constant elevation. */
export const ROAD_SURFACE_SETTINGS=Object.freeze({radius:3,minSamples:20,maxSlope:.15,maxResidual:18,maxAdjustment:30,waterClearance:.25,approachGrade:.06,approachPasses:12});
export function fitRoadPlane(samples,step){
 const fit=(rows)=>{
  let w=0,x=0,z=0,y=0;for(const [a,b,c,q] of rows){w+=q;x+=a*q;z+=b*q;y+=c*q;}
  if(!w)return null;x/=w;z/=w;y/=w;
  let xx=0,zz=0,xz=0,xy=0,zy=0;
  for(const [a,b,c,q] of rows){xx+=(a-x)**2*q;zz+=(b-z)**2*q;xz+=(a-x)*(b-z)*q;xy+=(a-x)*(c-y)*q;zy+=(b-z)*(c-y)*q;}
  const det=xx*zz-xz*xz;if(det<1e-8)return null;
  const dx=(xy*zz-zy*xz)/det,dz=(zy*xx-xy*xz)/det;
  return {height:y-dx*x-dz*z,dx,dz};
 };
 if(samples.length<ROAD_SURFACE_SETTINGS.minSamples)return null;
 let plane=fit(samples);if(!plane)return null;
 const residual=samples.map(([x,z,y])=>Math.abs(y-plane.height-plane.dx*x-plane.dz*z)).sort((a,b)=>a-b);
 if(residual[Math.floor(residual.length*.9)]>ROAD_SURFACE_SETTINGS.maxResidual)return null;
 const trimmed=samples.filter(([x,z,y])=>Math.abs(y-plane.height-plane.dx*x-plane.dz*z)<=Math.max(3,residual[Math.floor(residual.length*.8)]));
 if(trimmed.length>=ROAD_SURFACE_SETTINGS.minSamples)plane=fit(trimmed)??plane;
 if(Math.hypot(plane.dx,plane.dz)/step>ROAD_SURFACE_SETTINGS.maxSlope)return null;
 return plane;
}
/** One shared lattice for intersections and chunk borders. Low riverbeds stay below
 * the land grid; elevated DEM errors in water are corrected from bank evidence.
 * The separate street grid can span water without folding
 * bridge decks down onto the riverbed. Tunnels do not mask surface streets. */
export function designUrbanRoadSurface(grid,mask,water,urban,width,height,step){
 const land=grid.slice(),surface=grid.slice(),accepted=new Uint8Array(grid.length);
 const radius=ROAD_SURFACE_SETTINGS.radius;let changed=0,skipped=0;
 for(let j=radius;j<height-radius;j++)for(let i=radius;i<width-radius;i++){
  const k=j*width+i;if(!mask[k]||!urban[k]||!Number.isFinite(grid[k])||grid[k]<=1)continue;
  const samples=[];
  for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
   const q=(j+dz)*width+i+dx,v=grid[q];
   if(!water[q]&&Number.isFinite(v)&&v>1)samples.push([dx,dz,v,1/(1+(dx*dx+dz*dz)/4)]);
  }
  const plane=fitRoadPlane(samples,step);
  if(!plane){skipped++;continue;}
  const delta=Math.max(-ROAD_SURFACE_SETTINGS.maxAdjustment,Math.min(ROAD_SURFACE_SETTINGS.maxAdjustment,plane.height-grid[k]));
  const value=grid[k]+delta*mask[k]/255;
  surface[k]=value;
  // Water footprint is protected, not a noisy DEM elevation inside that footprint.
  // Limit the bed by the reviewed bank trend so a roof return in a river cannot
  // become a hard lower bound that pushes every nearby road uphill.
  land[k]=water[k]?Math.min(grid[k],value-ROAD_SURFACE_SETTINGS.waterClearance):value;
  accepted[k]=1;
  if(Math.abs(value-grid[k])>=.05)changed++;
 }
 // Close isolated rejected samples only when their already-designed neighbours
 // agree on a low-relief surface. Otherwise a single rejected DEM point becomes
 // a pit/peak between successfully corrected road samples. Broad hills have no
 // such enclosing consensus and remain untouched.
 for(let pass=0;pass<2;pass++){
  const fills=[];
  for(let j=2;j<height-2;j++)for(let i=2;i<width-2;i++){
   const k=j*width+i;if(accepted[k]||!mask[k]||!urban[k]||!Number.isFinite(grid[k]))continue;
   const near=[];let cardinal=0;
   for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
    if(!dx&&!dz)continue;const q=(j+dz)*width+i+dx;
    if(accepted[q]){near.push(surface[q]);if(!dx||!dz)cardinal++;}
   }
   if(near.length<6||cardinal<3||Math.max(...near)-Math.min(...near)>step*.3)continue;
   const value=median(near);if(Math.abs(value-grid[k])>ROAD_SURFACE_SETTINGS.maxAdjustment)continue;
   fills.push([k,value]);
  }
  for(const [k,value] of fills){surface[k]=value;land[k]=water[k]?Math.min(grid[k],value-ROAD_SURFACE_SETTINGS.waterClearance):value;accepted[k]=1;}
  if(!fills.length)break;
 }
 // A smoothed deck must never be buried beneath preserved water terrain. Lift
 // its connected street approach gradually instead of snapping up at the bank.
 // Each iteration uses immutable previous values: independent of tile/order.
 let lifted=surface;
 for(let k=0;k<grid.length;k++)if(accepted[k]&&water[k])lifted[k]=Math.max(lifted[k],land[k]+ROAD_SURFACE_SETTINGS.waterClearance);
 for(let pass=0;pass<ROAD_SURFACE_SETTINGS.approachPasses;pass++){
  const next=lifted.slice();let count=0;
  for(let j=1;j<height-1;j++)for(let i=1;i<width-1;i++){
   const k=j*width+i;if(!accepted[k])continue;
   let h=lifted[k];
   for(const q of [k-1,k+1,k-width,k+width])if(accepted[q])h=Math.max(h,lifted[q]-step*ROAD_SURFACE_SETTINGS.approachGrade);
   h=Math.min(h,grid[k]+ROAD_SURFACE_SETTINGS.maxAdjustment);
   if(h>lifted[k]+.001){next[k]=h;count++;}
  }
  lifted=next;if(!count)break;
 }
 for(let k=0;k<grid.length;k++)if(accepted[k]){surface[k]=lifted[k];if(!water[k])land[k]=lifted[k];}
 return {land,surface,accepted,changed,skipped};
}

/** Curvature fairing repairs rejected gaps as well as accepted planes. A constant
 * hillside has zero Laplacian and is preserved; oscillating DEM ridges do not.
 * Work on one city lattice, with bounded displacement and a feathered road mask.
 */
export const ROAD_FAIRING_SETTINGS=Object.freeze({passes:48,relaxation:.5,maxAdjustment:30});
export function fairUrbanRoadSurface(surface,land,reference,mask,water,urban,width,height){
 let current=surface.slice();const candidates=[];
 for(let z=1;z<height-1;z++)for(let x=1;x<width-1;x++){
  const k=z*width+x;if(mask[k]&&urban[k]&&Number.isFinite(reference[k])&&[k-1,k+1,k-width,k+width].every(q=>Number.isFinite(surface[q])))candidates.push(k);
 }
 for(let pass=0;pass<ROAD_FAIRING_SETTINGS.passes;pass++){
  const next=current.slice();
  for(const k of candidates){const mean=(current[k-1]+current[k+1]+current[k-width]+current[k+width])/4;
   const value=current[k]+(mean-current[k])*ROAD_FAIRING_SETTINGS.relaxation*mask[k]/255;
   // Keep an already evidenced deep spike repair; the outer writer still validates its 80m bound.
   const lower=Math.min(reference[k]-ROAD_FAIRING_SETTINGS.maxAdjustment,surface[k]);
   next[k]=Math.max(lower,Math.min(reference[k]+ROAD_FAIRING_SETTINGS.maxAdjustment,value));
  }current=next;
 }
 const ground=land.slice();let changed=0;
 for(const k of candidates){ground[k]=water[k]?Math.min(land[k],current[k]-ROAD_SURFACE_SETTINGS.waterClearance):current[k];if(Math.abs(current[k]-surface[k])>=.05)changed++;}
 return {land:ground,surface:current,changed};
}
