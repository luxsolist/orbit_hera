import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import site from './gyeongbokgung-site.json';
import type {Ring} from '../MapData';
import type {Cell,WorldChunk} from '../chunkManifest';
import {setUniformColor} from '../geo';
export function inPalace(x:number,z:number,p:number[]=site.boundary):boolean {let inside=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])inside=!inside;return inside;}
function edgeDistance(x:number,z:number,p:number[],closed=true){let d=Infinity;for(let i=closed?0:2,j=closed?p.length-2:0;i<p.length;j=i,i+=2){const dx=p[i]-p[j],dz=p[i+1]-p[j+1],t=Math.max(0,Math.min(1,((x-p[j])*dx+(z-p[j+1])*dz)/(dx*dx+dz*dz||1)));d=Math.min(d,Math.hypot(x-p[j]-dx*t,z-p[j+1]-dz*t));}return d;}
function center(p:number[]){return {x:p.filter((_,i)=>i%2===0).reduce((a,v)=>a+v,0)/(p.length/2),z:p.filter((_,i)=>i%2===1).reduce((a,v)=>a+v,0)/(p.length/2)};}
export function palaceGrade(z:number){const a=site.elevationProfile;if(z<=a[0][0])return a[0][1];for(let i=1;i<a.length;i++)if(z<a[i][0]){const t=(z-a[i-1][0])/(a[i][0]-a[i-1][0]);return a[i-1][1]*(1-t)+a[i][1]*t;}return a[a.length-1][1];}
const protectedArea=(x:number,z:number)=>[...site.modern,...site.construction].some(p=>inPalace(x,z,p));
const matched=new Map(site.buildings.filter(b=>b.match).map(b=>[JSON.stringify(b.match!.p),b]));
export function correctPalaceSite(cell:Cell,raw:WorldChunk):WorldChunk {
 if(raw.palaceSite)return raw;
 if(cell[0]!==37||cell[1]!==126||raw.cx<83||raw.cx>85||raw.cz<45||raw.cz>46)return raw;
 const n=raw.terrain.size,heights=[...raw.terrain.heights];
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const x=raw.cx*1024+i*1024/(n-1),z=raw.cz*1024+j*1024/(n-1);if(!inPalace(x,z)||protectedArea(x,z))continue;
  const t=Math.min(1,edgeDistance(x,z,site.boundary)/24),w=t*t*(3-2*t);let h=palaceGrade(z);
  for(const pond of site.water){const c=center(pond.p),level=palaceGrade(c.z);if(inPalace(x,z,pond.p))h=pond.holes.some(p=>inPalace(x,z,p))?level+.45:level-.65;else {const d=edgeDistance(x,z,pond.p);if(d<14)h=h*(d/14)+(level+.3)*(1-d/14);}}
  heights[j*n+i]+=(h-heights[j*n+i])*w;
 }
 const buildings=raw.objects.buildings.map(b=>{
  if(b.landmarkModel)return b;
  const c=center(b.p);if(!inPalace(c.x,c.z)||protectedArea(c.x,c.z))return b;
  const ref=matched.get(JSON.stringify(b.p));
  if(!ref)return {...b,palaceBuildingId:'unverified-footprint'};
  return {...b,h:ref.height,palaceBuildingId:ref.id,n:ref.name||b.n};
 });
 // Only add named source buildings whose bounds do not overlap any baked footprint.
 const bounds=(p:number[])=>[Math.min(...p.filter((_,i)=>i%2===0)),Math.min(...p.filter((_,i)=>i%2===1)),Math.max(...p.filter((_,i)=>i%2===0)),Math.max(...p.filter((_,i)=>i%2===1))];
 for(const ref of site.buildings.filter(b=>!b.match&&b.name)){
  const c=center(ref.p);if(Math.floor(c.x/1024)!==raw.cx||Math.floor(c.z/1024)!==raw.cz)continue;
  const a=bounds(ref.p);if(buildings.some(b=>{const q=bounds(b.p);return a[0]<q[2]&&a[2]>q[0]&&a[1]<q[3]&&a[3]>q[1];}))continue;
  buildings.push({p:ref.p,holes:ref.holes,h:ref.height,palaceBuildingId:ref.id,n:ref.name,lm:'deep-roots'});
 }
 const walls=(raw.objects.walls??[]).filter(w=>{const c=center(w.p);return !inPalace(c.x,c.z);});
 for(const wall of site.walls)for(let i=2;i<wall.p.length;i+=2){const p=wall.p.slice(i-2,i+2),c=center(p);if(Math.floor(c.x/1024)===raw.cx&&Math.floor(c.z/1024)===raw.cz)walls.push({p,h:wall.height,w:.55});}
 return {...raw,palaceSite:true,terrain:{...raw.terrain,heights},objects:{...raw.objects,buildings,walls}};
}
function shapeOf(p:number[],holes:number[][],ox:number,oz:number){const s=new THREE.Shape();const trace=(path:THREE.Path,q:number[])=>{path.moveTo(q[0]-ox,-(q[1]-oz));for(let i=2;i<q.length;i+=2)path.lineTo(q[i]-ox,-(q[i+1]-oz));path.closePath();};trace(s,p);for(const q of holes){const h=new THREE.Path();trace(h,q);s.holes.push(h);}return s;}
/** Roof follows the actual compound footprint, preserving courtyard holes. Unmeasured roof form is approximate. */
export function palaceSiteBuilding(id:string,ox:number,oz:number,base:number,footprint?:Ring):THREE.BufferGeometry|null{
 const ref=site.buildings.find(b=>b.id===id);
 const b=ref?{...ref,...(footprint?{p:footprint.p,holes:footprint.holes??ref.holes}:{})}:footprint?{p:footprint.p,holes:footprint.holes??[],height:footprint.h??5,name:footprint.n??'',gate:false}:null;if(!b)return null;
 if(b.name==='향원정'){
  const c=center(b.p),pieces:THREE.BufferGeometry[]=[];
  const push=(g:THREE.BufferGeometry,color:string)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();n.deleteAttribute('uv');setUniformColor(n,new THREE.Color(color));pieces.push(n);};
  for(let level=0;level<2;level++){
   const y=base+level*3.1;
   const floor=new THREE.ShapeGeometry(shapeOf(b.p,[],ox,oz));floor.rotateX(-Math.PI/2);floor.translate(0,y+.12,0);push(floor,'#ad997c');
   const verts:number[]=[];
   for(let j=0;j<b.p.length;j+=2){
    const k=(j+2)%b.p.length,ax=c.x+(b.p[j]-c.x)*.85,az=c.z+(b.p[j+1]-c.z)*.85;
    const col=new THREE.CylinderGeometry(.16,.19,2.3,8);col.translate(ax-ox,y+1.15,az-oz);push(col,'#985245');
    const a=[b.p[j]-ox,y+2.4,b.p[j+1]-oz],d=[b.p[k]-ox,y+2.4,b.p[k+1]-oz],tip=[c.x-ox,y+3.8,c.z-oz];verts.push(...a,...tip,...d,...a,...d,...tip);
   }
   const roof=new THREE.BufferGeometry();roof.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));roof.computeVertexNormals();push(roof,'#505a5b');
  }
  const result=mergeGeometries(pieces,false);pieces.forEach(g=>g.dispose());return result;
 }
 const roofH=Math.min(2.5,b.height*.3),wallH=Math.max(2,b.height-roofH),shape=shapeOf(b.p,b.holes,ox,oz);
 const walls=new THREE.ExtrudeGeometry(shape,{depth:wallH,bevelEnabled:false,steps:1});walls.rotateX(-Math.PI/2);walls.translate(0,base,0);walls.deleteAttribute('uv');setUniformColor(walls,new THREE.Color(b.name?'#965449':'#c4b79d'));
 const plane=new THREE.ShapeGeometry(shape);const flat=plane.index?plane.toNonIndexed():plane;const pos=flat.getAttribute('position'),vertices:number[]=[];
 const rise=(x:number,z:number)=>{let d=edgeDistance(x+ox,z+oz,b.p);for(const hole of b.holes)d=Math.min(d,edgeDistance(x+ox,z+oz,hole));return Math.min(roofH,d*.55);};
 const triangle=(a:number[],b:number[],c:number[],depth=0)=>{
  const ab=Math.hypot(a[0]-b[0],a[1]-b[1]),bc=Math.hypot(b[0]-c[0],b[1]-c[1]),ca=Math.hypot(c[0]-a[0],c[1]-a[1]);
  if(Math.max(ab,bc,ca)>3&&depth<10){if(bc>=ab&&bc>=ca){const m=[(b[0]+c[0])/2,(b[1]+c[1])/2];triangle(a,b,m,depth+1);triangle(a,m,c,depth+1);}else if(ca>=ab){const m=[(c[0]+a[0])/2,(c[1]+a[1])/2];triangle(a,b,m,depth+1);triangle(m,b,c,depth+1);}else{const m=[(a[0]+b[0])/2,(a[1]+b[1])/2];triangle(a,m,c,depth+1);triangle(m,b,c,depth+1);}return;}
  for(const p of [a,b,c])vertices.push(p[0],base+wallH+rise(p[0],p[1]),p[1]);
 };
 for(let i=0;i<pos.count;i+=3)triangle([pos.getX(i),-pos.getY(i)],[pos.getX(i+1),-pos.getY(i+1)],[pos.getX(i+2),-pos.getY(i+2)]);
 flat.dispose();if(flat!==plane)plane.dispose();const roof=new THREE.BufferGeometry();roof.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));roof.computeVertexNormals();setUniformColor(roof,new THREE.Color('#505a5b'));
 const merged=mergeGeometries([walls,roof],false);walls.dispose();roof.dispose();return merged;
}
export function paintPalaceGround(ctx:CanvasRenderingContext2D,scale:number,x0:number,z0:number){
 const trace=(p:number[])=>{ctx.moveTo((p[0]-x0)*scale,(p[1]-z0)*scale);for(let i=2;i<p.length;i+=2)ctx.lineTo((p[i]-x0)*scale,(p[i+1]-z0)*scale);ctx.closePath();};
 ctx.save();ctx.beginPath();trace(site.boundary);for(const p of [...site.modern,...site.construction])trace(p);ctx.clip('evenodd');ctx.fillStyle='#c9bc9b';ctx.fillRect(0,0,1024*scale,1024*scale);
 for(const a of site.areas){ctx.beginPath();trace(a.p);for(const p of a.holes)trace(p);ctx.fillStyle=a.kind==='wood'?'#7c9563':a.kind==='sand'?'#c9bc9b':'#9caa75';ctx.fill('evenodd');}
 for(const p of site.paths){ctx.beginPath();ctx.moveTo((p.p[0]-x0)*scale,(p.p[1]-z0)*scale);for(let i=2;i<p.p.length;i+=2)ctx.lineTo((p.p[i]-x0)*scale,(p.p[i+1]-z0)*scale);ctx.lineWidth=p.width*scale;ctx.strokeStyle=p.surface==='paving_stones'?'#b5b2a3':'#d3c6a7';ctx.stroke();}
 for(const pond of site.water){ctx.beginPath();trace(pond.p);for(const p of pond.holes)trace(p);ctx.fillStyle='#71968f';ctx.fill('evenodd');}
 ctx.restore();
}
export function addPalaceLandscape(group:THREE.Group,chunk:WorldChunk,ox:number,oz:number,height:(x:number,z:number)=>number){
 const owned=(x:number,z:number)=>Math.floor(x/1024)===chunk.cx&&Math.floor(z/1024)===chunk.cz;
 const geos:THREE.BufferGeometry[]=[];const push=(g:THREE.BufferGeometry,color:string)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();n.deleteAttribute('uv');setUniformColor(n,new THREE.Color(color));geos.push(n);};
 for(const pond of site.water){const c=center(pond.p);if(!owned(c.x,c.z))continue;const g=new THREE.ShapeGeometry(shapeOf(pond.p,pond.holes,ox,oz));g.rotateX(-Math.PI/2);g.translate(0,palaceGrade(c.z)+.05,0);push(g,'#71968f');}
 for(const path of site.paths.filter(p=>p.bridge))for(let i=2;i<path.p.length;i+=2){
  const ax=path.p[i-2],az=path.p[i-1],bx=path.p[i],bz=path.p[i+1],x=(ax+bx)/2,z=(az+bz)/2,len=Math.hypot(bx-ax,bz-az);if(!owned(x,z)||len<.1)continue;
  const y=Math.max(palaceGrade(az),palaceGrade(bz))+.55,angle=-Math.atan2(bz-az,bx-ax);
  const deck=new THREE.BoxGeometry(len,.35,path.width);deck.rotateY(angle);deck.translate(x-ox,y,z-oz);push(deck,'#bdb7a6');
  for(const side of [-1,1]){const rail=new THREE.BoxGeometry(len,.18,.14);rail.rotateY(angle);rail.translate(x-ox+side*(bz-az)/len*path.width/2,y+.8,z-oz-side*(bx-ax)/len*path.width/2);push(rail,'#a49c86');}
 }
 const trees=site.trees.map(t=>t.p);
 for(const wood of site.areas.filter(a=>a.kind==='wood')){
  const xs=wood.p.filter((_,i)=>i%2===0),zs=wood.p.filter((_,i)=>i%2===1);
  for(let gx=Math.min(...xs)+5;gx<Math.max(...xs);gx+=12)for(let gz=Math.min(...zs)+5;gz<Math.max(...zs);gz+=12){
   const x=gx+Math.sin(gx*13+gz*7)*3.6,z=gz+Math.cos(gx*5+gz*11)*3.6;
   if(inPalace(x,z,wood.p)&&inPalace(x,z)&&!site.water.some(p=>inPalace(x,z,p.p))&&!site.buildings.some(b=>inPalace(x,z,b.p))&&!site.paths.some(p=>edgeDistance(x,z,p.p,false)<p.width/2+2)&&!trees.some(p=>Math.hypot(p[0]-x,p[1]-z)<7))trees.push([x,z]);
  }
 }
 for(const [x,z] of trees){if(!owned(x,z)||protectedArea(x,z))continue;const h=5+(Math.abs(Math.round(x*3+z*7))%30)/10,y=height(x,z);const trunk=new THREE.CylinderGeometry(.14,.23,h*.65,5);trunk.translate(x-ox,y+h*.325,z-oz);push(trunk,'#74604a');const crown=new THREE.IcosahedronGeometry(h*.42,1);crown.scale(1,1.15,.95);crown.translate(x-ox,y+h*.76,z-oz);push(crown,['#657e50','#768c59','#536e4c'][Math.abs(Math.round(x+z))%3]);}
 for(const wall of site.walls)for(let i=2;i<wall.p.length;i+=2){const ax=wall.p[i-2],az=wall.p[i-1],bx=wall.p[i],bz=wall.p[i+1],x=(ax+bx)/2,z=(az+bz)/2;if(!owned(x,z))continue;const len=Math.hypot(bx-ax,bz-az);if(len<.1)continue;const g=new THREE.BoxGeometry(len,.24,.85);g.rotateY(-Math.atan2(bz-az,bx-ax));g.translate(x-ox,Math.max(height(ax,az),height(bx,bz))+wall.height+.1,z-oz);push(g,'#596263');}
 if(geos.length){const g=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95});mat.userData.paintedOwned=true;const mesh=new THREE.Mesh(g,mat);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
}
