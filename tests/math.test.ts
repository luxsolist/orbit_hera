import { describe, it, expect } from "vitest";
import { clamp, lerp, parseHexColor, clampToDisk } from "../src/core/math";

describe("core/math", () => {
  it("clamp: 범위 내/하한/상한", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
  it("lerp: 양끝 + 중점", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(2, 4, 0.5)).toBe(3);
  });
  it("parseHexColor: 0x 문자열 → number", () => {
    expect(parseHexColor("0xff8a3b")).toBe(0xff8a3b);
    expect(parseHexColor("0x000000")).toBe(0);
    expect(parseHexColor("0xffffff")).toBe(0xffffff);
  });
  it("clampToDisk: 안은 그대로, 밖은 경계로 투영", () => {
    const o = { x: 0, z: 0 };
    expect(clampToDisk(3, 4, 0, 0, 10, o)).toEqual({ x: 3, z: 4 }); // 안(거리5<10)
    clampToDisk(30, 40, 0, 0, 10, o); // 거리 50 → 경계(반경 10)로
    expect(Math.hypot(o.x, o.z)).toBeCloseTo(10, 6);
    expect(o.x).toBeCloseTo(6, 6); // 30·(10/50)
    expect(o.z).toBeCloseTo(8, 6);
  });
  it("clampToDisk: 중심 오프셋 + 무제한(r≤0)", () => {
    const o = { x: 0, z: 0 };
    clampToDisk(120, 100, 100, 100, 10, o); // 중심(100,100)에서 동쪽 20 → 경계 10
    expect(o.x).toBeCloseTo(110, 6);
    expect(o.z).toBeCloseTo(100, 6);
    expect(clampToDisk(9999, 9999, 0, 0, 0, o)).toEqual({ x: 9999, z: 9999 }); // r≤0 무제한
  });
});
