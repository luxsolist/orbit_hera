import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {FacadeGrammarSettings,GrammarName,GrammarZone} from './cities/types';
// 일반 건물 외관 문법(상세 프로필 전용). 실제 건물 용도·재료 데이터가 없으므로 위치(도시별 대표 가로권역),
// 높이, 면적, 큰길 인접 여부로 원형을 고른다. 권역·규칙·색·간판 밀도는 도시 프로필
// (CityDetailSettings.grammar)이 정하고, 이 모듈은 원형 형태와 셰이더만 담당한다.
// 원형은 서울 참고 사진(Wikimedia Commons, 2026-10 검색)에서 읽은 반복 규칙이다:
//  · 강남 테헤란로 — 유리 커튼월, 멀리언·스팬드럴, 옥상 크라운·사명 간판 (File:Teheran-ro_Yeongdong-daero_crossing_1.jpg, File:Teheran-ro_01.jpg)
//  · 종로 — 석재/타일 펀치 창 업무 건물, 1층 상점 + 색 간판 띠 + 타일 외벽 (File:Downtown_Seoul_along_Jongno_Street_in_2020.jpg, File:Jongno_district_Seoul_Oct_2014_04.JPG)
//  · 명동 — 2층 통유리 매장, 외벽 LED, 돌출 세로 간판 (File:Myeongdong_street.jpg, File:Seoul-Myeongdong-03.jpg)
// 사진을 복제하거나 개별 건물을 복원하지 않는다.

export const GRAMMAR={none:0,glassTower:1,stoneOffice:2,streetCommercial:3,retailFlagship:4,sign:9,screen:10} as const;
export type GrammarKind=typeof GRAMMAR[keyof typeof GRAMMAR];

/** Cell-local metres of a lat/lon on the map cell grid (same formula as chunkManifest). */
function cellLocal(cell:readonly [number,number],lat:number,lon:number):[number,number]{
 return [(lon-cell[1])*111320*Math.cos((cell[0]+.5)*Math.PI/180),(cell[0]+1-lat)*111320];
}
/** First matching zone (list order = priority) at a cell-local point. */
export function grammarZone(x:number,z:number,settings:FacadeGrammarSettings):GrammarZone|undefined {
 return settings.zones.find(d=>{const [x0,z1]=cellLocal(settings.cell,d.south,d.west),[x1,z0]=cellLocal(settings.cell,d.north,d.east);return x>=x0&&x<=x1&&z>=z0&&z<=z1;});
}
/** Blade/rooftop signage density at a point (zone value, else the city fallback). */
export function signDensity(x:number,z:number,settings:FacadeGrammarSettings):number {
 return (grammarZone(x,z,settings)??settings.fallback).signDensity;
}
function hash(x:number,z:number,salt:number):number {
 let h=Math.imul(Math.round(x*10)^salt,0x45d9f3b)^Math.imul(Math.round(z*10)+salt*31,0x27d4eb2d);
 h=Math.imul(h^(h>>>16),0x85ebca6b);return ((h^(h>>>13))>>>0)/4294967296;
}

/** Archetype from position, height (m), footprint area (m²) and a wide-street frontage flag. Pure. */
export function facadeGrammar(x:number,z:number,h:number,area:number,mainStreet:boolean,settings:FacadeGrammarSettings):GrammarKind {
 if(area<settings.minArea)return GRAMMAR.none;
 const rules=(grammarZone(x,z,settings)??settings.fallback).rules;
 const rule=rules.find(r=>h>=r.minHeight&&h<(r.maxHeight??Infinity)&&(!r.mainStreet||mainStreet));
 if(!rule)return GRAMMAR.none;
 let pick=hash(x,z,7);
 for(const [name,weight] of rule.mix){if(pick<weight)return GRAMMAR[name];pick-=weight;}
 return GRAMMAR.none;
}
/** Base facade kind the shared night/occupancy code expects for each archetype. */
export function grammarFacadeKind(kind:GrammarKind,fallback:number):number {
 return kind===GRAMMAR.glassTower||kind===GRAMMAR.stoneOffice?2:kind===GRAMMAR.streetCommercial||kind===GRAMMAR.retailFlagship?0:fallback;
}
const NAMES:Record<number,GrammarName>={[GRAMMAR.glassTower]:'glassTower',[GRAMMAR.stoneOffice]:'stoneOffice',[GRAMMAR.streetCommercial]:'streetCommercial',[GRAMMAR.retailFlagship]:'retailFlagship'};
export function grammarPaint(kind:GrammarKind,x:number,z:number,settings:FacadeGrammarSettings):number|undefined {
 const list=NAMES[kind]?settings.paint[NAMES[kind]]:undefined;return list?.length?list[Math.floor(hash(x,z,13)*list.length)]:undefined;
}

