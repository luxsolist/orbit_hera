import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'vite';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {correctJamsilChunk}=await server.ssrLoadModule('/src/world/cities/jamsilCorrection.ts');
 const {correctGyeongbokgungChunk}=await server.ssrLoadModule('/src/world/cities/Gyeongbokgung.ts');
 const {correctPalaceSite}=await server.ssrLoadModule('/src/world/cities/PalaceSite.ts');
 const {applySeoulDetail}=await server.ssrLoadModule('/src/world/cities/SeoulDetail.ts');
 const {correctGwanghwamunStatues}=await server.ssrLoadModule('/src/world/cities/GwanghwamunStatues.ts');
 const {applySeoulLandmarkAppearance}=await server.ssrLoadModule('/src/world/cities/SeoulLandmarkAppearance.ts');
 const {landmarkHighlightEnabled}=await server.ssrLoadModule('/src/world/BuildingFacade.ts');
 const {paintedSeoul}=await server.ssrLoadModule('/src/world/cities/painted.ts');
 const appearanceKeys=new Set(read('src/world/cities/seoul-landmark-appearance-index.json').chunks);
 const index=new Set(read('src/world/cities/seoul-detail-index.json').chunks),rows=[];
 for(const t of read('public/maps/37/126/tiles.json').chunks){
  const key=`${t.cx}_${t.cz}`,raw=read(`public/maps/37/126/${Math.floor(t.cx/16)}_${Math.floor(t.cz/16)}/${key}.json`);
  let c=correctPalaceSite([37,126],correctGyeongbokgungChunk([37,126],correctJamsilChunk([37,126],raw)));
  if(index.has(key))c=applySeoulDetail([37,126],c,read(`public/maps/details/seoul/${key}.json`));
  c=correctGwanghwamunStatues([37,126],c);
  if(appearanceKeys.has(key))c=applySeoulLandmarkAppearance([37,126],c,read(`public/maps/landmark-appearance/seoul/${key}.json`));
  for(const b of c.objects.buildings){if(!b.lm)continue;
   const n=b.p.length/2,x=b.p.filter((_,i)=>i%2===0).reduce((a,v)=>a+v,0)/n,z=b.p.filter((_,i)=>i%2).reduce((a,v)=>a+v,0)/n;
   const model=b.statueModel??b.landmarkModel??b.palaceBuildingId??b.seoulArchitecture?.kind??null;
   rows.push({key,name:b.n??'',class:b.lm,lat:38-z/111320,lon:126+x/88316.0938412203,height:b.h,model,legacyYellow:!model&&!c.seoulDetail&&!c.palaceSite&&landmarkHighlightEnabled(paintedSeoul),previousLegacyYellow:!model&&!c.seoulDetail&&!c.palaceSite,appearance:b.landmarkAppearance?.status??null,source:b.landmarkAppearance?.source??null,p:b.p});
  }
 }
 mkdirSync('build',{recursive:true});writeFileSync('build/seoul-landmark-rendering-audit.json',JSON.stringify(rows,null,2));writeFileSync('public/maps/landmark-appearance/seoul/runtime-audit.json',JSON.stringify(rows));
 console.log(JSON.stringify({total:rows.length,models:rows.filter(r=>r.model).length,legacyYellow:rows.filter(r=>r.legacyYellow).length,naturalShells:rows.filter(r=>r.appearance).length,missingAppearance:rows.filter(r=>!r.model&&!r.appearance).map(r=>({name:r.name,key:r.key}))}));
}finally{await server.close();}
