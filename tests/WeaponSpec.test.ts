import { describe, it, expect } from "vitest";
import { damageForDistance } from "../src/weapons/WeaponSpec";

// frequency-beam.json 의 falloff 기준
const F = { refDist: 26, maxMult: 2.5, minMult: 0.5 };

describe("damageForDistance — 거리 반비례 위력", () => {
  it("기준 거리(refDist)에서 배수 1.0", () => {
    expect(damageForDistance(26, 40, F)).toBeCloseTo(40, 6);
  });
  it("근접은 상한(maxMult)으로 클램프", () => {
    expect(damageForDistance(1, 40, F)).toBeCloseTo(40 * 2.5, 6); // refDist/1=26 → 상한 2.5
    expect(damageForDistance(0, 40, F)).toBeCloseTo(40 * 2.5, 6); // dist<1 → max(dist,1)
  });
  it("원거리는 하한(minMult)으로 클램프", () => {
    expect(damageForDistance(1000, 40, F)).toBeCloseTo(40 * 0.5, 6);
  });
  it("중간 거리는 거리에 반비례", () => {
    expect(damageForDistance(52, 40, F)).toBeCloseTo(40 * (26 / 52), 6); // 0.5 배
  });
});
