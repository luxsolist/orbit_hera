import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { projFns, buildingHeight, roadWidth, ringArea } from "../scripts/osm.mjs";

describe("osm.projFns", () => {
  it("maps the origin to (0,0)", () => {
    const p = projFns(37.578, 126.977);
    const [x, z] = p(37.578, 126.977);
    expect(x).toBe(0);
    expect(Math.abs(z)).toBe(0); // -0 도 허용
  });

  it("north is -Z and east is +X", () => {
    const p = projFns(37.578, 126.977);
    const [, zNorth] = p(37.579, 126.977); // 더 북쪽
    const [xEast] = p(37.578, 126.978); // 더 동쪽
    expect(zNorth).toBeLessThan(0);
    expect(xEast).toBeGreaterThan(0);
  });

  it("~1 lat degree ≈ 111320m (cm 반올림)", () => {
    const p = projFns(0, 0);
    const [, z] = p(-1, 0); // 남쪽 1도 → +Z
    expect(z).toBeCloseTo(111320, 0);
  });
});

describe("osm.buildingHeight", () => {
  it("prefers explicit height, stripping units", () => {
    expect(buildingHeight({ height: "12.5 m" })).toBe(12.5);
    expect(buildingHeight({ height: "30" })).toBe(30);
  });
  it("derives from levels (min 3m floor, 3.3m/level)", () => {
    expect(buildingHeight({ "building:levels": "10" })).toBe(33);
    expect(buildingHeight({ "building:levels": "0.5" })).toBe(3); // 최소 3
  });
  it("falls back to type defaults, else 9", () => {
    expect(buildingHeight({ building: "hut" })).toBe(3);
    expect(buildingHeight({ building: "palace" })).toBe(7);
    expect(buildingHeight({ building: "house" })).toBe(6);
    expect(buildingHeight({ building: "yes" })).toBe(9);
    expect(buildingHeight({})).toBe(9);
  });
});

describe("osm.roadWidth", () => {
  it("maps known highway classes, defaults to 6", () => {
    expect(roadWidth("primary")).toBe(28);
    expect(roadWidth("residential")).toBe(7);
    expect(roadWidth("footway")).toBe(6); // 미지정
  });
});

describe("osm.ringArea", () => {
  it("computes polygon area regardless of winding", () => {
    const cw = [0, 0, 4, 0, 4, 3, 0, 3]; // 4×3 = 12
    const ccw = [0, 0, 0, 3, 4, 3, 4, 0];
    expect(ringArea(cw)).toBeCloseTo(12);
    expect(ringArea(ccw)).toBeCloseTo(12);
  });
});