type Box={w:number;h:number;d:number;x:number;y:number;z:number;yaw:number;color:number;grammar:number};
/** Face-local sign coordinates in metres: (u·width, v·height, width + 1000·round(height·10)). */
export function decodeSignSize(z:number):[number,number]{const h=Math.floor(z/1000);return [z-h*1000,h/10];}
function boxes(list:Box[]):THREE.BufferGeometry|null {
 if(!list.length)return null;
 const parts=list.map(b=>{
  const g=new THREE.BoxGeometry(b.w,b.h,b.d).toNonIndexed(),uv=g.getAttribute('uv');
  const n=g.getAttribute('position').count,c=new THREE.Color(b.color),color=new Float32Array(n*3),grammar=new Float32Array(n).fill(b.grammar),sign=new Float32Array(n*3);
  // BoxGeometry face order: ±x (d×h), ±y (w×d), ±z (w×h); six vertices per face after toNonIndexed.
  for(let i=0;i<n;i++){
   color.set([c.r,c.g,c.b],i*3);
   const face=Math.floor(i/6),[fw,fh]=face<2?[b.d,b.h]:face<4?[b.w,b.d]:[b.w,b.h];
   sign.set([uv.getX(i)*fw,uv.getY(i)*fh,fw+1000*Math.round(fh*10)],i*3);
  }
  g.deleteAttribute('uv');g.rotateY(b.yaw);g.translate(b.x,b.y,b.z);
  g.setAttribute('color',new THREE.BufferAttribute(color,3));g.setAttribute('ornamentGrammar',new THREE.BufferAttribute(grammar,1));g.setAttribute('signCoord',new THREE.BufferAttribute(sign,3));return g;
 });
 const merged=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());return merged;
}

/**
 * Low-vertex ornaments (≤ ~6 boxes per building): rooftop plant/crown, parapets, shop fascias,
 * blade signs and LED panels. Local render frame. `toward` is a unit vector to the nearest street.
 */
