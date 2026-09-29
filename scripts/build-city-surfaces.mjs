import {streetRegions} from './street-config.mjs';
import {restoreMapBuildInputs} from './complete-map-chunks.mjs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {buildStreetRegions} from './build-street-regions.mjs';
import {validateCitySurfaces} from './validate-city-surfaces.mjs';
// Authored design -> regenerated map-derived recipe -> shared geometry audits.
// No network collection or release publication is performed here.
export function buildCitySurfaces(city){
 streetRegions(city,undefined,{requireSource:true,requireCityCoverage:true});
 restoreMapBuildInputs(city);
 execFileSync(process.execPath,['scripts/rebuild-building-heights.mjs',city,'--apply'],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'inherit'});
 if(city==='seoul')execFileSync('python3',['scripts/build-cheonggye-pilot.py'],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'inherit'});
 if(city==='seoul')execFileSync(process.execPath,['scripts/build-road-markings.mjs',city],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'inherit'});
 execFileSync(process.execPath,['scripts/build-road-network-grades.mjs',city],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'inherit'});
 execFileSync(process.execPath,['scripts/build-local-road-refinements.mjs',city],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'inherit'});
 buildStreetRegions(city,undefined,{complete:false});
 validateCitySurfaces(city);
 execFileSync(process.execPath,["scripts/complete-map-chunks.mjs",city],{stdio:"inherit"});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const city=process.argv[2];if(!city)throw new Error('usage: node scripts/build-city-surfaces.mjs <city>');
 buildCitySurfaces(city);
}
