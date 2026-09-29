import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export function streetBuildHash(base){
 const hash=createHash('sha256').update(readFileSync(base+'-input.json'));
 for(const file of ['scripts/street_walk_access.py','scripts/street-supports.mjs','scripts/street_checkpoint.py','scripts/street-source.mjs','scripts/street-config.mjs','config/street-profiles.json','scripts/street_compile.py','scripts/osm.mjs','scripts/prepare-street-region.mjs','src/world/chunkMesh.ts','src/world/MapCorrections.ts','src/world/StreetPlatform.ts','scripts/bake-street-region.mjs','scripts/street-build-hash.mjs','src/world/StreetGeometry.ts','src/world/SurfacePartition.ts','scripts/street-seams.mjs','scripts/street-crossings.mjs','scripts/street-elevation.mjs','src/world/CompiledStreet.ts'])hash.update(readFileSync(file));
 return hash.digest('hex');
}
