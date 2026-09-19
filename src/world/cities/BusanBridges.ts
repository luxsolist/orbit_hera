import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {setUniformColor} from '../geo';
export interface BusanBridge {id:string;name:string;x:number;z:number;angle:number;length:number;width:number;deck:number;tower:number;status:string;}
/** Source-footprint visual bridge. Deck/tower vertical levels are documented estimates, not DEM. */
export function busanBridgeGeometry(a:BusanBridge,ox:number,oz:number):THREE.BufferGeometry {
 const pieces:THREE.BufferGeometry[]=[];
 const add=(g:THREE.BufferGeometry,color:string)=>{const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute('uv');setUniformColor(v,new THREE.Color(color));pieces.push(v);};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,color:string)=>{const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);add(g,color);};
 const rod=(aa:number[],bb:number[],r:number,color:string)=>{const from=new THREE.Vector3(...aa),to=new THREE.Vector3(...bb),delta=to.clone().sub(from);if(delta.length()<.001)return;const g=new THREE.CylinderGeometry(r,r,delta.length(),6);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate(...from.add(to).multiplyScalar(.5).toArray());add(g,color);};
 const L=a.length,W=a.width,Y=a.deck,suspension=a.tower>0;
 const levels=suspension?[Y,Y-8]:[Y];
 for(const y of levels){
  box(0,y-1,0,L,2,W,'#aab8bb');
  for(const sign of [-1,1])box(0,y+.6,sign*W*.48,L,.45,.45,'#d0d9d5');
 }
 if(suspension){
  const span=Math.min(500,L*.6),top=a.tower;
  for(const x of [-span/2,span/2]){
   for(const sign of [-1,1]){box(x,top/2,sign*W*.53,5,top,5,'#d2dcd9');box(x,2,sign*W*.53,12,4,12,'#a3aaa5');}
   for(const y of [Y-4,Y+24,top-6])box(x,y,0,5,3,W*1.15,'#c9d6d2');
  }
  for(const sign of [-1,1]){
   const cable=(x:number)=>Math.abs(x)<=span/2?Y+12+(top-Y-12)*Math.pow(x/(span/2),2):top-(top-Y-2)*(Math.abs(x)-span/2)/(L/2-span/2);
   for(let x=-L/2;x<L/2;x+=12){const end=Math.min(x+12,L/2);rod([x,cable(x),sign*W*.52],[end,cable(end),sign*W*.52],.45,'#c1d2d3');rod([x,Y,sign*W*.52],[x,cable(x),sign*W*.52],.13,'#a8bbbd');
    rod([x,Y-7,sign*W*.47],[end,Y-1,sign*W*.47],.22,'#bbc9c6');rod([x,Y-1,sign*W*.47],[end,Y-7,sign*W*.47],.22,'#bbc9c6');}
  }
 }else{
  for(let x=-L/2+30;x<L/2;x+=50){box(x,Y/2-1,0,5,Y-2,W*.85,'#a3a99f');}
  // Low riveted side trusses, including the closed bascule span. No fictitious opening animation.
  for(const sign of [-1,1])for(let x=-L/2;x<L/2;x+=10){const end=Math.min(x+10,L/2);rod([x,Y+1,sign*W*.48],[end,Y+3.2,sign*W*.48],.22,'#647c83');rod([x,Y+3.2,sign*W*.48],[end,Y+1,sign*W*.48],.22,'#647c83');rod([x,Y+3.2,sign*W*.48],[end,Y+3.2,sign*W*.48],.24,'#647c83');}
 }
 const g=mergeGeometries(pieces,false)!;pieces.forEach(p=>p.dispose());g.rotateY(-a.angle);g.translate(a.x-ox,0,a.z-oz);return g;
}

/** World-space cross sections, shared at every streamed segment boundary. */
export interface BusanBridgeApproach {id:string;segment:number;a:number[];b:number[];rail:number;distance?:number;supportBase?:number|null;}
export function busanBridgeApproachGeometry(s:BusanBridgeApproach,ox:number,oz:number):THREE.BufferGeometry {
 const vertices:number[]=[],colors:number[]=[];
 const point=(row:number[],side:number,dy=0)=>new THREE.Vector3(row[side*3]-ox,row[side*3+1]+dy,row[side*3+2]-oz);
 const quad=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3,color:string)=>{
  const col=new THREE.Color(color);for(const p of [a,b,c,a,c,d]){vertices.push(p.x,p.y,p.z);colors.push(col.r,col.g,col.b);}
 };
 const a=point(s.a,0),b=point(s.a,1),c=point(s.b,1),d=point(s.b,0);
 // The cross sections are oriented along the outward route; reverse winding for upward normals.
 quad(a,d,c,b,'#aab8bb');
 const down=(p:THREE.Vector3)=>p.clone().add(new THREE.Vector3(0,-1.2,0));
 quad(a,b,down(b),down(a),'#aab8bb');quad(d,down(d),down(c),c,'#aab8bb');
 quad(a,down(a),down(d),d,'#aab8bb');quad(b,c,down(c),down(b),'#aab8bb');
 for(const side of [0,1]){
  const p=point(s.a,side),q=point(s.b,side),up=new THREE.Vector3(0,.65*s.rail,0);
  quad(p,q,q.clone().add(up),p.clone().add(up),'#d0d9d5');
  quad(q,p,p.clone().add(up),q.clone().add(up),'#d0d9d5');
 }
 if(s.supportBase!=null){
  const center=a.clone().add(b).add(c).add(d).multiplyScalar(.25),top=center.y-1.2,base=s.supportBase;
  if(top-base>4){const x=center.x,z=center.z,r=1.5;const v=(dx:number,y:number,dz:number)=>new THREE.Vector3(x+dx,y,z+dz);
   quad(v(-r,base,-r),v(-r,top,-r),v(r,top,-r),v(r,base,-r),'#aab8bb');
   quad(v(r,base,r),v(r,top,r),v(-r,top,r),v(-r,base,r),'#aab8bb');
   quad(v(r,base,-r),v(r,top,-r),v(r,top,r),v(r,base,r),'#aab8bb');
   quad(v(-r,base,r),v(-r,top,r),v(-r,top,-r),v(-r,base,-r),'#aab8bb');
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}

/** Keep all bridge road paint out of the structural vertex-color mesh. */
export function busanBridgeStreets(detail?:{bridges?:BusanBridge[];bridgeApproaches?:BusanBridgeApproach[]}):import('../StreetGeometry').ElevatedStreet[]{
 const result:import('../StreetGeometry').ElevatedStreet[]=[];
 for(const b of detail?.bridges??[]){
  const c=Math.cos(b.angle),s=Math.sin(b.angle);
  for(const y of (b.tower>0?[b.deck,b.deck-8]:[b.deck])){
   const row=(x:number)=>[-b.width/2,b.width/2].flatMap(z=>[b.x+x*c-z*s,y+.08,b.z+x*s+z*c]);
   // Left is positive local Z along +X.
   const flip=(r:number[])=>[...r.slice(3),...r.slice(0,3)];
   result.push({a:flip(row(-b.length/2)),b:flip(row(b.length/2)),distance:0});
  }
 }
 for(const s of detail?.bridgeApproaches??[])result.push({a:s.a,b:s.b,distance:s.distance??s.segment*Math.hypot((s.b[0]+s.b[3]-s.a[0]-s.a[3])/2,(s.b[2]+s.b[5]-s.a[2]-s.a[5])/2)});
 return result;
}
