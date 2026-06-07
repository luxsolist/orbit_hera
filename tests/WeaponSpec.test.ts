import { describe, it, expect } from "vitest";
import { damageForDistance, cooldownReadyFrac, withAutoBoost, type BeamSpec } from "../src/weapons/WeaponSpec";

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

describe("cooldownReadyFrac — 쿨다운 진행률(0=발동, 1=준비완료)", () => {
  it("막 발동=0, 절반=0.5, 완료=1", () => {
    expect(cooldownReadyFrac(60, 60)).toBe(0);
    expect(cooldownReadyFrac(30, 60)).toBeCloseTo(0.5, 6);
    expect(cooldownReadyFrac(0, 60)).toBe(1);
  });
  it("음수/초과는 [0,1] 클램프", () => {
    expect(cooldownReadyFrac(-5, 60)).toBe(1);
    expect(cooldownReadyFrac(90, 60)).toBe(0);
  });
});

describe("withAutoBoost — 자동조준/사격 강화(모바일 플라이어)", () => {
  const base: BeamSpec = {
    id: "b", name: "n", abbr: "빔", type: "beam", range: 400, color: "0x90ffff", beamLifetime: 0.08,
    manual: { damage: 13, freqCost: 7, fireInterval: 0.085, assistConeDeg: 28 },
    auto: { damage: 5, freqCost: 2, fireInterval: 0.13, range: 50 },
    falloff: { refDist: 26, maxMult: 2.5, minMult: 0.75 },
  };
  it("auto.range·assistConeDeg 만 배수 적용", () => {
    const b = withAutoBoost(base, 2);
    expect(b.auto.range).toBe(100);
    expect(b.manual.assistConeDeg).toBe(56);
  });
  it("그 외 수치는 불변(damage·freqCost·range 등)", () => {
    const b = withAutoBoost(base, 2);
    expect(b.auto.damage).toBe(5);
    expect(b.manual.damage).toBe(13);
    expect(b.range).toBe(400);
  });
  it("원본 스펙을 변형하지 않음(캐시 보호)", () => {
    withAutoBoost(base, 2);
    expect(base.auto.range).toBe(50);
    expect(base.manual.assistConeDeg).toBe(28);
  });
});
