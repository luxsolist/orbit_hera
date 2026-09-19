import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {setUniformColor} from '../geo';
import type {Ring} from '../MapData';
/** Meter-based, source-footprint models. Small mouldings are photo-proportioned, not surveyed. */
export function romeArchitectureGeometry(b:Ring,ox:number,oz:number,base:number,groundBase=base):THREE.BufferGeometry|null{
 const d=b.seoulArchitecture;if(!d?.kind.startsWith('rome-'))return null;
 const p=d.modelFootprint??b.p,xs=p.filter((_,i)=>i%2===0),zs=p.filter((_,i)=>i%2===1);
 const x=(Math.min(...xs)+Math.max(...xs))/2,z=(Math.min(...zs)+Math.max(...zs))/2,W=Math.max(...xs)-Math.min(...xs),D=Math.max(...zs)-Math.min(...zs),H=d.h??20;
 const parts:THREE.BufferGeometry[]=[],stone='#d4c4aa',light='#e6dcc7',brick='#a9836c',roof='#a8755c';
 const add=(g:THREE.BufferGeometry,color=stone)=>{const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute('uv');setUniformColor(v,new THREE.Color(color));parts.push(v);};
 const box=(w:number,h:number,depth:number,px=0,y=0,pz=0,color=stone)=>{const g=new THREE.BoxGeometry(w,h,depth);g.translate(px,y+h/2,pz);add(g,color);};
 const cylinder=(r:number,h:number,px=0,y=0,pz=0,color=stone,rt=r)=>{const g=new THREE.CylinderGeometry(rt,r,h,40);g.translate(px,y+h/2,pz);add(g,color);};
 const dome=(r:number,h:number,px:number,y:number,pz:number,color=roof,oculus=0)=>{const start=oculus?Math.asin(oculus/r):0,g=new THREE.SphereGeometry(r,40,16,0,Math.PI*2,start,Math.PI/2-start);g.scale(1,h/r,1);g.translate(px,y,pz);add(g,color);};
 const arch=(w:number,h:number,depth:number,r:number,spring:number)=>{
  const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,h);s.lineTo(-w/2,h);s.closePath();
  const hole=new THREE.Path();hole.moveTo(-r,0);hole.lineTo(-r,spring);hole.absarc(0,spring,r,Math.PI,0,true);hole.lineTo(r,0);hole.closePath();s.holes.push(hole);
  const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:8});g.translate(0,0,-depth/2);return g;
 };
 const shell=(rx:number,rz:number,thickness:number,y:number,h:number,color=stone)=>{
  const shape=new THREE.Shape(),hole=new THREE.Path();shape.absellipse(0,0,rx,rz,0,Math.PI*2,false,0);hole.absellipse(0,0,rx-thickness,rz-thickness,0,Math.PI*2,true,0);shape.holes.push(hole);
  const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,curveSegments:40});g.rotateX(-Math.PI/2);g.translate(0,y,0);add(g,color);
 };
 const footprint=(h:number,color=stone,y=0)=>{
  const shape=new THREE.Shape();const trace=(s:THREE.Path,q:number[])=>{s.moveTo(q[0]-x,-q[1]+z);for(let i=2;i<q.length;i+=2)s.lineTo(q[i]-x,-q[i+1]+z);s.closePath();};trace(shape,p);
  for(const q of d.holes??[]){const hole=new THREE.Path();trace(hole,q);shape.holes.push(hole);}
  const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,y,0);add(g,color);
 };
 const pediment=(w:number,depth:number,y:number,pz:number)=>{const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(0,w*.16);s.closePath();const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false});g.translate(0,y,pz-depth/2);add(g,light);};
 const column=(px:number,pz:number,y:number,h:number,r=.65)=>{cylinder(r*1.35,.5,px,y,pz,light);cylinder(r,h-1,px,y+.5,pz);cylinder(r*1.4,.5,px,y+h-.5,pz,light);};
 if(base>groundBase&&base-groundBase<12)footprint(base-groundBase,stone,groundBase-base);
 switch(d.kind){
 case 'rome-colosseum':{
  // The surviving outer north wall is tall; never reconstruct a complete ancient upper ring.
  const rx=94,rz=78,segments=80;
  for(let level=0;level<3;level++)for(let i=0;i<segments;i++){
   const a=(i+.5)*Math.PI*2/segments,px=Math.cos(a)*rx,pz=Math.sin(a)*rz;
   if(level>0&&pz>15)continue;
   const tangent=Math.atan2(rz*Math.cos(a),-rx*Math.sin(a)),width=Math.hypot(rx*Math.sin(a),rz*Math.cos(a))*Math.PI*2/segments;
   const g=arch(width+.15,12.8,3.3,width*.31,6.5);g.rotateY(-tangent);g.translate(px,level*12.8,pz);add(g,level%2?light:stone);
   const cornice=new THREE.BoxGeometry(width+.2,.65,4.2);cornice.rotateY(-tangent);cornice.translate(px,(level+1)*12.8,pz);add(cornice,light);
   if(level===2){const attic=new THREE.BoxGeometry(width+.1,10.1,3.5);attic.rotateY(-tangent);attic.translate(px,43.45,pz);add(attic,stone);}
  }
  for(const [rx,rz,levels] of [[80,64,2],[68,51,1]])for(let level=0;level<levels;level++)for(let i=0;i<80;i++){
   const a=(i+.5)*Math.PI/40,px=Math.cos(a)*rx,pz=Math.sin(a)*rz,tangent=Math.atan2(rz*Math.cos(a),-rx*Math.sin(a)),w=Math.hypot(rx*Math.sin(a),rz*Math.cos(a))*Math.PI/40;
   const g=arch(w+.1,10,2.5,w*.29,5.7);g.rotateY(-tangent);g.translate(px,level*10,pz);add(g,brick);
  }
  for(let i=0;i<8;i++)shell(47+i*2.5,28+i*2.5,2.5,1+i*1.3,1.3,stone);
  // Exposed hypogeum walls within the open arena.
  for(let q=-30;q<=30;q+=10)box(1.3,2.5,36,q,0,0,brick);
  for(const q of [-12,0,12])box(74,2.5,1.2,0,0,q,brick);
  break;
 }
 case 'rome-pantheon':{
  const r=27.7,cz=D/2-r;cylinder(r,21.65,0,0,cz,brick);dome(r,21.65,0,21.65,cz,'#b9b0a0',4.45);
  for(const y of [7,14,21]){const g=new THREE.TorusGeometry(r+.1,.35,6,48);g.rotateX(Math.PI/2);g.translate(0,y,cz);add(g,stone);}
  const front=-D/2+3;box(34,1.2,17,0,0,front+6,light);
  for(let row=0;row<3;row++)for(let col=0;col<8;col++){if(row>0&&col>1&&col<6)continue;column((col-3.5)*4.2,front+row*5,1.2,13.5,.78);}
  box(35,2,17,0,14.7,front+6,light);pediment(35,17,16.7,front+6);break;
 }
 case 'rome-st-peter':{
  footprint(43,light);box(W*.75,8,D*.33,0,43,0,stone);
  const dx=-W*.22,r=23.6;cylinder(r,21,dx,51,0,stone);dome(r,45,dx,72,0,'#a7aa9f');
  for(let i=0;i<16;i++){const a=i*Math.PI/8;column(dx+Math.cos(a)*r,Math.sin(a)*r,53,19,.65);}
  cylinder(5,12,dx,117,0,light);dome(5,3,dx,129,0,'#929a95');box(.7,4,.7,dx,132,0,light);box(3,.5,.6,dx,134,0,light);
  // East-facing facade columns; dome height belongs to dome only, not the entire footprint.
  for(let i=0;i<14;i++)column(W/2-.5,-D*.43+i*D*.86/13,3,29,.85);
  box(5,4,D*.94,W/2,34,0,light);break;
 }
 case 'rome-castle':{
  footprint(8,brick);const r=Math.min(W,D)*.38;cylinder(r,23,0,8,0,'#b5a08a');cylinder(r+1.5,2,0,31,0,light);cylinder(r*.64,8,0,33,0,brick);
  for(let i=0;i<48;i++){const a=i*Math.PI/24;box(1.3,1.8,1.3,Math.cos(a)*r,33,Math.sin(a)*r,light);}
  box(15,4,15,0,41,0,stone);column(0,0,45,2,.4);dome(.8,1,0,47,0,'#698b81');break;
 }
 case 'rome-arch-one':case 'rome-arch-three':{
  // Rotate the facade onto the source footprint's longest edge.
  let len=0,angle=0;for(let i=0;i<p.length;i+=2){const j=(i+2)%p.length,dx=p[j]-p[i],dz=p[j+1]-p[i+1];if(Math.hypot(dx,dz)>len){len=Math.hypot(dx,dz);angle=Math.atan2(dz,dx);}}
  const width=d.kind==='rome-arch-three'?25.7:13.5,depth=d.kind==='rome-arch-three'?7.4:4.75,three=d.kind==='rome-arch-three';
  const pieces=three?[[-8.7,8.3,2,5],[0,9.1,3.25,8], [8.7,8.3,2,5]]:[[0,width,2.65,5]];
  for(const [cx,w,r,spring] of pieces){const g=arch(w,H*.77,depth,r,spring);g.translate(cx,0,0);g.rotateY(-angle);add(g,stone);}
  const g=new THREE.BoxGeometry(width,H*.23,depth+.3);g.translate(0,H*.885,0);g.rotateY(-angle);add(g,light);break;
 }
 case 'rome-trevi':{
  // Source footprint is the fountain, not the whole Palazzo Poli block.
  const back=-D/2+17;footprint(.65,'#80aaa7');box(W,.9,2,0,0,D/2,light);box(W,H,3,0,0,back,light);
  for(let i=0;i<6;i++)column((i-2.5)*W/7,back+2,2,H*.74,.7);
  const niche=arch(W*.30,H*.72,1,W*.10,H*.36);niche.translate(0,0,back+2);add(niche,stone);
  for(let i=0;i<9;i++){const g=new THREE.IcosahedronGeometry(2+(i%3)*.5,1);g.scale(1,1.3,1);g.translate((i-4)*W/11,4,-D*.15+Math.sin(i)*2);add(g,light);}
  column(0,-D*.2,3,5,1);box(W*1.04,1.4,4,0,H-1.4,back,stone);break;
 }
 case 'rome-basilica':case 'rome-chapel':case 'rome-courtyard':{
  footprint(H*.8,light);footprint(H*.04,stone,H*.8);
  // Preserve source courtyard voids in every layer.
  const start=parts.length;footprint(H*.16,roof,H*.84);
  for(let j=start;j<parts.length;j++){const g=parts[j],a=g.getAttribute('position');for(let i=0;i<a.count;i++)if(a.getY(i)>H*.85){const across=W>D?a.getZ(i)/(D/2):a.getX(i)/(W/2);a.setY(i,H*.84+H*.16*(1-Math.min(1,Math.abs(across))));}a.needsUpdate=true;g.computeVertexNormals();}
  if(d.id==='way/131564482'){
   const tx=W*.27,tz=D*.28;box(7,53,7,tx,0,tz,brick);
   for(let level=0;level<4;level++){const g=arch(7,4.5,6,1.5,1.2);g.translate(tx,53+level*4.5,tz);add(g,brick);box(7.6,.6,7.6,tx,53+level*4.5,tz,light);}
   const g=new THREE.ConeGeometry(4.7,4,4);g.rotateY(Math.PI/4);g.translate(tx,73,tz);add(g,roof);
  }
  for(let i=0;i<p.length;i+=2){const j=(i+2)%p.length,dx=p[j]-p[i],dz=p[j+1]-p[i+1],n=Math.floor(Math.hypot(dx,dz)/6);
   for(let q=1;q<n;q++)column(p[i]-x+dx*q/n,p[i+1]-z+dz*q/n,1,H*.7,.3);
  }break;
 }
 default:return null;
 }
 if(!parts.length)return null;const g=mergeGeometries(parts,false)!;parts.forEach(p=>p.dispose());g.translate(x-ox,base,z-oz);return g;
}

