import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {setUniformColor} from './geo';
import type {Ring} from './MapData';
import type {BarrierBox} from './GroundedBarrier';
/** Open transport shelter: no facade or solid building-sized collision box. */
export function streetPlatform(b:Ring,ox:number,oz:number,height:(x:number,z:number)=>number){
 // Non-rectangular roofs follow the source footprint instead of filling their bounding box.
 if(b.structureKind!=='platform'){
  const parts:THREE.BufferGeometry[]=[],walls:BarrierBox[]=[],p=b.p,base=Math.max(...p.filter((_,i)=>i%2===0).map((_,i)=>height(p[i*2],p[i*2+1]))),top=base+Math.max(b.h??3,b.groundClearance??0);
  const shape=new THREE.Shape();shape.moveTo(p[0]-ox,-(p[1]-oz));for(let i=2;i<p.length;i+=2)shape.lineTo(p[i]-ox,-(p[i+1]-oz));shape.closePath();
  for(const ring of b.holes??[]){const hole=new THREE.Path();hole.moveTo(ring[0]-ox,-(ring[1]-oz));for(let i=2;i<ring.length;i+=2)hole.lineTo(ring[i]-ox,-(ring[i+1]-oz));hole.closePath();shape.holes.push(hole);}
  const roof=new THREE.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:false});roof.rotateX(-Math.PI/2);roof.translate(0,top,0);roof.deleteAttribute('uv');setUniformColor(roof,new THREE.Color('#657779'));if(b.roofed!==false)parts.push(roof);else roof.dispose();
  const seen=new Set<string>(),sites:number[]=[];
  if(b.supportPoints)sites.push(...b.supportPoints);
  else for(let i=0;i<p.length;i+=2){const j=(i+2)%p.length,steps=Math.max(1,Math.ceil(Math.hypot(p[j]-p[i],p[j+1]-p[i+1])/6));for(let k=0;k<steps;k++)sites.push(p[i]+(p[j]-p[i])*k/steps,p[i+1]+(p[j+1]-p[i+1])*k/steps);}
  for(let i=0;i<sites.length;i+=2){const x=sites[i],z=sites[i+1],key=x.toFixed(2)+','+z.toFixed(2);if(seen.has(key))continue;seen.add(key);const y=height(x,z),box=new THREE.BoxGeometry(.16,Math.max(.1,top-y),.16),g=box.toNonIndexed();box.dispose();g.translate(x-ox,(y+top)/2,z-oz);g.deleteAttribute('uv');setUniformColor(g,new THREE.Color('#556267'));parts.push(g);walls.push({x0:x-ox-.1,x1:x-ox+.1,z0:z-oz-.1,z1:z-oz+.1,top});}
  if(!parts.length)return {geometry:new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([],3)).setAttribute('color',new THREE.Float32BufferAttribute([],3)).setAttribute('normal',new THREE.Float32BufferAttribute([],3)),walls,center:[p[0],p[1]]};
  const geometry=mergeGeometries(parts,false)!;parts.forEach(g=>g.dispose());return {geometry,walls,center:[p[0],p[1]]};
 }
 const p=b.p;let ux=1,uz=0,longest=0;
 for(let i=0;i<p.length;i+=2){const j=(i+2)%p.length,dx=p[j]-p[i],dz=p[j+1]-p[i+1],l=Math.hypot(dx,dz);if(l>longest){longest=l;ux=dx/l;uz=dz/l;}}
 const x=p[0],z=p[1],u:number[]=[],v:number[]=[];
 for(let i=0;i<p.length;i+=2){u.push((p[i]-x)*ux+(p[i+1]-z)*uz);v.push(-(p[i]-x)*uz+(p[i+1]-z)*ux);}
 const lo=Math.min(...u),hi=Math.max(...u),vl=Math.min(...v),vh=Math.max(...v);
 const at=(a:number,b:number)=>[x+a*ux-b*uz,z+a*uz+b*ux];
 const center=at((lo+hi)/2,(vl+vh)/2),base=Math.max(...p.filter((_,i)=>i%2===0).map((_,i)=>height(p[i*2],p[i*2+1])));
 const parts:THREE.BufferGeometry[]=[],walls:BarrierBox[]=[];
 const box=(a:number,b:number,w:number,d:number,h:number,y:number,color:string)=>{const c=at(a,b),box=new THREE.BoxGeometry(w,h,d),g=box.toNonIndexed();box.dispose();g.rotateY(-Math.atan2(uz,ux));g.translate(c[0]-ox,y,c[1]-oz);g.deleteAttribute('uv');setUniformColor(g,new THREE.Color(color));parts.push(g);return c;};
 // A low platform remains traversable; only the support posts are solid obstacles.
 const slab=new THREE.Shape();slab.moveTo(p[0]-ox,-(p[1]-oz));for(let i=2;i<p.length;i+=2)slab.lineTo(p[i]-ox,-(p[i+1]-oz));slab.closePath();
 for(const ring of b.holes??[]){const hole=new THREE.Path();hole.moveTo(ring[0]-ox,-(ring[1]-oz));for(let i=2;i<ring.length;i+=2)hole.lineTo(ring[i]-ox,-(ring[i+1]-oz));hole.closePath();slab.holes.push(hole);}
 const low=new THREE.ExtrudeGeometry(slab,{depth:.18,bevelEnabled:false});low.rotateX(-Math.PI/2);low.translate(0,base,0);low.deleteAttribute('uv');setUniformColor(low,new THREE.Color('#b1afa5'));parts.push(low);
 if(b.roofed){
  const top=base+(b.h??3);
  const roof=new THREE.ExtrudeGeometry(slab,{depth:.18,bevelEnabled:false});roof.rotateX(-Math.PI/2);roof.translate(0,top-.09,0);roof.deleteAttribute('uv');setUniformColor(roof,new THREE.Color('#657779'));parts.push(roof);
  const count=Math.max(1,Math.ceil((hi-lo)/5));
  const support:number[][]=[];
  if(b.supportPoints){for(let i=0;i<b.supportPoints.length;i+=2){const dx=b.supportPoints[i]-x,dz=b.supportPoints[i+1]-z;support.push([dx*ux+dz*uz,-dx*uz+dz*ux]);}}
  else for(let i=0;i<=count;i++)for(const side of [vl+.2,vh-.2])support.push([lo+.3+(hi-lo-.6)*i/count,side]);
  for(const [a,side] of support){
   const c=at(a,side),bottom=height(...c as [number,number]);
   box(a,side,.13,.13,top-bottom,(top+bottom)/2,'#556267');walls.push({x0:c[0]-ox-.1,x1:c[0]-ox+.1,z0:c[1]-oz-.1,z1:c[1]-oz+.1,top});
  }
 }
 const geometry=mergeGeometries(parts,false)!;parts.forEach(g=>g.dispose());return {geometry,walls,center};
}
