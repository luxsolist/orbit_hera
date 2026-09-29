
import fs from 'node:fs/promises';
import {createServer} from 'vite';
const city=process.argv[2]??'seoul';
const catalog=JSON.parse(await fs.readFile('public/maps/index.json','utf8'));
const entry=catalog.find(c=>c.id===city+'-stream');
if(!entry)throw new Error('Unknown city: '+city);
const dir='public/maps/'+Math.floor(entry.lat)+'/'+Math.floor(entry.lon);
const server=await createServer({server:{middlewareMode:true,watch:null},appType:'custom'});
try{
 const {restoreRegionalArchitecture,seoulArchitectureGeometry}=await server.ssrLoadModule('/src/world/cities/SeoulDetail.ts');
 const files=await fs.readdir(dir,{recursive:true});
 const stats={chunks:0,authored:0,rebound:0,promoted:0,missing:[],invalid:[],tower:null};
 for(const f of files.filter(f=>/\d+_\d+\/\d+_\d+\.json$/.test(f))){
 const raw=JSON.parse(await fs.readFile(dir+'/'+f,'utf8'));if(!raw.objects)continue;stats.chunks++;
 const c=restoreRegionalArchitecture(raw),details=(c.seoulDetail??c.mapBuild?.input.detail)?.buildings??[];
 stats.promoted+=(raw.objects.structures?.length??0)-(c.objects.structures?.length??0);
 stats.rebound+=c.objects.buildings.filter(b=>b.seoulArchitecture).length-raw.objects.buildings.filter(b=>b.seoulArchitecture).length-((raw.objects.structures??[]).filter(b=>b.seoulArchitecture).length);
 for(const d of details.filter(d=>d.kind)){
 stats.authored++;
 const b=c.objects.buildings.find(b=>b.seoulArchitecture?.id===d.id||((b.palaceBuildingId||b.landmarkModel||b.statueModel)&&JSON.stringify(b.p)===JSON.stringify(d.p)));
 if(!b){stats.missing.push({file:f,id:d.id,name:d.name});continue;}
 if(!b.seoulArchitecture)continue;
 const g=seoulArchitectureGeometry(b,c.cx*1024,c.cz*1024,0);if(!g){stats.invalid.push(d.id);continue;}
 g.computeBoundingBox();if(!Array.from(g.getAttribute('position').array).every(Number.isFinite))stats.invalid.push(d.id);
 if(d.kind==='n-tower')stats.tower={file:f,id:d.id,height:b.h,min:g.boundingBox.min.toArray(),max:g.boundingBox.max.toArray()};
 g.dispose();
 }
 }
 if(!stats.chunks||!stats.authored)throw new Error('Restore completed city map chunks before auditing');await fs.mkdir('build',{recursive:true});await fs.writeFile('build/'+city+'-landmark-binding-verification.json',JSON.stringify(stats,null,2));console.log(JSON.stringify(stats,null,2));if(stats.missing.length||stats.invalid.length)process.exitCode=1;
}finally{await server.close();}
