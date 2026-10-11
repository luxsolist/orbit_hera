import * as THREE from 'three';
/**
 * Scene-wide lighting state shared by detail-tier shaders (water, signs, foliage sway).
 * SkyEnvironment.update writes it once per frame; materials bind the same uniform objects,
 * so no per-mesh callbacks or per-chunk uniform copies are needed.
 */
export const cityUniforms={
 time:{value:0},
 daylight:{value:1},
 night:{value:0},
 sun:{value:new THREE.Vector3(.4,.8,.45)},
};
