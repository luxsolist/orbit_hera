/** Bank-to-bank deck profile, shared by mesh generation and its support surface. */
export function crossingHeight(crossings,sample,x,z,fallback){
 let result=fallback;
 for(const r of crossings){
  const p=r.p,ax=p[0],az=p[1],bx=p.at(-2),bz=p.at(-1),dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz);
  if(length<.01)continue;
  const t=((x-ax)*dx+(z-az)*dz)/(length*length);
  if(t<0||t>1)continue;
  let distance=Infinity;
  for(let i=2;i<p.length;i+=2){
   const sx=p[i]-p[i-2],sz=p[i+1]-p[i-1],l=sx*sx+sz*sz;
   const u=l?Math.max(0,Math.min(1,((x-p[i-2])*sx+(z-p[i-1])*sz)/l)):0;
   distance=Math.min(distance,Math.hypot(x-p[i-2]-u*sx,z-p[i-1]-u*sz));
  }
  if(distance>(r.w??6)/2+4)continue;
  const a=sample(ax-dx/length*2,az-dz/length*2),b=sample(bx+dx/length*2,bz+dz/length*2);
  if(Number.isFinite(a)&&Number.isFinite(b))result=Math.max(result,a+(b-a)*t);
 }
 return result;
}
