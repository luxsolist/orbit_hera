import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {setUniformColor} from '../geo';
import type {Ring} from '../MapData';
import type {DetailBuilding} from './SeoulDetail';
/** Source-aligned contemporary silhouettes, not a reconstruction of intact ancient buildings. */
export function athensArchitectureGeometry(b:Ring,ox:number,oz:number,base:number):THREE.BufferGeometry|null {
 const d=b.seoulArchitecture;if(!d?.kind.startsWith('athens-'))return null;
 const p=d.modelFootprint??b.p;let angle=0,longest=0;
 for(let i=0;i<p.length;i+=2){const j=(i+2)%p.length,dx=p[j]-p[i],dz=p[j+1]-p[i+1],len=Math.hypot(dx,dz);if(len>longest){longest=len;angle=Math.atan2(dz,dx);}}
 if(angle>=Math.PI/2)angle-=Math.PI;if(angle< -Math.PI/2)angle+=Math.PI;
 const c=Math.cos(angle),s=Math.sin(angle),us:number[]=[],vs:number[]=[];
 for(let i=0;i<p.length;i+=2){us.push(p[i]*c+p[i+1]*s);vs.push(-p[i]*s+p[i+1]*c);}
 const u=(Math.min(...us)+Math.max(...us))/2,v=(Math.min(...vs)+Math.max(...vs))/2;
 const x=u*c-v*s,z=u*s+v*c,W=Math.max(...us)-Math.min(...us),D=Math.max(...vs)-Math.min(...vs),H=d.h??12;
 const parts:THREE.BufferGeometry[]=[],stone='#d1c6af',marble='#e5ddca',shade='#b7ab94';
 const add=(g:THREE.BufferGeometry,color=stone)=>{const a=g.index?g.toNonIndexed():g;if(a!==g)g.dispose();a.deleteAttribute('uv');setUniformColor(a,new THREE.Color(color));parts.push(a);};
 const box=(w:number,h:number,depth:number,px=0,y=0,pz=0,color=stone)=>{const g=new THREE.BoxGeometry(w,h,depth);g.translate(px,y+h/2,pz);add(g,color);};
 const cylinder=(r:number,h:number,px:number,y:number,pz:number,color=marble,rt=r*.83)=>{const g=new THREE.CylinderGeometry(rt,r,h,20);g.translate(px,y+h/2,pz);add(g,color);};
 const column=(px:number,pz:number,h:number,y=1,r=.75)=>{
  // Faceted shaft and collars suggest fluting/drum joints without separate meshes.
  cylinder(r,h,px,y,pz);cylinder(r*1.28,.35,px,y+h-.35,pz,marble,r*1.28);
  box(r*2.7,.3,r*2.7,px,y+h,pz,marble);
  for(let i=1;i<6;i++)cylinder(r*(1-.17*i/6)+.018,.045,px,y+h*i/6,pz,shade,r*(1-.17*i/6)+.018);
 };
 const footprint=(h:number,y=0,color=stone)=>{
  const shape=new THREE.Shape();const trace=(q:number[],path:THREE.Path)=>{q.forEach((_,i)=>{if(i%2)return;const px=q[i]*c+q[i+1]*s-u,pz=-q[i]*s+q[i+1]*c-v;if(i===0)path.moveTo(px,-pz);else path.lineTo(px,-pz);});path.closePath();};trace(p,shape);
  for(const q of d.holes){const hole=new THREE.Path();trace(q,hole);shape.holes.push(hole);}
  const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,y,0);add(g,color);
 };
 const pediment=(w:number,y:number,depth:number,px:number,pz:number)=>{const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(0,w*.15);shape.closePath();const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false});g.translate(px,y,pz-depth/2);add(g,marble);};
 const arch=(w:number,h:number,depth:number,r:number,spring:number,px:number,y:number,pz:number)=>{
  const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(w/2,h);shape.lineTo(-w/2,h);shape.closePath();const hole=new THREE.Path();hole.moveTo(-r,0);hole.lineTo(-r,spring);hole.absarc(0,spring,r,Math.PI,0,true);hole.lineTo(r,0);hole.closePath();shape.holes.push(hole);const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:10});g.translate(px,y,pz-depth/2);add(g);
 };
 const kind=d.kind.slice(7);
 if(kind==='parthenon'){
  for(let i=0;i<3;i++)box(W-i*.75,.35,D-i*.75,0,i*.35,0,marble);
  const a=W/2-1.8,q=D/2-1.8;
  for(let i=0;i<17;i++)for(const sign of [-1,1])column(-a+2*a*i/16,sign*q,10.4,1.05,.95);
  for(let i=1;i<7;i++)for(const sign of [-1,1])column(sign*a,-q+2*q*i/7,10.4,1.05,.95);
  for(const sign of [-1,1]){box(W-2,1.7,2.2,0,11.75,sign*q,marble);box(2.2,1.7,D-2,sign*a,11.75,0,marble);}
  // Open roof and broken cella walls: never cap the whole monument with a solid roof.
  for(const sign of [-1,1]){box(W*.24,7.2,1.2,-W*.28,1.05,sign*D*.25);box(W*.20,4.2,1.2,W*.29,1.05,sign*D*.25);}
  for(let i=0;i<10;i++)box(1.4,.4+(i%3)*.25,.9,(i-4.5)*3,1.05,Math.sin(i*5)*D*.18,shade);
  // Surviving ends retain only the lower triangular fragments.
  for(const sign of [-1,1])box(1.7,1.0,D*.62,sign*a,13.45,0,marble);
 }else if(kind==='erechtheion'){
  footprint(.9,0,marble);box(W*.62,6.8,1,0,.9,-D*.2);box(1,6.8,D*.48,-W*.30,.9,0);
  for(let i=0;i<6;i++)column(W*.30,-D*.23+i*D*.46/5,6.5,.9,.43);
  box(1.7,1,D*.60,W*.30,7.7,0,marble);
  // Six schematic Caryatids on the south porch; sculpture is explicitly approximate.
  const front=D*.38;box(W*.34,1.4,D*.25,-W*.10,.9,front,marble);
  for(let i=0;i<6;i++){const px=-W*.23+(i<4?i:(i-4)*3)*W*.087,pz=i<4?front+D*.09:front-D*.08; cylinder(.24,1.45,px,2.3,pz,marble,.30);cylinder(.30,.55,px,3.75,pz,marble,.18);const g=new THREE.SphereGeometry(.22,10,8);g.translate(px,4.53,pz);add(g,marble);box(.62,.22,.62,px,4.75,pz,marble);}
  box(W*.36,.65,D*.27,-W*.10,5,front,marble);
  for(let i=0;i<4;i++)column(-W*.20+i*W*.14,-D*.40,7.2,.9,.45);
  box(W*.63,.9,D*.22,0,8.4,-D*.38,marble);
 }else if(kind==='stoa'){
  footprint(.6,0,marble);box(W,H-2,D*.43,0,.6,-D*.23,'#cdb696');
  for(let level=0;level<2;level++){
   for(let i=0;i<45;i++)column(-W*.48+i*W*.96/44,D*.37,H*.40,.6+level*H*.46,.30);
   box(W,.55,D*.95,0,.6+(level+1)*H*.46,0,marble);
  }
  // Low pitched terracotta roof.
  const section=new THREE.Shape();section.moveTo(-D/2,0);section.lineTo(D/2,0);section.lineTo(0,1);section.closePath();
  const roof=new THREE.ExtrudeGeometry(section,{depth:W,bevelEnabled:false});roof.rotateY(Math.PI/2);roof.translate(-W/2,H-1,0);add(roof,'#aa7960');
 }else if(kind==='hadrian'){
  const w=Math.min(W,13.5);arch(w,10,Math.min(D,2.3),3.25,5.5,0,0,0);box(w+.4,.7,2.5,0,10,0,marble);
  for(const px of [-w*.45,-w*.22,w*.22,w*.45])column(px,0,5,10.7,.35);
  box(w,.5,1,0,16,0,marble);pediment(w*.48,16.5,1,0,0);
 }else if(kind==='zeus'){
  footprint(.35,0,shade);
  // Surviving southeast cluster plus two isolated columns; no reconstructed roof.
  const dx=W*.065,dz=D*.19;
  for(let row=0;row<3;row++)for(let i=0;i<(row===0?5:4);i++)column(W*.22+i*dx,-D*.33+row*dz,15.7,.35,1.05);
  for(const px of [-W*.39,-W*.29])column(px,D*.24,15.7,.35,1.05);
  for(let i=0;i<9;i++){const g=new THREE.CylinderGeometry(1,1,1.45,16);g.rotateZ(Math.PI/2);g.translate(-W*.12+i*1.4,1.1,D*.24);add(g,marble);}
 }else if(kind==='dionysus'||kind==='odeon'){
  const r=W*.48,inner=r*.30,rows=kind==='odeon'?30:24;
  for(let j=0;j<rows;j++){
   const rin=inner+(r-inner)*j/rows,rout=inner+(r-inner)*(j+1)/rows;
   // Open semicircular bowl; north-facing cavea, south-facing stage.
   const shape=new THREE.Shape();shape.absarc(0,0,rout,0,Math.PI,false);shape.absarc(0,0,rin,Math.PI,0,true);shape.closePath();const g=new THREE.ExtrudeGeometry(shape,{depth:.35+j*(kind==='odeon'?.45:.30),bevelEnabled:false,curveSegments:40});g.rotateX(-Math.PI/2);g.translate(0,0,D*.20);add(g,j%4===0?shade:marble);
  }
  box(W*.67,.4,D*.23,0,0,D*.28,shade);
  if(kind==='odeon')for(let level=0;level<3;level++)for(let i=0;i<9;i++)arch(W*.091,8.5,2,W*.025,4,(i-4)*W*.091,level*8.5,D*.40);
  else for(let i=0;i<8;i++)box(W*.085,.7,D*.11,(i-3.5)*W*.09,0,D*.42,stone);
 }else if(kind==='stadium'){
  // Stadium local long axis is X; open northwest end, horseshoe southeast end.
  const r=D*.22,straight=W*.55,end=straight/2,rows=42;
  for(let i=0;i<rows;i++){
   const inner=r+i*.65,outer=inner+.65,y=i*.44;
   for(const sign of [-1,1])box(straight,y+.42,.66,0,0,sign*(inner+.325),marble);
   const shape=new THREE.Shape();shape.absarc(0,0,outer,-Math.PI/2,Math.PI/2,false);shape.absarc(0,0,inner,Math.PI/2,-Math.PI/2,true);shape.closePath();const g=new THREE.ExtrudeGeometry(shape,{depth:y+.42,bevelEnabled:false,curveSegments:40});g.rotateX(-Math.PI/2);g.translate(end,0,0);add(g,marble);
  }
  box(straight+r, .15,r*2, r/2,0,0,'#b39b83');
  for(let i=0;i<8;i++){const line=new THREE.BoxGeometry(straight,.02,.10);line.translate(0,.16,-r+1+i*1.1);add(line,marble);}
 }else if(kind==='national-museum'){
  const portico=Math.min(32,W*.46);
  footprint(H*.64,0,'#c4a888');footprint(.5,H*.64,marble);footprint(.65,H*.64+.5,'#ac7862');
  for(let i=0;i<8;i++)column(-portico*.44+i*portico*.88/7,D*.48,H*.62,.6,.55);
  box(portico,1.1,3,0,H*.64,D*.48,marble);pediment(portico,H*.64+1.1,3,0,D*.48);
  for(let i=0;i<6;i++)box(W*.5+i*.5,.15,4+i*.8,0,i*.15,D*.47,marble);
 }else if(kind==='acropolis-museum'){
  footprint(1,0,'#b8b7ac');footprint(H*.46,2,'#9aaeb0');footprint(.8,H*.46+2,'#d1d0c6');
  // Upper glass gallery, fine concrete mullions, flat overhanging roof.
  box(W*.78,H*.34,D*.70,0,H*.55,0,'#829ca4');box(W*.81,.65,D*.74,0,H*.90,0,'#c4c5bc');
  for(let i=0;i<22;i++)for(const sign of [-1,1])box(.18,H*.34,.25,-W*.38+i*W*.76/21,H*.55,sign*D*.35,'#bbc4c3');
  for(let i=0;i<8;i++)column(-W*.4+i*W*.8/7,D*.4,3.2,0,.5);
 }else return null;
 if(!parts.length)return null;const result=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());
 if(result){result.rotateY(-angle);result.translate(x-ox,base,z-oz);}return result;
}
/** Open landmarks are visual sites, not giant solid building collision boxes. */
export function athensSiteGeometry(d:DetailBuilding,ox:number,oz:number,height:(x:number,z:number)=>number){
 const xs=d.p.filter((_,i)=>i%2===0),zs=d.p.filter((_,i)=>i%2===1);
 const x=(Math.min(...xs)+Math.max(...xs))/2,z=(Math.min(...zs)+Math.max(...zs))/2;
 return athensArchitectureGeometry({p:d.p,seoulArchitecture:d},ox,oz,height(x,z)+.1);
}
