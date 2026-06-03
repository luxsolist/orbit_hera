import { describe, it, expect } from "vitest";
import { stepVerticalVelocity } from "../src/player/PlayerController";
import type { JumpSpec } from "../src/player/DroneSpec";

// walker.json 의 jump 스펙(다이나믹 튜닝)을 기준으로 적분기 가드.
const JUMP: JumpSpec = {
  velocity: 28,
  riseGravity: 55,
  fallGravity: 50,
  fallTerminal: 25.5,
  maxRiseHeight: 100,
  coyoteTime: 0.1,
};
const DT = 1 / 60;

describe("stepVerticalVelocity — 보행 드론 점프/중력 적분", () => {
  it("상승 중에는 감속(속도가 줄지만 아직 양수)", () => {
    const v = stepVerticalVelocity(10, DT, JUMP);
    expect(v).toBeLessThan(10);
    expect(v).toBeGreaterThan(0);
  });

  it("하강은 점점 빨라지다 종단속도로 수렴", () => {
    let v = 0;
    for (let i = 0; i < 600; i++) v = stepVerticalVelocity(v, DT, JUMP);
    expect(v).toBeCloseTo(-JUMP.fallTerminal, 5);
  });

  it("종단속도 아래로는 절대 내려가지 않음(일정한 낙하)", () => {
    let v = 0,
      min = 0;
    for (let i = 0; i < 600; i++) {
      v = stepVerticalVelocity(v, DT, JUMP);
      min = Math.min(min, v);
    }
    expect(min).toBeGreaterThanOrEqual(-JUMP.fallTerminal - 1e-9);
  });

  it("점프 1회: 체공 ≈ 1.0s · 정점 ≈ 6.9m (다이나믹 튜닝 회귀 가드)", () => {
    let v = JUMP.velocity,
      y = 0,
      t = 0,
      apex = 0;
    for (let i = 0; i < 2000; i++) {
      v = stepVerticalVelocity(v, DT, JUMP);
      y += v * DT;
      t += DT;
      if (y > apex) apex = y;
      if (y <= 0 && t > 0.05) break;
    }
    expect(t).toBeGreaterThan(0.85);
    expect(t).toBeLessThan(1.2);
    expect(apex).toBeGreaterThan(6.3);
    expect(apex).toBeLessThan(7.5);
  });
});
