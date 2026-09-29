import {createServer} from 'vite';
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
const city=process.argv[2],read=p=>JSON.parse(readFileSync(p,'utf8')),optional=p=>existsSync(p)?read(p):null;
const cell=read('config/map-cities.json')[city];if(!cell)throw new Error('Unknown city: '+city);
const root='public/maps/'+cell.join('/'),manifest=read(root+'/tiles.json');
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {applyMapCorrections}=await server.ssrLoadModule('/src/world/MapCorrections.ts');
 const report={city,tiles:0,sections:0,narrowed:0,shared:0,conflicts:[],explicitWidthAdjustments:0,invalid:[]};
 for(const {cx,cz} of manifest.chunks){const key=cx+'_'+cz,raw=read(`${root}/${Math.floor(cx/(manifest.block??16))}_${Math.floor(cz/(manifest.block??16))}/${key}.json`);
  const c=applyMapCorrections(cell,raw,{roadGrade:null,detail:optional(`public/maps/details/${city}/${key}.json`),appearance:optional(`public/maps/landmark-appearance/${city}/${key}.json`)},{surfaceCoherence:false,roadNetwork:false});report.tiles++;
  for(const r of c.objects.roads){const s=r.streetSection;if(!s)continue;report.sections++;
   if(r.w<s.sourceWidth-.01)report.narrowed++;
   if(s.mode==='shared')report.shared++;
   if(s.mode==='conflict')report.conflicts.push({tile:key,p:r.p,sourceWidth:s.sourceWidth,reason:'centreline/obstacle conflict: existing road retained for review'});
   if(s.explicitWidthAdjusted)report.explicitWidthAdjustments++;
   if(!Number.isFinite(r.w)||r.w<0||r.w>s.sourceWidth+.001||s.carriageway!==r.w||s.sidewalk<0||s.furniture&&s.sidewalk<2.25)report.invalid.push({tile:key,p:r.p,section:s});
  }
 }
 mkdirSync('build',{recursive:true});writeFileSync(`build/${city}-street-section-audit.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,conflicts:report.conflicts.length,invalid:report.invalid.length}));
 if(report.invalid.length)throw new Error('Street section contract violated; packing stopped');
}finally{await server.close();}
