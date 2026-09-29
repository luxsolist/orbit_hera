import {createServer} from 'vite';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {auditRoadJoins} from './road-network-grade.mjs';
import {auditRoadProfile,ROAD_PROFILE_LIMITS} from './road-profile.mjs';
const fingerprint=createHash('sha256');
const withoutRefinement=process.argv.includes('--without-refinement');
const withoutNetwork=process.argv.includes('--without-network');
const city=process.argv[2]??'seoul',read=p=>{const bytes=readFileSync(p);fingerprint.update(p).update(bytes);return JSON.parse(bytes.toString());},optional=p=>existsSync(p)?read(p):null;
const cell=read('config/map-cities.json')[city];if(!cell)throw new Error('Unknown city '+city);
const root=`public/maps/${cell.join('/')}`,manifest=read(root+'/tiles.json'),C=manifest.chunkSize;
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {applyMapCorrections}=await server.ssrLoadModule('/src/world/MapCorrections.ts');
 const {chunkTerrainEntry,sampleStreetHeight}=await server.ssrLoadModule('/src/world/chunkMesh.ts');
 const chunks=new Map();
 for(const c of manifest.chunks){const k=`${c.cx}_${c.cz}`,raw=read(`${root}/${Math.floor(c.cx/(manifest.block??16))}_${Math.floor(c.cz/(manifest.block??16))}/${k}.json`);
  chunks.set(k,applyMapCorrections(cell,raw,{roadGrade:optional(`public/maps/road-grade/${cell.join('/')}/${k}.json`),detail:optional(`public/maps/details/${city}/${k}.json`),appearance:optional(`public/maps/landmark-appearance/${city}/${k}.json`)},{roadNetwork:!withoutNetwork,localRefinement:!withoutRefinement}));
 }
 const terrain=new Map([...chunks].map(([k,c])=>[k,chunkTerrainEntry(c,C)]));
 const bounds={minX:Math.min(...manifest.chunks.map(c=>c.cx))*C,maxX:(Math.max(...manifest.chunks.map(c=>c.cx))+1)*C,minZ:Math.min(...manifest.chunks.map(c=>c.cz))*C,maxZ:(Math.max(...manifest.chunks.map(c=>c.cz))+1)*C};
 const totals={city,cell,limits:ROAD_PROFILE_LIMITS,chunks:chunks.size,segments:0,samples:0,steepSegments:0,roughSegments:0,invalidSamples:0,outsideCoverageSamples:0,maxGrade:0,maxGradeChange:0,issues:[]};
 const seen=new Set();
 for(const [k,c] of chunks){
  const roads=c.objects.roads.flatMap(r=>{const out=[];for(let i=2;i<r.p.length;i+=2){const p=r.p.slice(i-2,i+2),key=p.join(',')+':'+r.w;if(!seen.has(key)){seen.add(key);out.push({...r,p});}}return out;});
  const sample=(x,z)=>{const t=terrain.get(`${Math.floor(x/C)}_${Math.floor(z/C)}`);if(!t){if(x<bounds.minX||x>=bounds.maxX||z<bounds.minZ||z>=bounds.maxZ)totals.outsideCoverageSamples++;return NaN;}return sampleStreetHeight(t,x,z);};
  const a=auditRoadProfile(roads,sample);for(const f of ['segments','samples','steepSegments','roughSegments','invalidSamples'])totals[f]+=a[f];
  totals.maxGrade=Math.max(totals.maxGrade,a.maxGrade);totals.maxGradeChange=Math.max(totals.maxGradeChange,a.maxGradeChange);
  totals.issues.push(...a.issues.map(i=>({...i,chunk:k,lat:cell[0]+1-i.location[1]/111320,lon:cell[1]+i.location[0]/manifest.mLon})));
 }
 const allRoads=[...chunks.values()].flatMap(c=>c.objects.roads);
 const connectedSample=(x,z)=>{const t=terrain.get(`${Math.floor(x/C)}_${Math.floor(z/C)}`);return t?sampleStreetHeight(t,x,z):NaN;};
 totals.connectedJoins=auditRoadJoins(allRoads,connectedSample);
 totals.classification={groundSteep:totals.issues.filter(i=>!i.bridge&&!i.layer&&i.steep).length,groundRough:totals.issues.filter(i=>!i.bridge&&!i.layer&&i.rough).length,bridgeTerrainCandidates:totals.issues.filter(i=>i.bridge).length,elevatedTerrainCandidates:totals.issues.filter(i=>!i.bridge&&i.layer>0).length};
 // Tagged bridges cannot be certified by sampling the terrain below their decks.
 const {busanBridgeStreets}=await server.ssrLoadModule('/src/world/cities/BusanBridges.ts');
 const deckSeen=new Set(),deckReview={sections:0,steepSections:0,discontinuousEnds:0,scope:'authored deck/approach geometry; unpaired OSM bridges remain review candidates'},deckEnds=new Map();
 for(const c of chunks.values())for(const s of busanBridgeStreets(c.seoulDetail??c.busanDetail)){
  const key=JSON.stringify([s.a,s.b]);if(deckSeen.has(key))continue;deckSeen.add(key);deckReview.sections++;
  const mid=r=>[(r[0]+r[3])/2,(r[1]+r[4])/2,(r[2]+r[5])/2],a=mid(s.a),b=mid(s.b),len=Math.hypot(b[0]-a[0],b[2]-a[2]);
  if(len>.01&&Math.abs(b[1]-a[1])/len>ROAD_PROFILE_LIMITS.maxGrade)deckReview.steepSections++;
  for(const p of [a,b]){const k=p[0].toFixed(2)+','+p[2].toFixed(2)+','+Math.round(p[1]/3);const old=deckEnds.get(k);if(old!=null&&Math.abs(old-p[1])>.1)deckReview.discontinuousEnds++;deckEnds.set(k,p[1]);}
 }
 totals.authoredDeckReview=deckReview;
 totals.issues.sort((a,b)=>b.maxGrade-a.maxGrade);totals.generatedAt=new Date().toISOString();totals.inputDataSha256=fingerprint.digest('hex');
 totals.interiorInvalidSamples=totals.invalidSamples-totals.outsideCoverageSamples;totals.qualityPassed=totals.steepSegments===0&&totals.roughSegments===0&&totals.interiorInvalidSamples===0&&totals.connectedJoins.roughJoins===0&&totals.authoredDeckReview.steepSections===0&&totals.authoredDeckReview.discontinuousEnds===0;
 const comparisonIndex=process.argv.indexOf('--compare');
 if(comparisonIndex>=0){
  const baseline=JSON.parse(readFileSync(process.argv[comparisonIndex+1],'utf8'));
  if(baseline.city!==city||JSON.stringify(baseline.limits)!==JSON.stringify(ROAD_PROFILE_LIMITS)||baseline.segments!==totals.segments)throw new Error('Incompatible road audit baseline');
  totals.comparison={baseline:process.argv[comparisonIndex+1],steepBefore:baseline.steepSegments,roughBefore:baseline.roughSegments,steepAfter:totals.steepSegments,roughAfter:totals.roughSegments,joinsBefore:baseline.connectedJoins?.roughJoins,joinsAfter:totals.connectedJoins.roughJoins,passed:totals.steepSegments<=baseline.steepSegments&&totals.roughSegments<=baseline.roughSegments&&totals.maxGrade<=baseline.maxGrade+.001&&(!baseline.connectedJoins||totals.connectedJoins.roughJoins<=baseline.connectedJoins.roughJoins)};
  if(!totals.comparison.passed)process.exitCode=1;
 }
 mkdirSync('build',{recursive:true});const suffix=withoutNetwork?'-network-baseline':withoutRefinement?'-refinement-baseline':process.argv.includes('--baseline')?'-baseline':'';writeFileSync(`build/${city}-road-profile${suffix}.json`,JSON.stringify(totals));
 if(!totals.qualityPassed)console.error(`Road quality review required: ${totals.steepSegments} steep / ${totals.roughSegments} irregular segments. See build/${city}-road-profile${suffix}.json`);
 const {issues,...summary}=totals;console.log(JSON.stringify({...summary,worst:issues.slice(0,3)}));
 if(totals.invalidSamples>totals.outsideCoverageSamples||process.argv.includes('--strict')&&!totals.qualityPassed)process.exitCode=1;
}finally{await server.close();}
