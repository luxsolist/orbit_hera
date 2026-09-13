import * as THREE from 'three';
import type {ChunkTerrain} from './chunkMesh';
import type {CityAppearance} from './cities';
type Point=[number,number];
type Road={p:number[];w?:number};
/** Clip a convex footprint against each actual terrain triangle, avoiding bilinear height drift. */
export function terrainFootprint(poly:Point[],t:ChunkTerrain,ox:number,oz:number):number[]{
 const output:number[]=[],n=t.size,step=t.step;
 const minX=Math.max(0,Math.floor((Math.min(...poly.map(p=>p[0]))-t.cellX0)/step));
 const maxX=Math.min(n-2,Math.floor((Math.max(...poly.map(p=>p[0]))-t.cellX0)/step));
 const minZ=Math.max(0,Math.floor((Math.min(...poly.map(p=>p[1]))-t.cellZ0)/step));
 const maxZ=Math.min(n-2,Math.floor((Math.max(...poly.map(p=>p[1]))-t.cellZ0)/step));
 for(let j=minZ;j<=maxZ;j++)for(let i=minX;i<=maxX;i++){
  const x=t.cellX0+i*step,z=t.cellZ0+j*step;
  const a:Point=[x,z],b:Point=[x+step,z],c:Point=[x,z+step],d:Point=[x+step,z+step];
  for(const tri of [[a,b,c],[b,d,c]]){
   let clipped=poly;
   for(let edge=0;edge<3;edge++){
    const u=tri[edge],v=tri[(edge+1)%3];
    const side=(p:Point)=>(v[0]-u[0])*(p[1]-u[1])-(v[1]-u[1])*(p[0]-u[0]);
    const next:Point[]=[];
    for(let k=0;k<clipped.length;k++){
     const p=clipped[k],q=clipped[(k+1)%clipped.length],dp=side(p),dq=side(q);
     if(dp>=0)next.push(p);
     if((dp>=0)!==(dq>=0)){const f=dp/(dp-dq);next.push([p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f]);}
    }
    clipped=next;if(clipped.length<3)break;
   }
   const h=(p:Point)=>{
    const fx=(p[0]-x)/step,fz=(p[1]-z)/step;
    const ha=t.heights[j*n+i],hb=t.heights[j*n+i+1],hc=t.heights[(j+1)*n+i],hd=t.heights[(j+1)*n+i+1];
    return tri[0]===a?ha+(hb-ha)*fx+(hc-ha)*fz:hd+(hc-hd)*(1-fx)+(hb-hd)*(1-fz);
   };
   for(let k=1;k<clipped.length-1;k++){
    const p=clipped[0],q=clipped[k],r=clipped[k+1];
    if(Math.abs((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]))<1e-8)continue;
    // Upward winding: X/Z plane reverses the usual 2D orientation.
    for(const v of [p,r,q])output.push(v[0]-ox,h(v),v[1]-oz);
   }
  }
 }
 return output;
}
function capsule(ax:number,az:number,bx:number,bz:number,r:number):Point[]{
 const angle=Math.atan2(bz-az,bx-ax),points:Point[]=[];
 for(let i=0;i<=8;i++){const a=angle-Math.PI/2+i*Math.PI/8;points.push([bx+Math.cos(a)*r,bz+Math.sin(a)*r]);}
 for(let i=0;i<=8;i++){const a=angle+Math.PI/2+i*Math.PI/8;points.push([ax+Math.cos(a)*r,az+Math.sin(a)*r]);}
 return points;
}
type Segment={ax:number;az:number;bx:number;bz:number;w:number;len:number};
function segmentDistance(x:number,z:number,s:Segment):number {
 const u=Math.max(0,Math.min(1,((x-s.ax)*(s.bx-s.ax)+(z-s.az)*(s.bz-s.az))/(s.len*s.len)));
 return Math.hypot(x-s.ax-u*(s.bx-s.ax),z-s.az-u*(s.bz-s.az));
}
/** Spatial index shared by junction detection and exposed curb selection. */
function streetSegments(roads:Road[]){
 const segments:Segment[]=[],grid=new Map<string,Segment[]>();
 for(const r of roads)for(let k=2;k<r.p.length;k+=2){
  const [ax,az,bx,bz]=r.p.slice(k-2,k+2),len=Math.hypot(bx-ax,bz-az),w=r.w??6;
  if(!Number.isFinite(len)||len<.01||!Number.isFinite(w)||w<=0)continue;
  const seg={ax,az,bx,bz,w,len};segments.push(seg);
  for(let x=Math.floor((Math.min(ax,bx)-w/2-3)/32);x<=Math.floor((Math.max(ax,bx)+w/2+3)/32);x++)for(let z=Math.floor((Math.min(az,bz)-w/2-3)/32);z<=Math.floor((Math.max(az,bz)+w/2+3)/32);z++){
   const key=x+':'+z;let list=grid.get(key);if(!list){list=[];grid.set(key,list);}list.push(seg);
  }
 }
 const nearby=(x:number,z:number)=>grid.get(Math.floor(x/32)+':'+Math.floor(z/32))??[];
 return {segments,nearby};
}
/** Intersection distances measured along one road; ignore nearly parallel continuations. */
export function junctions(s:Segment,others:Segment[]):{distance:number;clearance:number}[]{
 const result:{distance:number;clearance:number}[]=[];
 const dx=s.bx-s.ax,dz=s.bz-s.az;
 for(const q of others){
  if(q===s)continue;
  const ex=q.bx-q.ax,ez=q.bz-q.az,det=dx*ez-dz*ex,sine=Math.abs(det)/(s.len*q.len);
  if(sine<.35)continue;
  const rx=q.ax-s.ax,rz=q.az-s.az,u=(rx*ez-rz*ex)/det,v=(rx*dz-rz*dx)/det;
  if(u<-.001||u>1.001||v<-.001||v>1.001)continue;
  const distance=Math.max(0,Math.min(s.len,u*s.len)),clearance=(q.w/2+1)/sine;
  const old=result.find(p=>Math.abs(p.distance-distance)<1);
  if(old)old.clearance=Math.max(old.clearance,clearance);else result.push({distance,clearance});
 }
 return result.sort((a,b)=>a.distance-b.distance);
}
function raisedFootprint(poly:Point[],t:ChunkTerrain,ox:number,oz:number,height:number):number[]{
 const top=terrainFootprint(poly,t,ox,oz),out:number[]=[];
 const edges=new Map<string,{a:number[];b:number[];count:number}>();
 const key=(p:number[])=>p.map(v=>v.toFixed(5)).join(',');
 for(let i=0;i<top.length;i+=9){
  const points=[top.slice(i,i+3),top.slice(i+3,i+6),top.slice(i+6,i+9)];
  for(const p of points)out.push(p[0],p[1]+height,p[2]);
  for(let e=0;e<3;e++){const a=points[e],b=points[(e+1)%3],k=[key(a),key(b)].sort().join('|'),old=edges.get(k);if(old)old.count++;else edges.set(k,{a,b,count:1});}
 }
 for(const {a,b,count} of edges.values())if(count===1){
  const at=[a[0],a[1]+height,a[2]],bt=[b[0],b[1]+height,b[2]];
  out.push(...a,...b,...bt,...a,...bt,...at);
 }
 return out;
}
function surfaceMaterial(color:string,layer:number,wear=0):THREE.MeshStandardMaterial {
 const material=new THREE.MeshStandardMaterial({color,roughness:layer===3?.97:.9,polygonOffset:true,polygonOffsetFactor:-1-layer,polygonOffsetUnits:-1-layer});
 if(layer===1||layer===3){
  material.onBeforeCompile=shader=>{
   shader.uniforms.roadWear={value:wear};
   shader.vertexShader='attribute vec2 streetCoord; varying vec2 streetUV;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nstreetUV=streetCoord;');
   shader.fragmentShader='uniform float roadWear; varying vec2 streetUV;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    ${layer===1?`
    vec2 tile=streetUV/vec2(.6,.4),edge=abs(fract(tile)-.5),aa=max(fwidth(tile),vec2(.002));
    float fade=1.0-smoothstep(.3,.8,max(aa.x,aa.y));
    float joint=max(smoothstep(.475-aa.x,.475+aa.x,edge.x),smoothstep(.46-aa.y,.46+aa.y,edge.y));
    diffuseColor.rgb*=1.0-joint*.18*fade;
    `:`
    vec2 grainCoord=streetUV*12.0;
    float fade=1.0-smoothstep(.3,1.0,max(fwidth(grainCoord.x),fwidth(grainCoord.y)));
    float grain=fract(sin(dot(floor(grainCoord),vec2(127.1,311.7)))*43758.5453)-.5;
    diffuseColor.rgb*=1.0+grain*.16*fade;
    vec2 patchCell=streetUV/vec2(7.0,4.0),patchEdge=abs(fract(patchCell)-.5);
    float seed=fract(sin(dot(floor(patchCell),vec2(12.9898,78.233)))*43758.5453);
    vec2 patchAA=max(fwidth(patchCell),vec2(.015));
    vec2 repairMask=1.0-smoothstep(vec2(.35)-patchAA,vec2(.35)+patchAA,patchEdge);
    float wearFade=1.0-smoothstep(.2,.6,max(patchAA.x,patchAA.y));
    diffuseColor.rgb*=1.0-roadWear*step(.9,seed)*repairMask.x*repairMask.y*wearFade;

    `}
   `);
  };
  material.customProgramCacheKey=()=> 'street-geometry-'+layer;
 }
 return material;
}
const cache=new WeakMap<CityAppearance['street'],THREE.MeshStandardMaterial[]>();
/** Layered opaque footprints form road unions at intersections, with no curb across the carriageway. */
export function addStreetGeometry(group:THREE.Group,roads:Road[],t:ChunkTerrain,ox:number,oz:number,colors:CityAppearance['street']):void {
 let materials=cache.get(colors);
 if(!materials){materials=[colors.curb,colors.pavement,colors.curb,colors.asphalt,colors.center,colors.marking,colors.curb].map((c,i)=>surfaceMaterial(c,i,colors.wearStrength??0));cache.set(colors,materials);}
 const buffers:number[][]=Array.from({length:7},()=>[]);
 const add=(layer:number,poly:Point[])=>{const data=terrainFootprint(poly,t,ox,oz);for(const value of data)buffers[layer].push(value);};
 const {segments,nearby}=streetSegments(roads);
 for(const segment of segments){
   const {ax,az,bx,bz,len,w}=segment;
   const shape=(width:number)=>capsule(ax,az,bx,bz,width/2);
   if(w>=6&&w<=24){add(0,shape(w+5.2));add(1,shape(w+4.6));}
   add(2,shape(w+.45));add(3,shape(w));
   const candidates=new Set<Segment>();
   for(let d=0;d<=len+16;d+=16){const u=Math.min(d,len)/len;for(const q of nearby(ax+(bx-ax)*u,az+(bz-az)*u))candidates.add(q);}
   const joins=colors.junctionMarkings?junctions(segment,[...candidates]):[];
   const ux=(bx-ax)/len,uz=(bz-az)/len;
   const point=(distance:number,side:number):Point=>[ax+ux*distance-uz*side,az+uz*distance+ux*side];
   const rectangle=(start:number,end:number,left:number,right:number,layer:number)=>add(layer,[point(start,left),point(end,left),point(end,right),point(start,right)]);
   const stripe=(offset:number,start:number,end:number,layer:number)=>{
    let pieces=[[start,end]];
    for(const j of joins){const lo=j.distance-j.clearance-7,hi=j.distance+j.clearance+7;pieces=pieces.flatMap(([a,b])=>b<=lo||a>=hi?[[a,b]]:[[a,Math.min(b,lo)],[Math.max(a,hi),b]].filter(([a,b])=>b>a));}
    for(const [a,b] of pieces)rectangle(a,b,offset-.09,offset+.09,layer);
   };
   if(w>=16){stripe(-.22,0,len,4);stripe(.22,0,len,4);}
   if(w>=22)for(let d=0;d<len;d+=11){stripe(-3.5,d,Math.min(d+4,len),5);stripe(3.5,d,Math.min(d+4,len),5);}
   // Zebra and stop lines on sufficiently long approaches. Placement is inferred, not surveyed.
   if(w>=6&&w<=24)for(const j of joins)for(const sign of [-1,1]){
    const center=j.distance+sign*(j.clearance+3),start=center-1.5,end=center+1.5;
    const stop=center+sign*3;
    if(start<1||end>len-1||stop<1||stop>len-1)continue;
    if(joins.some(q=>q!==j&&Math.abs(q.distance-center)<q.clearance+7))continue;
    for(let lateral=-w/2+.7;lateral+.5<w/2-.5;lateral+=1)rectangle(start,end,lateral,lateral+.5,5);
    // Right-hand traffic: only the incoming half of the road receives a stop line.
    rectangle(stop-.15,stop+.15,sign<0?.2:-w/2+.4,sign<0?w/2-.4:-.2,5);
   }
   const height=colors.curbHeight??0;
   if(height>0&&w>=6&&w<=24){
    const outline=shape(w+.24);
    for(let e=0;e<outline.length;e++){
     const a=outline[e],b=outline[(e+1)%outline.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
     const steps=Math.max(1,Math.ceil(length/1.5)),nx=-(b[1]-a[1])/length*.10,nz=(b[0]-a[0])/length*.10;
     for(let k=0;k<steps;k++){
      const p:Point=[a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps],q:Point=[a[0]+(b[0]-a[0])*(k+1)/steps,a[1]+(b[1]-a[1])*(k+1)/steps];
      const mx=(p[0]+q[0])/2,mz=(p[1]+q[1])/2;
      // Keep the full short section clear of every neighbouring carriageway.
      if(nearby(mx,mz).some(other=>other!==segment&&[p,q,[mx,mz]].some(v=>segmentDistance(v[0],v[1],other)<other.w/2+.25)))continue;
      const data=raisedFootprint([[p[0]-nx,p[1]-nz],[q[0]-nx,q[1]-nz],[q[0]+nx,q[1]+nz],[p[0]+nx,p[1]+nz]],t,ox,oz,height);
      for(const value of data)buffers[6].push(value);
     }
    }
   }
 }
 buffers.forEach((positions,i)=>{
  if(!positions.length)return;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  const coords:number[]=[];for(let k=0;k<positions.length;k+=3)coords.push(positions[k]+ox,positions[k+2]+oz);geometry.setAttribute('streetCoord',new THREE.Float32BufferAttribute(coords,2));
  const mesh=new THREE.Mesh(geometry,materials![i]);mesh.name=['street_outer_edge','street_pavement','street_curb','street_asphalt','street_center_lines','street_lane_lines','street_raised_curbs'][i];mesh.receiveShadow=true;mesh.renderOrder=i+1;group.add(mesh);
 });
}
