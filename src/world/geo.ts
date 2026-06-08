import * as THREE from "three";
import type { MatDef } from "./MapData";

// 단순 지형 팔레트 — 바닥은 단일 옅은 초록, 고산은 단일 흰색(눈). 비초록 지표(사막/해변/바위/포장)는 SAND_TAN.
// 모놀리식 World 와 스트리밍 청크가 공유.
export const GROUND_GREEN = 0x7ec84a; // 바닥 단일 초록
export const SAND_TAN = 0xd8c89e; // 비초록 지표 단일 황토색
const SNOW = new THREE.Color(0xeef4f7); // 고산 눈
const GROUND = new THREE.Color(GROUND_GREEN);
const SNOW_START = 380, SNOW_FULL = 620; // 이 고도(m) 사이에서 초록→흰색

/** 표고 y(m) → 지형색(out 에 기록·반환): 단일 초록 바닥, 고산(눈)은 흰색으로 전이. 순수. */
export function elevationColor(y: number, out: THREE.Color): THREE.Color {
  return out.copy(GROUND).lerp(SNOW, THREE.MathUtils.smoothstep(y, SNOW_START, SNOW_FULL));
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
