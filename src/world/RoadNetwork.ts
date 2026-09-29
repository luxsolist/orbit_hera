/** Pure, world-space road corridor solver; shared by rendering and map-build audits.
 * Keep source centerlines. Only join matching degree-two continuations; junctions stay junctions.
 */
export type RoadPoint=[number,number];
export interface RoadSource {p:number[];w?:number}
export interface RoadCorridor {
 key:string; chain:string; a:RoadPoint; b:RoadPoint; w:number; length:number; phase:number;
 start:RoadPoint; end:RoadPoint; startWidth:number; endWidth:number;
 startJoined:boolean; endJoined:boolean;
}
const pointKey=(p:RoadPoint)=>p.join(',');
export const roadSegmentKey=(p:readonly number[])=>[p.slice(0,2).join(','),p.slice(2,4).join(',')].sort().join('|');
/** Identical endpoint offsets on both sides of a bend avoid round bulges and cap seams. */
export function solveRoadNetwork(roads:readonly RoadSource[]):Map<string,RoadCorridor>{
 const edges=new Map<string,{a:RoadPoint;b:RoadPoint;w:number;length:number}>();
 for(const road of roads)for(let i=2;i<road.p.length;i+=2){
  const p=road.p.slice(i-2,i+2),key=roadSegmentKey(p),a=p.slice(0,2) as RoadPoint,b=p.slice(2,4) as RoadPoint;
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]),w=road.w??6;
  if(p.length!==4||!p.every(Number.isFinite)||!Number.isFinite(w)||w<=0||length<.01)continue;
  const previous=edges.get(key);if(!previous||w>previous.w)edges.set(key,{a,b,w,length});
 }
 const nodes=new Map<string,string[]>();
 for(const [key,s] of edges)for(const p of [s.a,s.b]){const k=pointKey(p),list=nodes.get(k)??[];list.push(key);nodes.set(k,list);}
 const other=(key:string,p:RoadPoint)=>{const e=edges.get(key)!;return pointKey(e.a)===pointKey(p)?e.b:e.a;};
 const continuation=(key:string,p:RoadPoint):string|undefined=>{
  const keys=nodes.get(pointKey(p))!;if(keys.length!==2)return;
  const next=keys.find(k=>k!==key)!,s=edges.get(key)!,q=edges.get(next)!;
  if(Math.max(s.w,q.w)/Math.min(s.w,q.w)>1.4)return;
  const a=other(key,p),b=other(next,p),dot=((a[0]-p[0])*(b[0]-p[0])+(a[1]-p[1])*(b[1]-p[1]))/(s.length*q.length);
  if(dot>-.7)return; // A sharp turn or fork is not a smooth continuation.
  const turn=Math.sqrt(Math.max(0,(1+dot)/(1-dot)));
  if(turn*(Math.max(s.w,q.w)/2+2.6)>.4*Math.min(s.length,q.length))return; // Bevel/round a short bend instead of folding its inner edge.
  return next;
 };
 const result=new Map<string,RoadCorridor>();
 const walk=(first:string,point:RoadPoint)=>{
  let key:string|undefined=first,a=point,phase=0;
  while(key&&!result.has(key)){
   const e=edges.get(key)!,b=other(key,a),nx=-(b[1]-a[1])/e.length,nz=(b[0]-a[0])/e.length;
   const cross=(p:RoadPoint,start:boolean):{offset:RoadPoint;width:number;joined:boolean}=>{
    const next=continuation(key!,p);if(!next)return {offset:[nx,nz],width:e.w,joined:false};
    const q=edges.get(next)!,o=other(next,p),sign=start?1:-1;
    const ux=(p[0]-o[0])/q.length*sign,uz=(p[1]-o[1])/q.length*sign;
    const den=1+nx*(-uz)+nz*ux;
    let x=(nx-uz)/den,z=(nz+ux)/den;
    const width=Math.min(e.w,q.w);
    // Short unsafe bends were rejected above; keep the shared miter bounded at other bends.
    const scale=Math.min(1,1.35/Math.hypot(x,z));x*=scale;z*=scale;
    return {offset:[x,z],width,joined:true};
   };
   const start=cross(a,true),end=cross(b,false);
   result.set(key,{key,chain:first,a,b,w:e.w,length:e.length,phase,start:start.offset,end:end.offset,startWidth:start.width,endWidth:end.width,startJoined:start.joined,endJoined:end.joined});
   phase+=e.length;key=continuation(key,b);a=b;
  }
 };
 // Start at chain endpoints first, then deterministic closed loops. Sorting makes chunk order irrelevant.
 for(const key of [...edges.keys()].sort()){
  const e=edges.get(key)!;
  for(const p of [e.a,e.b].sort((a,b)=>pointKey(a).localeCompare(pointKey(b))))if(!continuation(key,p))walk(key,p);
 }
 for(const key of [...edges.keys()].sort())walk(key,edges.get(key)!.a);
 return result;
}
export function corridorPoint(s:RoadCorridor,distance:number,offset:number,extraWidth=0):RoadPoint {
 const t=Math.max(0,Math.min(1,distance/s.length));
 const width=s.startWidth+(s.endWidth-s.startWidth)*t;
 const side=offset*(width+extraWidth)/s.w;
 return corridorOffsetPoint(s,distance,side);
}
/** Fixed metre offsets keep paint width and lane centres continuous across a road-width taper. */
export function corridorOffsetPoint(s:RoadCorridor,distance:number,side:number):RoadPoint {
 const t=Math.max(0,Math.min(1,distance/s.length));
 return [s.a[0]+(s.b[0]-s.a[0])*t+(s.start[0]+(s.end[0]-s.start[0])*t)*side,
 s.a[1]+(s.b[1]-s.a[1])*t+(s.start[1]+(s.end[1]-s.start[1])*t)*side];
}
export function corridorFootprint(s:RoadCorridor,extraWidth=0):RoadPoint[]{
 return [corridorPoint(s,0,-s.w/2,extraWidth),corridorPoint(s,s.length,-s.w/2,extraWidth),corridorPoint(s,s.length,s.w/2,extraWidth),corridorPoint(s,0,s.w/2,extraWidth)];
}

