import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Bloom 포스트 프로세싱 컴포저.
 * 이미시브/글로우 머티리얼(에너지 빔, 디졸브 경계, 씨앗 코어)을 발광시켜
 * 스펙 1장의 'SF적 분위기' 연출을 담당.
 */
export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.85, // strength
    0.6, // radius
    0.75 // threshold — 밝은 하늘은 블룸 제외, 빔/임팩트 등 진짜 발광체만 빛나게
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return composer;
}
