import { describe, it, expect } from "vitest";
import { stepVerticalVelocity, dirSpeedMult, maxRiseAltitude, HARD_CEILING, applyDamage, applyHeal, MERCY_INVULN } from "../src/player/PlayerController";
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

describe("dirSpeedMult — 방향별 이동속도(백페달 억제)", () => {
  const FWD = { x: 0, z: -1 }; // 시선 -z
  it("전진=1.0, 옆=0.85, 후진=0.6", () => {
    expect(dirSpeedMult(0, -1, FWD)).toBeCloseTo(1.0, 5); // 전진
    expect(dirSpeedMult(1, 0, FWD)).toBeCloseTo(0.85, 5); // 우측 스트레이프
    expect(dirSpeedMult(-1, 0, FWD)).toBeCloseTo(0.85, 5); // 좌측 스트레이프
    expect(dirSpeedMult(0, 1, FWD)).toBeCloseTo(0.6, 5); // 후진
  });
  it("입력 없으면 1, 대각선은 중간값", () => {
    expect(dirSpeedMult(0, 0, FWD)).toBe(1);
    expect(dirSpeedMult(0, -1, FWD)).toBeGreaterThan(dirSpeedMult(1, -1, FWD)); // 정전진 > 전방대각
    expect(dirSpeedMult(1, -1, FWD)).toBeGreaterThan(dirSpeedMult(1, 1, FWD)); // 전방대각 > 후방대각
  });
});

describe("maxRiseAltitude — 지표 상대 천장(보행 점프·비행 공통) + 절대 5km 캡", () => {
  const EYE = 1.7;
  it("평지: standY + rise + eye", () => {
    expect(maxRiseAltitude(0, 100, EYE)).toBeCloseTo(101.7, 6);
    expect(maxRiseAltitude(50, 300, EYE)).toBeCloseTo(351.7, 6);
  });
  it("HARD_CEILING(5km) 절대 클램프 — 고지대에서도 못 넘음", () => {
    expect(maxRiseAltitude(4990, 100, EYE)).toBe(HARD_CEILING);
    expect(maxRiseAltitude(HARD_CEILING + 1000, 300, EYE)).toBe(HARD_CEILING);
  });
  it("캡 아래에서는 standY 에 단조 증가(지형 추종)", () => {
    expect(maxRiseAltitude(100, 200, EYE)).toBeGreaterThan(maxRiseAltitude(0, 200, EYE));
  });
  it("해수면 아래(음수 standY)도 정상 계산", () => {
    expect(maxRiseAltitude(-30, 100, EYE)).toBeCloseTo(71.7, 6);
  });
});

describe("applyDamage — 피해 전이(머시 무적·사망 게이트)", () => {
  it("정상 피격: hp 차감 + 무적 충전 + applied true", () => {
    const r = applyDamage(100, 0, 30);
    expect(r).toEqual({ hp: 70, invuln: MERCY_INVULN, applied: true });
  });
  it("무적 중(invuln>0)이면 무시 — 상태 불변, applied false", () => {
    const r = applyDamage(70, 0.3, 30);
    expect(r).toEqual({ hp: 70, invuln: 0.3, applied: false });
  });
  it("이미 사망(hp<=0)이면 무시 — 죽은 뒤엔 적 회복 안 됨", () => {
    expect(applyDamage(0, 0, 30)).toEqual({ hp: 0, invuln: 0, applied: false });
  });
  it("치명상은 hp 를 0 하한으로 클램프(음수 금지)", () => {
    const r = applyDamage(20, 0, 50);
    expect(r.hp).toBe(0);
    expect(r.applied).toBe(true);
  });
});

describe("applyHeal — 회복 전이(최대치 한도·사망 게이트)", () => {
  it("정상 회복: maxHp 한도로 가산", () => {
    expect(applyHeal(50, 120, 30)).toBe(80);
  });
  it("최대치 초과는 maxHp 로 클램프", () => {
    expect(applyHeal(110, 120, 30)).toBe(120);
  });
  it("이미 사망(hp<=0)이면 부활 불가 — 불변", () => {
    expect(applyHeal(0, 120, 30)).toBe(0);
  });
  it("비양수 회복은 무시 — 불변", () => {
    expect(applyHeal(50, 120, 0)).toBe(50);
    expect(applyHeal(50, 120, -10)).toBe(50);
  });
});
