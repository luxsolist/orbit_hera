import {mapBuildVersion,assertCurrentChunk} from './map-build-version.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {cityChunkFiles} from './complete-map-chunks.mjs';
const city=process.argv[2],data=cityChunkFiles(city);let count=0,triangles=0;const version=mapBuildVersion(city);
for(const row of data.rows){const c=JSON.parse(readFileSync(row.file,'utf8'));
 assertCurrentChunk(c,version,row.key);
 if(c.mapBuild?.version!==1||c.mapBuild.input.raw.mapBuild)throw Error('Missing/recursive build input '+row.key);
 if(c.cx+'_'+c.cz!==row.key||c.terrain.heights.length!==c.terrain.size**2||!c.terrain.heights.every(Number.isFinite))throw Error('Invalid terrain '+row.key);
 if(c.roadHeights&&(c.roadHeights.length!==c.terrain.heights.length||!c.roadHeights.every(Number.isFinite)))throw Error('Invalid road support '+row.key);
 if(c.mapBuild.input.roadGrade?.streetPlan)throw Error('Duplicated generated plan '+row.key);
 for(const p of Object.values(row.overlays))if(existsSync(p))throw Error('Unexpected output sidecar '+p);
 for(const mesh of c.compiledStreet?.meshes??[]){if(!mesh.position.every(Number.isFinite)||mesh.position.length%3||mesh.index?.some(i=>!Number.isInteger(i)||i<0||i>=mesh.position.length/3))throw Error('Invalid mesh '+row.key);triangles+=(mesh.index?.length??mesh.position.length/3)/3;}
 count++;
}
console.log(JSON.stringify({city,chunks:count,triangles,sidecars:0}));
