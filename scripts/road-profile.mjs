/** Audit actual road-width tracks. Constant hillside grades and repeated crests are separate findings. */
export const ROAD_PROFILE_LIMITS=Object.freeze({spacing:4,maxGrade:.18,maxGradeChange:.12,minReversalGrade:.06});
export function auditRoadProfile(roads,sample,limits=ROAD_PROFILE_LIMITS){
 const out={segments:0,samples:0,steepSegments:0,roughSegments:0,invalidSamples:0,maxGrade:0,maxGradeChange:0,issues:[]};
 for(const r of roads){if(r.tunnel||(r.layer??0)<0)continue;
  for(let i=2;i<r.p.length;i+=2){
   const [ax,az,bx,bz]=r.p.slice(i-2,i+2),len=Math.hypot(bx-ax,bz-az);if(len<.01)continue;
   const steps=Math.max(2,Math.ceil(len/limits.spacing)),ds=len/steps;let maxGrade=0,maxChange=0,reversals=0,location=[ax,az];
   for(const side of [-.4,0,.4]){
    let previous,grade;
    for(let j=0;j<=steps;j++){
     const x=ax+(bx-ax)*j/steps-(bz-az)/len*(r.w??6)*side,z=az+(bz-az)*j/steps+(bx-ax)/len*(r.w??6)*side,h=sample(x,z);out.samples++;
     if(!Number.isFinite(h)){out.invalidSamples++;previous=undefined;grade=undefined;continue;}
     if(previous!=null){const g=(h-previous)/ds;
      if(Math.abs(g)>maxGrade){maxGrade=Math.abs(g);location=[x,z];}
      if(grade!=null){maxChange=Math.max(maxChange,Math.abs(g-grade));if(g*grade<0&&Math.min(Math.abs(g),Math.abs(grade))>limits.minReversalGrade)reversals++;}
      grade=g;
     }previous=h;
    }
   }
   out.segments++;out.maxGrade=Math.max(out.maxGrade,maxGrade);out.maxGradeChange=Math.max(out.maxGradeChange,maxChange);
   const steep=maxGrade>limits.maxGrade,rough=maxChange>limits.maxGradeChange||reversals>0;
   if(steep)out.steepSegments++;if(rough)out.roughSegments++;
   if(steep||rough)out.issues.push({p:[ax,az,bx,bz],location,maxGrade,maxChange,reversals,steep,rough,w:r.w??6,bridge:!!r.bridge,layer:r.layer??0});
  }
 }return out;
}
