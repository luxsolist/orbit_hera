import {spawnSync} from 'node:child_process';
import {loadMapCities,selectMapCities} from './map-city-config.mjs';
const [command,selection]=process.argv.slice(2),cities=await loadMapCities();
if(!['publish','restore','ensure','prepare'].includes(command))throw new Error('Unknown map command');
const selected=selectMapCities(cities,selection);
function run(executable,args){const result=spawnSync(executable,args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);}
for(const city of selected){
 if(command==='publish')run(process.execPath,['scripts/build-map-bundles.mjs',city]);
 run('python3',['scripts/map-release.py',command,'--city',city]);
}
