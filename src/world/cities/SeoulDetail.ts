import {romeArchitectureGeometry,romeSiteGeometry} from './RomeArchitecture';
import {busanBridgeGeometry,busanBridgeApproachGeometry,type BusanBridge,type BusanBridgeApproach} from './BusanBridges';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {StructureBuilder} from '../StructureBuilder';
import {setUniformColor} from '../geo';
import {palaceSiteBuilding,inPalace} from './PalaceSite';
import type {Ring,Part} from '../MapData';
import type {Cell,WorldChunk} from '../chunkManifest';

export interface DetailBuilding {
 id:string;p:number[];holes:number[][];name:string;h:number|null;kind:string;roof:string;modelFootprint?:number[];
 wallColor?:string;
 heightSource:Ring['heightSource']|null;heightTag?:string|null;levelsTag?:string|null;
}
interface Surface {id:string;p:number[];holes:number[][];kind:string;level?:number;levelSource?:string}
interface Path {id:string;p:number[];width:number;bridge:boolean;tunnel:boolean;surface:string}
export interface SeoulDetail {
 romeSites?:DetailBuilding[];
 bridges?:BusanBridge[];
 bridgeApproaches?:BusanBridgeApproach[];
 roadReplacements?:{p:number[];pieces:number[][]}[];
 buildings:DetailBuilding[];remove?:number[][];areas:Surface[];water:Surface[];paths:Path[];
 walls:{id:string;p:number[];h:number}[];trees:number[][];terrain:number[][];
}
/** Immutable, exact baked-footprint binding. Unknown heights stay unknown; no neighbor-height propagation. */
export function applySeoulDetail(cell:Cell,raw:WorldChunk,detail:SeoulDetail):WorldChunk {
 if(cell[0]!==37||cell[1]!==126)return raw;
 return applyRegionalDetail(raw,detail,true);
}
/** Shared immutable detail binding used by Seoul and Busan. Legacy field names preserve worker compatibility. */
export function applyRegionalDetail(raw:WorldChunk,detail:SeoulDetail,protectPalace=false):WorldChunk {
 if(raw.seoulDetail)return raw;
 if(!['buildings','areas','paths','walls','water','trees','terrain'].every(k=>Array.isArray(detail[k as keyof SeoulDetail])))return raw;
 const byShape=new Map(detail.buildings.map(b=>[JSON.stringify(b.p),b]));
 const removed=new Set((detail.remove??[]).map(p=>JSON.stringify(p)));
 const buildings=raw.objects.buildings.filter(b=>!removed.has(JSON.stringify(b.p))).map(b=>{
  if(b.landmarkModel||b.palaceBuildingId)return b;
  const d=byShape.get(JSON.stringify(b.p));if(!d)return b;
  return {...b,...(d.h!=null?{h:d.h}:{}),osmId:d.id,...(d.heightSource?{heightSource:d.heightSource}:{}),
   ...(d.heightTag?{heightTag:d.heightTag}:{}),...(d.levelsTag?{levelsTag:d.levelsTag}:{}),
   ...(d.wallColor?{landmarkAppearance:{p:b.p,source:'https://www.openstreetmap.org/'+d.id,height:null,levels:null,roofShape:'flat',roofHeight:null,wallColor:d.wallColor,roofColor:null,wallMaterial:null,buildingType:null,status:'photo-palette-estimate'}}:{}),
   ...(d.kind?{seoulArchitecture:d}:{}),...(d.name?{n:d.name}:{})};
 });
 // Replace only source-aligned wall segments, then use the same walls for visual and collision geometry.
 const sourceSegments=detail.walls.flatMap(w=>Array.from({length:w.p.length/2-1},(_,i)=>w.p.slice(i*2,i*2+4)));
 const distance=(x:number,z:number,p:number[])=>{const dx=p[2]-p[0],dz=p[3]-p[1],t=Math.max(0,Math.min(1,((x-p[0])*dx+(z-p[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-p[0]-dx*t,z-p[1]-dz*t);};
 const walls:Ring[]=[];
 for(const wall of raw.objects.walls??[])for(let i=2;i<wall.p.length;i+=2){const p=wall.p.slice(i-2,i+2);
  if(!sourceSegments.some(q=>distance(p[0],p[1],q)<1.5&&distance(p[2],p[3],q)<1.5))walls.push({...wall,p});
 }
 const knownWalls=new Set(walls.map(w=>JSON.stringify(w.p)));
 for(const wall of detail.walls)for(let i=2;i<wall.p.length;i+=2){
  const p=wall.p.slice(i-2,i+2),x=(p[0]+p[2])/2,z=(p[1]+p[3])/2;
  if(Math.floor(x/1024)!==raw.cx||Math.floor(z/1024)!==raw.cz)continue;
  const key=JSON.stringify(p);if(!knownWalls.has(key)){walls.push({p,h:wall.h,w:.55});knownWalls.add(key);}
 }
 const heights=raw.terrain.heights.slice();
 for(const [i,y] of detail.terrain)if(Number.isInteger(i)&&i>=0&&i<heights.length&&Number.isFinite(y)){
  const n=raw.terrain.size,x=raw.cx*1024+(i%n)*1024/(n-1),z=raw.cz*1024+Math.floor(i/n)*1024/(n-1);
  if(!protectPalace||!inPalace(x,z))heights[i]=y;
 }
 const roadReplacements=new Map((detail.roadReplacements??[]).map(r=>[JSON.stringify(r.p),r.pieces]));
 const roads=raw.objects.roads.flatMap(r=>{const pieces=roadReplacements.get(JSON.stringify(r.p));return pieces?pieces.map(p=>({...r,p})):[r];});
 return {...raw,seoulDetail:detail,terrain:{...raw.terrain,heights},objects:{...raw.objects,buildings,walls,roads}};
}
const builder=new StructureBuilder();
function shape(p:number[],holes:number[][],ox:number,oz:number){
 const s=new THREE.Shape();const trace=(o:THREE.Path,q:number[])=>{o.moveTo(q[0]-ox,-q[1]+oz);for(let i=2;i<q.length;i+=2)o.lineTo(q[i]-ox,-q[i+1]+oz);o.closePath();};
 trace(s,p);for(const h of holes){const v=new THREE.Path();trace(v,h);s.holes.push(v);}return s;
}
/** Architectural silhouette, explicitly not a surveyed restoration. Horizontal alignment comes from the source footprint. */
export function seoulArchitectureGeometry(b:Ring,ox:number,oz:number,base:number,groundBase=base):THREE.BufferGeometry|null {
 const d=b.seoulArchitecture;if(!d)return null;
 if(d.kind.startsWith('rome-'))return romeArchitectureGeometry(b,ox,oz,base,groundBase);
 if(d.kind==='source-roof'||d.kind==='shrine'||(d.kind==='korean'&&(b.holes?.length||b.p.length>24)))return palaceSiteBuilding('seoul-source',ox,oz,base,{...b,h:d.h??b.h??6,n:d.kind==='source-roof'?undefined:b.n});
 let edge=0,angle=0;const p=d.modelFootprint??b.p;
 for(let i=0;i<p.length;i+=2){const j=(i+2)%p.length,dx=p[j]-p[i],dz=p[j+1]-p[i+1],len=Math.hypot(dx,dz);if(len>edge){edge=len;angle=Math.atan2(dz,dx);}}
 const c=Math.cos(angle),s=Math.sin(angle),xs:number[]=[],zs:number[]=[];
 for(let i=0;i<p.length;i+=2){xs.push(p[i]*c+p[i+1]*s);zs.push(-p[i]*s+p[i+1]*c);}
 const u=(Math.min(...xs)+Math.max(...xs))/2,v=(Math.min(...zs)+Math.max(...zs))/2;
 const x=u*c-v*s,z=u*s+v*c,W=(Math.max(...xs)-Math.min(...xs))/2,D=(Math.max(...zs)-Math.min(...zs))/2;
 const h=d.kind==='cathedral'?45:(d.h??b.h??8), geos:THREE.BufferGeometry[]=[];
 const add=(g:THREE.BufferGeometry,color:string,local=true)=>{
  const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute('uv');setUniformColor(v,new THREE.Color(color));
  if(local){v.rotateY(-angle);v.translate(x-ox,base,z-oz);}geos.push(v);
 };
 const part=(p:Part,color:string)=>{const g=builder.partGeometry(p);if(g)add(g,color);};
 const box=(w:number,hh:number,dd:number,px:number,y:number,pz:number,color:string)=>part({g:'box',m:0,s:[w,hh,dd],p:[px,y,pz]},color);
 const cyl=(rt:number,rb:number,hh:number,y:number,color:string,seg=24,px=0,pz=0)=>part({g:'cyl',m:0,rt,rb,h:hh,seg,p:[px,y,pz]},color);
 const roof=(w:number,dd:number,y:number,rise:number,color='#50595d',ridge=.62)=>{
  const traditional=d.kind.includes('korean')||d.kind.includes('gate')||d.kind==='blue-house'||d.kind==='pagoda-museum';
  if(!traditional){part({g:'hiproof',m:0,W:w,D:dd,H:rise,ridge,t:.2,cap:0,fin:0,up:0,p:[0,y,0]},color);return;}
  const R=w*ridge,paljak=d.roof!=='hipped',cut=.55,verts:number[]=[];
  const faces=[[[ -w,dd],[w,dd],[-R,0],[R,0]],[[w,-dd],[-w,-dd],[R,0],[-R,0]],[[w,dd],[w,-dd],[R,0],[R,0]],[[-w,-dd],[-w,dd],[-R,0],[-R,0]]];
  const emit=(a:number[],b:number[],c:number[])=>{const ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);const q=ny>=0?[a,b,c]:[a,c,b];verts.push(...q.flat(),...[...q].reverse().flatMap(p=>[p[0],p[1]-.12,p[2]]));};
  for(const [side,[a,b,c,e]] of faces.entries()){
   const at=(u:number,t:number)=>{const xx=a[0]+(b[0]-a[0])*u,zz=a[1]+(b[1]-a[1])*u,rx=c[0]+(e[0]-c[0])*u,rz=c[1]+(e[1]-c[1])*u;return [xx+(rx-xx)*(paljak?Math.min(1,t/cut):t),y+rise*(.45*t+.55*t*t)+.22*Math.pow(Math.abs(2*u-1),4)*(1-t),zz+(rz-zz)*t];};
   const rows=6,cols=12,end=paljak&&side>=2?cut:1;
   for(let i=0;i<cols;i++)for(let j=0;j<rows;j++){const a=at(i/cols,j/rows*end),b=at((i+1)/cols,j/rows*end),c=at((i+1)/cols,(j+1)/rows*end),e=at(i/cols,(j+1)/rows*end);emit(a,b,c);emit(a,c,e);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();add(g,color);
  box(R*2+.2,.2,.32,0,y+rise+.08,0,color);
  if(paljak)for(const sign of [-1,1]){
   const zz=dd*(1-cut),low=y+rise*(.45*cut+.55*cut*cut);
   const v=[sign*R,low,-zz,sign*R,y+rise,0,sign*R,low,zz];
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([...v,...v.slice(6),...v.slice(3,6),...v.slice(0,3)],3));g.computeVertexNormals();add(g,'#b4a58c');
  }
 };
 const extrude=(hh:number,color:string)=>{const g=new THREE.ExtrudeGeometry(shape(b.p,b.holes??[],ox,oz),{depth:hh,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,base,0);add(g,color,false);};
 if(d.kind==='busan-tower'){
  // Total height is published; shaft/deck dimensions are photo-proportioned.
  const r=Math.max(3.5,Math.min(W,D,6));
  cyl(r*1.45,r*1.65,3,1.5,'#c6c8bd',8);cyl(r*.72,r,94,50,'#e0e4db',32);
  cyl(r*2,r*.72,4,99,'#d1d8d1',8);cyl(r*2,r*2,8,105,'#728f99',8);
  for(let i=0;i<8;i++){const a=i*Math.PI/4;box(.45,8,.45,Math.cos(a)*r*2,105,Math.sin(a)*r*2,'#c2a49b');}
  cyl(r*2.15,r*2.15,1,109.5,'#e6e6d9',8);cyl(r*1.35,r*2.15,4,112,'#d0d9d3',8);
  cyl(r*.7,r*1.35,2,115,'#e1e3d6',8);cyl(.2,r*.7,4,118,'#d5dcdb',8);
 }else if(d.kind==='busan-pavilion'){
  const r=Math.min(W,D);cyl(r,r,1,.5,'#beb9a9',8);
  for(const level of [0,1]){const q=level?.77:1,y=1+level*4.5;
   for(let i=0;i<8;i++){const a=i*Math.PI/4;cyl(.20,.23,2.8,y+1.4,'#8c5145',8,Math.cos(a)*r*q*.8,Math.sin(a)*r*q*.8);}
   cyl(r*q*1.1,r*q, .4,y+2.8,'#4e6661',8);cyl(r*q*.2,r*q*1.1,1.4,y+3.7,'#58666a',8);
  }
 }else if(d.kind==='busan-museum'){
  // Keep all courtyard holes; stepped eaves follow the mapped polygon rather than a bounding box.
  extrude(h*.78,'#c9c6b7');
  const g=new THREE.ExtrudeGeometry(shape(b.p,b.holes??[],ox,oz),{depth:h*.22,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,base+h*.78,0);add(g,'#698b7c',false);
  for(let i=0;i<b.p.length;i+=2){const j=(i+2)%b.p.length,dx=b.p[j]-b.p[i],dz=b.p[j+1]-b.p[i+1],n=Math.floor(Math.hypot(dx,dz)/5);
   for(let k=1;k<n;k++){const g=new THREE.BoxGeometry(.6,h*.75,.6);g.translate(b.p[i]+dx*k/n-ox,base+h*.375,b.p[i+1]+dz*k/n-oz);add(g,'#e0daca',false);}
  }
 }else if(d.kind==='busan-jagalchi'){
  // Original footprint preserved; three gull-wing roof sections use photographic proportions.
  extrude(h*.60,'#99b1b8');
  for(let y=4;y<h*.6;y+=4)box(W*2,.22,D*2,0,y,0,'#dce0d9');
  for(let xx=-W;xx<=W;xx+=Math.max(3,W/20))for(const sign of [-1,1])box(.18,h*.59,.22,xx,h*.30,sign*D,'#d9dfdb');
  for(let section=0;section<3;section++){
   const verts:number[]=[],left=-W+section*W*2/3,span=W*2/3;
   const at=(u:number,z:number)=>[left+span*u,h*(.64+section*.07)+h*.22*Math.pow(Math.abs(u*2-1),1.6),z];
   for(let j=0;j<16;j++){const a=at(j/16,-D*1.03),b=at((j+1)/16,-D*1.03),c=at((j+1)/16,D*1.03),d=at(j/16,D*1.03);verts.push(...a,...c,...b,...a,...d,...c,...b,...c,...a,...c,...d,...a);}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();add(g,'#d0dcda');
  }
 }else if(d.kind==='n-tower'){
  const r=6.2;extrude(8,'#b3b5ad');cyl(r*.7,r,h*.43,h*.215,'#d0d2cc');
  cyl(r*2.8,r*2.1,h*.035,h*.43,'#a9b8bd');cyl(r*2.8,r*2.8,h*.045,h*.47,'#526f7c');cyl(r*1.1,r*2.8,h*.025,h*.505,'#d9dad2');
  cyl(.5,r*.65,h*.48,h*.76,'#c6c9c7');for(let i=0;i<5;i++)cyl(r*(.7-i*.09),r*(.7-i*.09),.6,h*(.61+i*.07),'#89928f');
 }else if(d.kind==='lotte'){
  const verts:number[]=[];const levels=36,segments=32;
  const at=(j:number,i:number)=>{const t=j/levels,a=i/segments*Math.PI*2,q=Math.pow(1-t, .65)*.95+.05;return [Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),.65)*W*q,t*h,Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),.65)*D*q];};
  for(let j=0;j<levels;j++)for(let i=0;i<segments;i++){const a=at(j,i),b=at(j,i+1),c=at(j+1,i+1),d=at(j+1,i);verts.push(...a,...c,...b,...a,...d,...c);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();add(g,'#a5c1ca');
  for(let i=1;i<24;i++){const t=i/24,q=Math.pow(1-t,.65)*.95+.05;const ring=new THREE.CylinderGeometry(1,1,.35,32,1,true);ring.scale(W*q,1,D*q);ring.translate(0,t*h,0);add(ring,'#d1d8d6');}
 }else if(d.kind==='cathedral'){
  extrude(h*.37,'#966956');roof(W,D,h*.37,h*.17,'#677574',1);
  const bx=-W*.72;cyl(D*.65,D*.65,h*.68,h*.34,'#9e725e',4,bx,0);part({g:'cone',m:0,r:D*.91,h:h*.32,seg:4,p:[bx,h*.84,0],ry:Math.PI/4},'#5a716e');
  for(let xx=-W*.5;xx<W;xx+=Math.max(3,W/6))for(const sign of [-1,1]){box(.7,h*.32,.9,xx,h*.16,sign*D,'#ba9277');box(1.1,h*.12,.12,xx+1.2,h*.25,sign*(D+.02),'#4c6974');}
 }else if(d.kind==='station'){
  extrude(h*.62,'#b77f69');roof(W,D,h*.62,h*.12,'#657b75',.85);
  const dome=new THREE.SphereGeometry(Math.min(W*.3,D)*.85,24,12,0,Math.PI*2,0,Math.PI/2);dome.scale(1,.9,1);dome.translate(0,h*.75,0);add(dome,'#68837b');cyl(Math.min(W*.3,D)*.84,Math.min(W*.3,D)*.84,h*.18,h*.69,'#d7cbbb');
 }else if(['museum','modern','neoclassical','greenhouse','pagoda-museum'].includes(d.kind)){
  const color=d.kind==='greenhouse'?'#b4c9cc':'#c1beb1';extrude(d.kind==='pagoda-museum'?7:d.kind==='greenhouse'?h*.85:h,color);
  if(d.kind==='pagoda-museum'){const tw=Math.min(W,13),td=Math.min(D,13);for(let j=0;j<5;j++){const q=1-j*.13;box(tw*q*1.6,3.6,td*q*1.6,0,9+j*5,0,'#a87f63');roof(tw*q,td*q,10.8+j*5,3);}}
  else if(d.kind==='greenhouse'){roof(W,D,h*.85,h*.15,'#b7d0d0',.8);for(let xx=-W;xx<=W;xx+=3)box(.15,h*.8,D*2,xx,h*.42,0,'#e5e3d5');}
  else {for(let xx=-W+2;xx<W;xx+=Math.max(3,W/16))for(const sign of [-1,1])box(.35,h*.75,.5,xx,h*.44,sign*D,'#dedacf');}
 }else{
  const stone=d.kind.startsWith('stone-gate'),gate=d.kind.includes('gate'),two=['korean-double','gate','stone-gate'].includes(d.kind),blue=d.kind==='blue-house';
  const podium=stone?h*.34:Math.min(1.2,h*.1),bodyY=podium,bodyH=h*(two?.27:.57);
  if(stone){const gap=Math.min(3,W*.22);box(W-gap,podium,D*2,-(W+gap)/2,podium/2,0,'#bdbbb0');box(W-gap,podium,D*2,(W+gap)/2,podium/2,0,'#bdbbb0');box(gap*2,podium*.27,D*2,0,podium*.865,0,'#bdbbb0');}
  else extrude(podium,'#bdb7aa');
  if(!gate)box(W*1.7,bodyH,D*1.7,0,bodyY+bodyH/2,0,'#a17258');
  for(let xx=-W*.85;xx<=W*.86;xx+=Math.max(2,W*.34))for(const sign of [-1,1]){cyl(.22,.27,bodyH,bodyY+bodyH/2,'#874e40',10,xx,sign*D*.85);if(!gate)box(Math.max(.8,W*.24),bodyH*.65,.12,xx,bodyY+bodyH*.5,sign*D*.86,'#c2bba0');}
  roof(W,D,bodyY+bodyH,h*(two?.17:.26),blue?'#466b80':'#50595d',d.roof==='hipped'?.6:.68);
  if(two){box(W*1.4,h*.16,D*1.4,0,h*.72,0,'#ac8670');roof(W*.87,D*.84,h*.8,h*.2);}
 }
 if(groundBase<base-.01){const g=new THREE.ExtrudeGeometry(shape(b.p,b.holes??[],ox,oz),{depth:base-groundBase,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,groundBase,0);add(g,'#b7b5a9',false);}
 if(!geos.length)return null;const g=mergeGeometries(geos,false);geos.forEach(v=>v.dispose());return g;
}

/** Source ground polygons and paths. Existing roads remain the authoritative traffic geometry. */
export function paintSeoulDetail(ctx:CanvasRenderingContext2D,detail:SeoulDetail,sc:number,x0:number,z0:number){
 const trace=(p:number[])=>{ctx.moveTo((p[0]-x0)*sc,(p[1]-z0)*sc);for(let i=2;i<p.length;i+=2)ctx.lineTo((p[i]-x0)*sc,(p[i+1]-z0)*sc);ctx.closePath();};
 ctx.save();for(const a of detail.areas){ctx.beginPath();trace(a.p);for(const h of a.holes)trace(h);ctx.fillStyle=a.kind==='wood'?'#7a9168':a.kind==='sand'?'#cbbfa5':a.kind==='paving'?'#c1bfb4':'#a1b184';ctx.fill('evenodd');}
 for(const p of detail.paths){if(p.tunnel)continue;ctx.beginPath();for(let i=0;i<p.p.length;i+=2){const x=(p.p[i]-x0)*sc,z=(p.p[i+1]-z0)*sc;if(i===0)ctx.moveTo(x,z);else ctx.lineTo(x,z);}ctx.lineWidth=p.width*sc;ctx.strokeStyle=p.surface==='asphalt'?'#8b9291':'#c5bcaa';ctx.stroke();}
 for(const a of detail.water){ctx.beginPath();trace(a.p);for(const h of a.holes)trace(h);ctx.fillStyle='#7faaa6';ctx.fill('evenodd');}ctx.restore();
}
export function addSeoulLandscape(group:THREE.Group,chunk:WorldChunk,ox:number,oz:number,height:(x:number,z:number)=>number){
 const d=chunk.seoulDetail;if(!d)return;const geos:THREE.BufferGeometry[]=[];
 const add=(g:THREE.BufferGeometry,color:string)=>{const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute('uv');setUniformColor(v,new THREE.Color(color));geos.push(v);};
 for(const site of d.romeSites??[]){const geo=romeSiteGeometry(site,ox,oz,height);if(geo)geos.push(geo);}
 for(const bridge of d.bridges??[])geos.push(busanBridgeGeometry(bridge,ox,oz));
 for(const approach of d.bridgeApproaches??[])geos.push(busanBridgeApproachGeometry(approach,ox,oz));
 const owned=(x:number,z:number)=>Math.floor(x/1024)===chunk.cx&&Math.floor(z/1024)===chunk.cz;
 for(const a of d.water){if(a.level==null)continue;const xs=a.p.filter((_,i)=>i%2===0),zs=a.p.filter((_,i)=>i%2===1),x=xs.reduce((a,v)=>a+v,0)/xs.length,z=zs.reduce((a,v)=>a+v,0)/zs.length;if(!owned(x,z))continue;const g=new THREE.ShapeGeometry(shape(a.p,a.holes,ox,oz));g.rotateX(-Math.PI/2);g.translate(0,a.level+.03,0);add(g,'#7faaa6');}
 for(const [x,z] of d.trees){const y=height(x,z),h=9+Math.abs(Math.sin(x+z))*5;const crown=new THREE.IcosahedronGeometry(h*.58,1);crown.translate(x-ox,y+h*.75,z-oz);add(crown,'#648159');const trunk=new THREE.CylinderGeometry(.16,.25,h*.6,5);trunk.translate(x-ox,y+h*.3,z-oz);add(trunk,'#796954');}
 for(const wall of d.walls)for(let i=2;i<wall.p.length;i+=2){const ax=wall.p[i-2],az=wall.p[i-1],bx=wall.p[i],bz=wall.p[i+1],x=(ax+bx)/2,z=(az+bz)/2;if(!owned(x,z))continue;const len=Math.hypot(bx-ax,bz-az);if(len<.1)continue;const g=new THREE.BoxGeometry(len,.25,.8);g.rotateY(-Math.atan2(bz-az,bx-ax));g.translate(x-ox,Math.max(height(ax,az),height(bx,bz))+wall.h,z-oz);add(g,'#687171');}
 if(geos.length){const g=mergeGeometries(geos,false);geos.forEach(v=>v.dispose());const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9});m.userData.paintedOwned=true;const mesh=new THREE.Mesh(g,m);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
}
