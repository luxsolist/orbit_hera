/** Top-down ground-street allocation. Metres, independent of city and coordinate.
 * Reserve walking space before allocating asphalt. Buildings/walls are immutable.
 * Whole-segment clearance includes corners and terminal caps, not only parallel facades.
 */
export const STREET_SECTION = Object.freeze({version:1,sidewalk:2.3,minSidewalk:1.5,
 minCarriageway:3,facadeGap:.4,curb:.225,furnitureInset:1.35,furnitureRadius:.9,maxMiter:1.35,widthSlope:.12});
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
function pointDistance(p,a,b){const d=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/(dot(d,d)||1)));return Math.hypot(p[0]-a[0]-t*d[0],p[1]-a[1]-t*d[1]);}
function distance(a,b,c,d){
 const u=sub(b,a),v=sub(d,c),r=sub(c,a),det=u[0]*v[1]-u[1]*v[0];
 if(Math.abs(det)>1e-9){const t=(r[0]*v[1]-r[1]*v[0])/det,s=(r[0]*u[1]-r[1]*u[0])/det;if(t>=0&&t<=1&&s>=0&&s<=1)return 0;}
 return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
function inside(p,ring){let hit=false;for(let i=0,j=ring.length-2;i<ring.length;j=i,i+=2)if((ring[i+1]>p[1])!==(ring[j+1]>p[1])&&p[0]<(ring[j]-ring[i])*(p[1]-ring[i+1])/(ring[j+1]-ring[i+1])+ring[i])hit=!hit;return hit;}
/** A symmetric section deliberately preserves the mapped centreline; no building displacement.
 * Insufficient space is an explicit shared-street/source-conflict state, never a forced 28m road.
 */
export function planStreetSections(objects){
 const grid=new Map(),cell=128;
 const insert=(p,closed,pad=0,holes=[])=>{if(p.length<4)return;const box=[Infinity,Infinity,-Infinity,-Infinity];for(let i=0;i<p.length;i+=2){box[0]=Math.min(box[0],p[i]-pad);box[1]=Math.min(box[1],p[i+1]-pad);box[2]=Math.max(box[2],p[i]+pad);box[3]=Math.max(box[3],p[i+1]+pad);}const o={p,closed,pad,holes};
  for(let x=Math.floor(box[0]/cell);x<=Math.floor(box[2]/cell);x++)for(let z=Math.floor(box[1]/cell);z<=Math.floor(box[3]/cell);z++){const k=x+','+z,a=grid.get(k)??[];a.push(o);grid.set(k,a);}
 };
 for(const b of [...(objects.buildings??[]),...(objects.structures??[])])if(!b.bridge&&!b.tunnel&&(b.layer??0)===0)insert(b.p,true);
 for(const b of objects.water??[])if(!b.bridge)insert(b.p,b.w==null,(b.w??0)/2,b.holes??[]);
 for(const b of objects.walls??[])if(!b.bridge&&!b.tunnel&&(b.layer??0)===0)insert(b.p,false,(b.w??.4)/2);
 const roads=objects.roads.map(r=>{
  if(r.bridge||r.tunnel||(r.layer??0)!==0)return r;
  const source=r.streetSection?.sourceWidth??r.w??6;
  if(!Number.isFinite(source)||source<=0)return r;
  const target=source>=6?STREET_SECTION.sidewalk:0,reach=(source/2+target+STREET_SECTION.curb)*STREET_SECTION.maxMiter+STREET_SECTION.facadeGap;
  let clearance=reach;
  for(let i=2;i<r.p.length;i+=2){const a=r.p.slice(i-2,i),b=r.p.slice(i,i+2),near=new Set();
   for(let x=Math.floor((Math.min(a[0],b[0])-reach)/cell);x<=Math.floor((Math.max(a[0],b[0])+reach)/cell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-reach)/cell);z<=Math.floor((Math.max(a[1],b[1])+reach)/cell);z++)for(const o of grid.get(x+','+z)??[])near.add(o);
   for(const o of near){if(o.closed&&[a,b].some(p=>inside(p,o.p)&&!o.holes.some(h=>inside(p,h)))){clearance=0;break;}
    for(const ring of [o.p,...o.holes])for(let j=o.closed?0:2;j<ring.length;j+=2){const k=(j+ring.length-2)%ring.length;clearance=Math.min(clearance,Math.max(0,distance(a,b,ring.slice(k,k+2),ring.slice(j,j+2))-o.pad));}
   }
  }
  // Reserve the maximum joint extension as well as facade clearance before budgeting.
  const half=Math.max(0,(clearance-STREET_SECTION.facadeGap)/STREET_SECTION.maxMiter-STREET_SECTION.curb);
  let sidewalk=target,mode='street';
  if(half<source/2+target){sidewalk=target?Math.min(target,Math.max(STREET_SECTION.minSidewalk,half-STREET_SECTION.minCarriageway/2)):0;}
  if(half<STREET_SECTION.minCarriageway/2+sidewalk){sidewalk=0;mode='shared';}
  let width=Math.floor(Math.min(source,r.streetSection?.carriageway??source,half*2-sidewalk*2)*100+1e-8)/100;
  // A cross-section solver cannot repair a centreline crossing a solid obstacle.
  // Preserve the existing road instead of silently deleting an entire mapped link.
  // Disable new furniture and expose the unresolved source conflict to the build audit.
  if(width<.5){width=r.w??source;sidewalk=target;mode='conflict';}
  const streetSection={version:1,sourceWidth:source,carriageway:width,sidewalk,
   furniture:mode!=='conflict'&&sidewalk>=STREET_SECTION.furnitureInset+STREET_SECTION.furnitureRadius,
   clearance:Math.round(clearance*1000)/1000,mode,explicitWidthAdjusted:r.widthSource==='tag'&&width<source-.01};
  return {...r,w:width,streetSection};
 });
 // Propagate constrictions along smooth continuations. Only shrink; never trade a
 // building clearance for a prettier taper. Length-based limits avoid 7m sawteeth.
 const nodes=new Map();
 roads.forEach((r,i)=>{if(!r.streetSection||r.streetSection.mode==='conflict'||r.p.length!==4||r.w<=0)return;for(const p of [r.p.slice(0,2),r.p.slice(2)]){const k=p.join(','),a=nodes.get(k)??[];a.push(i);nodes.set(k,a);}});
 const links=[];
 for(const [key,indices] of nodes){if(indices.length!==2)continue;const [i,j]=indices,a=roads[i],b=roads[j],p=key.split(',').map(Number);
  const other=r=>r.p[0]===p[0]&&r.p[1]===p[1]?r.p.slice(2):r.p.slice(0,2),u=sub(other(a),p),v=sub(other(b),p),la=Math.hypot(...u),lb=Math.hypot(...v);
  if(dot(u,v)/(la*lb)<-.7)links.push([i,j,Math.min(la,lb)*STREET_SECTION.widthSlope]);
 }
 // Integer-centimetre relaxation converges independent of source ordering. A
 // fixed pass count leaves short, densely segmented streets incompletely tapered.
 const neighbors=new Map();
 for(const [i,j,delta] of links)for(const [a,b] of [[i,j],[j,i]]){const list=neighbors.get(a)??[];list.push([b,Math.floor(delta*100+1e-8)]);neighbors.set(a,list);}
 const queue=[...neighbors.keys()],pending=new Set(queue);
 for(let head=0;head<queue.length;head++){const i=queue[head];pending.delete(i);
  for(const [j,cost] of neighbors.get(i)??[]){const r=roads[j],limit=(Math.round(roads[i].w*100)+cost)/100;
   if(r.w<=limit+.001)continue;
   roads[j]={...r,w:limit,streetSection:{...r.streetSection,carriageway:limit,explicitWidthAdjusted:r.widthSource==='tag'&&limit<r.streetSection.sourceWidth-.01}};
   if(!pending.has(j)){pending.add(j);queue.push(j);}
  }
 }
 return {...objects,roads};
}
export function streetSidewalk(r){return r.streetSection?.sidewalk??((r.w??6)>=6&&(r.w??6)<=36?STREET_SECTION.sidewalk:0);}
