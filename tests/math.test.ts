import { describe, it, expect } from "vitest";
import { clamp, lerp, parseHexColor } from "../src/core/math";

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
});
