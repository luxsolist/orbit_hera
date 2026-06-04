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
  it("봉우리에서 멀어질수록 단조 감소(가우시안, 도심 밖)", () => {
    // 100단위 이동의 가우시안 감쇠(≫ 잔물결 ±3) → 엄격 단조 감소
    expect(f.heightAt(800, 800)).toBeGreaterThan(f.heightAt(900, 800));
    expect(f.heightAt(900, 800)).toBeGreaterThan(f.heightAt(1000, 800));
  });
});

describe("TerrainField.cityMask", () => {
  const f = new TerrainField(base);
  it("도심 안=1, 충분히 먼 곳=0", () => {
    expect(f.cityMask(0, 0)).toBeCloseTo(1, 6);
    expect(f.cityMask(2000, 2000)).toBeCloseTo(0, 6);
  });
  it("반감 거리(d=110)≈0.5, 경계(d≥220)=0", () => {
    // 도심 bbox [-50,50] → x=160 은 가장자리에서 d=110, x=271 은 d=221
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
    const f = new TerrainField(base);
    expect(f.inPalace(0, 0)).toBe(true);
    expect(f.inPalace(100, 100)).toBe(false);
  });
  it("경계 없으면 항상 false", () => {
    const f = new TerrainField({ ...base, boundary: undefined });
    expect(f.inPalace(0, 0)).toBe(false);
  });
  it("오목(L자) 경계: 노치는 외부", () => {
    // L자: (0,0)-(40,0)-(40,40)-(20,40)-(20,20)-(0,20). 좌상단(x0~20,y20~40)이 파인 노치.
    const f = new TerrainField({ ...base, boundary: [0, 0, 40, 0, 40, 40, 20, 40, 20, 20, 0, 20] });
    expect(f.inPalace(10, 10)).toBe(true); // 하단 가로획(채워짐)
    expect(f.inPalace(30, 30)).toBe(true); // 우상단 세로획(채워짐)
    expect(f.inPalace(10, 30)).toBe(false); // 좌상단 노치(파인 곳) → 외부
  });
});
