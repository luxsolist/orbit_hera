import {createServer} from 'vite';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const city=process.argv[2];if(city!=='seoul')throw new Error('No reviewed marking recipe for '+city);
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{
 const {solveRoadNetwork}=await server.ssrLoadModule('/src/world/RoadNetwork.ts');
 const {planRoadMarkings,DEFAULT_MARKINGS}=await server.ssrLoadModule('/src/world/RoadMarkings.ts');
 const {pilotWeight,pilotBridgeRoad,pilotInRiver}=await server.ssrLoadModule('/src/world/cities/CheonggyePilot.ts');
 const inputs=['src/world/cities/cheonggye-pilot.json','src/world/RoadNetwork.ts','src/world/RoadMarkings.ts','scripts/build-road-markings.mjs'];
 const hashes=Object.fromEntries(inputs.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
 const recipe=JSON.parse(readFileSync(inputs[0],'utf8'));
 const settings={...DEFAULT_MARKINGS,...recipe.design.markings};
 const network=solveRoadNetwork(recipe.roadNetwork),plan=planRoadMarkings(network,settings,(c,p)=>pilotBridgeRoad([...c.a,...c.b])||!pilotInRiver(...p));
 const data={version:2,sourceHashes:hashes,settings,segments:[...plan].filter(([key,marks])=>{const c=network.get(key);return marks.length&&[0,.5,1].some(t=>pilotWeight(c.a[0]+(c.b[0]-c.a[0])*t,c.a[1]+(c.b[1]-c.a[1])*t)>0);}).map(([key,marks])=>[key,marks.map(m=>[m.start,m.end,m.left,m.right,m.layer,0,m.endLeft,m.endRight].map(n=>Math.round(n*1e5)/1e5))])};
 const output='src/world/cities/cheonggye-markings.json',text=JSON.stringify(data)+'\n';
 if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==text)throw new Error('Road marking recipe is stale. Run npm run build:city-surfaces -- seoul');}
 else writeFileSync(output,text);
 console.log(`Road paint: ${data.segments.length} segments, ${data.segments.reduce((n,[,marks])=>n+marks.length,0)} patches`);
}finally{await server.close();}
