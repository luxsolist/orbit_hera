import { describe, it, expect } from "vitest";
import { projectLatLon, declusterDots } from "../src/ui/worldMapSvg";

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

describe("declusterDots — 근접 점 겹침 분리(클릭 가능, 2:1 종횡비)", () => {
  const sep = (a: any, bp: any, aspect = 0.5) => Math.hypot(a.x - bp.x, (a.y - bp.y) * aspect); // width-% 메트릭
  it("최소 간격 미만 쌍을 minSep(width-%) 이상으로 분리(서울·부산 시뮬)", () => {
    const seoul = projectLatLon(37.58, 126.98), busan = projectLatLon(35.16, 129.07);
    const pts = [{ ...seoul }, { ...busan }];
    declusterDots(pts, 2.6);
    expect(sep(pts[0], pts[1])).toBeGreaterThanOrEqual(2.55);
  });
  it("완전 동일 좌표도 분리(겹침 0)", () => {
    const pts = [{ x: 50, y: 50 }, { x: 50, y: 50 }];
    declusterDots(pts, 2.6);
    expect(sep(pts[0], pts[1])).toBeGreaterThan(2.55);
  });
  it("멀리 떨어진 점은 거의 안 움직임", () => {
    const pts = [{ x: 10, y: 10 }, { x: 80, y: 80 }];
    declusterDots(pts, 2.6);
    expect(pts[0].x).toBeCloseTo(10, 6); expect(pts[1].x).toBeCloseTo(80, 6);
  });
});
