/** Solid support uses the exact baked triangle plane, never a region-wide maximum. */
export function streetSupportPrism(v,offset){
 const [ax,ay,az,bx,by,bz,cx,cy,cz]=v,dx=bx-ax,dz=bz-az,ex=cx-ax,ez=cz-az,det=dx*ez-ex*dz;
 if(Math.abs(det)<1e-8)return null;
 const x=((by-ay)*ez-(cy-ay)*dz)/det,z=(dx*(cy-ay)-ex*(by-ay))/det;
 return {p:[ax,az,bx,bz,cx,cz],base:Math.min(ay,by,cy)-offset,top:Math.max(ay,by,cy),topPlane:[x,z,ay-x*ax-z*az]};
}

/** Ground entry to an authored terrace: keep a normal step, then a bounded rise. */
export function walkAccessOffset(offset,x,z,anchors=[]){
 for(const [ax,az] of anchors)offset=Math.min(offset,.18+.45*Math.hypot(x-ax,z-az));
 return offset;
}
