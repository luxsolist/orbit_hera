import {roadJunctionCandidate,corridorOffsetPoint,corridorOutline,corridorFootprint,type RoadCorridor,type RoadPoint} from './RoadNetwork';
export interface MarkingSettings {lineWidth:number;minimumRun:number;junctionMargin:number;mergeGap:number}
export const DEFAULT_MARKINGS:MarkingSettings={lineWidth:.24,minimumRun:6,junctionMargin:7,mergeGap:6};
/** One visual policy for generated maps, ordinary roads, textures and bridge decks. */
export const centerLineOffsets=(width:number):number[]=>width<6?[]:[0];
export interface RoadPaint {start:number;end:number;left:number;right:number;endLeft:number;endRight:number;layer:4;kind:'center';run:string}
export function roadPaintCorners(c:RoadCorridor,m:RoadPaint):RoadPoint[]{
 return [corridorOffsetPoint(c,m.start,m.left),corridorOffsetPoint(c,m.end,m.endLeft),corridorOffsetPoint(c,m.end,m.endRight),corridorOffsetPoint(c,m.start,m.right)];
}
type Interval=[number,number];
/** Whole connected roads own continuous centre lines; suppress overlap and short junction fragments. */
export function planRoadMarkings(network:Map<string,RoadCorridor>,settings:MarkingSettings=DEFAULT_MARKINGS,supports:(c:RoadCorridor,p:RoadPoint)=>boolean=()=>true):Map<string,RoadPaint[]>{
 if(Object.values(settings).some(v=>!Number.isFinite(v)||v<=0))throw new Error('Invalid road marking settings');
 const result=new Map<string,RoadPaint[]>(),chains=new Map<string,RoadCorridor[]>(),grid=new Map<string,RoadCorridor[]>();
 for(const c of network.values()){
  result.set(c.key,[]);const chain=chains.get(c.chain)??[];chain.push(c);chains.set(c.chain,chain);
  const pad=c.w+settings.junctionMargin+4;
  for(let x=Math.floor((Math.min(c.a[0],c.b[0])-pad)/32);x<=Math.floor((Math.max(c.a[0],c.b[0])+pad)/32);x++)for(let z=Math.floor((Math.min(c.a[1],c.b[1])-pad)/32);z<=Math.floor((Math.max(c.a[1],c.b[1])+pad)/32);z++){
   const key=x+':'+z,list=grid.get(key)??[];list.push(c);grid.set(key,list);
  }
 }
 // When inferred widths make parallel source carriageways overlap, only the
 // widest, then longest connected road owns paint there. Ranking whole chains is independent
 // of input order and tile/segment subdivision.
 const rank=new Map([...chains].map(([id,chain])=>[id,chain.reduce((n,c)=>n+c.length,0)]));
 const bounds=new Map([...chains].map(([id,chain])=>{const points=chain.flatMap(c=>[c.a,c.b]);return [id,[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))].join(',')];}));
 const chainWidth=new Map([...chains].map(([id,chain])=>[id,Math.max(...chain.map(c=>c.w))]));
 const ownsPaint=(q:RoadCorridor,c:RoadCorridor)=>{
  const width=chainWidth.get(q.chain)!-chainWidth.get(c.chain)!;if(Math.abs(width)>.01)return width>0;
  const delta=rank.get(q.chain)!-rank.get(c.chain)!;
  return Math.abs(delta)>1e-5?delta>0:bounds.get(q.chain)!<bounds.get(c.chain)!;
 };
 const nearby=(x:number,z:number)=>grid.get(Math.floor(x/32)+':'+Math.floor(z/32))??[];
 for(const [id,chain] of chains){
  chain.sort((a,b)=>a.phase-b.phase);const length=Math.max(...chain.map(c=>c.phase+c.length)),width=Math.min(...chain.map(c=>Math.min(c.w,c.startWidth,c.endWidth)));
  if(width<6)continue;
  const blocks:Interval[]=[];
  for(const c of chain){
   const candidates=new Set<RoadCorridor>();for(let d=0;d<=c.length+16;d+=16){const p=corridorOffsetPoint(c,Math.min(d,c.length),0);for(const q of nearby(...p))candidates.add(q);}
   for(const q of candidates){
    if(q.chain===id||q.w<6)continue;
    const junction=roadJunctionCandidate(c.a,c.b,q.a,q.b);
    if(!junction&&!ownsPaint(q,c))continue;
    // A small side entrance does not interrupt the main road's centre. A true
    // through crossing still clears it, including when its source is subdivided.
    if(junction&&q.w<c.w*.55){
     const sides=chains.get(q.chain)!.flatMap(r=>[r.a,r.b]).map(p=>((c.b[0]-c.a[0])*(p[1]-c.a[1])-(c.b[1]-c.a[1])*(p[0]-c.a[0]))/c.length);
     if(!(Math.min(...sides)<-c.w/2&&Math.max(...sides)>c.w/2))continue;
    }
    // Parallel road ownership uses the combined widths, not just the other
    // centreline's half width. No round endcaps: they create false paint gaps.
    const poly=junction?corridorOutline(q):corridorFootprint(q,c.w-.25);let lo=0,hi=1;
    for(let i=0;i<poly.length&&lo<=hi;i++){
     const a=poly[i],b=poly[(i+1)%poly.length],side=(p:RoadPoint)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
     const v=side(c.a),delta=side(c.b)-v;
     if(Math.abs(delta)<1e-9){if(v<0)hi=-1;}else if(delta>0)lo=Math.max(lo,-v/delta);else hi=Math.min(hi,-v/delta);
    }
    if(hi>lo){const interval:Interval=[c.phase+lo*c.length-(junction?settings.junctionMargin:0),c.phase+hi*c.length+(junction?settings.junctionMargin:0)];blocks.push(interval);}
   }
  }
  const merged:Interval[]=[];
  for(const [a,b] of blocks.sort((a,b)=>a[0]-b[0])){const last=merged[merged.length-1];if(last&&a<=last[1]+Math.max(settings.mergeGap,width*1.2))last[1]=Math.max(last[1],b);else merged.push([a,b]);}
  const free:Interval[]=[];let from=0;
  for(const [a,b] of merged){if(a>from)free.push([from,Math.min(length,a)]);from=Math.max(from,b);}if(from<length)free.push([from,length]);
  // Sample the union's lateral bounds on a connected road. Only overlapping
  // parallel pavement contributes; separated roads retain independent centres.
  const count=Math.max(1,Math.ceil(length/4)),step=length/count,offsets:number[]=[];
  let ci=0;
  for(let i=0;i<=count;i++){
   const d=i*step;while(ci<chain.length-1&&d>chain[ci].phase+chain[ci].length)ci++;
   const c=chain[ci],p=corridorOffsetPoint(c,d-c.phase,0),ux=(c.b[0]-c.a[0])/c.length,uz=(c.b[1]-c.a[1])/c.length;
   let left=-c.w/2,right=c.w/2;
   for(const q of nearby(...p)){
    if(q.chain===id)continue;
    const vx=(q.b[0]-q.a[0])/q.length,vz=(q.b[1]-q.a[1])/q.length,dot=ux*vx+uz*vz;
    if(Math.abs(ux*vz-uz*vx)>=.25)continue;
    const along=((p[0]-q.a[0])*ux+(p[1]-q.a[1])*uz)/dot;
    if(along<0||along>q.length)continue;
    const lateral=-(q.a[0]+vx*along-p[0])*uz+(q.a[1]+vz*along-p[1])*ux,half=q.w/(2*Math.abs(dot));
    if(Math.abs(lateral)>=(c.w+q.w)/2-.125)continue;
    left=Math.min(left,lateral-half);right=Math.max(right,lateral+half);
   }
   offsets.push(Math.max(-c.w*.45,Math.min(c.w*.45,(left+right)/2)));
  }
  // Bound sideways movement so a short branch or source endpoint cannot cause
  // a visible kink. Shared chain stations keep split segments connected.
  for(let pass=0;pass<3;pass++){
   const previous=[...offsets];for(let i=1;i<count;i++)offsets[i]=(previous[i-1]+2*previous[i]+previous[i+1])/4;
   for(let i=1;i<=count;i++)offsets[i]=Math.max(offsets[i-1]-.15*step,Math.min(offsets[i-1]+.15*step,offsets[i]));
   for(let i=count-1;i>=0;i--)offsets[i]=Math.max(offsets[i+1]-.15*step,Math.min(offsets[i+1]+.15*step,offsets[i]));
  }
  const offsetAt=(d:number)=>{const i=Math.min(count-1,Math.max(0,Math.floor(d/step))),u=Math.max(0,Math.min(1,d/step-i));return offsets[i]*(1-u)+offsets[i+1]*u;};
  const emit=(start:number,end:number,left:number,right:number,layer:4,kind:RoadPaint['kind'],run:string)=>{
   for(const c of chain){const a=Math.max(start,c.phase),b=Math.min(end,c.phase+c.length);if(b-a<1e-5)continue;
    const cuts=[a];for(let j=Math.floor(a/step)+1;j<count&&j*step<b-1e-5;j++)if(Math.abs(offsets[j-1]-2*offsets[j]+offsets[j+1])>1e-5)cuts.push(j*step);cuts.push(b);
    for(let i=1;i<cuts.length;i++){
     const from=cuts[i-1],to=cuts[i],o=offsetAt(from),e=offsetAt(to);
     const paint:RoadPaint={start:from-c.phase,end:to-c.phase,left:left+o,right:right+o,endLeft:left+e,endRight:right+e,layer,kind,run};
     const corners=roadPaintCorners(c,paint);
     if([...corners,...corners.map((p,i)=>[(p[0]+corners[(i+1)%4][0])/2,(p[1]+corners[(i+1)%4][1])/2] as RoadPoint)].every(p=>supports(c,p)))result.get(c.key)!.push(paint);
    }
   }
  };
  for(const [a,b] of free){
   if(b-a<settings.minimumRun)continue;
   const half=settings.lineWidth/2;
   for(const offset of centerLineOffsets(width))emit(a,b,offset-half,offset+half,4,'center',id+':center:'+a+':'+offset);
  }
 }
 const runLengths=new Map<string,number>();for(const marks of result.values())for(const m of marks)runLengths.set(m.run,(runLengths.get(m.run)??0)+m.end-m.start);
 for(const [key,marks] of result)result.set(key,marks.filter(m=>runLengths.get(m.run)!>=settings.minimumRun-1e-5));
 return result;
}
