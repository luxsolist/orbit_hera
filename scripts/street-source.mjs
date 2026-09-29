import {isVehicularHighway,roadWidthInfo,relationPolys,surfaceBuildingKind,structureFields,buildingVerticalFields,buildingHeightInfo,buildingHeightProvenance,sanitizeRing,ringArea} from './osm.mjs';
import {waterMetadata,waterChunkPieces} from './water-build.mjs';
import {isUndergroundWaterway} from './osm.mjs';
import {clipPolylineToRect} from './clip.mjs';
export const WALK_HIGHWAYS=new Set(['pedestrian','footway','path','steps','cycleway']);
export function isStreetSource(t={}){return !!t.waterway||t.natural==='water'||!!t.water||!!t.tourism||!!t.historic||!!t.building||!!t['building:part']||isVehicularHighway(t.highway)||WALK_HIGHWAYS.has(t.highway)||!['building','underground'].includes(surfaceBuildingKind(t));}
export function collectStreetSource(elements,project,policy={}){
 const roads=[],walking=[],buildings=[],water=[],roles={},elementsById=new Map(elements.map(e=>[e.type+'/'+e.id,e]));
 for(const e of elements){const t=e.tags??{},id=e.type+'/'+e.id;
  roles[id]=t.building||t['building:part']?'building':t.tourism||t.historic?'site':'other';
  const waterArea=t.natural==='water'||!!t.water||t.waterway==='riverbank';
  if((waterArea||['river','stream','canal','ditch','drain'].includes(t.waterway))&&!isUndergroundWaterway(t)){
   if(waterArea){for(const poly of e.type==='relation'?relationPolys(e,project):(e.geometry?.length>=4?[{outer:e.geometry.flatMap(g=>project(g.lat,g.lon)),holes:[]}]:[]))water.push({p:poly.outer,holes:poly.holes,...waterMetadata(t,id)});}
   else if(e.type==='way'&&e.geometry?.length>1)water.push({p:e.geometry.flatMap(g=>project(g.lat,g.lon)),...waterMetadata(t,id,true)});
  }
  const open=!['building','underground'].includes(surfaceBuildingKind(t));
  // Platform edges are lines, not closed platform footprints.
  if(open&&e.type==='way'&&(!e.geometry?.length||e.geometry[0].lat!==e.geometry.at(-1).lat||e.geometry[0].lon!==e.geometry.at(-1).lon))continue;
  if(t.building||t['building:part']||open){
   if(surfaceBuildingKind(t)==='underground')continue;
   const polys=e.type==='relation'?relationPolys(e,project):(e.geometry?.length>=4?[{outer:e.geometry.flatMap(p=>project(p.lat,p.lon)),holes:[]}]:[]);
   for(const poly of polys){const p=sanitizeRing(poly.outer,false);if(!p||ringArea(p)<2)continue;
    // A building relation may outline an elevated connector. Preserve the
    // outline way's explicit vertical role instead of filling its underpass.
    const member=e.tags?.type==='building'?(e.members??[]).find(m=>m.role==='outline'&&m.geometry?.length&&m.geometry.every(g=>{const q=project(g.lat,g.lon);return poly.outer.some((v,i)=>i%2===0&&Math.abs(v-q[0])<.01&&Math.abs(poly.outer[i+1]-q[1])<.01);})):null;
    const outline=member?elementsById.get('way/'+member.ref)?.tags:null;
    const vertical=outline&&(outline.layer||outline.min_height||outline['building:min_level']||outline.bridge)?buildingVerticalFields({...t,...outline}):buildingVerticalFields(t);
    buildings.push({p,holes:poly.holes??[],h:buildingHeightInfo(t).h,...buildingHeightProvenance(t,id),...structureFields(t),...vertical,...(t.amenity==='car_wash'?{vehiclePassage:true}:{}),ruin:t.ruins==='yes'||t.historic==='ruins'||t.building==='ruins',buildingType:t.building??t['building:part'],sourceLevel:t.level,sourceFootprints:[poly]});
   }
  }else if(e.type==='way'&&e.geometry?.length>1&&(isVehicularHighway(t.highway)||WALK_HIGHWAYS.has(t.highway))){
   const p=e.geometry.flatMap(p=>project(p.lat,p.lon)),meta={id,osmId:id,p,highway:t.highway,name:t.name??t.ref??'',roadName:t.name??t.ref??'',nodes:e.nodes,oneway:t.oneway??'no',lanes:t.lanes,surface:t.surface,foot:t.foot,bicycle:t.bicycle,ford:t.ford,location:t.location,incline:t.incline,covered:t.covered,indoor:t.indoor,level:t.level,footway:t.footway,service:t.service,access:t.access,bridge:!!t.bridge&&t.bridge!=='no',tunnel:!!t.tunnel&&t.tunnel!=='no',layer:Number(t.layer)||0};
   if(isVehicularHighway(t.highway))roads.push({...meta,...roadWidthInfo(t)});
   else walking.push({...meta,w:Math.max(.7,Math.min(12,parseFloat(t.width)||policy.pedestrianWidth||2.5)),area:t.area==='yes',stepCount:Number(t.step_count)||undefined});
  }
 }
 const waterByChunk=new Map();
 for(const w of water)for(const piece of waterChunkPieces(w,p=>p)){const k=piece.cx+'_'+piece.cz,list=waterByChunk.get(k)??[];list.push(piece.water);waterByChunk.set(k,list);}
 return {roads,walking,buildings,roles,waterByChunk};
}
/** Rehydrate legacy geometry from source; retain reviewed models by ID and footprint. */
export function refreshStreetObjects(chunk,source){
 const authored=chunk.objects.buildings.filter(b=>b.seoulArchitecture||b.landmarkModel||b.palaceBuildingId||b.statueModel);
 const sites=authored.filter(b=>source.roles?.[b.osmId]==='site');
 const custom=authored.filter(b=>source.roles?.[b.osmId]!=='site');
 const ids=new Set(custom.map(b=>b.osmId).filter(Boolean));
 const owned=b=>{const p=b.p,n=p.length/2;let x=0,z=0;for(let i=0;i<p.length;i+=2){x+=p[i];z+=p[i+1];}return Math.floor(x/n/1024)===chunk.cx&&Math.floor(z/n/1024)===chunk.cz;};
 const contains=(p,x,z)=>{let yes=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])yes=!yes;return yes;};
 const replaced=b=>ids.has(b.osmId)||custom.some(c=>b.p.every((v,i)=>i%2||contains(c.p,b.p[i],b.p[i+1])));
 const buildings=source.buildings.filter(b=>owned(b)&&!replaced(b));
 const roads=source.roads.flatMap(r=>clipPolylineToRect(r.p,chunk.cx*1024,chunk.cz*1024,(chunk.cx+1)*1024,(chunk.cz+1)*1024).map(p=>({...r,p})));
 return {...chunk,objects:{...chunk.objects,...(source.waterByChunk?{water:source.waterByChunk.get(chunk.cx+'_'+chunk.cz)??[]}:{}),sites:[...(chunk.objects.sites??[]),...sites.map(b=>{const n=b.p.length/2;return {x:b.p.filter((_,i)=>i%2===0).reduce((a,v)=>a+v,0)/n,z:b.p.filter((_,i)=>i%2===1).reduce((a,v)=>a+v,0)/n,y:chunk.terrain.heights[Math.floor(chunk.terrain.heights.length/2)],r:25,lm:b.lm??'archive',n:b.n,osmId:b.osmId};})],buildings:[...custom,...buildings.filter(b=>!b.structureKind)],structures:buildings.filter(b=>b.structureKind),roads}};
}