export function grammarOrnaments(kind:GrammarKind,poly:number[],base:number,top:number,toward:[number,number]|undefined,seedX:number,seedZ:number,busy:number,signs:readonly number[]):THREE.BufferGeometry|null {
 const SIGNS=signs.length?signs:[0xf4f1e8];
 if(kind===GRAMMAR.none)return null;
 const n=poly.length/2;let cx=0,cz=0;for(let i=0;i<n;i++){cx+=poly[i*2];cz+=poly[i*2+1];}cx/=n;cz/=n;
 let area=0;for(let i=0,j=n-1;i<n;j=i++)area+=poly[j*2]*poly[i*2+1]-poly[i*2]*poly[j*2+1];
 const ccw=area>0; // outward normal side depends on winding (x,z plane)
 // Street frontage: the long edge whose outward normal faces the street (fallback: longest edge).
 let front=-1,score=-Infinity;
 for(let i=0;i<n;i++){
  const j=(i+1)%n,ex=poly[j*2]-poly[i*2],ez=poly[j*2+1]-poly[i*2+1],len=Math.hypot(ex,ez);if(len<3.5)continue;
  const nx=(ccw?ez:-ez)/len,nz=(ccw?-ex:ex)/len,facing=toward?nx*toward[0]+nz*toward[1]:0;
  const s=len*(toward?Math.max(.05,facing):1);if(s>score){score=s;front=i;}
 }
 const r=(salt:number)=>hash(seedX,seedZ,salt),list:Box[]=[],height=top-base;
 // Rooftop plant: a modest box at the centroid, kept inside small footprints.
 const span=Math.sqrt(Math.abs(area)/2);
 if(span>6&&kind!==GRAMMAR.retailFlagship)list.push({w:Math.min(9,span*.42),h:kind===GRAMMAR.glassTower?4.2:2.6,d:Math.min(7,span*.34),x:cx,y:top+(kind===GRAMMAR.glassTower?2.1:1.3),z:cz,yaw:r(3)*Math.PI,color:kind===GRAMMAR.glassTower?0x7d8a90:0xb4b1a8,grammar:0});
 if(front<0)return boxes(list);
 const i=front,j=(i+1)%n,ax=poly[i*2],az=poly[i*2+1],ex=poly[j*2]-ax,ez=poly[j*2+1]-az,len=Math.hypot(ex,ez);
 const ux=ex/len,uz=ez/len,nx=ccw?uz:-uz,nz=ccw?-ux:ux,yaw=Math.atan2(-uz,ux);
 const at=(t:number,out:number)=>[ax+ex*t+nx*out,az+ez*t+nz*out];
 if(kind===GRAMMAR.glassTower){
  // Crown fin along the frontage; a lit corporate sign on some towers (cf. Teheran-ro).
  const [x,z]=at(.5,-.6);
  list.push({w:len*.92,h:2.4,d:.5,x,z,y:top+1.2,yaw,color:0x9fb3bb,grammar:0});
  if(r(5)<.45&&height>45){const [sx,sz]=at(.5,-.2);list.push({w:Math.min(len*.55,16),h:3.2,d:.35,x:sx,z:sz,y:top+4.1,yaw,color:SIGNS[Math.floor(r(6)*Math.min(3,SIGNS.length))],grammar:GRAMMAR.sign});}
 }else if(kind===GRAMMAR.stoneOffice){
  const [x,z]=at(.5,-.3);list.push({w:len,h:1.1,d:.6,x,z,y:top+.55,yaw,color:0xcfc6b5,grammar:0});
  if(r(5)<.35){const [sx,sz]=at(.5,.12);list.push({w:Math.min(len*.4,7),h:1.6,d:.25,x:sx,z:sz,y:top-2.2,yaw,color:SIGNS[Math.floor(r(6)*SIGNS.length)],grammar:GRAMMAR.sign});}
 }else{
  // Shopfront fascia band over the ground floor, then a few blade signs (density by district).
  const fascia=SIGNS[Math.floor(r(8)*SIGNS.length)],[fx,fz]=at(.5,.14);
  list.push({w:len*.94,h:.85,d:.28,x:fx,z:fz,y:base+3.35,yaw,color:fascia,grammar:GRAMMAR.sign});
  const blades=height<9||r(9)>busy?0:len>16&&r(17)<busy*.6?2:1;
  for(let b=0;b<blades;b++){
   const t=b===0?.1+r(18)*.15:.9-r(19)*.15,[bx,bz]=at(t,.36),bh=Math.min(height-5.5,2.6+r(10+b)*3);if(bh<2)continue;
   list.push({w:.2,h:bh,d:.7,x:bx,z:bz,y:base+4.8+bh/2,yaw,color:SIGNS[Math.floor(r(12+b)*SIGNS.length)],grammar:GRAMMAR.sign});
  }
  if(kind===GRAMMAR.retailFlagship&&height>12){
   // Wall-mounted LED screen (Myeongdong) above the double-height shopfront.
   const pw=Math.min(len*.5,12),ph=Math.min(10,height*.45,pw*1.4),[px,pz]=at(.5,.18);
   list.push({w:pw,h:ph,d:.26,x:px,z:pz,y:base+7.6+ph/2,yaw,color:0x1a1d22,grammar:GRAMMAR.screen});
  }else if(height<26&&r(15)<.05+busy*.2){
   // Rooftop billboard on low commercial blocks.
   const [px,pz]=at(.5,-1.2);list.push({w:Math.min(len*.7,9),h:3,d:.3,x:px,z:pz,y:top+2.3,yaw,color:SIGNS[Math.floor(r(16)*SIGNS.length)],grammar:GRAMMAR.sign});
  }
 }
 return boxes(list);
}

/**
 * Fragment snippet appended to the facade colour stage (detail profile only). Uses the base shader's
 * locals (fPosition, fFace, fKind, fVariant, glazing, night* masks). Mobile-safe: analytic patterns,
 * one derivative normal for glass reflection, no textures.
 */
