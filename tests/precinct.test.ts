import { describe, it, expect } from "vitest";
import { resolveBuildingStyle, buildingBaseColor } from "../src/world/precinct";
import type { PrecinctBuilding } from "../src/world/MapData";

// 데이터 구동 권역 건물 양식 해석 — 경복궁 마이그레이션(층고 상한·지붕·생략·색) 회귀 가드.

// 경복궁 precinct.building 값
const PB: PrecinctBuilding = {
  color: "0xcc5a28",
  maxHeight: 8,
  skipEnclosuresOver: 2000,
  roof: { color: "0x3a5c82", thickness: 1.4 },
};

describe("resolveBuildingStyle", () => {
  it("권역 밖: baseH 그대로, 도심 팔레트, 지붕 없음", () => {
    const s = resolveBuildingStyle(false, 30, 500, PB);
    expect(s).toEqual({ skip: false, height: 30, roofThick: 0, roofTop: 30, usePrecinctColor: false });
  });

  it("양식 없음(일반 도심): 권역 안이라도 baseH 그대로", () => {
    const s = resolveBuildingStyle(true, 30, 500, undefined);
    expect(s.usePrecinctColor).toBe(false);
    expect(s.height).toBe(30);
    expect(s.roofThick).toBe(0);
  });

  it("권역 안: 층고 상한 적용 + 지붕 슬래브 + 권역색", () => {
    const s = resolveBuildingStyle(true, 30, 500, PB);
    expect(s.skip).toBe(false);
    expect(s.height).toBe(8); // min(30, 8)
    expect(s.roofThick).toBe(1.4);
    expect(s.roofTop).toBeCloseTo(9.4, 6); // 8 + 1.4
    expect(s.usePrecinctColor).toBe(true);
  });

  it("상한보다 낮은 건물은 원래 높이 유지", () => {
    expect(resolveBuildingStyle(true, 5, 500, PB).height).toBe(5);
  });

  it("대형 인클로저(면적 > skipEnclosuresOver)는 생략", () => {
    const s = resolveBuildingStyle(true, 8, 2500, PB);
    expect(s.skip).toBe(true);
  });

  it("skipEnclosuresOver 미설정이면 면적 무관 비생략", () => {
    const s = resolveBuildingStyle(true, 8, 999999, { color: "0xcc5a28" });
    expect(s.skip).toBe(false);
  });

  it("roof 미설정이면 roofTop = height", () => {
    const s = resolveBuildingStyle(true, 8, 500, { color: "0xcc5a28", maxHeight: 8 });
    expect(s.roofThick).toBe(0);
    expect(s.roofTop).toBe(8);
  });
});

describe("buildingBaseColor — 높이별 도심 팔레트 / 권역 양식색", () => {
  it("권역색 지정 시 높이 무관 그 색", () => {
    expect(buildingBaseColor(5, 0x123456)).toBe(0x123456);
    expect(buildingBaseColor(99, 0x123456)).toBe(0x123456);
  });
  it("높이 밴드 경계(<9/<22/<45/그외)", () => {
    expect(buildingBaseColor(8, null)).toBe(0xe6c23a);
    expect(buildingBaseColor(9, null)).toBe(0x3fb56a); // 경계 포함 윗밴드
    expect(buildingBaseColor(21, null)).toBe(0x3fb56a);
    expect(buildingBaseColor(22, null)).toBe(0x3a82e0);
    expect(buildingBaseColor(44, null)).toBe(0x3a82e0);
    expect(buildingBaseColor(45, null)).toBe(0x2fcadf);
  });
});