/** Rounded terminals/junction corners only; connected bend stations have no round cap. */
export function corridorOutline(s:RoadCorridor,extraWidth=0):RoadPoint[]{
 const points=corridorFootprint(s,extraWidth),angle=Math.atan2(s.b[1]-s.a[1],s.b[0]-s.a[0]);
 for(const [p,joined,width,heading] of [[s.a,s.startJoined,s.startWidth,angle+Math.PI/2],[s.b,s.endJoined,s.endWidth,angle-Math.PI/2]] as const){
  if(joined)continue;
  for(let i=0;i<=8;i++){const a=heading+i*Math.PI/8;points.push([p[0]+Math.cos(a)*(width+extraWidth)/2,p[1]+Math.sin(a)*(width+extraWidth)/2]);}
 }
 // Convex hull supports both asymmetric miters and rounded terminals without an inverted fan.
 const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(a:RoadPoint,b:RoadPoint,c:RoadPoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const chain=(list:RoadPoint[])=>{const out:RoadPoint[]=[];for(const p of list){while(out.length>1&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}out.pop();return out;};
 return [...chain(sorted),...chain([...sorted].reverse())];
}

export function insideRoadOutline(point:RoadPoint,polygon:RoadPoint[]):boolean {
 return polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return (b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0])>=-1e-6;});
}

/** Wide parallel carriageways may overlap because widths are inferred. Their
 * overlapping pavement is not an intersection. Keep true shallow crossings.
 * Shared by map-baked paint and the ordinary street renderer.
 */
export function roadJunctionCandidate(a:RoadPoint,b:RoadPoint,c:RoadPoint,d:RoadPoint):boolean {
 const dx=b[0]-a[0],dz=b[1]-a[1],ex=d[0]-c[0],ez=d[1]-c[1];
 const lengths=Math.hypot(dx,dz)*Math.hypot(ex,ez);if(lengths<1e-8)return false;
 const det=dx*ez-dz*ex,sine=Math.abs(det)/lengths;
 if(sine>=.25)return true;
 if(sine<1e-6)return false;
 const rx=c[0]-a[0],rz=c[1]-a[1],u=(rx*ez-rz*ex)/det,v=(rx*dz-rz*dx)/det;
 // A nearly straight shared endpoint is a continuation, not a crossing.
 const shared=[a,b].some(p=>[c,d].some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.01));
 if(shared&&sine<.035)return false;
 return u>=-.001&&u<=1.001&&v>=-.001&&v<=1.001;
}


/** Final map streets override stale contextual widths before joins, paint or props are planned. */
export function resolveRoadContext(roads:readonly RoadSource[],context:Map<string,RoadCorridor>):Map<string,RoadCorridor>{
 const overrides=new Map<string,number>();
 for(const r of roads)for(let i=2;i<r.p.length;i+=2){const key=roadSegmentKey(r.p.slice(i-2,i+2)),c=context.get(key),w=r.w??6;
  if(c&&Number.isFinite(w)&&w>=0)overrides.set(key,Math.min(overrides.get(key)??Infinity,w));
 }
 if([...overrides].every(([key,w])=>Math.abs(context.get(key)!.w-w)<.00001))return context;
 return solveRoadNetwork([...context.values()].map(c=>({p:[...c.a,...c.b],w:overrides.get(c.key)??c.w})));
}
