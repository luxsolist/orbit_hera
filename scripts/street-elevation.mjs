/** Continuous inferred upper-road profile; source layer is ordering, not metres. */
export function createElevatedStreetSampler(ground,roofs=[]){
 const cell=128,grid=new Map();
 for(const r of roofs){
  const xs=r.p.filter((_,i)=>i%2===0),zs=r.p.filter((_,i)=>i%2===1);
  const b={x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};
  const y=Math.max(...xs.map((x,i)=>ground(x,zs[i])??0))+r.h+.15,margin=Math.max(30,r.h*6);
  const item={...b,y};
  for(let x=Math.floor((b.x0-margin)/cell);x<=Math.floor((b.x1+margin)/cell);x++)for(let z=Math.floor((b.z0-margin)/cell);z<=Math.floor((b.z1+margin)/cell);z++){const k=x+':'+z,list=grid.get(k)??[];list.push(item);grid.set(k,list);}
 }
 return (x,z,level)=>{
  const base=ground(x,z)??0;let y=base+5;
  for(const r of grid.get(Math.floor(x/cell)+':'+Math.floor(z/cell))??[]){const d=Math.hypot(Math.max(r.x0-x,0,x-r.x1),Math.max(r.z0-z,0,z-r.z1));y=Math.max(y,r.y-d/6);}
  return y+(Math.max(1,level)-1)*5;
 };
}
