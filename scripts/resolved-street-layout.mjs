// Canonical streets for build recipes: use the same semantic/clearance pass as game and viewer.
import {createServer} from 'vite';import {readFileSync,existsSync} from 'node:fs';
const city=process.argv[2],keys=process.argv.slice(3),read=p=>JSON.parse(readFileSync(p,'utf8')),optional=p=>existsSync(p)?read(p):null;
const cell=read('config/map-cities.json')[city];if(!cell||!keys.length||keys.some(k=>!/^\d+_\d+$/.test(k)))throw new Error('usage: resolved-street-layout.mjs <city> <cx_cz> ...');
const root='public/maps/'+cell.join('/'),manifest=read(root+'/tiles.json');
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
try{const {applyMapCorrections}=await server.ssrLoadModule('/src/world/MapCorrections.ts');const out={};
 for(const key of keys){const [cx,cz]=key.split('_').map(Number),raw=read(`${root}/${Math.floor(cx/(manifest.block??16))}_${Math.floor(cz/(manifest.block??16))}/${key}.json`);
 const c=applyMapCorrections(cell,raw,{roadGrade:null,detail:optional(`public/maps/details/${city}/${key}.json`),appearance:optional(`public/maps/landmark-appearance/${city}/${key}.json`)},{streetSections:false,streetPilot:false,surfaceCoherence:false,roadNetwork:false});out[key]=c.objects.roads;}
 process.stdout.write(JSON.stringify(out));
}finally{await server.close();}
