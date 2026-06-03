import * as THREE from "three";
import type { MatDef } from "./MapData";

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
