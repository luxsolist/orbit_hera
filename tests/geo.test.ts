import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { normalizeGeo, setUniformColor, makeMaterial, elevationColor, GROUND_GREEN } from "../src/world/geo";

describe("geo.normalizeGeo", () => {
  it("removes the index and uv (merge 일관성)", () => {
    const g = new THREE.BoxGeometry(1, 1, 1); // indexed + uv 보유
    const n = normalizeGeo(g);
    expect(n.index).toBe(null);
    expect(n.getAttribute("uv")).toBeUndefined();
    expect(n.getAttribute("position")).toBeDefined();
  });
});

describe("geo.setUniformColor", () => {
  it("paints every vertex the same color", () => {
    const g = new THREE.PlaneGeometry(1, 1).toNonIndexed();
    setUniformColor(g, new THREE.Color(0.25, 0.5, 0.75));
    const col = g.getAttribute("color");
    expect(col.count).toBe(g.getAttribute("position").count);
    for (let i = 0; i < col.count; i++) {
      expect(col.getX(i)).toBeCloseTo(0.25);
      expect(col.getY(i)).toBeCloseTo(0.5);
      expect(col.getZ(i)).toBeCloseTo(0.75);
    }
  });
});

describe("geo.makeMaterial", () => {
  it("maps MatDef fields onto MeshStandardMaterial", () => {
    const m = makeMaterial({ c: "ff8800", rough: 0.3, metal: 0.7, flat: true, opacity: 0.5 });
    expect(m.color.getHex()).toBe(0xff8800);
    expect(m.roughness).toBeCloseTo(0.3);
    expect(m.metalness).toBeCloseTo(0.7);
    expect(m.flatShading).toBe(true);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeCloseTo(0.5);
  });

  it("is opaque by default when opacity is absent", () => {
    const m = makeMaterial({ c: "000000" });
    expect(m.transparent).toBe(false);
    expect(m.opacity).toBe(1);
    expect(m.flatShading).toBe(false);
  });
});

describe("geo.elevationColor — 단일 초록 바닥 + 고산 눈(흰색)", () => {
  const out = new THREE.Color();
  it("바닥(저~중 고도) = 단일 옅은 초록 GROUND_GREEN", () => {
    expect(elevationColor(0, out).getHex()).toBe(GROUND_GREEN);
    expect(elevationColor(300, new THREE.Color()).getHex()).toBe(GROUND_GREEN); // 눈선 아래는 모두 동일 초록
  });
  it("고산(눈선 위)은 흰색으로 전이 — 녹색보다 밝고 채도 낮음", () => {
    const peak = elevationColor(900, new THREE.Color()); // 충분히 높음 → 거의 흰색
    expect(peak.r).toBeGreaterThan(0.85);
    expect(peak.g).toBeGreaterThan(0.85);
    expect(peak.b).toBeGreaterThan(0.85);
  });
  it("바닥 초록은 녹색 우세(g>r, g>b)", () => {
    const g = elevationColor(0, new THREE.Color());
    expect(g.g).toBeGreaterThan(g.r);
    expect(g.g).toBeGreaterThan(g.b);
  });
  it("out 인자에 기록하고 같은 참조를 반환(할당 회피)", () => {
    expect(elevationColor(10, out)).toBe(out);
  });
});
