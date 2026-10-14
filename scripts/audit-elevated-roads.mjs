// Elevated road / roadside tree audit over the shipped map bundles (what the game renders).
//
//   npm run maps:audit-roads -- <city> [--out build/<city>-elevated-audit.json] [--strict] [--ref <git-ref>]
//   --ref audits the bundles committed at that ref (before/after comparisons on the same rules).
//
// Checks, city-wide and across chunk seams:
//  · deck junctions — every end of an elevated (bridge / layer>0) road piece is either a
//    continuation of another elevated piece, a portal onto an at-grade road, or a dead end.
//    A portal whose deck surface sits more than STEP_LIMIT above the ground carriageway has no
//    usable connection (the "floating end" / "missing ramp" class). A dead end hanging above
//    the terrain is a floating deck stub.
//  · buildings — a carriageway (any level) inside a footprint between the volume's base and roof
//    (deck-structure.mjs roadsThroughBuildings; the build cuts them with clearBuildingsOfRoads).
//  · road surfaces — a carriageway over another with too little headroom (HEADROOM_SEAM–HEADROOM_MIN, sampled on a
//    2 m grid and grouped in 40 m spots: a lifted street pressed up under a deck, a deck sunk onto
//    the one below) and deck surfaces steeper than STEEP_DECK (a folded or twisted slab).
//  · trees — every vegetation site the runtime would place is tested against at-grade
//    carriageways (trunk on the road) and elevated deck footprints (crown through the deck).
// --strict compares against config/map-quality/elevated-roads.json (per-city ceilings) and exits 1
// when a count rises above it — trees on roads have a ceiling of zero. The bundle step runs this
// gate, so a later map build cannot silently bring the defects back.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createServer} from 'vite';
import {loadMapCities,selectMapCities} from './map-city-config.mjs';
import {deckTreeConflict,crownProbe,TREE_TOP_PER_SCALE} from '../src/world/treeClearance.mjs';
import {PORTAL_REACH,ELEVATED_GAP,slimTerrain,nodeKey,roadsThroughBuildings,RoadDeadEnds} from './deck-structure.mjs';

export const STEP_LIMIT=1.0;      // m — deck surface above the ground carriageway at a portal
export const FLOAT_LIMIT=1.5;     // m — dead-end deck surface above terrain
export const HEADROOM_MIN=4;      // m — carriageway over carriageway
export const HEADROOM_SEAM=STEP_LIMIT; // m — closer surfaces are a seam / slab lip, measured as portal steps instead
export const STEEP_DECK=20;       // ° — deck facet slope
const NODE=.5;                    // m — endpoint matching tolerance (seam pieces share exact points)

const args=process.argv.slice(2),flag=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1]??true;};
const cities=await loadMapCities(),[city]=selectMapCities(cities,args.find(a=>!a.startsWith('--')));
const cell=cities[city],out=flag('--out')??`build/${city}-elevated-audit.json`,strict=args.includes('--strict');
const ref=flag('--ref'),load=path=>ref?execFileSync('git',['show',`${ref}:${path}`],{maxBuffer:1<<30}):readFileSync(path);
const index=JSON.parse(load(`src/world/${city}-bundles.json`).toString());

