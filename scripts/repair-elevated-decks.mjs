// Apply the shared deck plan (deck-structure.mjs) to an already completed city: re-profile every
// elevated vehicle deck, add girders / undersides / piers, re-pack the 2×2 bundles.
//
//   npm run maps:repair-decks -- <city> [--dry-run]   (node --expose-gc --max-old-space-size=3072 …)
//   Seoul peaks at ~2.4 GB resident: pass 1 keeps heights-only terrain and deck-end surfaces, and
//   is released before pass 2, which holds a single bundle at a time. --mem-stats prints pass-1 sizes.
//
// New builds get the same result from bake-street-region.mjs (same planCityDecks inputs);
// this tool exists so shipped cities do not wait for a full street rebuild. Idempotent: chunks
// stamped with the current DECK_STRUCTURE_VERSION are left untouched.
//
// The bundle index hash changes, so the city's release pointer (config/map-releases/<city>.json)
// no longer matches: publish the source snapshot (npm run maps:publish:city -- <city>) before a
// release build. Nothing is published by this tool.
import {readFileSync,writeFileSync,unlinkSync,mkdirSync,renameSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {loadMapCities,selectMapCities} from './map-city-config.mjs';
import {PORTAL_LIFT,planCityDecks,meshPieces,trimDeckTriangles,deckTrimTests,limitDeckGrade,holdsDeckEnd,TRIM_FLUSH,UNDER_DECK_LAYERS,hideUnderDeck,deckStructures,refitDeckSplits,approachRamps,liftSkirts,liftTriangles,clearBuildingsOfRoads,structuresOffRoads,RoadDeadEnds,slimTerrain,SKIRT_LAYERS,DECK_STRUCTURE_VERSION} from './deck-structure.mjs';

const args=process.argv.slice(2),dry=args.includes('--dry-run');
const cities=await loadMapCities(),[city]=selectMapCities(cities,args.find(a=>!a.startsWith('--')));
const cell=cities[city],indexPath=`src/world/${city}-bundles.json`,index=JSON.parse(readFileSync(indexPath,'utf8'));
const decode=e=>JSON.parse(gunzipSync(readFileSync(`public/maps/bundles/${city}/${e.file}`)));
const NEAR=40;
// Phase memory trace (stderr): live heap vs resident size, to keep the tool inside small machines.
let peakHeap=0;const mem=label=>{const m=process.memoryUsage();peakHeap=Math.max(peakHeap,m.heapUsed);console.error(`[mem] ${label}: heap ${(m.heapUsed/2**20).toFixed(0)}MB · rss ${(m.rss/2**20).toFixed(0)}MB`);};
/** 16 m binned triangles; `highest` is the top surface at a point (optionally the nearest vertex within `reach`). */
class Grid{
 constructor(){this.cells=new Map();}
 add(t){const x0=Math.min(t[0],t[3],t[6]),x1=Math.max(t[0],t[3],t[6]),z0=Math.min(t[2],t[5],t[8]),z1=Math.max(t[2],t[5],t[8]);
  for(let a=Math.floor(x0/16);a<=Math.floor(x1/16);a++)for(let b=Math.floor(z0/16);b<=Math.floor(z1/16);b++){const k=a+':'+b;(this.cells.get(k)??this.cells.set(k,[]).get(k)).push(t);}}
 /** Separate surfaces (0.5 m apart) over (x,z). */
 count(x,z){const ys=[];for(const t of this.cells.get(Math.floor(x/16)+':'+Math.floor(z/16))??[]){const det=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]);if(Math.abs(det)<1e-9)continue;
   const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/det,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/det,c=1-a-b;if(Math.min(a,b,c)<-1e-6)continue;const y=a*t[1]+b*t[4]+c*t[7];if(ys.every(v=>Math.abs(v-y)>.5))ys.push(y);}return ys.length;}
 highest(x,z,reach=0){
  let best;const list=this.cells.get(Math.floor(x/16)+':'+Math.floor(z/16))??[];
  for(const t of list){const det=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]);if(Math.abs(det)<1e-9)continue;
   const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/det,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/det,c=1-a-b;
   if(Math.min(a,b,c)<-1e-6)continue;best=Math.max(best??-Infinity,a*t[1]+b*t[4]+c*t[7]);}
  if(best!==undefined||!reach)return best;
  let d=reach,y;for(const t of list)for(let k=0;k<9;k+=3){const dd=Math.hypot(t[k]-x,t[k+2]-z);if(dd<d){d=dd;y=t[k+1];}}return y;
 }
}


