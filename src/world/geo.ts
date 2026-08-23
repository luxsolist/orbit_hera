import * as THREE from "three";
import type { MatDef } from "./MapData";
import { WATER_COLOR } from "./palette";

// 단순 지형 팔레트 — 바닥은 단일 옅은 초록, 고산은 단일 흰색(눈). 비초록 지표(사막/해변/바위/포장)는 SAND_TAN.
// 모놀리식 World 와 스트리밍 청크가 공유.
// 배경 지형은 옅게 — 빠르게 움직이는 화면에서 플라즈모이드(전경)가 잘 보이도록 대비 확보.
export const GROUND_GREEN = 0xa6d985; // 바닥 단일 초록(연한 파스텔 — 녹색 우세 유지)
export const SAND_TAN = 0xe4d8ba; // 비초록 지표 단일 황토색(연하게)
const SNOW = new THREE.Color(0xeef4f7); // 고산 눈
// 표고 0m 이하 지형 — 강·호수(폴리곤)와 **같은 색**. 바다만 다르게 보이지 않도록. palette.ts 참조.
const SEA = new THREE.Color(WATER_COLOR);
const GROUND = new THREE.Color(GROUND_GREEN);
const SNOW_START = 380, SNOW_FULL = 620; // 이 고도(m) 사이에서 초록→흰색

/**
 * 표고 y(m) → 지형색(out 에 기록·반환): 해수면 이하=바다(파랑), 바닥=초록, 고산=흰색(눈). 순수.
 * 해안 맵(부산 등)에서 0m 바다가 초록으로 보이지 않게 — 내륙 맵은 최소 표고가 높아 영향 없음.
 */
export function elevationColor(y: number, out: THREE.Color): THREE.Color {
  out.copy(SEA).lerp(GROUND, THREE.MathUtils.smoothstep(y, 0, 3)); // ≤0 바다 → 3m↑ 육지
  return out.lerp(SNOW, THREE.MathUtils.smoothstep(y, SNOW_START, SNOW_FULL));
}

/** 병합 일관성을 위해 비인덱스화 + uv 제거(여러 지오메트리를 mergeGeometries 로 합칠 때 필수). */
export function normalizeGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute("uv");
  return ng;
}

/** 모든 정점을 단색으로 칠하는 color 속성 부여(vertexColors 메시 병합용). */
export function setUniformColor(g: THREE.BufferGeometry, color: THREE.Color): void {
  const cnt = g.attributes.position.count;
  const arr = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

/** MatDef(데이터) → MeshStandardMaterial. 데이터 구동 랜드마크/공통 재질 생성을 한 곳으로. */
export function makeMaterial(d: MatDef): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: parseInt(d.c, 16),
    roughness: d.rough ?? 0.9,
    metalness: d.metal ?? 0,
    flatShading: d.flat ?? false,
    transparent: d.opacity != null,
    opacity: d.opacity ?? 1,
  });
}
