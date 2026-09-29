import {auditRoadProfile} from './road-profile.mjs';
import {auditRoadJoins,fitNetworkSurface,rejectNewRoadWarnings} from './road-network-grade.mjs';
export const LOCAL_ROAD_SETTINGS=Object.freeze({size:129,step:8,maxChunks:8,maxCandidates:48,radius:224,maxAdjustment:8,fitPasses:96});
export function latticeSampler(grid,n,step,ox,oz,fallback=()=>NaN){return (x,z)=>{
 const gx=(x-ox)/step,gz=(z-oz)/step;if(gx<0||gz<0||gx>n-1||gz>n-1)return fallback(x,z);
 const i=Math.min(n-2,Math.floor(gx)),j=Math.min(n-2,Math.floor(gz)),fx=gx-i,fz=gz-j,k=j*n+i;
 const a=Math.fround(grid[k]),b=Math.fround(grid[k+1]),c=Math.fround(grid[k+n]),d=Math.fround(grid[k+n+1]);
 return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
};}
export function scopeAt(codes,n,x,z,ox,oz,step){
 const i=Math.max(0,Math.min(n-2,Math.floor((x-ox)/step))),j=Math.max(0,Math.min(n-2,Math.floor((z-oz)/step))),k=j*n+i;
 return codes[k]|codes[k+1]|codes[k+n]|codes[k+n+1];
}
export const issueKey=i=>i.p.join(',')+':'+(i.w??6);
export function compareRoadAudits(before,after){
 const old=new Map(before.issues.map(i=>[issueKey(i),i]));
 const regressions=after.issues.filter(i=>{const b=old.get(issueKey(i));return i.steep&&!b?.steep||i.rough&&!b?.rough||b&&(i.maxGrade>b.maxGrade+.002||i.maxChange>b.maxChange+.002||i.reversals>b.reversals);});
 return {regressions:regressions.length,removed:before.steepSegments+before.roughSegments-after.steepSegments-after.roughSegments};
}
export function refineLocalSurface(source,mask,roads,ox,oz,fallback,settings=LOCAL_ROAD_SETTINGS){
 const n=settings.size,sample=g=>latticeSampler(g,n,settings.step,ox,oz,fallback);
 const before=auditRoadProfile(roads,sample(source)),joinsBefore=auditRoadJoins(roads,sample(source),4,{collectAll:true});
 const oldJoins=new Map(joinsBefore.examples.map(i=>[i.p.join(','),i.change]));
 const fitted=fitNetworkSurface(source,mask,new Float64Array(n*n),new Float64Array(n*n),n,n,settings);
 for(const blend of [1,.5,.25]){
  const candidate=Float64Array.from(fitted,(v,i)=>source[i]+Math.round((v-source[i])*blend*10000)/10000);
  const guard=rejectNewRoadWarnings(roads,source,candidate,n,n,settings.step,ox,oz);
  const after=auditRoadProfile(roads,sample(guard.surface)),joinsAfter=auditRoadJoins(roads,sample(guard.surface),4,{collectAll:true});
  const cmp=compareRoadAudits(before,after),joinRegressions=joinsAfter.examples.filter(i=>!oldJoins.has(i.p.join(','))||i.change>oldJoins.get(i.p.join(','))+.002).length;
  if(!cmp.regressions&&!joinRegressions&&cmp.removed>0)return {surface:guard.surface,before,after,guard:guard.report,blend,removed:cmp.removed,joinsBefore:joinsBefore.roughJoins,joinsAfter:joinsAfter.roughJoins};
 }
 return null;
}
