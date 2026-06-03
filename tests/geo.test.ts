import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { normalizeGeo, setUniformColor, makeMaterial } from "../src/world/geo";

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
