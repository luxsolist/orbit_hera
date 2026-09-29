import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';

// Per-city semantic surface gates. Add reviewed cities here rather than duplicating build paths.
export const CITY_SURFACE_CHECKS=Object.freeze({
 seoul:['tests/seoulStreetLayout.test.ts','tests/cheonggyeRoadRegression.test.ts','tests/roadSurfaceReview.test.ts','tests/cheonggyeSurfaces.test.ts','tests/groundedBarrier.test.ts','tests/roadNetwork.test.ts','tests/roadMarkings.test.ts'],
});
export function validateCitySurfaces(city){
 const registered=JSON.parse(readFileSync('config/map-cities.json','utf8'))[city];
 if(registered){const manifest=JSON.parse(readFileSync('public/maps/'+registered.join('/')+'/tiles.json','utf8'));if(manifest.completedChunkVersion===1){execFileSync(process.execPath,['scripts/validate-complete-chunks.mjs',city],{stdio:'inherit'});return;}}

 const checks=['tests/compiledStreet.test.ts','tests/streetSection.test.ts','tests/streetLayout.test.ts','tests/roadRefinement.test.ts','tests/roadNetworkGrade.test.ts','tests/estimatedFootprintHeight.test.ts','tests/structureTypes.test.ts','tests/streetSemantics.test.ts','tests/waterBuild.test.ts','tests/surfaceCoherence.test.ts','tests/roadSurface.test.ts','tests/roadProfile.test.ts','tests/streetAppearance.test.ts','tests/roadMarkingRules.test.ts','tests/streetGeometry.test.ts',...(CITY_SURFACE_CHECKS[city]??[])];
 console.error(`Checking ${city}: common water build contract${CITY_SURFACE_CHECKS[city] ? ", authored roads/river/barriers and worker parity" : ""}`);
 const root=fileURLToPath(new URL('../',import.meta.url));
 const cell=JSON.parse(readFileSync(resolve(root,'config/map-cities.json'),'utf8'))[city];
 if(cell&&existsSync(resolve(root,'public/maps/road-grade/index.json')))execFileSync(process.execPath,['scripts/validate-road-grades.mjs','--cell',cell.join('/')],{cwd:root,stdio:'inherit'});
 if(city==='seoul')execFileSync('python3',['scripts/build-cheonggye-pilot.py','--check'],{cwd:root,stdio:'inherit'});
 if(city==='seoul')execFileSync(process.execPath,['scripts/build-road-markings.mjs',city,'--check'],{cwd:root,stdio:'inherit'});
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../node_modules/vitest/vitest.mjs',import.meta.url)),'run',...checks],{cwd:root,stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(`${city} surface validation failed; map build/packing stopped (exit ${result.status??'unknown'})`);
 if(cell)execFileSync(process.execPath,['scripts/rebuild-building-heights.mjs',city],{cwd:root,stdio:'inherit'});
 if(cell)execFileSync(process.execPath,['scripts/audit-structure-types.mjs',city],{cwd:root,stdio:'inherit'});
 if(cell)execFileSync(process.execPath,['scripts/validate-road-network-grades.mjs',city],{cwd:root,stdio:'inherit'});
 if(cell)execFileSync(process.execPath,['scripts/validate-local-road-refinements.mjs',city],{cwd:root,stdio:'inherit'});
 if(cell)execFileSync(process.execPath,['scripts/audit-street-sections.mjs',city],{cwd:root,stdio:'inherit'});
 if(cell)execFileSync(process.execPath,['scripts/audit-city-roads.mjs',city],{cwd:root,stdio:'inherit'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const cities=process.argv.slice(2);for(const city of cities.length?cities:Object.keys(CITY_SURFACE_CHECKS)){
  // Every city runs the common water contract, even without an authored surface recipe.
  validateCitySurfaces(city);
 }
}
