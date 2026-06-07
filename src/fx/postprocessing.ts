import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Bloom 포스트 프로세싱 컴포저.
 * 이미시브/글로우 머티리얼(에너지 빔, 디졸브 경계, 코어)을 발광시켜
 * 스펙 1장의 'SF적 분위기' 연출을 담당.
 */
export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // 블룸 렌더타깃 기준 해상도를 절반으로 — 밉 체인 RT 메모리/대역폭을 1/4 로(특히 iPad VRAM 절감). 시각 차이 미미.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(Math.max(1, window.innerWidth >> 1), Math.max(1, window.innerHeight >> 1)),
    0.85, // strength
    0.6, // radius
    0.75 // threshold — 밝은 하늘은 블룸 제외, 빔/임팩트 등 진짜 발광체만 빛나게
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return composer;
}

/**
 * 컴포저 완전 해제 — EffectComposer.dispose() 는 자체 핑퐁 RT 2개만 풀고 추가 패스(UnrealBloomPass 등)의
 * 렌더타깃은 해제하지 않는다. 각 패스의 dispose() 까지 호출해 블룸 밉체인 RT(컴포저당 ~11개) 누수를 막는다.
 */
export function disposeComposer(composer: EffectComposer): void {
  for (const pass of composer.passes) (pass as { dispose?: () => void }).dispose?.();
  composer.dispose();
}