const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true},logLevel:'error'});
try{
 const {chunkTerrainEntry,sampleChunkLandHeight}=await server.ssrLoadModule('/src/world/chunkMesh.ts');
 const {pilotBridgeAt,pilotStreetHeight}=await server.ssrLoadModule('/src/world/cities/CheonggyePilot.ts');
 const pilotChunks=new Set();
 // ── pass 1: city-wide inputs ──
 const terrains=new Map(),chunkKeys=new Set(),elevated=[],ground=[],water=[];
 const oldDeck=new Map(),atGrade=[],deadEnds=new RoadDeadEnds();let already=0,total=0;
 for(const entry of Object.values(index.bundles)){
  for(const [key,{raw}] of Object.entries(decode(entry).chunks)){
   total++;chunkKeys.add(key);terrains.set(key,slimTerrain(chunkTerrainEntry(raw,1024)));if(raw.streetPilot)pilotChunks.add(key);
   const plan=raw.compiledStreet;if(plan?.deckStructure?.version>=DECK_STRUCTURE_VERSION)already++;
   const roads=raw.objects?.roads??[],mine=[];
   for(const r of roads)deadEnds.add(r.p);
   for(const r of roads){if(r.tunnel||(r.layer??0)<0||r.p.length<4)continue;
    if(r.bridge||(r.layer??0)>0){const line={p:r.p,level:Math.max(1,r.layer??0),w:r.w??8,bridge:!!r.bridge,chunk:key};elevated.push(line);mine.push(line);}
    else ground.push({p:r.p,w:r.w??8});}
   if(!mine.length||!plan)continue;
   const boxes=mine.map(l=>box(l.p,NEAR)),near=b=>boxes.some(m=>b.x0<=m.x1&&b.x1>=m.x0&&b.z0<=m.z1&&b.z1>=m.z0);
   // At-grade surfaces only feed portalHeight: keep them near deck ends, not along whole decks.
   const endBoxes=mine.flatMap(l=>[[l.p[0],l.p[1]],[l.p[l.p.length-2],l.p[l.p.length-1]]]).map(([x,z])=>({x0:x-24,x1:x+24,z0:z-24,z1:z+24})),nearEnd=b=>endBoxes.some(m=>b.x0<=m.x1&&b.x1>=m.x0&&b.z0<=m.z1&&b.z1>=m.z0);
   for(const w of raw.objects.water??[])if(near(box(w.p,(w.w??0)/2)))water.push(w);
   for(const m of plan.meshes){if(m.layer!==3)continue;const level=m.level??0;
    for(const t of triangles(m,plan.origin)){if(!near(box([t[0],t[2],t[3],t[5],t[6],t[8]],0)))continue;
     if(level>0)(oldDeck.get(level)??oldDeck.set(level,new Grid()).get(level)).add(t);else if(nearEnd(box([t[0],t[2],t[3],t[5],t[6],t[8]],0)))atGrade.push(t);}}
  }
 }
 mem('pass 1 (city inputs)');
 if(args.includes('--mem-stats')){const nums=a=>a.reduce((s,x)=>s+x.p.length,0),tri=g=>{let n=0;for(const l of g.cells.values())n+=l.length;return n;};
  console.error('[mem] inputs',JSON.stringify({terrains:terrains.size,elevatedLines:elevated.length,elevatedNums:nums(elevated),groundLines:ground.length,groundNums:nums(ground),water:water.length,waterNums:nums(water),atGradeTris:atGrade.length,deckTriCellRefs:[...oldDeck.values()].reduce((s,g)=>s+tri(g),0)}));
  if(args.includes('--stats-only'))process.exit(0);}
 if(already===total){console.log(JSON.stringify({city,chunks:total,already,changed:0}));process.exit(0);}
 const atGradeGrid=new Grid();for(const t of atGrade)atGradeGrid.add(t);
 const terrain=(x,z)=>{const t=terrains.get(Math.floor(x/1024)+'_'+Math.floor(z/1024));return t?sampleChunkLandHeight(t,x,z,true):undefined;};
 const interior=(x,z)=>[[-48,-48],[48,-48],[-48,48],[48,48]].every(([dx,dz])=>chunkKeys.has(Math.floor((x+dx)/1024)+'_'+Math.floor((z+dz)/1024)));
 let plan=planCityDecks({elevated,ground,water,terrain,interior,
  portalHeight:(x,z)=>atGradeGrid.highest(x,z)??terrain(x,z),
  // The previously baked surface caps the new one: a repair only ever lowers or keeps a deck.
  // Cheonggye pilot bridges are drawn by the pilot at street level: the deck lies on them (no crown).
  bound:(x,z,level)=>{const old=oldDeck.get(level)?.highest(x,z,8)??Infinity;return pilotChunks.has(Math.floor(x/1024)+'_'+Math.floor(z/1024))&&pilotBridgeAt(x,z)?Math.min(old,pilotStreetHeight(x,z)+PORTAL_LIFT):old;}});
 mem('planned');
 const ramps=approachRamps(plan,ground);mem('ramps');
 console.log(JSON.stringify({city,phase:'planned',...plan.stats,approachRamps:ramps.lifts.length,residualSteps:ramps.residual.length}));
 // Pass 2 needs only three lookups; release every city-wide pass-1 structure before it starts.
 // Deck ends (portals, dead ends) on a 16 m hash: limitDeckGrade keeps the slab near them where it lies low.
 const endCells=new Map();for(const n of plan.nodes)if(n.portal||n.deadEnd){const k=Math.floor(n.x/16)+':'+Math.floor(n.z/16);(endCells.get(k)??endCells.set(k,[]).get(k)).push([n.x,n.z,n.h]);}
 const nearEnd=(x,y,z)=>{for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(const e of endCells.get((Math.floor(x/16)+a)+':'+(Math.floor(z/16)+b))??[])if(holdsDeckEnd(e,x,y,z))return true;return false;};
 const deck={height:plan.height,nearest:plan.nearest,linesThrough:plan.linesThrough,inWater:plan.inWater,stats:plan.stats,conflicts:plan.conflicts};
 const ramp={lift:ramps.lift,count:ramps.lifts.length,residual:ramps.residual};
 const entries=deadEnds.byChunk();
 plan=null;ground.length=0;water.length=0;atGrade.length=0;oldDeck.clear();atGradeGrid.cells.clear();
 globalThis.gc?.();mem('released pass 1');

 // ── pass 2: rewrite deck surfaces, add structures, re-pack ──
 const linesByChunk=new Map();for(const l of elevated)(linesByChunk.get(l.chunk)??linesByChunk.set(l.chunk,[]).get(l.chunk)).push(l);
 let buildingColumns=0,buildingsCut=0,buildingsRaised=0,buildingsRemoved=0;const buildingsKept=[];let changedVertices=0,trimmedDeck=0,hiddenUnderDeck=0,droppedProps=0,maxDrop=0,faces=0,lipFaces=0,gradeRaised=0,piers=0,refitParts=0,liftedVertices=0,skirtFaces=0,bytes=0,rawBytes=0;const next={...index,bundles:{}},stale=[];let bundlesDone=0;
 for(const [bundleKey,entry] of Object.entries(index.bundles)){
  const bundle=decode(entry);let touched=false;
  for(const [key,chunk] of Object.entries(bundle.chunks)){
   const street=chunk.raw.compiledStreet,lines=linesByChunk.get(key)??[];
   if(!street||street.deckStructure?.version>=DECK_STRUCTURE_VERSION)continue;
   const decks=street.meshes.filter(m=>m.layer===3&&(m.level??0)>0);
   const [ox,oz]=street.origin,deckTris=[],skirt=[];
   const x0=Number(key.split('_')[0])*1024,z0=Number(key.split('_')[1])*1024,onSeam=v=>Math.abs(v)<.01||Math.abs(v-1024)<.01,edgeOfChunk=(x,z)=>onSeam(x-x0)||onSeam(z-z0);
   // Approach ramps: lift every at-grade street layer the same way, then close the sides.
   const outline=[];let anyLift=false;
   for(const m of street.meshes){if((m.level??0)!==0||m.layer===0)continue;
    const added=liftMesh(m,street.origin,ramp.lift);if(added){anyLift=true;liftedVertices+=added;}
    if(SKIRT_LAYERS.includes(m.layer))for(const t of triangles(m,street.origin))outline.push(t);}
   if(anyLift)for(const v of liftSkirts(outline,ramp.lift,edgeOfChunk))skirt.push(v); // no spread: chunks reach 10⁶ values
   if(skirt.length){street.meshes.push({layer:6,level:0,position:skirt.map((v,i)=>Math.round((v-(i%3===0?ox:i%3===2?oz:0))*1e4)/1e4)});skirtFaces+=skirt.length/9;}
   // Final carriageways (decks, lifted approaches) cut through no building — every chunk, decks or not.
   const clearBuildings=()=>{const roads=street.meshes.filter(m=>m.layer===3).flatMap(m=>[...triangles(m,street.origin)]);
    const cleared=clearBuildingsOfRoads(chunk.raw.objects.buildings??[],roads,(x,z)=>terrain(x,z),entries.get(key)??[]);
    if(cleared.cut||cleared.raised||cleared.removed||cleared.columns){chunk.raw.objects.buildings=cleared.buildings;buildingsCut+=cleared.cut;buildingsRaised+=cleared.raised;buildingsRemoved+=cleared.removed;buildingColumns+=cleared.columns;}
    const posts=structuresOffRoads(chunk.raw.objects.structures,roads);if(posts.columns){chunk.raw.objects.structures=posts.structures;buildingColumns+=posts.columns;}
    for(const b of cleared.kept)buildingsKept.push({x:Math.round(b.p[0]),z:Math.round(b.p[1]),osmId:b.osmId});};
   if(!decks.length&&!lines.length){clearBuildings();street.deckStructure={version:DECK_STRUCTURE_VERSION};touched=true;continue;}
   // The final at-grade carriageway surface (approach lifts applied) and the streets running along each deck.
   const streetSurface=new Grid();for(const m of street.meshes)if(m.layer===3&&(m.level??0)===0)for(const t of triangles(m,street.origin))streetSurface.add(t);
   const trimTests=deckTrimTests(chunk.raw.objects?.roads??[],(x,z)=>streetSurface.highest(x,z),deck.nearest);
   for(const m of decks){const P=m.position,idx=m.index??Array.from({length:P.length/3},(_,i)=>i),soup=[...triangles(m,street.origin)],own=new Map();
    // Each strip takes its heights from the roads running through it, not a neighbour's axis.
    for(const piece of meshPieces(soup)){const lines=deck.linesThrough(piece.map(i=>soup[i]),m.level);for(const i of piece)for(let k=0;k<3;k++)own.set(idx[i*3+k],lines);}
    // A deck never dips under an at-grade street it overlaps (on a hillside the uphill street pushed through it).
    for(let v=0;v<P.length/3;v++){const i=v*3,top=streetSurface.highest(P[i]+ox,P[i+2]+oz),y=Math.max(deck.height(P[i]+ox,P[i+2]+oz,m.level,P[i+1],[P[i],P[i+2]].some(u=>Math.abs(u)<.01||Math.abs(u-1024)<.01)?undefined:own.get(v)),top===undefined?-Infinity:top+PORTAL_LIFT),q=Math.round(y*1e4)/1e4;if(q!==P[i+1]){maxDrop=Math.max(maxDrop,P[i+1]-q);changedVertices++;P[i+1]=q;}}
    // No cliff where two roads' heights meet; a deck on its street, near its end, or on the chunk seam stays put: raised there, the end stood as a step.
    gradeRaised+=limitDeckGrade(P,idx,v=>{const x=P[v*3]+ox,z=P[v*3+2]+oz,top=streetSurface.highest(x,z),seam=u=>Math.abs(u)<.01||Math.abs(u-1024)<.01;return seam(P[v*3])||seam(P[v*3+2])||top!==undefined&&P[v*3+1]-top<TRIM_FLUSH+.01||nearEnd(x,P[v*3+1],z);});
    trimmedDeck+=trimDeckMesh(m,street.origin,v=>trimTests(m.level,own.get(v)));
    for(const t of triangles(m,street.origin))deckTris.push(t);}
   // Paint, curbs and pavement just under a deck met at grade showed through it (white dashes on the slab).
   const deckTop=new Grid();for(const t of deckTris)deckTop.add(t);
   const pavementOf=()=>{const g=new Grid();for(const m of street.meshes)if(m.layer===1&&(m.level??0)===0)for(const t of triangles(m,street.origin))g.add(t);return g;},planned=pavementOf();
   for(const m of street.meshes)if(UNDER_DECK_LAYERS.includes(m.layer)&&(m.level??0)===0)hiddenUnderDeck+=dropCovered(m,street.origin,(x,z,y)=>{const d=deckTop.highest(x,z);return d!==undefined&&d-y>-.2&&d-y<1;});
   // A lamp or tree whose pavement went under the deck would stand on nothing (bake-street-region.mjs standingProps).
   if(street.props?.length){const kept=pavementOf(),before=street.props.length;street.props=street.props.filter(p=>[[0,0],[-.85,-.85],[.85,-.85],[-.85,.85],[.85,.85]].every(([dx,dz])=>planned.highest(p.x+dx,p.z+dz)===undefined||kept.highest(p.x+dx,p.z+dz)!==undefined));droppedProps+=before-street.props.length;}
   const refit=refitDeckSplits(chunk.raw.objects.buildings??[],(x,z,l)=>deck.height(x,z,l,undefined),terrain);
   if(refit.changed){chunk.raw.objects.buildings=refit.buildings;refitParts+=refit.changed;}
   clearBuildings();
   const roadGrid=new Grid();for(const m of street.meshes)if((m.layer===3||m.layer===2)&&(m.level??0)===0)for(const t of triangles(m,street.origin))roadGrid.add(t);
   const walkGrid=new Grid();for(const m of street.meshes)if(m.layer===1&&(m.level??0)===0)for(const t of triangles(m,street.origin))walkGrid.add(t);
   const footprints=[...(chunk.raw.objects.buildings??[]),...(chunk.raw.objects.structures??[])].filter(b=>b.p.length>=6);
   // Slab faces hang to the street surface where there is one: a deck met at grade on a street raised above
   // the land kept a 5 cm girder strip along its edge, read as a white line across the junction.
   const result=deckStructures({tris:deckTris,lines,height:(x,z,l)=>deck.height(x,z,l,undefined),terrain:(x,z)=>Math.max(terrain(x,z)??0,roadGrid.highest(x,z)??-Infinity),
    blocked:(x,z)=>roadGrid.highest(x,z)!==undefined||walkGrid.highest(x,z)!==undefined||deckTop.count(x,z)>1||deck.inWater(x,z)||footprints.some(b=>insideRing(b.p,x,z)),
    edgeOfChunk,street:(x,z)=>streetSurface.highest(x,z)});
   if(result.lips.length){street.meshes.push({layer:3,level:0,position:result.lips.map((v,i)=>Math.round((v-(i%3===0?ox:i%3===2?oz:0))*1e4)/1e4)});lipFaces+=result.lips.length/9;}
   if(result.faces.length){const position=result.faces.map((v,i)=>Math.round((v-(i%3===0?ox:i%3===2?oz:0))*1e4)/1e4);street.meshes.push({layer:6,level:1,position});faces+=result.faces.length/9;}
   if(result.volumes.length){street.supportVolumes=(street.supportVolumes??[]).concat(result.volumes);piers+=result.volumes.length;}
   street.deckStructure={version:DECK_STRUCTURE_VERSION};touched=true;
  }
  if((++bundlesDone)%50===0)mem(`pass 2: ${bundlesDone} bundles`);
  if(!touched){next.bundles[bundleKey]=entry;bytes+=entry.bytes;rawBytes+=entry.rawBytes;continue;}
  const raw=Buffer.from(JSON.stringify(bundle)),gz=gzipSync(raw,{level:6}),sha=createHash('sha256').update(gz).digest('hex'),file=`${bundleKey}.${sha.slice(0,16)}.bin`;
  if(!dry){writeFileSync(`public/maps/bundles/${city}/${file}`,gz);if(file!==entry.file)stale.push(entry.file);}
  next.bundles[bundleKey]={file,bytes:gz.length,rawBytes:raw.length,sha256:sha,chunks:entry.chunks};bytes+=gz.length;rawBytes+=raw.length;
 }
 const report={city,cell,version:DECK_STRUCTURE_VERSION,dryRun:dry,chunks:total,already,deckVertices:{changed:changedVertices,maxDrop:+maxDrop.toFixed(2),trimmedPieces:trimmedDeck,gradeRaised,hiddenUnderDeck,droppedProps},structures:{faces,lipFaces,piers,refitTowerParts:refitParts},buildings:{cut:buildingsCut,raised:buildingsRaised,removedRemnants:buildingsRemoved,columnsOffRoad:buildingColumns,authoredOnRoad:buildingsKept},approach:{ramps:ramps.lifts.length,liftedVertices,skirtFaces,residual:ramps.residual.length,tallest:ramps.lifts.slice().sort((a,b)=>b.step-a.step).slice(0,40).map(l=>({x:Math.round(l.path[0]),z:Math.round(l.path[1]),step:+l.step.toFixed(2),length:Math.round(l.length)}))},residualSteps:ramps.residual.sort((a,b)=>b.step-a.step),
  plan:deck.stats,conflictsByCause:deck.conflicts.reduce((a,c)=>(a[c.kind+':'+c.heldBy]=(a[c.kind+':'+c.heldBy]||0)+1,a),{}),conflicts:deck.conflicts.slice().sort((a,b)=>b.step-a.step),bundles:{gzipBytes:bytes,rawBytes}};
 mkdirSync('build',{recursive:true});writeFileSync(`build/${city}-deck-repair.json`,JSON.stringify(report,null,1));
 if(!dry){writeFileSync(indexPath+'.next',JSON.stringify(next,null,2)+'\n');renameSync(indexPath+'.next',indexPath);for(const f of stale)unlinkSync(`public/maps/bundles/${city}/${f}`);}
 console.log(JSON.stringify({...report,conflicts:report.conflicts.length}));
}finally{await server.close();}

