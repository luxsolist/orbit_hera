import * as THREE from 'three';
import {subtractSurface} from './SurfacePartition';
import type {Ring} from './MapData';
type Point=[number,number];
type Obstacle={ring:Ring;minX:number;maxX:number;minZ:number;maxZ:number;cuts?:Point[][]};
const cache=new WeakMap<readonly Ring[],Map<string,Obstacle[]>>();
/** Partition street surfaces in free space; never overlay patches on top of an obstacle.
 * This is also the conservative fallback for contradictory source centrelines.
 */
export function streetFreeFootprints(poly:Point[],obstacles?:readonly Ring[]):Point[][]{
 if(!obstacles?.length)return [poly];
 let grid=cache.get(obstacles);
 if(!grid){grid=new Map();for(const ring of obstacles){if(ring.p.length<6)continue;
  const xs=ring.p.filter((_,i)=>i%2===0),zs=ring.p.filter((_,i)=>i%2===1),o:Obstacle={ring,minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};
  for(let x=Math.floor(o.minX/64);x<=Math.floor(o.maxX/64);x++)for(let z=Math.floor(o.minZ/64);z<=Math.floor(o.maxZ/64);z++){const key=x+','+z,a=grid.get(key)??[];a.push(o);grid.set(key,a);}
 }cache.set(obstacles,grid);}
 const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),near=new Set<Obstacle>();
 for(let x=Math.floor(minX/64);x<=Math.floor(maxX/64);x++)for(let z=Math.floor(minZ/64);z<=Math.floor(maxZ/64);z++)for(const o of grid.get(x+','+z)??[])if(o.maxX>minX&&o.minX<maxX&&o.maxZ>minZ&&o.minZ<maxZ)near.add(o);
 let pieces= [poly.map(([x,z])=>[x,0,z])];
 for(const o of near){if(!o.cuts){const vec=(p:number[])=>Array.from({length:p.length/2},(_,i)=>new THREE.Vector2(p[i*2],p[i*2+1]));const outer=vec(o.ring.p),holes=(o.ring.holes??[]).map(vec),triangles=THREE.ShapeUtils.triangulateShape(outer,holes),points=[...outer,...holes.flat()];
   o.cuts=triangles.map(t=>{const p=t.map(i=>[points[i].x,points[i].y] as Point);if((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0])<0)p.reverse();return p;});
  }
  for(const cut of o.cuts)pieces=pieces.flatMap(p=>subtractSurface(p,cut));if(!pieces.length)break;
 }
 return pieces.map(p=>p.map(v=>[v[0],v[2]]));
}
/** Buffer linear barriers/water; polygon holes remain traversable islands. */
export function streetObstacleRings(objects:{buildings:Ring[];structures?:Ring[];walls?:Ring[];water?:Ring[]}):Ring[]{
 const polygons=[...objects.buildings,...objects.structures??[]].filter(r=>!r.bridge&&!r.tunnel&&(r.layer??0)===0);
 for(const r of [...(objects.walls??[]).map(r=>({...r,w:r.w??.4})),...objects.water??[]]){
  if(r.bridge||r.tunnel||(r.layer??0)!==0)continue;
  if(r.w==null){polygons.push(r);continue;}
  for(let i=2;i<r.p.length;i+=2){const [ax,az,bx,bz]=r.p.slice(i-2,i+2),len=Math.hypot(bx-ax,bz-az);if(len<.01)continue;const nx=-(bz-az)/len*r.w/2,nz=(bx-ax)/len*r.w/2;
   polygons.push({p:[ax+nx,az+nz,bx+nx,bz+nz,bx-nx,bz-nz,ax-nx,az-nz]});
  }
 }
 return polygons;
}