/** Glass reflects the city's painted sky (linear RGB horizon/zenith). */
export function grammarGlsl(horizon:readonly number[],zenith:readonly number[]):string {
 const v=(c:readonly number[],k=1)=>`vec3(${c.map(x=>(x*k).toFixed(3)).join(',')})`;
 return `
  if(fGrammar>8.5){
   // Sign faces carry face-local metres (FacadeGrammar.boxes): framed panel, hangul-like glyph blocks.
   float signH=floor(fPosition.z/1000.0)/10.0,signW=fPosition.z-signH*1000.0;
   vec2 sp=fPosition.xy,size=vec2(signW,signH);
   float edge=min(min(sp.x,size.x-sp.x),min(sp.y,size.y-sp.y));
   float frame=1.0-smoothstep(.05,.09,edge);
   vec3 base=vColor.rgb;
   if(fGrammar>9.5){
    // LED screen: soft colour fields (no text), bright at night.
    vec2 q=sp/max(size,vec2(.1));
    float blob=smoothstep(.55,.15,length(q-vec2(.35+.3*fract(fVariant*13.0),.55)))+smoothstep(.5,.1,length(q-vec2(.72,.3)));
    vec3 a=mix(vec3(.85,.35,.45),vec3(.25,.55,.85),fract(fVariant*7.0)),b=mix(vec3(.95,.85,.55),vec3(.45,.8,.65),fract(fVariant*3.0));
    base=mix(mix(a*.7,b,q.y),vec3(.95),blob*.45);
   }else{
    bool vertical=size.y>size.x*1.6;
    float cell=max(.16,(vertical?size.x:size.y)*.62);
    vec2 g=(sp-(vertical?vec2(size.x*.5,.12):vec2(.12,size.y*.5)))/cell+(vertical?vec2(.5,0.0):vec2(0.0,.5));
    vec2 ci=floor(g),cf=fract(g);
    float inside=step(0.0,ci.x)*step(0.0,ci.y)*(vertical?step(ci.x,0.0):step(ci.y,0.0));
    vec2 sub=floor(cf*3.0);float stroke=step(.45,fract(sin(dot(ci*3.0+sub+fVariant*vec2(17.0,29.0),vec2(127.1,311.7)))*43758.5453));
    float margin=step(.12,cf.x)*step(cf.x,.88)*step(.12,cf.y)*step(cf.y,.88);
    vec3 ink=dot(base,vec3(.2126,.7152,.0722))>.38?vec3(.06,.07,.09):vec3(.97,.96,.92);
    base=mix(base,ink,inside*stroke*margin*.9);
   }
   diffuseColor.rgb=mix(base,vec3(.12,.13,.14),frame);
   signGlow=diffuseColor.rgb*(fGrammar>9.5?1.3:1.0);
  }else if(fGrammar>.5 && fKind>=0.0 && fFace<1.5){
   float wallU=fFace<.5?fPosition.z:fPosition.x;
   vec3 paint=vColor.rgb;
   vec2 uvAA=max(fwidth(vec2(wallU,fPosition.y)),vec2(.002));
   float far=smoothstep(.12,.5,max(uvAA.x,uvAA.y));
   if(fGrammar<1.5){
    // Glass curtain wall: 1.5m mullions, 3.9m floors, opaque spandrel band, sky reflection.
    vec2 g=vec2(wallU/1.5+fVariant,fPosition.y/3.9);vec2 c=fract(g),ga=max(fwidth(g),vec2(.002));
    float mullion=max(1.0-smoothstep(.03,.03+ga.x*1.5,min(c.x,1.0-c.x)),1.0-smoothstep(.025,.025+ga.y*1.5,min(c.y,1.0-c.y)));
    float spandrel=1.0-smoothstep(.20,.20+ga.y,c.y);
    vec3 faceN=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));
    vec3 viewV=normalize(vViewPosition);
    vec3 refl=reflect(-viewV,faceN),upV=normalize((viewMatrix*vec4(0.0,1.0,0.0,0.0)).xyz);
    float up=dot(refl,upV);
    vec3 skyRefl=mix(${v(horizon,.92)},${v(zenith)},smoothstep(0.0,.7,up));
    skyRefl=mix(vec3(.30,.31,.30),skyRefl,smoothstep(-.18,.04,up));
    float fres=.35+.55*pow(1.0-clamp(dot(faceN,viewV),0.0,1.0),3.0);
    vec3 glassC=mix(paint*.62,skyRefl,fres);
    glassC*=mix(.92,1.06,fract(sin(dot(floor(g),vec2(41.3,17.9)))*9137.1)*(1.0-far));
    vec3 frame=paint*.55+vec3(.04);
    diffuseColor.rgb=mix(mix(glassC,paint*.78,spandrel*(1.0-far*.5)),frame,mullion*(1.0-far));
    glazing=(1.0-mullion)*(1.0-spandrel);
   }else if(fGrammar<2.5){
    // Stone / tile office: 3.2m bays, punched windows, darker two-storey plinth.
    vec2 g=vec2(wallU/3.2+fVariant,fPosition.y/3.7);vec2 c=fract(g),ga=max(fwidth(g),vec2(.002));
    float win=(1.0-smoothstep(.27,.27+ga.x,abs(c.x-.5)))*smoothstep(.24,.24+ga.y,c.y)*(1.0-smoothstep(.80,.80+ga.y,c.y));
    float plinth=1.0-smoothstep(7.2,7.4,fPosition.y);
    float jointD=.5-abs(fract(fPosition.y/1.2)-.5),joint=(1.0-smoothstep(.015,.015+fwidth(fPosition.y/1.2)*1.5,jointD))*(1.0-far);
    vec3 stone=paint*mix(1.0,.8,plinth)*(1.0-joint*.05);
    vec3 glass=mix(vec3(.16,.22,.27),vec3(.32,.40,.46),fract(sin(dot(floor(g),vec2(12.9,78.2)))*437.5));
    float groundGlass=plinth*(1.0-smoothstep(.36,.36+ga.x,abs(c.x-.5)))*step(.4,fPosition.y)*(1.0-smoothstep(3.3,3.5,fPosition.y));
    float w=max(win*(1.0-plinth),groundGlass);
    diffuseColor.rgb=mix(stone,glass,w*mix(1.0,.55,far));
    glazing=w;nightShop=groundGlass;nightGlazing=w;nightCell=floor(g);
   }else{
    // Street commercial / retail: glazed shopfront (double height for flagships), tiled upper wall.
    float shopTop=fGrammar>3.5?7.0:3.0;
    float shop=step(.15,fPosition.y)*(1.0-smoothstep(shopTop,shopTop+.1,fPosition.y));
    vec2 sg=vec2(wallU/2.4+fVariant,fPosition.y/shopTop);float sc=fract(sg.x),sa=max(fwidth(sg.x),.002);
    float shopMullion=1.0-smoothstep(.04,.04+sa*1.5,min(sc,1.0-sc));
    vec3 interior=mix(vec3(.30,.33,.34),vec3(.52,.48,.40),fract(sin(floor(sg.x)*91.7)*137.3));
    vec3 shopC=mix(interior,vec3(.18,.19,.2),shopMullion);
    vec3 upper=paint;
    if(fGrammar>3.5){
     // Flagship upper wall: tall panels with a few slot windows.
     float panel=fract(wallU/3.6+fVariant);float pa=max(fwidth(wallU/3.6),.002);
     float seam=1.0-smoothstep(.02,.02+pa*1.5,min(panel,1.0-panel));
     float slot=(1.0-smoothstep(.06,.06+pa,abs(panel-.5)))*step(.5,fract(fVariant*7.0));
     upper=mix(paint,paint*.8,seam*(1.0-far));
     upper=mix(upper,vec3(.18,.24,.28),slot);glazing=max(glazing,slot*(1.0-shop));
    }else{
     // Korean commercial walls: small square tiles and horizontal ribbon windows per 3.3m floor.
     vec2 tg=vec2(wallU,fPosition.y)/.45;vec2 tc=abs(fract(tg)-.5),ta=max(fwidth(tg),vec2(.002));
     float grout=max(1.0-smoothstep(.45,.45+ta.x,tc.x),1.0-smoothstep(.45,.45+ta.y,tc.y));
     upper=paint*(1.0-(1.0-grout)*.06*(1.0-far));
     vec2 wg=vec2(wallU/2.2+fVariant,(fPosition.y-shopTop)/3.3);vec2 wc=fract(wg),wa=max(fwidth(wg),vec2(.002));
     float ribbon=smoothstep(.30,.30+wa.y,wc.y)*(1.0-smoothstep(.76,.76+wa.y,wc.y))*(1.0-smoothstep(.44,.44+wa.x,abs(wc.x-.5)))*step(shopTop+.9,fPosition.y);
     upper=mix(upper,mix(vec3(.20,.26,.30),vec3(.36,.44,.49),wc.y),ribbon*mix(1.0,.6,far));
     glazing=max(glazing,ribbon);nightGlazing=ribbon;nightCell=floor(wg);
    }
    diffuseColor.rgb=mix(upper,shopC,shop);
    glazing=max(glazing,shop*(1.0-shopMullion));nightShop=shop;nightGlazing=max(nightGlazing,shop);
   }
   // Contact darkening at the street (cheap ambient occlusion stand-in).
   diffuseColor.rgb*=mix(.8,1.0,smoothstep(0.0,3.2,fPosition.y));
  }
`;
}
