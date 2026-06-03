import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { StructureBuilder } from "../src/world/StructureBuilder";
import { CollisionWorld } from "../src/world/CollisionWorld";
import type { Landmark } from "../src/world/MapData";

/** group 내 모든 메시 position 이 유한값인가(NaN/Inf 없음 — 과거 블랙스크린 원인 가드). */
function positionsFinite(group: THREE.Group): boolean {
  let ok = true;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry) return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    const arr = pos.array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) ok = false;
  });
  return ok;
}

// 모든 프리미티브(box/cyl/cone/plane/hiproof/strut) + 한국식 지붕 파라미터(up>0) 포함
const SAMPLE: Landmark = {
  type: "structure",
  x: 10,
  z: -20,
  rot: 0.5,
  mats: [
    { c: "ada793", rough: 0.9, flat: true },
    { c: "37414d" },
  ],
  parts: [
    { g: "box", s: [4, 2, 4], p: [0, 1, 0], m: 0 },
    { g: "cyl", rt: 0.4, rb: 0.5, h: 3, seg: 8, p: [0, 1.5, 0], m: 0 },
    { g: "cone", r: 0.8, h: 1, p: [0, 3, 0], m: 1 },
    { g: "plane", s: [6, 6], p: [0, 0.1, 0], m: 1 },
    { g: "hiproof", W: 5, D: 4, H: 3, ridge: 0.6, cap: 0.13, fin: 1.7, up: 0.9, p: [0, 3, 0], m: 1 },
    { g: "strut", a: [-1, 0, -1], b: [1, 4, 1], thick: 0.3, m: 0 },
  ],
  colliders: [{ x: 0, z: 0, r: 6, top: 8 }],
  boxColliders: [{ x0: -3, x1: 3, z0: -3, z1: 3 }],
};

describe("StructureBuilder", () => {
  it("builds one merged mesh per material with finite geometry", () => {
    const group = new THREE.Group();
    new StructureBuilder().build(SAMPLE, group, new CollisionWorld());
    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(2); // 재질 2개 → 병합 메시 2
    expect(positionsFinite(group)).toBe(true);
  });

  it("places the sub-group at the landmark origin with Y rotation", () => {
    const group = new THREE.Group();
    new StructureBuilder().build(SAMPLE, group, new CollisionWorld());
    const sub = group.children[0];
    expect(sub.position.x).toBeCloseTo(10);
    expect(sub.position.z).toBeCloseTo(-20);
    expect(sub.rotation.y).toBeCloseTo(0.5);
  });

  it("registers circle + box colliders into the CollisionWorld", () => {
    const collision = new CollisionWorld();
    new StructureBuilder().build(SAMPLE, new THREE.Group(), collision);
    collision.finalize();
    expect(collision.topAt(10, -20)).toBe(8); // 원 콜라이더(top=8) 위
    const r = collision.resolveCollision(10, -20, 0.5, 0); // 콜라이더 중심 → 밀려남
    expect(Math.hypot(r.x - 10, r.z + 20)).toBeGreaterThan(0);
  });

  it("ignores unknown part kinds without throwing", () => {
    const group = new THREE.Group();
    const lm = { ...SAMPLE, parts: [{ g: "blob", m: 0 } as unknown as Landmark["parts"][number]] };
    expect(() => new StructureBuilder().build(lm as Landmark, group, new CollisionWorld())).not.toThrow();
  });
});