const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true},logLevel:'error'});
try{
 const {vegetationSites}=await server.ssrLoadModule('/src/world/Vegetation.ts');
 const {chunkTerrainEntry,sampleChunkLandHeight}=await server.ssrLoadModule('/src/world/chunkMesh.ts');
 const {cityAppearance}=await server.ssrLoadModule('/src/world/cities/index.ts');
 const {seoulDetailTrees}=await server.ssrLoadModule('/src/world/cities/SeoulDetail.ts');
 const {palaceTrees}=await server.ssrLoadModule('/src/world/cities/PalaceSite.ts');
 const {pilotTreeSites}=await server.ssrLoadModule('/src/world/cities/CheonggyeStreetDetails.ts');
 const settings=cityAppearance(`${city}-stream`).detail?.vegetation;

 const key=nodeKey; // numeric 0.5 m key, shared with the build
 const ends=[];              // elevated piece ends {x,z,chunk}
 let pieceId=0;const elevatedSegs=new Map(); // 64 m cells → elevated segments (topology-gap continuation)
 const elevatedNodes=new Map(),groundNodes=new Map(),groundSegs=new Map(); // node key → count; 64 m cells → segments
 const onGround=(x,z)=>(groundSegs.get(Math.floor(x/64)*1e6+Math.floor(z/64))??[]).some(([ax,az,bx,bz,r])=>{const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l));return Math.hypot(x-ax-t*dx,z-az-t*dz)<=r;});
 const samples=new Map();    // chunk → {deck:[tri], road:[tri], terrain, footprints}
 const blocked=[];             // carriageway samples inside a building volume
 const lowHeadroom=new Map(),steepDeck=new Map(); // 40 m spot → {x,z,n,gap|area}
 const trees={total:0,authored:0,onCarriageway:[],throughDeck:[]};
 const near=(list,x,z,r)=>list.some(e=>Math.abs(e[0]-x)<r&&Math.abs(e[1]-z)<r);

 // Road ends that join nothing, city-wide first: a road ending inside a footprint enters the building.
 const roadEnds=new RoadDeadEnds();
 for(const entry of Object.values(index.bundles))for(const {raw} of Object.values(JSON.parse(gunzipSync(load(`public/maps/bundles/${city}/${entry.file}`))).chunks))for(const r of raw.objects?.roads??[])roadEnds.add(r.p);
 const roadEntries=roadEnds.byChunk();
 for(const entry of Object.values(index.bundles)){
  const bundle=JSON.parse(gunzipSync(load(`public/maps/bundles/${city}/${entry.file}`)));
  for(const [chunkKey,{raw}] of Object.entries(bundle.chunks)){
   // vegetationSites below needs nothing from the entry; only heights are kept per chunk (slimTerrain).
   const plan=raw.compiledStreet,roads=raw.objects?.roads??[],terrain=slimTerrain(chunkTerrainEntry(raw,1024));
   const localEnds=[],groundRoads=[];
   for(const r of roads){
    if(r.tunnel||r.p.length<4)continue;
    const elevated=!!r.bridge||(r.layer??0)>0;
    // Every elevated vertex counts: a ramp often joins its mainline at an interior vertex.
    if(!elevated){groundRoads.push(r);continue;}
    {const level=Math.max(1,r.layer??0),pid=++pieceId;
     for(let i=2;i<r.p.length;i+=2){const sg=[r.p[i-2],r.p[i-1],r.p[i],r.p[i+1],pid];for(let a=Math.floor((Math.min(sg[0],sg[2])-2)/64);a<=Math.floor((Math.max(sg[0],sg[2])+2)/64);a++)for(let b=Math.floor((Math.min(sg[1],sg[3])-2)/64);b<=Math.floor((Math.max(sg[1],sg[3])+2)/64);b++){const k=a*1e6+b;(elevatedSegs.get(k)??elevatedSegs.set(k,[]).get(k)).push(sg);}}for(let i=0;i<r.p.length;i+=2){const k=key(r.p[i],r.p[i+1]);elevatedNodes.set(k,(elevatedNodes.get(k)??0)+1);}
     for(const i of [0,r.p.length-2]){const j=i===0?2:i-2;ends.push({x:r.p[i],z:r.p[i+1],px:r.p[j],pz:r.p[j+1],chunk:chunkKey,level,pid});localEnds.push([r.p[i],r.p[i+1]]);}}
   }
   // Ground roads only matter at this chunk's deck ends (a seam portal's road piece is clipped into
   // the same chunk): register their vertices and segments within 30 m of an end — not city-wide.
   if(localEnds.length)for(const r of groundRoads){
    for(let i=0;i<r.p.length;i+=2)if(near(localEnds,r.p[i],r.p[i+1],30))groundNodes.set(key(r.p[i],r.p[i+1]),1);
    // Segments too: a deck end may join the middle of a road (T-junction) — same rule as the build.
    for(let i=2;i<r.p.length;i+=2){const seg=[r.p[i-2],r.p[i-1],r.p[i],r.p[i+1],Math.max(PORTAL_REACH,(r.w??8)/2)];
     if(!localEnds.some(([x,z])=>x>=Math.min(seg[0],seg[2])-30&&x<=Math.max(seg[0],seg[2])+30&&z>=Math.min(seg[1],seg[3])-30&&z<=Math.max(seg[1],seg[3])+30))continue;
     for(let a=Math.floor((Math.min(seg[0],seg[2])-seg[4])/64);a<=Math.floor((Math.max(seg[0],seg[2])+seg[4])/64);a++)for(let b=Math.floor((Math.min(seg[1],seg[3])-seg[4])/64);b<=Math.floor((Math.max(seg[1],seg[3])+seg[4])/64);b++){const k=a*1e6+b;(groundSegs.get(k)??groundSegs.set(k,[]).get(k)).push(seg);}}
   }
   // Keep only the triangles near elevated ends (portal sampling) — bounded memory city-wide.
   const deck=[],road=[];
   if(plan&&localEnds.length)for(const m of plan.meshes){
    const isDeck=m.layer===3&&(m.level??0)>0,isRoad=m.layer===3&&(m.level??0)===0;if(!isDeck&&!isRoad)continue;
    const n=m.index?.length??m.position.length/3;
    for(let i=0;i+2<n;i+=3){
     const t=[];for(let k=0;k<3;k++){const j=(m.index?.[i+k]??i+k)*3;t.push(m.position[j]+plan.origin[0],m.position[j+1],m.position[j+2]+plan.origin[1]);}
     if(near(localEnds,(t[0]+t[3]+t[6])/3,(t[2]+t[5]+t[8])/3,24)){if(isDeck)t.level=m.level;(isDeck?deck:road).push(t);}
    }
   }
   // Solid footprints near elevated ends: a deck ending inside one enters the building, it does not float.
   const footprints=localEnds.length?(raw.objects.buildings??[]).filter(b=>b.p.length>=6&&!b.groundClearance&&localEnds.some(([x,z])=>insideRing(b.p,x,z))):[];
   samples.set(chunkKey,{deck,road,terrain,footprints});

   // Buildings a carriageway (any level) runs through — the game's own volume rule.
   if(plan&&terrain){const roadTris=[];for(const m of plan.meshes)if(m.layer===3){const n=m.index?.length??m.position.length/3;
     for(let i=0;i+2<n;i+=3){const t=[];for(let k=0;k<3;k++){const j=(m.index?.[i+k]??i+k)*3;t.push(m.position[j]+plan.origin[0],m.position[j+1],m.position[j+2]+plan.origin[1]);}t.level=m.level??0;roadTris.push(t);}}
    surfaceChecks(roadTris,lowHeadroom,steepDeck);
    for(const hit of roadsThroughBuildings(raw.objects?.buildings??[],roadTris,(x,z)=>sampleChunkLandHeight(terrain,x,z,true),roadEntries.get(chunkKey)??[]))blocked.push({...hit,chunk:chunkKey});}

   // Trees exactly as chunkMesh builds them.
   if(settings?.enabled&&terrain){
    const authored=[...seoulDetailTrees(raw).map(([x,z])=>({x,z,kind:'grand'})),...(raw.palaceSite?palaceTrees(raw):[]).map(([x,z])=>({x,z,kind:'palace'})),...(raw.streetPilot?pilotTreeSites(raw):[]).map(([x,z])=>({x,z,kind:'street'}))];
    const sites=vegetationSites(raw,1024,settings,authored,(x,z)=>sampleChunkLandHeight(terrain,x,z,true)),authoredKeys=new Set(authored.map(t=>t.x+','+t.z));
    const {road:roadTris,deck:deckTris}=treeSurfaces(plan);
    for(let i=0;i<sites.length;i+=8){
     const x=sites[i],z=sites[i+2],w=sites[i+3],h=sites[i+4];trees.total++;const isAuthored=authoredKeys.has(x+','+z);if(isAuthored)trees.authored++;
     const ground=sampleChunkLandHeight(terrain,x,z,true);
     const where={x:+x.toFixed(2),z:+z.toFixed(2),chunk:chunkKey,authored:isAuthored};
     if(onAny(roadTris,x,z))trees.onCarriageway.push(where);
     else{let deckY;for(const [px,pz] of crownProbe(x,z,w)){const y=highestAt(deckTris,px,pz);if(y!==undefined)deckY=Math.min(deckY??Infinity,y);}
      if(deckY!==undefined&&deckTreeConflict(ground,h,deckY))trees.throughDeck.push({...where,clearance:+(deckY-ground).toFixed(2),treeTop:+(h*TREE_TOP_PER_SCALE).toFixed(2)});}
    }
   }
  }
 }

 // Classify every elevated end city-wide (seam pieces meet their neighbour here).
 const portals=[],steps=[],deadEnds=[],floating=[],entersBuilding=[];
 for(const e of ends){
  const k=key(e.x,e.z),elevatedHere=elevatedNodes.get(k)??0;
  if(elevatedHere>1)continue; // continues into another elevated piece
  // …or stops just short of one (no shared vertex): same ELEVATED_GAP rule as the build.
  if((elevatedSegs.get(Math.floor(e.x/64)*1e6+Math.floor(e.z/64))??[]).some(([ax,az,bx,bz,pid])=>{if(pid===e.pid)return false;const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((e.x-ax)*dx+(e.z-az)*dz)/l));return Math.hypot(e.x-ax-t*dx,e.z-az-t*dz)<=ELEVATED_GAP;}))continue;
  // The end's own deck level: a higher flyover passing over a portal is not this ramp's surface.
  const s=samples.get(e.chunk),own=s.deck.filter(t=>t.level===e.level),deckY=highestAt(own.length?own:s.deck,e.x,e.z,true);
  const where={x:+e.x.toFixed(2),z:+e.z.toFixed(2),chunk:e.chunk};
  if(groundNodes.has(k)||onGround(e.x,e.z)){
   portals.push(where);
   // The visible step is at the slab's edge, not the node: the deck overhangs its end by half its
   // width and hides the road below it. Walk on along the deck heading to where the slab ends and
   // compare its edge with the road surface just beyond.
   const hl=Math.hypot(e.x-e.px,e.z-e.pz)||1,ux=(e.x-e.px)/hl,uz=(e.z-e.pz)/hl,deckTris=own.length?own:s.deck;
   let edgeY=deckY,roadY;
   for(let d=0;d<=20;d+=1){const x=e.x+ux*d,z=e.z+uz*d,y=highestAt(deckTris,x,z);
    if(y!==undefined){edgeY=y;continue;}
    roadY=highestAt(s.road,x,z)??highestAt(s.road,x+ux,z+uz)??highestAt(s.road,x+2*ux,z+2*uz);break;}
   roadY??=highestAt(s.road,e.x,e.z,true)??(s.terrain?sampleChunkLandHeight(s.terrain,e.x,e.z,true):undefined);
   // Both ways: a ramp lifted above its deck is as broken as a deck left above its road.
   if(edgeY!==undefined&&roadY!==undefined&&Math.abs(edgeY-roadY)>STEP_LIMIT)steps.push({...where,step:+Math.abs(edgeY-roadY).toFixed(2),...(roadY>edgeY?{roadAbove:true}:{})});
  }else{
   deadEnds.push(where);const groundY=s.terrain?sampleChunkLandHeight(s.terrain,e.x,e.z,true):undefined;
   if(s.footprints.some(b=>insideRing(b.p,e.x,e.z)))entersBuilding.push(where);
   else if(deckY!==undefined&&groundY!==undefined&&deckY-groundY>FLOAT_LIMIT)floating.push({...where,height:+(deckY-groundY).toFixed(2)});
  }
 }
 const worst=(list,f)=>list.sort((a,b)=>b[f]-a[f]).slice(0,40);
 const spots=m=>[...m.values()].sort((a,b)=>b.n-a.n);
 const report={city,cell,generated:new Date().toISOString(),limits:{STEP_LIMIT,FLOAT_LIMIT,HEADROOM_MIN,STEEP_DECK},
  decks:{elevatedEnds:ends.length,portals:portals.length,portalSteps:steps.length,deadEnds:deadEnds.length,entersBuilding:entersBuilding.length,floatingDeadEnds:floating.length,worstSteps:worst(steps,'step'),worstFloating:worst(floating,'height'),steps:steps.slice().sort((a,b)=>b.step-a.step),floating:floating.slice().sort((a,b)=>b.height-a.height)},
  surfaces:{lowHeadroomSpots:lowHeadroom.size,lowHeadroomSamples:spots(lowHeadroom).reduce((s,o)=>s+o.n,0),steepDeckSpots:steepDeck.size,worstLowHeadroom:spots(lowHeadroom).slice(0,40),worstSteepDeck:spots(steepDeck).slice(0,40)},
  buildings:{roadThrough:blocked.length,roadThroughAuthored:blocked.filter(b=>b.authored).length,worst:worst(blocked,'samples')},
  trees:{total:trees.total,authored:trees.authored,onCarriageway:trees.onCarriageway.length,throughDeck:trees.throughDeck.length,
   onCarriagewayAuthored:trees.onCarriageway.filter(t=>t.authored).length,samplesOnCarriageway:trees.onCarriageway.slice(0,40),samplesThroughDeck:worst(trees.throughDeck,'treeTop')}};
 // Regression gate: per-city ceilings (structural residuals stay reported, never silently grown).
 const limits=JSON.parse(readFileSync('config/map-quality/elevated-roads.json','utf8'))[city]??{};
 const measured={lowHeadroomSpots:lowHeadroom.size,steepDeckSpots:steepDeck.size,roadsThroughBuildings:blocked.filter(b=>!b.authored).length,portalSteps:steps.length,floatingDeadEnds:floating.length,treesOnCarriageway:trees.onCarriageway.length,treesThroughDeck:trees.throughDeck.length};
 report.limits=limits;report.exceeded=Object.entries(measured).filter(([k,v])=>v>(limits[k]??0)).map(([k,v])=>({check:k,measured:v,limit:limits[k]??0}));
 report.passed=!report.exceeded.length;
 mkdirSync('build',{recursive:true});writeFileSync(out,JSON.stringify(report,null,1));
 console.log(JSON.stringify({city,...report.decks,worstSteps:undefined,worstFloating:undefined,steps:undefined,floating:undefined,surfaces:{...report.surfaces,worstLowHeadroom:undefined,worstSteepDeck:undefined},buildings:{...report.buildings,worst:undefined},trees:{...report.trees,samplesOnCarriageway:undefined,samplesThroughDeck:undefined},passed:report.passed,out}));
 if(strict&&!report.passed){console.error('Elevated road / tree regression: '+JSON.stringify(report.exceeded));process.exitCode=1;}
}finally{await server.close();}

