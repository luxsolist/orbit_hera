// Inspect existing tiles against source OSM tags; changes require --apply.
// Inputs: tag-map JSON (osmId -> tags), or one/more local OSM XML extracts.
import {readFileSync,writeFileSync,mkdirSync,createReadStream,existsSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createOsmParser} from './osmxml.mjs';
import {surfaceBuildingKind,structureFields,buildingHeightInfo,buildingHeightProvenance,auditStructureRecords} from './osm.mjs';
const [city,...args]=process.argv.slice(2),apply=args.includes('--apply'),sources=args.filter(a=>!a.startsWith('--'));
const cell=JSON.parse(readFileSync('config/map-cities.json','utf8'))[city];
if(!cell)throw new Error('usage: audit-structure-types.mjs <city> [source.osm|tags.json ...] [--apply]');
const tags=new Map();
for(const source of sources){
 if(source.endsWith('.json'))for(const [id,t] of Object.entries(JSON.parse(readFileSync(source,'utf8'))))tags.set(id,t);
 else {const parser=createOsmParser(e=>{if(e.tags?.building)tags.set(e.type+'/'+e.id,e.tags);});for await(const line of createInterface({input:createReadStream(source),crlfDelay:Infinity}))parser.line(line);}
}
const root='public/maps/'+cell.join('/'),manifest=JSON.parse(readFileSync(root+'/tiles.json','utf8'));
const report={city,sources,apply,buildings:0,matched:0,unmatched:0,counts:{},bakedCounts:{},corrections:[],unknownSmallTall:[],changedChunks:[],errors:[],review:[]};
const run=Date.now();
for(const {cx,cz} of manifest.chunks){
 const file=`${root}/${Math.floor(cx/(manifest.block??16))}_${Math.floor(cz/(manifest.block??16))}/${cx}_${cz}.json`,before=readFileSync(file,'utf8'),c=JSON.parse(before);let changed=false;
 c.objects.buildings=c.objects.buildings.flatMap(b=>{
  report.buildings++;const t=tags.get(b.osmId);
  if(!t){report.unmatched++;let area=0;for(let i=0,j=b.p.length-2;i<b.p.length;j=i,i+=2)area+=b.p[j]*b.p[i+1]-b.p[i]*b.p[j+1];
   if(Math.abs(area)/2<100&&b.h>12&&['neighbor-estimate','default-estimate'].includes(b.heightSource))report.unknownSmallTall.push({osmId:b.osmId,chunk:[cx,cz],h:b.h,area:Math.abs(area)/2});return [b];
  }
  report.matched++;const kind=surfaceBuildingKind(t);report.counts[kind]=(report.counts[kind]??0)+1;if(kind==='building')return [b];
  if(kind==='underground'){changed=true;report.corrections.push({osmId:b.osmId,kind,before:b.h,after:null,chunk:[cx,cz]});return [];}
  const fields=structureFields(t),height=buildingHeightInfo(t),provenance=buildingHeightProvenance(t,b.osmId);
  const {facilityKind,structureKind,roofed,...base}=b;
  const next={...base,...fields,h:height.h,...provenance};
  // Keep surveyed/curated heritage identity and authored model priority.
  if(!t.historic&&!t.heritage&&t.tourism!=='attraction'&&!b.landmarkModel&&!b.palaceBuildingId&&!b.seoulArchitecture){delete next.lm;delete next.n;}
  if(next.heightSource!=='osm-height')delete next.heightTag;if(next.heightSource!=='levels-estimate')delete next.levelsTag;
  if(Object.keys(next).length!==Object.keys(b).length||Object.keys(next).some(k=>JSON.stringify(next[k])!==JSON.stringify(b[k]))){changed=true;report.corrections.push({osmId:b.osmId,kind,before:b.h,after:next.h,chunk:[cx,cz]});}return [next];
 });
 const audit=auditStructureRecords(c.objects.buildings);for(const [kind,n] of Object.entries(audit.counts))report.bakedCounts[kind]=(report.bakedCounts[kind]??0)+n;report.errors.push(...audit.errors);report.review.push(...audit.review);
 if(changed&&apply){if(audit.errors.length)throw new Error(audit.errors.join('\n'));const dir=`build/structure-type-backups/${city}/${run}`;mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/${cx}_${cz}.json`,before);writeFileSync(file,JSON.stringify(c));report.changedChunks.push([cx,cz]);}
}
mkdirSync('build',{recursive:true});writeFileSync(`build/${city}-structure-types${apply?'-applied':''}.json`,JSON.stringify(report,null,2)+'\n');
const {corrections,unknownSmallTall,...summary}=report;console.log(JSON.stringify({...summary,corrections:corrections.length,unknownSmallTall:unknownSmallTall.length,examples:corrections.slice(0,12)}));
if(report.errors.length)process.exitCode=1;
