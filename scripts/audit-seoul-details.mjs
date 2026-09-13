import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'vite';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const index=read('src/world/cities/seoul-detail-index.json');
const v=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {applySeoulDetail}=await v.ssrLoadModule('/src/world/cities/SeoulDetail.ts');
 const {correctJamsilChunk}=await v.ssrLoadModule('/src/world/cities/jamsilCorrection.ts');
 const {correctGyeongbokgungChunk}=await v.ssrLoadModule('/src/world/cities/Gyeongbokgung.ts');
 const {correctPalaceSite}=await v.ssrLoadModule('/src/world/cities/PalaceSite.ts');
 let changedHeights=0,models=0,removed=0,vertices=0;const buildings=[],surfaces=new Set(),water=new Set(),paths=new Set(),walls=new Set();let trees=0;
 for(const key of index.chunks){const [x,z]=key.split('_').map(Number),raw=read(`public/maps/37/126/${Math.floor(x/16)}_${Math.floor(z/16)}/${key}.json`),d=read(`public/maps/details/seoul/${key}.json`);
  const previous=correctPalaceSite([37,126],correctGyeongbokgungChunk([37,126],correctJamsilChunk([37,126],raw))),c=applySeoulDetail([37,126],previous,d);
  removed+=previous.objects.buildings.length-c.objects.buildings.length;
  for(const b of c.objects.buildings){const old=previous.objects.buildings.find(a=>JSON.stringify(a.p)===JSON.stringify(b.p));if(old&&old.h!==b.h)changedHeights++;if(b.seoulArchitecture)models++;buildings.push(b);}
  for(let i=0;i<c.terrain.heights.length;i++)if(c.terrain.heights[i]!==previous.terrain.heights[i])vertices++;
  d.areas.forEach(a=>surfaces.add(a.id));d.water.forEach(a=>water.add(a.id));d.paths.forEach(a=>paths.add(a.id));d.walls.forEach(a=>walls.add(a.id));trees+=d.trees.length;
 }
 const rows=index.targets.map(t=>{const x=(t.lon-126)*88316.0938412203,z=(38-t.lat)*111320;const near=buildings.filter(b=>{const n=b.p.length/2;return Math.hypot(b.p.filter((_,i)=>i%2===0).reduce((a,v)=>a+v,0)/n-x,b.p.filter((_,i)=>i%2===1).reduce((a,v)=>a+v,0)/n-z)<=500;});return {name:t.name,architecture:near.filter(b=>b.seoulArchitecture).length,preservedPalace:near.filter(b=>b.landmarkModel||b.palaceBuildingId).length,taggedHeight:near.filter(b=>b.heightSource==='osm-height').length,estimatedHeight:near.filter(b=>b.heightSource&&b.heightSource!=='osm-height').length};});
 const result={models,changedHeights,removed,terrainVerticesChanged:vertices,uniqueGroundPolygons:surfaces.size,uniqueWaterPolygons:water.size,uniquePaths:paths.size,uniqueWalls:walls.size,trees,rows};
 writeFileSync('build/seoul-reference/runtime-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await v.close();}
