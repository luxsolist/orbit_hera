import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {setUniformColor} from '../geo';
import type {Cell,WorldChunk} from '../chunkManifest';
export const STATUES=[
 {id:'sejong',name:'세종대왕 동상',x:86273.81217,z:47549.04,base:4.2,figure:6.2,width:4.3,pedestalWidth:7,pedestalDepth:7},
 {id:'yi',name:'이순신 장군 동상',x:86280.81957,z:47760.04,base:10.5,figure:6.5,width:3,pedestalWidth:5.5,pedestalDepth:5.5},
] as const;
const oldSejong=[86268,47545,86268,47557,86280,47557,86280,47545,86277,47545,86277,47546,86277,47547,86274,47547,86271,47547,86271,47546,86271,47545];
/** Replace the known erroneous outline only; never remove surrounding buildings by radius. */
export function correctGwanghwamunStatues(cell:Cell,raw:WorldChunk):WorldChunk{
 if(cell[0]!==37||cell[1]!==126||raw.cx!==84||raw.cz!==46)return raw;
 const buildings=raw.objects.buildings.filter(b=>!b.statueModel&&JSON.stringify(b.p)!==JSON.stringify(oldSejong));
 for(const a of STATUES){const w=a.pedestalWidth/2,d=a.pedestalDepth/2;buildings.push({p:[a.x-w,a.z-d,a.x+w,a.z-d,a.x+w,a.z+d,a.x-w,a.z+d],h:a.base+a.figure,statueModel:a.id,n:a.name,lm:'deep-roots'});}
 return {...raw,objects:{...raw.objects,buildings}};
}
/** Photo-informed sculptural approximation; surveyed portrait/relief details are not available. */
export function statueGeometry(id:string,ox:number,oz:number,baseY:number):THREE.BufferGeometry|null{
 const spec=STATUES.find(a=>a.id===id);if(!spec)return null;
 let pieces:THREE.BufferGeometry[]=[];
 const bronze=id==='sejong'?'#b48a39':'#526659',dark=id==='sejong'?'#826323':'#364b42';
 const add=(g:THREE.BufferGeometry,color=bronze)=>{const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute('uv');setUniformColor(v,new THREE.Color(color));pieces.push(v);};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,color=bronze)=>{const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);add(g,color);};
 const oval=(x:number,y:number,z:number,w:number,h:number,d:number,color=bronze)=>{const g=new THREE.SphereGeometry(1,20,12);g.scale(w,h,d);g.translate(x,y,z);add(g,color);};
 const rod=(a:number[],b:number[],r:number,color=bronze,r2=r)=>{const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);const g=new THREE.CylinderGeometry(r2,r,delta.length(),12);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize()));g.translate(...start.add(end).multiplyScalar(.5).toArray());add(g,color);};
 // Model in a human-scale frame, then fit the figure alone to published dimensions.
 if(id==='sejong'){
  box(0,1.6,-.6,2.3,2.6,.38,dark);box(0,.75,0,2.35,.35,1.8); // throne
  for(const sign of [-1,1]){box(sign*1.05,1.15,.05,.2,.85,1.75);oval(sign*1.05,1.68,.68,.18,.18,.23);box(sign*.63,.13,1.12,.6,.25,1.05,dark);}
  // Draped robe covers the seated thighs and knees, with gently raised folds.
  const robe=new THREE.CylinderGeometry(.65,1.2,1.6,32);robe.scale(1,1,.7);robe.translate(0,1.03,.48);add(robe);
  oval(0,2.03,0,.88,.98,.54);oval(-.53,.97,.83,.57,.62,.38);oval(.53,.97,.83,.57,.62,.38);
  for(let i=-4;i<=4;i++)rod([i*.2,.3,1.01],[i*.13,1.53,.85],.035,dark);
  // Right hand held out, left hand resting on the book.
  rod([-.73,2.5,.1],[-1.06,1.9,.55],.31);rod([-1.06,1.9,.55],[-1.27,2.23,1.03],.22);
  oval(-1.28,2.26,1.13,.22,.10,.25);for(let i=0;i<4;i++)rod([-1.45+i*.10,2.27,1.17],[-1.46+i*.1,2.3,1.5],.043);
  rod([.72,2.45,.1],[1.0,1.77,.51],.31);rod([1,1.77,.51],[.61,1.48,1.02],.20);oval(.6,1.49,1.05,.22,.10,.18);
  box(.30,1.33,1.06,.88,.16,.68,dark);box(.3,1.42,1.06,.84,.025,.63); // book
  oval(0,3.06,.08,.4,.5,.34);const beard=new THREE.ConeGeometry(.22,.72,16);beard.rotateZ(Math.PI);beard.scale(1,1,.55);beard.translate(0,2.69,.40);add(beard,dark); // beard
  oval(0,3.45,-.03,.42,.22,.34);for(const sign of [-1,1])oval(sign*.24,3.69,-.23,.19,.31,.07); // upright rear wings of the ikseongwan
  oval(0,2.1,.53,.32,.33,.045,dark); // royal chest medallion
 }else{
  for(const sign of [-1,1]){box(sign*.36,.12,.21,.43,.25,.8,dark);rod([sign*.36,.25,.04],[sign*.36,1.28,0],.21);}
  const skirt=new THREE.CylinderGeometry(.55,.8,1.3,24);skirt.scale(1,1,.65);skirt.translate(0,1.34,0);add(skirt,dark);
  oval(0,2.25,0,.7,.8,.40); // armoured torso
  for(let row=0;row<7;row++)for(let col=-3;col<=3;col++)box(col*.17,1.72+row*.16,.40-Math.abs(col)*.018,.14,.12,.06,row%2?bronze:dark);
  box(0,1.68,.01,1.28,.14,.77,dark);oval(0,1.68,.43,.13,.12,.055);
  for(const sign of [-1,1]){oval(sign*.69,2.69,0,.35,.22,.45);rod([sign*.75,2.56,0],[sign*.94,2.02,.22],.22);}
  rod([-.94,2.02,.22],[-.94,1.72,.55],.16);oval(-.94,1.66,.54,.16,.2,.13);
  rod([.94,2.02,.22],[.53,1.86,.48],.17);oval(.53,1.86,.49,.16,.12,.15);
  rod([-.94,.12,.56],[-.94,1.8,.56],.067,dark);box(-.94,1.59,.56,.48,.09,.12); // grounded sword
  oval(0,3.08,.02,.32,.4,.29);oval(0,2.8,.23,.18,.26,.12,dark);
  oval(0,3.40,-.01,.39,.28,.34);box(0,3.28,.16,.82,.06,.53);rod([0,3.55,-.02],[0,3.92,-.06],.06); // helmet crest
  for(const sign of [-1,1])box(sign*.33,3.05,-.05,.1,.43,.42,dark);
 }
 // Shared facial cues: nose, brows and recessed eyes. Fine portrait likeness remains approximate.
 const faceZ=id==='sejong'?.41:.29;oval(0,3.08,faceZ,.065,.13,.075);for(const sign of [-1,1]){oval(sign*.13,3.17,faceZ,.10,.026,.045,dark);oval(sign*.13,3.10,faceZ+.018,.04,.024,.022,dark);}
 if(id==='sejong'){for(let i=-5;i<=5;i++){const x=i*.17;const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x*.7,1.50,.91),new THREE.Vector3(x,1.05,1.12),new THREE.Vector3(x*1.14,.48,1.05),new THREE.Vector3(x*1.2,.27,1.1)]);add(new THREE.TubeGeometry(curve,12,.025,5,false),dark);}}
 const figure=mergeGeometries(pieces,false)!;pieces.forEach(g=>g.dispose());pieces=[];
 figure.computeBoundingBox();const bounds=figure.boundingBox!;
 const sx=spec.width/(bounds.max.x-bounds.min.x),sy=spec.figure/(bounds.max.y-bounds.min.y);
 figure.translate(0,-bounds.min.y,0);figure.scale(sx,sy,sx);figure.translate(0,spec.base,0);pieces.push(figure);
 // Granite stepped plinth. Yi's tall shaft and Sejong's broad low pedestal differ.
 const w=spec.pedestalWidth,d=spec.pedestalDepth,h=spec.base;
 box(0,.15,0,w,.3,d,'#a7a397');box(0,.4,0,w*.94,.2,d*.94,'#bcb6a7');
 box(0,(h+.5)/2,0,w*(id==='yi'?.58:.88),h-.5,d*(id==='yi'?.58:.88),'#aaa28d');
 box(0,h-.13,0,w*.94,.26,d*.94,'#c4bead');
 if(id==='yi'){
  // Turtle ship and two drums on the lower platform, as documented by Seoul.
  oval(0,.88,d*.34,1,.25,.46,dark);oval(0,1.09,d*.34,.85,.20,.40);
  for(const sign of [-1,1]){const drum=new THREE.CylinderGeometry(.38,.38,.45,20);drum.rotateX(Math.PI/2);drum.translate(sign*1.75,.93,d*.30);add(drum,dark);}
 }
 const merged=mergeGeometries(pieces,false)!;pieces.forEach(g=>g.dispose());
 merged.rotateY(-.0332);merged.translate(spec.x-ox,baseY,spec.z-oz);return merged;
}