function box(p,pad){let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(let i=0;i<p.length;i+=2){x0=Math.min(x0,p[i]);x1=Math.max(x1,p[i]);z0=Math.min(z0,p[i+1]);z1=Math.max(z1,p[i+1]);}return {x0:x0-pad,x1:x1+pad,z0:z0-pad,z1:z1+pad};}
/**
 * Lift one indexed at-grade mesh onto the approach ramps. Triangles the lift touches (at a vertex,
 * an edge midpoint or the centroid) are re-emitted through liftTriangles, split along the ramp
 * edge; untouched triangles keep their shared vertices. Returns the number of vertices added.
 */
function liftMesh(m,[ox,oz],lift){
 const P=m.position,n=P.length/3,L=new Float64Array(n),at=(x,z)=>lift(x+ox,z+oz);
 for(let v=0;v<n;v++)L[v]=at(P[v*3],P[v*3+2]);
 const idx=m.index??Array.from({length:n},(_,i)=>i),keep=[],soup=[];
 const touched=(a,b,c)=>{if(L[a]>1e-4||L[b]>1e-4||L[c]>1e-4)return true;
  for(const [p,q] of [[a,b],[b,c],[c,a]])if(at((P[p*3]+P[q*3])/2,(P[p*3+2]+P[q*3+2])/2)>1e-4)return true;
  return at((P[a*3]+P[b*3]+P[c*3])/3,(P[a*3+2]+P[b*3+2]+P[c*3+2])/3)>1e-4;};
 for(let i=0;i+2<idx.length;i+=3){const a=idx[i],b=idx[i+1],c=idx[i+2];
  if(!touched(a,b,c)){keep.push(a,b,c);continue;}
  for(const v of [a,b,c])soup.push(P[v*3],P[v*3+1],P[v*3+2]);}
 if(!soup.length)return 0;
 const out=liftTriangles(soup,at);
 for(let k=0;k<out.length;k++)P.push(Math.round(out[k]*1e4)/1e4);
 for(let v=0;v<out.length/3;v++)keep.push(n+v);
 m.index=keep;return out.length/3;
}
/**
 * Cut the deck mesh back where it hangs low over a street running along it (trimDeckTriangles).
 * Triangles the cut leaves whole keep their shared vertices. `tests(v)` gives the deckTrimTests
 * closures for a triangle whose first vertex is v. Returns the number of pieces removed.
 */
