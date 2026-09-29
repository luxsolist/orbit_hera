import type {Cell,WorldChunk} from './chunkManifest';
import type {BundleChunk} from './MapBundles';
import {applyMapCorrections} from './MapCorrections';
/** Normalize redundant staging fields, preserving exactly the displayed/support geometry. */
export function compactMapChunk(chunk:WorldChunk):WorldChunk {
 const result={...chunk};delete result.mapBuild;
 if(result.compiledStreet){const {terrainHeights,roadHeights,buildings,resolvedSites,resolvedWater,resolvedBuildings,resolvedStructures,walls,...plan}=result.compiledStreet;result.compiledStreet=plan;}
 return result;
}
export function completeMapChunk(cell:Cell,input:BundleChunk):WorldChunk {
 if(input.raw.mapBuild?.version===1)return input.raw;
 const output=compactMapChunk(applyMapCorrections(cell,structuredClone(input.raw),structuredClone(input)));
 const source=structuredClone(input);if(source.roadGrade)delete source.roadGrade.streetPlan;
 output.mapBuild={version:1,input:source};
 return output;
}
