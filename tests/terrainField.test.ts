import { describe, it, expect } from "vitest";
import { TerrainField } from "../src/world/TerrainField";
import type { MapData } from "../src/world/MapData";

// World 에서 분리한 공간 질의 계층(지형 높이·도심/경계 마스크)의 순수성·경계 가드.

// 도심 bbox = [-50,50]×[-50,50], 멀리(800,800)에 봉우리 1개, 경계 폴리곤(사각) 포함.
const base: MapData = {
  id: "t",
  name: "t",
  subtitle: "",
  meta: { lat0: 0, lon0: 0, source: "" },
  buildings: [{ p: [-50, -50, 50, -50, 50, 50, -50, 50] } as any],
  roads: [],
  water: [],
  boundary: [-20, -20, 20, -20, 20, 20, -20, 20],
  mountains: [{ x: 800, z: 800, h: 200, r: 120 } as any],
};

describe("TerrainField.heightAt", () => {
  const f = new TerrainField(base);

  it("도심 중심부는 평탄(≈0)", () => {
    expect(Math.abs(f.heightAt(0, 0))).toBeLessThan(0.5);
  });
  it("산봉우리 중심은 솟아오름(도심 밖)", () => {
    expect(f.heightAt(800, 800)).toBeGreaterThan(150);
  });
  it("순수: 같은 입력 → 같은 값", () => {
    expect(f.heightAt(300, -120)).toBe(f.heightAt(300, -120));
  });
});

describe("TerrainField.cityMask", () => {
  const f = new TerrainField(base);
  it("도심 안=1, 충분히 먼 곳=0", () => {
    expect(f.cityMask(0, 0)).toBeCloseTo(1, 6);
    expect(f.cityMask(2000, 2000)).toBeCloseTo(0, 6);
  });
});

describe("TerrainField.inPalace", () => {
  it("경계 폴리곤 내부=true, 외부=false", () => {
    const f = new TerrainField(base);
    expect(f.inPalace(0, 0)).toBe(true);
    expect(f.inPalace(100, 100)).toBe(false);
  });
  it("경계 없으면 항상 false", () => {
    const f = new TerrainField({ ...base, boundary: undefined });
    expect(f.inPalace(0, 0)).toBe(false);
  });
});
