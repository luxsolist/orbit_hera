import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {auditStreetRegion} from './audit-street-region.mjs';
import {completeCityChunks} from './complete-map-chunks.mjs';
const [city='seoul',region='jongno-cheonggye']=process.argv.slice(2);
const cell=JSON.parse(readFileSync('config/map-cities.json','utf8'))[city];
const manifest=JSON.parse(readFileSync('public/maps/'+cell.join('/')+'/tiles.json','utf8'));
if(manifest.completedChunkVersion!==1){auditStreetRegion(city,region);await completeCityChunks(city);}
execFileSync(process.execPath,['scripts/build-map-bundles.mjs',city],{stdio:'inherit'});
