import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {correctPalaceSite}=await server.ssrLoadModule('/src/world/cities/PalaceSite.ts');
 const {correctGyeongbokgungChunk}=await server.ssrLoadModule('/src/world/cities/Gyeongbokgung.ts');
 const rows=[];
 for(const cx of [83,84])for(const cz of [45,46]){
  const raw=JSON.parse(await readFile(`public/maps/37/126/${Math.floor(cx/16)}_${Math.floor(cz/16)}/${cx}_${cz}.json`,'utf8'));
  const out=correctPalaceSite([37,126],correctGyeongbokgungChunk([37,126],raw));
  rows.push({cx,cz,custom:out.objects.buildings.filter(b=>b.landmarkModel).length,mapped:out.objects.buildings.filter(b=>b.palaceBuildingId&&b.palaceBuildingId!=='unverified-footprint').length,unverified:out.objects.buildings.filter(b=>b.palaceBuildingId==='unverified-footprint').length,added:out.objects.buildings.length-raw.objects.buildings.length,terrainChanged:out.terrain.heights.filter((h,i)=>Math.abs(h-raw.terrain.heights[i])>.01).length});
 }
 await writeFile('build/palace-site-coverage.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));
}finally{await server.close();}
