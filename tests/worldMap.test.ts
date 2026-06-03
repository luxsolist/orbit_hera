import { describe, it, expect } from "vitest";
import { projectLatLon } from "../src/ui/worldMapSvg";

describe("projectLatLon — equirectangular 백분율 투영", () => {
  it("원점(0,0) → 중앙(50,50)", () => {
    const p = projectLatLon(0, 0);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });
  it("경도 -180/180 → x 0/100", () => {
    expect(projectLatLon(0, -180).x).toBeCloseTo(0, 6);
    expect(projectLatLon(0, 180).x).toBeCloseTo(100, 6);
  });
  it("위도 90/-90 → y 0/100", () => {
    expect(projectLatLon(90, 0).y).toBeCloseTo(0, 6);
    expect(projectLatLon(-90, 0).y).toBeCloseTo(100, 6);
  });
  it("서울(37.578, 126.977) ≈ (85.3%, 29.1%)", () => {
    const p = projectLatLon(37.578, 126.977);
    expect(p.x).toBeCloseTo(85.27, 1);
    expect(p.y).toBeCloseTo(29.12, 1);
  });
});
