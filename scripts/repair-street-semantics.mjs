import {execFileSync} from 'node:child_process';
// Upgrade existing tiles from a local OSM extract without rebuilding unrelated DEM.
// Usage: node scripts/repair-street-semantics.mjs <city> <source.osm>
import {readFileSync,writeFileSync,createReadStream,mkdirSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createOsmParser} from './osmxml.mjs';
import {surfaceBuildingKind,roadWidthInfo,isVehicularHighway} from './osm.mjs';
const [city,source]=process.argv.slice(2),cells=JSON.parse(readFileSync('config/map-cities.json','utf8')),cell=cells[city];
if(!cell||!source)throw new Error('usage: repair-street-semantics.mjs <registered-city> <source.osm>');
execFileSync(process.execPath,['scripts/audit-structure-types.mjs',city,source,'--apply'],{stdio:'inherit'});
const grid=new Map(),size=128;
const project=p=>[(p.lon-cell[1])*111320*Math.cos((cell[0]+.5)*Math.PI/180),(cell[0]+1-p.lat)*111320];
const parser=createOsmParser(el=>{
 if(el.type!=='way'||!isVehicularHighway(el.tags?.highway)||!el.geometry)return;
 const t=el.tags,info=roadWidthInfo(t);if(info.widthSource==='class')return;
 const p=el.geometry.map(project);
 for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.1)continue;
  const e={a,b,len,ux:(b[0]-a[0])/len,uz:(b[1]-a[1])/len,...info,bridge:!!t.bridge&&t.bridge!=='no',tunnel:!!t.tunnel&&t.tunnel!=='no',layer:Number(t.layer)||0};
  for(let z=Math.floor(Math.min(a[1],b[1])/size);z<=Math.floor(Math.max(a[1],b[1])/size);z++)for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++){const k=x+':'+z;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(e);}
 }
});
for await(const line of createInterface({input:createReadStream(source),crlfDelay:Infinity}))parser.line(line);
const root='public/maps/'+cell.join('/'),manifest=JSON.parse(readFileSync(root+'/tiles.json','utf8'));
const report={city,source,platforms:[],underground:[],roadSegments:0,changedChunks:[]};
for(const {cx,cz} of manifest.chunks){
 const path=`${root}/${Math.floor(cx/(manifest.block??16))}_${Math.floor(cz/(manifest.block??16))}/${cx}_${cz}.json`,raw=readFileSync(path,'utf8'),c=JSON.parse(raw);let changed=false;
 c.objects.roads=c.objects.roads.flatMap(r=>{
  if(r.widthSource)return [r];const parts=[];let revised=false;
  for(let i=2;i<r.p.length;i+=2){const a=r.p.slice(i-2,i),b=r.p.slice(i,i+2),len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.1)continue;
   const ux=(b[0]-a[0])/len,uz=(b[1]-a[1])/len,count=Math.max(1,Math.ceil(len/8)),matches=[];
   for(let j=0;j<count;j++){const x=a[0]+(b[0]-a[0])*(j+.5)/count,z=a[1]+(b[1]-a[1])*(j+.5)/count;let best=null,distance=2;
    const near=new Set();for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)for(const e of grid.get((Math.floor(x/size)+dx)+':'+(Math.floor(z/size)+dz))??[])near.add(e);
    for(const e of near){if(!!r.bridge!==e.bridge||!!r.tunnel!==e.tunnel||(r.layer??0)!==e.layer||Math.abs(ux*e.ux+uz*e.uz)<.98)continue;
     const t=Math.max(0,Math.min(e.len,(x-e.a[0])*e.ux+(z-e.a[1])*e.uz)),d=Math.hypot(x-e.a[0]-t*e.ux,z-e.a[1]-t*e.uz);
     if(d<distance){best=e;distance=d;}
    }if(best)matches.push(best);
   }
   // A partial/ambiguous source extract must not change the rest of a long road.
   const first=matches[0],consistent=first&&matches.length>=count*.9&&matches.every(m=>m.w===first.w&&m.widthSource===first.widthSource);
   const piece=consistent?{...r,p:[...a,...b],w:first.w,widthSource:first.widthSource}:{...r,p:[...a,...b]};
   if(consistent){revised=true;report.roadSegments++;}parts.push(piece);
  }
  if(revised){changed=true;return parts;}return [r];
 });
 if(changed){const backup=`build/street-semantics-backup/${city}/${cx}_${cz}.json`;mkdirSync(`build/street-semantics-backup/${city}`,{recursive:true});writeFileSync(backup,raw,{flag:'wx'});writeFileSync(path,JSON.stringify(c));report.changedChunks.push([cx,cz]);}
}
mkdirSync('build',{recursive:true});writeFileSync(`build/${city}-street-semantics-report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
