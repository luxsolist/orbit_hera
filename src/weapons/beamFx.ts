import * as THREE from "three";

// 무기 공용 발광 빔 FX — 글로우 텍스처 + 빔(실린더)·임팩트 글로우 스프라이트.
// FrequencyBeam(시안)·SpecialBarrage(호박색)가 색/반경만 달리해 공유한다.

/** 방사형 그라데이션 글로우 텍스처(중앙 흰색 → mid → outer 투명). */
export function makeGlowTexture(mid: string, outer: string): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, mid);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const _up = new THREE.Vector3(0, 1, 0);

/** 발광 빔(실린더) + 끝점 임팩트 글로우를 씬에 추가하고 {line, glow} 반환. */
export function spawnBeam(
  scene: THREE.Scene,
  glowTex: THREE.Texture,
  from: THREE.Vector3,
  to: THREE.Vector3,
  o: { beamColor: number; glowColor: number; radius: number; glowScale: number }
): { line: THREE.Mesh; glow: THREE.Sprite } {
  const axis = new THREE.Vector3().subVectors(to, from);
  const length = axis.length();
  // 실린더 기본 축은 +Y. 길이만큼 만들고 중점에 배치한 뒤 방향으로 회전.
  const geo = new THREE.CylinderGeometry(o.radius, o.radius, length, 6, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color: o.beamColor,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Mesh(geo, mat);
  line.position.copy(from).add(to).multiplyScalar(0.5);
  line.quaternion.setFromUnitVectors(_up, axis.clone().normalize());
  scene.add(line);

  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: o.glowColor,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.position.copy(to);
  glow.scale.setScalar(o.glowScale);
  scene.add(glow);

  return { line, glow };
}
