import { describe, it, expect } from "vitest";
import { TerrainField } from "../src/world/TerrainField";
import { normalizeMapData } from "../src/world/MapData";

// World 에서 분리한 공간 질의 계층(지형 높이·도심/경계 마스크)의 순수성·경계 가드.
// 입력은 평면(v1) JSON → normalizeMapData 로 섹션형 변환 후 주입.

// 도심 bbox = [-50,50]×[-50,50], 멀리(800,800)에 봉우리 1개, 경계 폴리곤(사각) 포함.
const flat = {
  id: "t", name: "t", subtitle: "",
  meta: { lat0: 0, lon0: 0, source: "" },
  buildings: [{ p: [-50, -50, 50, -50, 50, 50, -50, 50] }],
  roads: [], water: [],
  boundary: [-20, -20, 20, -20, 20, 20, -20, 20],
  mountains: [{ x: 800, z: 800, h: 200, r: 120 }],
};
const field = (overrides: Record<string, unknown> = {}) => new TerrainField(normalizeMapData({ ...flat, ...overrides }));

describe("TerrainField.heightAt (절차적 폴백)", () => {
  const f = field();

  it("도심 중심부는 평탄(≈0)", () => {
    expect(Math.abs(f.heightAt(0, 0))).toBeLessThan(0.5);
  });
  it("산봉우리 중심은 솟아오름(도심 밖)", () => {
    expect(f.heightAt(800, 800)).toBeGreaterThan(150);
  });
  it("순수: 같은 입력 → 같은 값", () => {
    expect(f.heightAt(300, -120)).toBe(f.heightAt(300, -120));
  });
  it("봉우리에서 멀어질수록 단조 감소(가우시안, 도심 밖)", () => {
    expect(f.heightAt(800, 800)).toBeGreaterThan(f.heightAt(900, 800));
    expect(f.heightAt(900, 800)).toBeGreaterThan(f.heightAt(1000, 800));
  });
});

describe("TerrainField.heightAt (DEM 하이트맵)", () => {
  it("하이트맵 제공 시 바이리니어 샘플(− seaLevel)", () => {
    // 2×2, meters=2000(±1000), 값 [[0,100],[200,300]], seaLevel=50
    const heights = new Float32Array([0, 100, 200, 300]);
    const map = normalizeMapData({
      ...flat,
      meta: { lat0: 0, lon0: 0, source: "", schema: 2 },
      terrain: { seaLevel: 50, heightmap: { src: "x.bin", size: 2, meters: 2000 } },
      objects: { buildings: flat.buildings, roads: [] },
    });
    const f = new TerrainField(map, heights);
    expect(f.heightAt(-1000, -1000)).toBeCloseTo(0 - 50, 4); // 좌상단 텍셀 − seaLevel
    expect(f.heightAt(1000, 1000)).toBeCloseTo(300 - 50, 4); // 우하단
    expect(f.heightAt(0, 0)).toBeCloseTo(150 - 50, 4); // 중앙 평균
  });
  it("하이트맵 선언돼도 heights 미로드면 절차적 폴백", () => {
    const map = normalizeMapData({
      ...flat, meta: { lat0: 0, lon0: 0, source: "", schema: 2 },
      terrain: { heightmap: { src: "x.bin", size: 2, meters: 2000 }, procedural: { mountains: flat.mountains } },
      objects: { buildings: flat.buildings, roads: [] },
    });
    const f = new TerrainField(map, null); // heights 없음 → 절차적
    expect(f.heightAt(800, 800)).toBeGreaterThan(150);
  });
});

describe("TerrainField.cityMask", () => {
  const f = field();
  it("도심 안=1, 충분히 먼 곳=0", () => {
    expect(f.cityMask(0, 0)).toBeCloseTo(1, 6);
    expect(f.cityMask(2000, 2000)).toBeCloseTo(0, 6);
  });
  it("반감 거리(d=110)≈0.5, 경계(d≥220)=0", () => {
    expect(f.cityMask(160, 0)).toBeCloseTo(0.5, 6);
    expect(f.cityMask(271, 0)).toBeCloseTo(0, 6);
  });
  it("거리 증가 → 단조 감소", () => {
    expect(f.cityMask(60, 0)).toBeGreaterThan(f.cityMask(160, 0));
    expect(f.cityMask(160, 0)).toBeGreaterThan(f.cityMask(260, 0));
  });
});

describe("TerrainField.inPalace", () => {
  it("경계 폴리곤 내부=true, 외부=false", () => {
    const f = field();
    expect(f.inPalace(0, 0)).toBe(true);
    expect(f.inPalace(100, 100)).toBe(false);
  });
  it("경계 없으면 항상 false", () => {
    expect(field({ boundary: undefined }).inPalace(0, 0)).toBe(false);
  });
  it("오목(L자) 경계: 노치는 외부", () => {
    const f = field({ boundary: [0, 0, 40, 0, 40, 40, 20, 40, 20, 20, 0, 20] });
    expect(f.inPalace(10, 10)).toBe(true);
    expect(f.inPalace(30, 30)).toBe(true);
    expect(f.inPalace(10, 30)).toBe(false);
  });
});
