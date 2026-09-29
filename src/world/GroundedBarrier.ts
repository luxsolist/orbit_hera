import {terrainFootprint} from './StreetGeometry';
import type {ChunkTerrain} from './chunkMesh';

export const BARRIER_EMBED=.06;
export type BarrierBox={x0:number;x1:number;z0:number;z1:number;top:number};
export interface GroundedBarrier {positions:number[];walls:BarrierBox[];}
const quad=(out:number[],a:number[],b:number[],c:number[],d:number[])=>out.push(...a,...b,...c,...a,...c,...d);

/** Closed solid wall: both sides and the cap follow the actual clipped terrain triangles.
 * The small uniform embed is independent of the length or minimum height of a wall.
 * Four-metre collision sections are derived from these same footprint vertices.
 */
export function groundedWall(p:readonly number[],height:number,width:number,t:ChunkTerrain,ox:number,oz:number):GroundedBarrier {
 const positions:number[]=[],walls:BarrierBox[]=[];
 if(!Number.isFinite(height)||height<=0||!Number.isFinite(width)||width<=0)return {positions,walls};
 for(let i=2;i<p.length;i+=2){
  const ax=p[i-2],az=p[i-1],dx=p[i]-ax,dz=p[i+1]-az,len=Math.hypot(dx,dz);
  if(!Number.isFinite(len)||len<.01)continue;
  const nx=-dz/len*width/2,nz=dx/len*width/2,steps=Math.ceil(len/4);
  for(let j=0;j<steps;j++){
   const x=ax+dx*j/steps,z=az+dz*j/steps,bx=ax+dx*(j+1)/steps,bz=az+dz*(j+1)/steps;
   const floor=terrainFootprint([[x-nx,z-nz],[bx-nx,bz-nz],[bx+nx,bz+nz],[x+nx,z+nz]],t,ox,oz,false,false);
   if(!floor.length)continue;
   const edges=new Map<string,{a:number[];b:number[];count:number}>();
   const key=(v:number[])=>v.map(n=>n.toFixed(6)).join(',');
   let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity,top=-Infinity;
   for(let k=0;k<floor.length;k+=9){
    const tri=[floor.slice(k,k+3),floor.slice(k+3,k+6),floor.slice(k+6,k+9)];
    for(const v of tri){positions.push(v[0],v[1]+height,v[2]);x0=Math.min(x0,v[0]);x1=Math.max(x1,v[0]);z0=Math.min(z0,v[2]);z1=Math.max(z1,v[2]);top=Math.max(top,v[1]+height);}
    for(const v of [...tri].reverse())positions.push(v[0],v[1]-BARRIER_EMBED,v[2]);
    for(let e=0;e<3;e++){const a=tri[e],b=tri[(e+1)%3],id=[key(a),key(b)].sort().join('|'),edge=edges.get(id);if(edge)edge.count++;else edges.set(id,{a,b,count:1});}
   }
   for(const {a,b,count} of edges.values())if(count===1)quad(positions,[a[0],a[1]-BARRIER_EMBED,a[2]],[b[0],b[1]-BARRIER_EMBED,b[2]],[b[0],b[1]+height,b[2]],[a[0],a[1]+height,a[2]]);
   walls.push({x0,x1,z0,z1,top});
  }
 }
 return {positions,walls};
}

/** Posts are solid, individually seated into their support surface, with a sloping top rail.
 * Support is explicit: bridge railings pass deck height, never the river bed underneath.
 */
export function groundedRailing(a:readonly number[],b:readonly number[],height:number,support:(x:number,z:number)=>number):number[]{
 const out:number[]=[],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
 if(len<.01||!Number.isFinite(len))return out;
 const ux=dx/len,uz=dz/len,nx=-uz,nz=ux,steps=Math.max(1,Math.ceil(len/3));
 const prism=(low:number[][],high:number[][])=>{
  for(let k=0;k<4;k++){const j=(k+1)%4;quad(out,low[k],low[j],high[j],high[k]);}
  quad(out,high[0],high[1],high[2],high[3]);quad(out,low[3],low[2],low[1],low[0]);
 };
 const rows:{x:number;z:number;top:number}[]=[];
 for(let i=0;i<=steps;i++){
  const x=a[0]+dx*i/steps,z=a[1]+dz*i/steps,top=support(x,z)+height;
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[x+(ux*u+nx*v)*.055,z+(uz*u+nz*v)*.055]);
  const low=corners.map(([x,z])=>[x,support(x,z)-BARRIER_EMBED,z]),high=corners.map(([x,z])=>[x,top,z]);
  prism(low,high);rows.push({x,z,top});
 }
 for(let i=1;i<rows.length;i++){
  const a=rows[i-1],b=rows[i],high=[[a.x-nx*.045,a.top,a.z-nz*.045],[b.x-nx*.045,b.top,b.z-nz*.045],[b.x+nx*.045,b.top,b.z+nz*.045],[a.x+nx*.045,a.top,a.z+nz*.045]];
  prism(high.map(v=>[v[0],v[1]-.09,v[2]]),high);
 }
 return out;
}
