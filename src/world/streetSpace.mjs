/** Shared build/runtime clearance: preserve structures; constrain estimated asphalt.
 * Only long parallel boundaries are evidence of a street edge. Cross streets,
 * gates, bridges and explicit width tags must not be silently cut or moved.
 */
export function fitStreetWidths(objects) {
 const grid=new Map(),cell=128;
 const index=(a,b,pad=0)=>{const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<8)return;
  const e={a,b,len,ux:dx/len,uz:dz/len,pad};
  for(let z=Math.floor(Math.min(a[1],b[1])/cell);z<=Math.floor(Math.max(a[1],b[1])/cell);z++)for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++){const k=x+':'+z;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(e);}
 };
 for(const b of objects.buildings??[])if(!b.structureKind)for(let i=0;i<b.p.length;i+=2){const j=(i+2)%b.p.length;index(b.p.slice(i,i+2),b.p.slice(j,j+2));}
 for(const w of objects.walls??[])for(let i=2;i<w.p.length;i+=2)index(w.p.slice(i-2,i),w.p.slice(i,i+2),(w.w??.4)/2);
 const roads=objects.roads.map(r=>{
  if(r.bridge||r.tunnel||(r.layer??0)!==0||r.widthSource==='tag'||r.widthSource==='clearance')return r;
  const original=r.w??6;let width=original;
  for(let i=2;i<r.p.length;i+=2){const ax=r.p[i-2],az=r.p[i-1],bx=r.p[i],bz=r.p[i+1],len=Math.hypot(bx-ax,bz-az);if(len<8)continue;
   const ux=(bx-ax)/len,uz=(bz-az)/len,near=new Set();
   for(let z=Math.floor((Math.min(az,bz)-original)/cell);z<=Math.floor((Math.max(az,bz)+original)/cell);z++)for(let x=Math.floor((Math.min(ax,bx)-original)/cell);x<=Math.floor((Math.max(ax,bx)+original)/cell);x++)for(const e of grid.get(x+':'+z)??[])near.add(e);
   for(const e of near){if(Math.abs(ux*e.ux+uz*e.uz)<.985)continue;
    const ta=(e.a[0]-ax)*ux+(e.a[1]-az)*uz,tb=(e.b[0]-ax)*ux+(e.b[1]-az)*uz;
    if(Math.min(len,Math.max(ta,tb))-Math.max(0,Math.min(ta,tb))<8)continue;
    const da=(e.a[0]-ax)*-uz+(e.a[1]-az)*ux,db=(e.b[0]-ax)*-uz+(e.b[1]-az)*ux;
    if(da*db<=0)continue; // crossing is a source conflict, not evidence of street width
    const available=Math.min(Math.abs(da),Math.abs(db))-e.pad-1;
    if(available>=2)width=Math.min(width,Math.floor(available*2*10)/10);
   }
  }
  return width<original-.1?{...r,w:width,widthSource:'clearance'}:r;
 });
 return {...objects,roads};
}
