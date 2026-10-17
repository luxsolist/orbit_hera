import {execFileSync} from 'node:child_process';
import {streetSupportPrism,walkAccessOffset} from './street-supports.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {mapBuildVersion} from './map-build-version.mjs';
import {streetBuildHash} from './street-build-hash.mjs';
import {createServer} from 'vite';
import {streetArtifacts,writeStreetPart} from './street-artifacts.mjs';
import {createElevatedStreetSampler,fitDeckSlots} from './street-elevation.mjs';
import {PORTAL_LIFT,planCityDecks,meshPieces,trimDeckTriangles,deckTrimTests,limitDeckGrade,holdsDeckEnd,TRIM_FLUSH,UNDER_DECK_LAYERS,hideUnderDeck,approachRamps,deckStructures,liftSkirts,liftTriangles,clearBuildingsOfRoads,structuresOffRoads,RoadDeadEnds,SKIRT_LAYERS,DECK_STRUCTURE_VERSION} from './deck-structure.mjs';
import {crossingHeight} from './street-crossings.mjs';
import {createStreetSeamSampler,reconcileStreetTerrain} from './street-seams.mjs';
const [city='seoul',region='city-wide']=process.argv.slice(2),read=p=>JSON.parse(readFileSync(p,'utf8'));
execFileSync(process.env.MAP_PYTHON??'python3',['scripts/street_walk_access.py',city,region],{stdio:'inherit'});
const base='build/streets/'+city+'-'+region,inputText=readFileSync(base+'-input.json','utf8'),input=JSON.parse(readFileSync(base+'-resolved-input.json','utf8')),regions=streetArtifacts(base+'-regions.json');
const hash=streetBuildHash(base),compilerVersion=mapBuildVersion(city);
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {terrainFootprint}=await server.ssrLoadModule('/src/world/StreetGeometry.ts');
 const {chunkTerrainEntry,sampleChunkLandHeight}=await server.ssrLoadModule('/src/world/chunkMesh.ts');
 const {inPilot,pilotStreetHeight,pilotBridgeAt}=await server.ssrLoadModule('/src/world/cities/CheonggyePilot.ts');
 const terrains=new Map(input.chunks.map(c=>[c.cx+'_'+c.cz,chunkTerrainEntry(c,1024)]));
 const crossings=new Map(regions.keys.map(key=>[key,regions.read(key).crossings??[]]));
 const sourceGround=(x,z)=>{const t=terrains.get(Math.floor(x/1024)+'_'+Math.floor(z/1024));return t?sampleChunkLandHeight(t,x,z,true):undefined;};
 const reconciled=reconcileStreetTerrain(terrains,(t,x,z)=>crossingHeight(crossings.get(Math.floor(x/1024)+'_'+Math.floor(z/1024))??[],sourceGround,x,z,t.streetPilot&&inPilot(x,z)?pilotStreetHeight(x,z):sampleChunkLandHeight(t,x,z,true)));
 for(const [key,grids] of reconciled){const t=terrains.get(key);t.heights=new Float32Array(grids.land);t.roadHeights=new Float32Array(grids.road);}
 const ground=(x,z)=>{const t=terrains.get(Math.floor(x/1024)+'_'+Math.floor(z/1024));return t?sampleChunkLandHeight(t,x,z,true):undefined;};
 const deck=(x,z,y)=>crossingHeight(crossings.get(Math.floor(x/1024)+'_'+Math.floor(z/1024))??[],ground,x,z,y);
 // The final physical edge grid already includes crossing support. Reapplying
 // deck interpolation here would raise only road vertices above neighbouring land.
 const seamHeight=createStreetSeamSampler(terrains,(t,x,z)=>sampleChunkLandHeight(t,x,z,true));
 const elevatedHeight=createElevatedStreetSampler((x,z)=>seamHeight(x,z)??ground(x,z),read(base+'-elevated-roofs.json'),(x,z)=>Math.max(seamHeight(x,z)??ground(x,z)??0,sourceGround(x,z)??-Infinity));
 // One city-wide deck plan (deck-structure.mjs) — the same inputs repair-elevated-decks.mjs reads
 // from completed chunks, so rebuilt and repaired cities agree. Source layer is ordering only.
 const chunkKeys=new Set(input.chunks.map(c=>c.cx+'_'+c.cz)),elevatedLines=[],groundLines=[],deckWater=[],deadEnds=new RoadDeadEnds();
 for(const chunk of input.chunks){const key=chunk.cx+'_'+chunk.cz,part=regions.keys.includes(key)?regions.read(key):null;
  for(const r of chunk.objects?.roads??[]){deadEnds.add(r.p);if(r.tunnel||(r.layer??0)<0||r.p.length<4)continue;
   if(r.bridge||(r.layer??0)>0)elevatedLines.push({p:r.p,level:Math.max(1,r.layer??0),w:r.w??8,bridge:!!r.bridge,chunk:key});else groundLines.push({p:r.p,w:r.w??8});}
  for(const w of part?.resolvedWater??chunk.objects?.water??[])deckWater.push(w);}
 const deckGround=(x,z)=>seamHeight(x,z)??ground(x,z),roadEntries=deadEnds.byChunk();
 const deckPlan=planCityDecks({elevated:elevatedLines,ground:groundLines,water:deckWater,terrain:deckGround,portalHeight:deckGround,
  // Cheonggye pilot bridges are drawn by the pilot at street level: the deck lies on them (no crown).
  bound:(x,z,level)=>{const b=elevatedHeight(x,z,level);return terrains.get(Math.floor(x/1024)+'_'+Math.floor(z/1024))?.streetPilot&&pilotBridgeAt(x,z)?Math.min(b??Infinity,pilotStreetHeight(x,z)+PORTAL_LIFT):b;},interior:(x,z)=>[[-48,-48],[48,-48],[-48,48],[48,48]].every(([dx,dz])=>chunkKeys.has(Math.floor((x+dx)/1024)+'_'+Math.floor((z+dz)/1024)))});
 const ramps=approachRamps(deckPlan,groundLines),deckHeight=(x,z,level,own)=>deckPlan.height(x,z,level,elevatedHeight(x,z,level),own);
 console.log(JSON.stringify({deckPlan:deckPlan.stats,approachRamps:ramps.lifts.length,residualSteps:ramps.residual.length}));
 const output={},yielded={},sharded=input.coverage==='manifest';let totalTriangles=0,totalBytes=0;
 for(const chunk of input.chunks){const key=chunk.cx+'_'+chunk.cz,part=regions.keys.includes(key)?regions.read(key):null;if(!part)continue;
 const origin=[chunk.cx*1024,chunk.cz*1024],terrain=terrains.get(key);
 // A seam vertex takes the plan height with every road (no per-piece choice): both chunks agree on it.
 const seamOf=(x,z)=>[x-origin[0],z-origin[1]].some(v=>Math.abs(v)<.01||Math.abs(v-1024)<.01);if(terrain)delete terrain.compiledStreet;
 const layers=new Map(),supportVolumes=[];
 for(const r of part.regions){const level=r.kind==='walkdeck'?1:r.kind.startsWith('deck-')?Number(r.kind.slice(5)):0,layer=r.kind==='walkdeck'?1:level?3:{pavement:1,asphalt:3,curb:2,center:4}[r.kind],meshKey=layer+':'+level,pos=layers.get(meshKey)??[];
 // Each connected deck strip takes its heights from the roads running through it (deck-structure linesThrough).
 const ownOf=new Map();if(level&&r.kind!=='walkdeck'){const soup=r.triangles.map(t=>[t[0],0,t[1],t[2],0,t[3],t[4],0,t[5]]);
  for(const piece of meshPieces(soup)){const lines=deckPlan.linesThrough(piece.map(i=>soup[i]),level);for(const i of piece)ownOf.set(r.triangles[i],lines);}}
 for(const triangle of r.triangles){const own=ownOf.get(triangle),poly=[[triangle[0],triangle[1]],[triangle[2],triangle[3]],[triangle[4],triangle[5]]];let area=0;for(let k=0;k<3;k++)area+=poly[k][0]*poly[(k+1)%3][1]-poly[(k+1)%3][0]*poly[k][1];if(area<0)poly.reverse();
 const data=terrainFootprint(poly,terrain,...origin,true,true,false);for(let k=0;k<data.length;k+=3){const x=data[k]+origin[0],z=data[k+2]+origin[1];data[k+1]=deck(x,z,data[k+1]);if(sharded)data[k+1]=seamHeight(x,z)??data[k+1];if(r.kind==='walkdeck'){
 const profile=r.profile;if(profile.offset!=null)data[k+1]+=walkAccessOffset(profile.offset,x,z,profile.accessAnchors);
 else {const levels=profile.levels??[1],p=profile.path;let distance=Infinity,along=0,total=0;for(let j=2;j<p.length;j+=2)total+=Math.hypot(p[j]-p[j-2],p[j+1]-p[j-1]);let walked=0;for(let j=2;j<p.length;j+=2){const dx=p[j]-p[j-2],dz=p[j+1]-p[j-1],length=Math.hypot(dx,dz),t=length?Math.max(0,Math.min(1,((x-p[j-2])*dx+(z-p[j-1])*dz)/(length*length))):0,d=Math.hypot(x-p[j-2]-t*dx,z-p[j-1]-t*dz);if(d<distance){distance=d;along=walked+t*length;}walked+=length;}const t=total?along/total:0;const offsets=profile.offsets??levels.map(v=>v*3.3);data[k+1]+=offsets[0]+(offsets.at(-1)-offsets[0])*t;}
 }else if(level)data[k+1]=deckHeight(x,z,level,seamOf(x,z)?undefined:own);}
 // Approach ramps lift at-grade surfaces, splitting triangles the ramp edge runs through.
 const drop=[],surface=!level&&r.kind!=='walkdeck'?liftTriangles(data,(x,z)=>ramps.lift(x+origin[0],z+origin[1]),[],drop):data;
 // Ramp-side feathers become retaining walls; the surface audit is told which plan area they took.
 if(drop.length)((yielded[key]??={})[r.kind]??=[]).push(...drop.map((v,i)=>Math.round((v+origin[i%2])*1000)/1000));
 for(let k=0;k<surface.length;k++)pos.push(Math.round((surface[k]+(k%3===1&&(layer===1||layer===2)?(layer===2?.10:.025):0))*10000)/10000);
 if(r.kind==='walkdeck'&&r.profile.offset!=null)for(let k=0;k<data.length;k+=9){
  const v=data.slice(k,k+9).map((value,j)=>Math.round((value+(j%3===1?.025:0))*10000)/10000+(j%3===0?origin[0]:j%3===2?origin[1]:0));
  const volume=streetSupportPrism(v,r.profile.offset+.025);if(volume)supportVolumes.push(volume);
 }
 }
 if(r.kind==='walkdeck'&&r.profile.offset!=null){
  for(const ring of [r.p,...(r.holes??[])])for(let j=0;j<ring.length;j+=2){const k=(j+2)%ring.length,ax=ring[j],az=ring[j+1],bx=ring[k],bz=ring[k+1],ay=seamHeight(ax,az)??ground(ax,az)??0,by=seamHeight(bx,bz)??ground(bx,bz)??0,ha=walkAccessOffset(r.profile.offset,ax,az,r.profile.accessAnchors)+.025,hb=walkAccessOffset(r.profile.offset,bx,bz,r.profile.accessAnchors)+.025;
   pos.push(ax-origin[0],ay,az-origin[1],bx-origin[0],by+hb,bz-origin[1],ax-origin[0],ay+ha,az-origin[1],ax-origin[0],ay,az-origin[1],bx-origin[0],by,bz-origin[1],bx-origin[0],by+hb,bz-origin[1]);
  }
 }
 layers.set(meshKey,pos);
 }
 // Deck girders / undersides / piers and approach-ramp retaining walls (layer 6 = concrete).
 const toCell=meshKey=>{const p=layers.get(meshKey)??[],out=[];for(let i=0;i+8<p.length;i+=9)out.push([p[i]+origin[0],p[i+1],p[i+2]+origin[1],p[i+3]+origin[0],p[i+4],p[i+5]+origin[1],p[i+6]+origin[0],p[i+7],p[i+8]+origin[1]]);return out;};
 const toLocal=faces=>faces.map((v,i)=>Math.round((v-(i%3===0?origin[0]:i%3===2?origin[1]:0))*10000)/10000);
 const onSeam=v=>Math.abs(v)<.01||Math.abs(v-1024)<.01,edgeOfChunk=(x,z)=>onSeam(x-origin[0])||onSeam(z-origin[1]);
 const skirt=liftSkirts(SKIRT_LAYERS.flatMap(l=>toCell(l+':0')),ramps.lift,edgeOfChunk);
 if(skirt.length)layers.set('6:0',(layers.get('6:0')??[]).concat(toLocal(skirt)));
 // Decks cut back where they hang low over a street running along them (deck-structure trimDeckTriangles).
 const streetTop=surfaceGrid(toCell('3:0')),trimTests=deckTrimTests(chunk.objects?.roads??[],streetTop,deckPlan.nearest);
 for(const k of [...layers.keys()].filter(k=>k.startsWith('3:')&&k!=='3:0')){const level=Number(k.slice(2)),tests=trimTests(level),out=[];
  // No cliff where two roads' heights meet; a deck on its street, near its end, or on the chunk seam
  // (the neighbour cannot see this chunk's raise) stays put (repair-elevated-decks.mjs).
  const deckEnds=deckPlan.nodes.filter(n=>(n.portal||n.deadEnd)&&Math.abs(n.x-origin[0]-512)<540&&Math.abs(n.z-origin[1]-512)<540).map(n=>[n.x,n.z,n.h]),soup=toCell(k).flat();limitDeckGrade(soup,soup.map((_,i)=>i).slice(0,soup.length/3),v=>{const top=streetTop(soup[v*3],soup[v*3+2]);const x=soup[v*3],z=soup[v*3+2];return edgeOfChunk(x,z)||top!==undefined&&soup[v*3+1]-top<TRIM_FLUSH+.01||deckEnds.some(e=>holdsDeckEnd(e,x,soup[v*3+1],z));});
  for(let i=0;i<soup.length;i+=9){const t=soup.slice(i,i+9),r=trimDeckTriangles(t,tests);out.push(...r.tris);
   // A cut deck triangle is recorded for the surface audit like a ramp-side feather.
   if(r.cut)((yielded[key]??={})['deck-'+level]??=[]).push(...[t[0],t[2],t[3],t[5],t[6],t[8]].map(v=>Math.round(v*1000)/1000));}
  // A deck never dips under an at-grade street it overlaps (on a hillside the uphill street pushed through it).
  for(let i=0;i<out.length;i+=3){const top=streetTop(out[i],out[i+2]);if(top!==undefined&&out[i+1]<top+PORTAL_LIFT)out[i+1]=top+PORTAL_LIFT;}
  layers.set(k,toLocal(out));}
 const deckTris=[...layers.keys()].filter(k=>k.startsWith('3:')&&k!=='3:0').flatMap(toCell);
 // Paint, curbs and pavement just under a deck met at grade showed through it (white dashes on the slab).
 const deckTop=surfaceGrid(deckTris);
 for(const l of UNDER_DECK_LAYERS){const k=l+':0';if(!layers.has(k))continue;const kept=[];
  const hidden=[],kind={1:'pavement',2:'curb',4:'center'}[l];
  for(const t of toCell(k))hideUnderDeck(t,(x,z,y)=>{const d=deckTop(x,z);return d!==undefined&&d-y>-.2&&d-y<1;},kept,0,hidden);
  if(hidden.length)((yielded[key]??={})[kind]??=[]).push(...hidden.map(v=>Math.round(v*1000)/1000));
  layers.set(k,toLocal(kept));}
 // A lamp or tree whose pavement went under a deck or into a ramp wall would stand on nothing.
 const planned=surfaceGrid(part.regions.filter(r=>r.kind==='pavement').flatMap(r=>r.triangles.map(t=>[t[0],0,t[1],t[2],0,t[3],t[4],0,t[5]])));
 const props=standingProps(part.props,planned,surfaceGrid(toCell('1:0')));
 const decksAt=surfaceCount(deckTris),walkTop=surfaceGrid(toCell('1:0')),carriage=[...toCell('3:0'),...toCell('2:0')],carriageTop=surfaceGrid(carriage);
 const onCarriage=(x,z)=>carriage.some(t=>{const d=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]);if(Math.abs(d)<1e-9)return false;const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/d,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/d;return a>=0&&b>=0&&a+b<=1;});
 const solid=(part.resolvedBuildings??chunk.objects.buildings).filter(b=>b.p?.length>=6&&!b.groundClearance);
 const structure=deckStructures({tris:deckTris,lines:elevatedLines.filter(l=>l.chunk===key),height:(x,z,l)=>deckPlan.height(x,z,l,undefined),terrain:(x,z)=>Math.max(deckGround(x,z)??0,carriageTop(x,z)??-Infinity), // slab faces hang to the street surface
  // No pier on a carriageway, pavement or water, nor in a building (deckStructures probes its whole footprint),
  // nor through a lower deck under this one.
  blocked:(x,z)=>onCarriage(x,z)||walkTop(x,z)!==undefined||decksAt(x,z)>1||deckPlan.inWater(x,z)||solid.some(b=>insideRing(b.p,x,z)),edgeOfChunk,street:streetTop});
 if(structure.lips.length)layers.set('3:0',(layers.get('3:0')??[]).concat(toLocal(structure.lips)));
 if(structure.faces.length)layers.set('6:1',(layers.get('6:1')??[]).concat(toLocal(structure.faces)));
 for(const v of structure.volumes)supportVolumes.push(v);
 const fitted=part.resolvedBuildings&&fitDeckSlots(part.resolvedBuildings,deckHeight,[sourceGround,ground]);
 // Final carriageways (decks and lifted approaches included) cut through no building.
 const cleared=clearBuildingsOfRoads(fitted??chunk.objects.buildings,[...layers.keys()].filter(k=>k.startsWith('3:')).flatMap(toCell),(x,z)=>ground(x,z),roadEntries.get(key)??[]);
 const resolvedBuildings=cleared.cut||cleared.raised||cleared.removed||cleared.columns?cleared.buildings:fitted;
 // Canopy columns stand off the final carriageways and decks too (buildings get this in clearBuildingsOfRoads).
 const resolvedStructures=part.resolvedStructures&&structuresOffRoads(part.resolvedStructures,[...layers.keys()].filter(k=>k.startsWith('3:')).flatMap(toCell)).structures;
 const plan={version:1,deckStructure:{version:DECK_STRUCTURE_VERSION},region,terrainHeights:reconciled.get(key)?.land,roadHeights:reconciled.get(key)?.road,bounds:part.bounds,origin,sourceHash:hash,compilerVersion,supportVolumes,meshes:[...layers].sort((a,b)=>a[0].localeCompare(b[0])).map(([meshKey,source])=>{const [layer,level]=meshKey.split(':').map(Number);const position=[],index=[],keys=new Map();for(let i=0;i<source.length;i+=3){const p=source.slice(i,i+3),key=p.join();if(!keys.has(key)){keys.set(key,position.length/3);position.push(...p);}index.push(keys.get(key));}return {layer,level,position,index};}),props,resolvedSites:part.resolvedSites,walls:part.walls,resolvedWater:part.resolvedWater,resolvedBuildings,resolvedStructures,buildings:(resolvedBuildings??chunk.objects.buildings).filter(b=>b.osmId&&!b.walkableProfile).flatMap(b=>b.passageGroundParts?[{id:b.osmId,p:b.p,h:b.h,holes:b.holes,groundClearance:b.passageClearance},...b.passageGroundParts.map(p=>({id:b.osmId,h:b.passageClearance,...p}))]:[{id:b.osmId,p:b.p,h:b.h,holes:b.holes,groundClearance:b.groundClearance}])};
 totalTriangles+=plan.meshes.reduce((s,m)=>s+(m.index?.length??m.position.length/3)/3,0);totalBytes+=Buffer.byteLength(JSON.stringify(plan));
 output[key]=sharded?writeStreetPart(base+'-plans',key,plan):plan;
 if(Object.keys(output).length%100===0)console.log(JSON.stringify({bakedChunks:Object.keys(output).length,triangles:totalTriangles}));
 }
 writeFileSync(base+'-yielded.json',JSON.stringify(yielded));
 writeFileSync(base+'-plans.json',JSON.stringify(sharded?{format:'chunk-files',chunks:output}:output));
 console.log(JSON.stringify({chunks:Object.keys(output).length,bytes:totalBytes,triangles:totalTriangles,sourceHash:hash}));
}finally{await server.close();}
/** Props still on pavement after the bake removed some of it (footprint ±0.85 m, as audit-street-meshes.py). */
function standingProps(list,planned,pavement){
 return list.filter(p=>[[0,0],[-.85,-.85],[.85,-.85],[-.85,.85],[.85,.85]].every(([dx,dz])=>planned(p.x+dx,p.z+dz)===undefined||pavement(p.x+dx,p.z+dz)!==undefined));
}
function insideRing(p,x,z){let c=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const xi=p[i],zi=p[i+1],xj=p[j],zj=p[j+1];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;}
/** Number of separate surfaces (0.5 m apart) of `tris` over (x,z), 16 m binned. */
function surfaceCount(tris){
 const cells=new Map();for(const t of tris){for(let a=Math.floor(Math.min(t[0],t[3],t[6])/16);a<=Math.floor(Math.max(t[0],t[3],t[6])/16);a++)for(let b=Math.floor(Math.min(t[2],t[5],t[8])/16);b<=Math.floor(Math.max(t[2],t[5],t[8])/16);b++){const k=a+':'+b;(cells.get(k)??cells.set(k,[]).get(k)).push(t);}}
 return (x,z)=>{const ys=[];for(const t of cells.get(Math.floor(x/16)+':'+Math.floor(z/16))??[]){const det=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]);if(Math.abs(det)<1e-9)continue;
  const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/det,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/det,c=1-a-b;if(Math.min(a,b,c)<-1e-6)continue;const y=a*t[1]+b*t[4]+c*t[7];if(ys.every(v=>Math.abs(v-y)>.5))ys.push(y);}return ys.length;};
}
/** Highest surface of `tris` ([x,y,z]*3, cell metres) at (x,z), 16 m binned; undefined off them. */
function surfaceGrid(tris){
 const cells=new Map();for(const t of tris){for(let a=Math.floor(Math.min(t[0],t[3],t[6])/16);a<=Math.floor(Math.max(t[0],t[3],t[6])/16);a++)for(let b=Math.floor(Math.min(t[2],t[5],t[8])/16);b<=Math.floor(Math.max(t[2],t[5],t[8])/16);b++){const k=a+':'+b;(cells.get(k)??cells.set(k,[]).get(k)).push(t);}}
 return (x,z)=>{let best;for(const t of cells.get(Math.floor(x/16)+':'+Math.floor(z/16))??[]){const det=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]);if(Math.abs(det)<1e-9)continue;
  const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/det,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/det,c=1-a-b;if(Math.min(a,b,c)<-1e-6)continue;best=Math.max(best??-Infinity,a*t[1]+b*t[4]+c*t[7]);}return best;};
}