function trimDeckMesh(m,[ox,oz],tests){
 const P=m.position,idx=m.index??Array.from({length:P.length/3},(_,i)=>i),keep=[];let cut=0;
 for(let i=0;i+2<idx.length;i+=3){const t=[];for(let k=0;k<3;k++){const j=idx[i+k]*3;t.push(P[j]+ox,P[j+1],P[j+2]+oz);}
  const r=trimDeckTriangles(t,tests(idx[i]));
  if(r.tris.length===9&&r.tris.every((v,k)=>v===t[k])){keep.push(idx[i],idx[i+1],idx[i+2]);continue;}
  cut+=r.cut;for(let k=0;k<r.tris.length;k+=3){P.push(Math.round((r.tris[k]-ox)*1e4)/1e4,Math.round(r.tris[k+1]*1e4)/1e4,Math.round((r.tris[k+2]-oz)*1e4)/1e4);keep.push(P.length/3-1);}}
 m.index=keep;return cut;
}
/** Drop the triangles of an indexed mesh whose centroid `covered(x,z,y)` says lies under a deck. Returns the count. */
function dropCovered(m,[ox,oz],covered){
 const P=m.position,idx=m.index??Array.from({length:P.length/3},(_,i)=>i),kept=[];let n=0;
 for(let i=0;i+2<idx.length;i+=3){const t=[];for(let k=0;k<3;k++){const j=idx[i+k]*3;t.push(P[j]+ox,P[j+1],P[j+2]+oz);}
  const before=kept.length;hideUnderDeck(t,covered,kept);if(kept.length-before!==9||kept.slice(before).some((v,k)=>v!==t[k]))n++;}
 if(!n)return 0;
 const position=[],index=[],keys=new Map();
 for(let i=0;i<kept.length;i+=3){const p=[Math.round((kept[i]-ox)*10000)/10000,kept[i+1],Math.round((kept[i+2]-oz)*10000)/10000],key=p.join();if(!keys.has(key)){keys.set(key,position.length/3);position.push(...p);}index.push(keys.get(key));}
 m.position=position;m.index=index;return n;
}
function* triangles(m,origin){const n=m.index?.length??m.position.length/3;for(let i=0;i+2<n;i+=3){const t=[];for(let k=0;k<3;k++){const j=(m.index?.[i+k]??i+k)*3;t.push(m.position[j]+origin[0],m.position[j+1],m.position[j+2]+origin[1]);}yield t;}}
function insideRing(p,x,z){let c=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const xi=p[i],zi=p[i+1],xj=p[j],zj=p[j+1];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;}