// ── geometry helpers (triangles as flat [x,y,z]*3 in cell metres) ──
/** One chunk's carriageway triangles (t.level set): headroom gaps on a 2 m grid, steep deck facets; 40 m spots. */
function surfaceChecks(tris,low,steep){
 const at=new Map(),spot=(m,x,z)=>{const k=Math.floor(x/40)*1e6+Math.floor(z/40);return m.get(k)??m.set(k,{x:Math.round(x),z:Math.round(z),n:0}).get(k);};
 const minNy=Math.cos(STEEP_DECK*Math.PI/180);
 for(const t of tris){
  const ux=t[3]-t[0],uy=t[4]-t[1],uz=t[5]-t[2],vx=t[6]-t[0],vy=t[7]-t[1],vz=t[8]-t[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz);
  if(t.level>0&&len/2>=.3&&Math.abs(ny)/len<minNy)spot(steep,(t[0]+t[3]+t[6])/3,(t[2]+t[5]+t[8])/3).n++;
  const x0=Math.min(t[0],t[3],t[6]),x1=Math.max(t[0],t[3],t[6]),z0=Math.min(t[2],t[5],t[8]),z1=Math.max(t[2],t[5],t[8]);
  for(let x=Math.ceil(x0/2)*2;x<=x1;x+=2)for(let z=Math.ceil(z0/2)*2;z<=z1;z+=2){const w=bary(t,x,z);if(!w||Math.min(...w)<-1e-6)continue;const k=x*1e6+z;(at.get(k)??at.set(k,[]).get(k)).push(w[0]*t[1]+w[1]*t[4]+w[2]*t[7]);}
 }
 for(const [k,ys] of at){if(ys.length<2)continue;ys.sort((a,b)=>a-b);
  for(let i=1;i<ys.length;i++){const g=ys[i]-ys[i-1];if(g>HEADROOM_SEAM&&g<HEADROOM_MIN){const o=spot(low,Math.floor(k/1e6),k%1e6);o.n++;o.gap=Math.min(o.gap??Infinity,+g.toFixed(2));break;}}}
}
function bary(t,x,z){
 const det=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]);if(Math.abs(det)<1e-9)return;
 const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/det,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/det,c=1-a-b;
 return [a,b,c];
}
/** Highest surface at (x,z); `reach` also accepts the nearest vertex within 6 m (decks trimmed short of the node). */
function highestAt(tris,x,z,reach=false){
 const list=tris.cellsAt?tris.cellsAt(x,z):tris;
 let best;for(const t of list){const w=bary(t,x,z);if(w&&Math.min(...w)>=-1e-6)best=Math.max(best??-Infinity,w[0]*t[1]+w[1]*t[4]+w[2]*t[7]);}
 if(best!==undefined||!reach)return best;
 let d=6,y;for(const t of list)for(let k=0;k<9;k+=3){const dd=Math.hypot(t[k]-x,t[k+2]-z);if(dd<d){d=dd;y=t[k+1];}}
 return y;
}
function onAny(tris,x,z){for(const t of tris.cellsAt?tris.cellsAt(x,z):tris){const w=bary(t,x,z);if(w&&Math.min(...w)>=-1e-6)return true;}return false;}
/** Carriageway (layer 3, level 0) and deck (layer 3, level ≥ 1) triangles binned by the tree's 16 m cell. */
function treeSurfaces(plan){
 const road=[],deck=[];if(!plan)return {road:binned(road),deck:binned(deck)};
 for(const m of plan.meshes){if(m.layer!==3)continue;const n=m.index?.length??m.position.length/3,dst=(m.level??0)>0?deck:road;
  for(let i=0;i+2<n;i+=3){const t=[];for(let k=0;k<3;k++){const j=(m.index?.[i+k]??i+k)*3;t.push(m.position[j]+plan.origin[0],m.position[j+1],m.position[j+2]+plan.origin[1]);}dst.push(t);}}
 return {road:binned(road),deck:binned(deck)};
}
function binned(tris){
 const cells=new Map();
 for(const t of tris){const x0=Math.min(t[0],t[3],t[6]),x1=Math.max(t[0],t[3],t[6]),z0=Math.min(t[2],t[5],t[8]),z1=Math.max(t[2],t[5],t[8]);
  for(let a=Math.floor(x0/16);a<=Math.floor(x1/16);a++)for(let b=Math.floor(z0/16);b<=Math.floor(z1/16);b++){const k=a+':'+b;(cells.get(k)??cells.set(k,[]).get(k)).push(t);}}
 return {cellsAt:(x,z)=>cells.get(Math.floor(x/16)+':'+Math.floor(z/16))??[]};
}
function insideRing(p,x,z){let c=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const xi=p[i],zi=p[i+1],xj=p[j],zj=p[j+1];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;}
