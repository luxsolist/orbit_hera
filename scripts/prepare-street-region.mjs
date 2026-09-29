import {collectStreetSource,isStreetSource,refreshStreetObjects} from './street-source.mjs';
import {streetRegions} from './street-config.mjs';
import {readFileSync,writeFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {createOsmParser} from './osmxml.mjs';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {isVehicularHighway,roadWidthInfo,relationPolys,surfaceBuildingKind,structureFields,buildingVerticalFields,buildingHeightInfo,buildingHeightProvenance} from './osm.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const [city='seoul',region='jongno-cheonggye']=process.argv.slice(2);
const cfg=streetRegions(city,region,{requireSource:true})[region];
const cell=read('config/map-cities.json')[city],mlon=111320*Math.cos((cell[0]+.5)*Math.PI/180);
if(cfg.coverage==='manifest'){
 const manifest=read('public/maps/'+cell.join('/')+'/tiles.json'),cs=manifest.chunks;
 cfg.bounds=[Math.min(...cs.map(c=>c.cx))*1024,Math.min(...cs.map(c=>c.cz))*1024,(Math.max(...cs.map(c=>c.cx))+1)*1024,(Math.max(...cs.map(c=>c.cz))+1)*1024];
}
const [x0,z0,x1,z1]=cfg.bounds,margin=cfg.halo??150;
mkdirSync('build/streets',{recursive:true});
const xml='build/streets/'+city+'-'+region+'.osm';
const pbf=process.env.MAP_OSM_PBF??cfg.source;
const sourceStamp=JSON.stringify({schema:2,source:pbf,size:statSync(pbf).size,mtime:statSync(pbf).mtimeMs,bounds:cfg.bounds,margin});
if(!existsSync(xml)||!existsSync(xml+'.source')||readFileSync(xml+'.source','utf8')!==sourceStamp||process.argv.includes('--refresh-source')){
 const bb=[cell[1]+(x0-margin)/mlon,cell[0]+1-(z1+margin)/111320,cell[1]+(x1+margin)/mlon,cell[0]+1-(z0-margin)/111320];
 execFileSync(process.env.OSMCONVERT??'build/map-tools/osmctools/usr/bin/osmconvert',[pbf,'-b='+bb.join(','),'--complete-ways','--complete-multipolygons','--drop-author','--drop-version','--out-osm','-o='+xml]);writeFileSync(xml+'.source',sourceStamp);
}
const els=[];const parser=createOsmParser(e=>{if(isStreetSource(e.tags)||(e.type==='way'&&(e.tags?.traffic_calming==='island'||e.tags?.highway==='traffic_island')))els.push(e);});
for await(const line of createInterface({input:createReadStream(xml),crlfDelay:Infinity}))parser.line(line);
console.log(JSON.stringify({sourceElements:els.length,parser:parser.stats()}));
const project=(lat,lon)=>[(lon-cell[1])*mlon,(cell[0]+1-lat)*111320];
const refreshed=collectStreetSource(els,project,cfg);
const sourceBuildings=new Map(els.filter(e=>e.tags?.building).map(e=>[e.type+'/'+e.id,{tags:e.tags,polys:e.type==='relation'?relationPolys(e,project):(e.geometry?.length>=4?[{outer:e.geometry.flatMap(p=>project(p.lat,p.lon)),holes:[]}]:[])}]));
const roads=els.filter(e=>e.type==='way'&&isVehicularHighway(e.tags?.highway)&&e.geometry?.length>1).map(e=>{
 const t=e.tags;return {id:'way/'+e.id,highway:t.highway,name:t.name??t.ref??'',oneway:t.oneway??'no',lanes:t.lanes,nodes:e.nodes,covered:t.covered,service:t.service,access:t.access,ford:t.ford,...roadWidthInfo(t),bridge:!!t.bridge&&t.bridge!=='no',tunnel:!!t.tunnel&&t.tunnel!=='no',layer:Number(t.layer)||0,p:e.geometry.flatMap(p=>[(p.lon-cell[1])*mlon,(cell[0]+1-p.lat)*111320])};
}).sort((a,b)=>a.id.localeCompare(b.id));
const islands=els.filter(e=>e.geometry?.length>=3&&(e.tags?.['traffic_calming']==='island'||e.tags?.area==='yes'&&e.tags?.highway==='traffic_island')).map(e=>({id:e.id,p:e.geometry.flatMap(p=>[(p.lon-cell[1])*mlon,(cell[0]+1-p.lat)*111320])}));
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try {
 const {applyMapCorrections}=await server.ssrLoadModule('/src/world/MapCorrections.ts');
 const {reconcileUrbanTerrain}=await server.ssrLoadModule('/src/world/SurfaceCoherence.ts');
 const optional=p=>existsSync(p)?read(p):null,chunks=[];
 for(let cz=Math.floor((z0-margin)/1024);cz<=Math.floor((z1+margin)/1024);cz++)for(let cx=Math.floor((x0-margin)/1024);cx<=Math.floor((x1+margin)/1024);cx++){
 const key=cx+'_'+cz,path='public/maps/'+cell.join('/')+'/'+Math.floor(cx/16)+'_'+Math.floor(cz/16)+'/'+key+'.json';
 if(!existsSync(path))continue;
 const stored=read(path),source=stored.mapBuild?.input,raw=source?.raw??stored,grade=source?.roadGrade??optional('public/maps/road-grade/'+cell.join('/')+'/'+key+'.json');if(grade)delete grade.streetPlan;
 let chunk=applyMapCorrections(cell,raw,{roadGrade:grade,detail:source?.detail??optional('public/maps/details/'+city+'/'+key+'.json'),appearance:source?.appearance??optional('public/maps/landmark-appearance/'+city+'/'+key+'.json')},{surfaceCoherence:!cfg.refreshObjects,roadNetwork:!cfg.refreshObjects,streetSections:!cfg.refreshObjects});
 if(cfg.refreshObjects)chunk=reconcileUrbanTerrain({...refreshStreetObjects(chunk,refreshed),surfaceReconciled:false});
 // Restore exact source outlines/courtyards and vertical roles before allocating streets.
 const classified=[];
 for(const b of [...chunk.objects.buildings,...(chunk.objects.structures??[])]){
  const source=sourceBuildings.get(b.osmId);if(!source||b.landmarkModel||b.seoulArchitecture||b.palaceBuildingId||b.statueModel){classified.push(b);continue;}
  const t=source.tags,kind=surfaceBuildingKind(t);if(kind==='underground')continue;
  const fields=structureFields(t),vertical=buildingVerticalFields(t);
  classified.push({...b,...fields,...vertical,...(cfg.refreshObjects&&b.groundClearance?{groundClearance:b.groundClearance,clearanceSource:b.clearanceSource}:{}),...(kind!=='building'?{h:buildingHeightInfo(t).h,...buildingHeightProvenance(t,b.osmId)}:{}),sourceFootprints:source.polys});
 }
 chunk.objects.buildings=classified.filter(b=>!b.structureKind);
 chunk.objects.structures=classified.filter(b=>b.structureKind);

 chunks.push(chunk);
 if(chunks.length%100===0)console.log(JSON.stringify({preparedChunks:chunks.length}));
 }
 const {enabled,...buildConfig}=cfg;
 const input={version:1,city,region,cell,...buildConfig,roads:refreshed.roads,walking:refreshed.walking,islands,chunks,sourceFile:xml};
 if(!input.roads.length)throw Error('No source roads in requested region');
 if(cfg.refreshObjects&&chunks.some(c=>c.objects.buildings.some(b=>!b.osmId&&!b.seoulArchitecture&&!b.landmarkModel)))throw Error('Missing building source identity');
 writeFileSync('build/streets/'+city+'-'+region+'-input.json',JSON.stringify(input));
 console.log(JSON.stringify({roads:roads.length,chunks:chunks.length,bounds:cfg.bounds,source:xml}));
}finally{await server.close();}