/** Site structures retain bank/landing levels; no terrain-radius flattening or neighbor extrusion. */
export function romeSiteGeometry(site:import('./SeoulDetail').DetailBuilding,ox:number,oz:number,height:(x:number,z:number)=>number):THREE.BufferGeometry|null{
 const p=site.p,parts:THREE.BufferGeometry[]=[];
 const add=(g:THREE.BufferGeometry,color='#d4c7ae')=>{const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute('uv');setUniformColor(v,new THREE.Color(color));parts.push(v);};
 const box=(w:number,h:number,d:number,x:number,y:number,z:number,a:number,color?:string)=>{const g=new THREE.BoxGeometry(w,h,d);g.rotateY(-a);g.translate(x-ox,y,z-oz);add(g,color);};
 if(site.kind==='rome-mask'){
  const [x,z]=p,y=height(x,z)+1.5;const face=new THREE.CylinderGeometry(.9,.9,.18,32);face.rotateZ(Math.PI/2);face.translate(x-ox,y,z-oz);add(face,'#dbd4c2');
  for(const [dy,dz,r] of [[.22,-.27,.10],[.22,.27,.10],[-.30,0,.18]]){const hole=new THREE.CircleGeometry(r,12);hole.rotateY(-Math.PI/2);hole.translate(x-ox-.10,y+dy,z-oz+dz);add(hole,'#59584f');}
 }else if(site.kind==='rome-steps'){
  // Follow each mapped stair flight, sharing terrain-sampled landings at segment joins.
  for(let i=2;i<p.length;i+=2){const ax=p[i-2],az=p[i-1],bx=p[i],bz=p[i+1],length=Math.hypot(bx-ax,bz-az),angle=Math.atan2(bz-az,bx-ax),a=height(ax,az),b=height(bx,bz),n=Math.max(1,Math.ceil(length/.45));
   for(let j=0;j<n;j++){const t=(j+.5)/n,y=a+(b-a)*t;box(length/n+.04,.22,10,ax+(bx-ax)*t,y+.11,az+(bz-az)*t,angle);}
  }
 }else if(site.kind==='rome-stone-bridge'){
  // Principal axis from the source polygon's furthest pair, then bank-to-bank deck interpolation.
  let dist=0,a=0,b=2;for(let i=0;i<p.length;i+=2)for(let j=i+2;j<p.length;j+=2){const d=Math.hypot(p[i]-p[j],p[i+1]-p[j+1]);if(d>dist){dist=d;a=i;b=j;}}
  const angle=Math.atan2(p[b+1]-p[a+1],p[b]-p[a]),c=Math.cos(angle),s=Math.sin(angle);
  const along:number[]=[],across:number[]=[];for(let i=0;i<p.length;i+=2){along.push(p[i]*c+p[i+1]*s);across.push(-p[i]*s+p[i+1]*c);}
  const lo=Math.min(...along),hi=Math.max(...along),v=(Math.min(...across)+Math.max(...across))/2,width=Math.min(12,Math.max(...across)-Math.min(...across));
  const pos=(u:number,q=0)=>[(lo+(hi-lo)*u)*c-(v+q)*s,(lo+(hi-lo)*u)*s+(v+q)*c];
  const pa=pos(0),pb=pos(1),ya=height(...pa as [number,number]),yb=height(...pb as [number,number]);
  for(let i=0;i<50;i++){
   const u=(i+.5)/50,[x,z]=pos(u),y=ya+(yb-ya)*u;box((hi-lo)/50+.04,.5,width,x,y-.2,z,angle,'#bfb5a3');
   for(const sign of [-1,1]){const [rx,rz]=pos(u,sign*width/2);box((hi-lo)/50+.04,.9,.45,rx,y+.45,rz,angle);}
  }
  // Five stone arches; top surface shares exactly the road's sampled endpoints.
  for(let i=0;i<5;i++){
   const u=(i+.5)/5,[x,z]=pos(u),y=ya+(yb-ya)*u,span=(hi-lo)/5,r=span*.37;
   const curve=new THREE.Shape();curve.moveTo(-span/2,0);curve.lineTo(span/2,0);curve.lineTo(span/2,9);curve.lineTo(-span/2,9);curve.closePath();
   const hole=new THREE.Path();hole.moveTo(-r,0);hole.lineTo(-r,1);hole.absellipse(0,1,r,6,Math.PI,0,true,0);hole.lineTo(r,0);hole.closePath();curve.holes.push(hole);
   const g=new THREE.ExtrudeGeometry(curve,{depth:width-.5,bevelEnabled:false,curveSegments:10});g.translate(0,-9,-(width-.5)/2);g.rotateY(-angle);g.translate(x-ox,y-.5,z-oz);add(g);
   for(const sign of [-1,1]){const [sx,sz]=pos(u,sign*width/2);box(.9,1.2,.9,sx,y+1.2,sz,angle);const statue=new THREE.CylinderGeometry(.25,.45,1.8,8);statue.translate(sx-ox,y+2.5,sz-oz);add(statue,'#e0d8c6');}
  }
 }else return null;
 if(!parts.length)return null;const g=mergeGeometries(parts,false)!;parts.forEach(p=>p.dispose());return g;
}
