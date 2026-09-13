import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {applySeoulLandmarkAppearance,landmarkRoof,type LandmarkAppearance} from '../src/world/cities/SeoulLandmarkAppearance';
import {buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {paintedSeoul} from '../src/world/cities/painted';
import type {WorldChunk} from '../src/world/chunkManifest';
import type {Ring} from '../src/world/MapData';
import index from '../src/world/cities/seoul-landmark-appearance-index.json';
const p=[10,10,30,10,30,22,10,22];
const appearance:LandmarkAppearance={p,source:null,height:null,levels:null,roofShape:'gabled',roofHeight:4,wallColor:'#a87868',roofColor:'#606971',wallMaterial:'brick',buildingType:'church',status:'mapped-shell-estimate'};
const raw={cx:0,cz:0,terrain:{size:2,heights:[0,0,0,0]},objects:{buildings:[{p,h:20,lm:'ritual',n:'test'}],roads:[],walls:[],water:[]}} as WorldChunk;
it('preserves gameplay identity, unknown height, other cities and bespoke models',()=>{
 const patch={version:1,buildings:[appearance]},out=applySeoulLandmarkAppearance([37,126],raw,patch);
 expect(out.objects.buildings[0]).toMatchObject({lm:'ritual',n:'test',h:20,p});expect(raw.objects.buildings[0].landmarkAppearance).toBeUndefined();
 expect(applySeoulLandmarkAppearance([35,129],raw,patch)).toBe(raw);
 const model={...raw,objects:{...raw.objects,buildings:[{...raw.objects.buildings[0],landmarkModel:'existing'}]}};
 expect(applySeoulLandmarkAppearance([37,126],model,patch).objects.buildings[0]).toBe(model.objects.buildings[0]);
 expect(applySeoulLandmarkAppearance([37,126],raw,{version:1,buildings:[{...appearance,p:[0,0,1,0,1,1]}]}).objects.buildings[0]).toBe(raw.objects.buildings[0]);
});
it('keeps roof peaks inside the mapped height and does not roof over courtyards',()=>{
 const b={...raw.objects.buildings[0],landmarkAppearance:appearance};
 const roof=landmarkRoof(b,p,2,22)!;expect(roof).toBeTruthy();roof.geometry.computeBoundingBox();expect(roof.geometry.boundingBox!.max.y).toBe(22);expect(Array.from(roof.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);roof.geometry.dispose();
 expect(landmarkRoof({...b,holes:[[12,12,15,12,15,15]]},p,2,22)).toBeNull();
});
it('renders landmark shells with facade attributes while keeping combat vertex ranges valid',()=>{
 const city={...paintedSeoul,props:{...paintedSeoul.props,enabled:false},ground:{...paintedSeoul.ground,enabled:false},street:{...paintedSeoul.street,geometry:false}};
 const chunk=applySeoulLandmarkAppearance([37,126],raw,{version:1,buildings:[appearance]});
 const built=buildChunkMesh(chunk,1024,0,0,city),geometry=built.buildingMesh!.geometry;
 expect(built.buildings[0].lm).toBe('ritual');expect(geometry.getAttribute('facadeKind').getX(0)).toBeGreaterThanOrEqual(0);
 expect(built.buildings[0].vCount).toBe(geometry.getAttribute('position').count);
 const c=geometry.getAttribute('color'),faces=geometry.getAttribute('facadeFace');const wall=Array.from({length:faces.count},(_,i)=>i).find(i=>faces.getX(i)<1.5)!;expect(c.getX(wall)).toBeGreaterThan(c.getY(wall));disposeChunkGroup(built.group);
});
it('covers every baked landmark in the Seoul cell with an exact footprint entry',()=>{
 const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));let count=0;
 for(const t of read('public/maps/37/126/tiles.json').chunks){const key=`${t.cx}_${t.cz}`,raw=read(`public/maps/37/126/${Math.floor(t.cx/16)}_${Math.floor(t.cz/16)}/${key}.json`);
  const landmarks=raw.objects.buildings.filter((b:Ring)=>b.lm);if(!landmarks.length)continue;
  expect(index.chunks).toContain(key);const entries=read(`public/maps/landmark-appearance/seoul/${key}.json`).buildings;
  for(const b of landmarks){expect(entries.some((e:LandmarkAppearance)=>JSON.stringify(e.p)===JSON.stringify(b.p))).toBe(true);count++;}
 }
 expect(count).toBeGreaterThan(800);
},30000);
