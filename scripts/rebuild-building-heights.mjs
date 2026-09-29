// Reprocess complete, previously built footprints without replacing roads, terrain or source tags.
// The same conservative rule is used by fresh OSM builds and cached-source world builds.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {constrainEstimatedBuildingHeight,auditEstimatedBuildingHeights,ringArea} from './osm.mjs';
const [city,...args]=process.argv.slice(2),apply=args.includes('--apply');
const cell=JSON.parse(readFileSync('config/map-cities.json','utf8'))[city];
if(!cell)throw new Error('usage: node scripts/rebuild-building-heights.mjs <city> [--apply]');
const root='public/maps/'+cell.join('/'),manifest=JSON.parse(readFileSync(root+'/tiles.json','utf8'));
const report={city,apply,chunks:0,buildings:0,changedChunks:0,corrections:[],errors:[]};
const pending=[];
for(const {cx,cz,m} of manifest.chunks){
 if(m&&m!==city+'-stream')continue;
 const file=`${root}/${Math.floor(cx/(manifest.block??16))}_${Math.floor(cz/(manifest.block??16))}/${cx}_${cz}.json`;
 const before=readFileSync(file,'utf8'),chunk=JSON.parse(before);let changed=false;report.chunks++;
 for(const b of chunk.objects.buildings??[]){
  report.buildings++;const h=b.h,source=b.heightSource;
  if(constrainEstimatedBuildingHeight(b)){
   changed=true;report.corrections.push({osmId:b.osmId,chunk:[cx,cz],area:ringArea(b.p),before:h,after:b.h,previousSource:source});
  }
 }
 report.errors.push(...auditEstimatedBuildingHeights(chunk.objects.buildings??[]));
 if(changed)pending.push({file,before,after:JSON.stringify(chunk),cx,cz});
}
// Validate the whole city before writing any tile. Keep the exact previous files for recovery.
if(report.errors.length)throw new Error(report.errors.join('\n'));
report.changedChunks=pending.length;
if(apply&&pending.length){
 report.backup=`build/building-height-backups/${city}/${Date.now()}`;mkdirSync(report.backup,{recursive:true});
 for(const c of pending)writeFileSync(`${report.backup}/${c.cx}_${c.cz}.json`,c.before);
 for(const c of pending)writeFileSync(c.file,c.after);
}
mkdirSync('build',{recursive:true});
writeFileSync(`build/${city}-building-heights${apply?'-applied':''}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,corrections:report.corrections.length,examples:report.corrections.slice(0,5)}));
if(!apply&&pending.length)process.exitCode=1;
