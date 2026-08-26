import { describe, it, expect } from "vitest";
import {
  stepVerticalVelocity, dirSpeedMult, maxRiseAltitude, HARD_CEILING, applyDamage, applyHeal,
  historyLookup, canCastLinkRewind, type PosHpSample,
} from "../src/player/PlayerController";
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

describe("maxRiseAltitude — 지표 상대 천장(보행 점프·비행 공통) + 지면+5km 마진 캡", () => {
  const EYE = 1.7;
  it("평지: standY + rise + eye", () => {
    expect(maxRiseAltitude(0, 100, EYE)).toBeCloseTo(101.7, 6);
    expect(maxRiseAltitude(50, 300, EYE)).toBeCloseTo(351.7, 6);
  });
  it("상승 마진은 HARD_CEILING(지면 +5km)로 제한 — rise 가 더 커도 지면+5km+eye", () => {
    expect(maxRiseAltitude(0, HARD_CEILING + 2000, EYE)).toBeCloseTo(HARD_CEILING + EYE, 6); // min(7000,5000)
  });
  it("고지대 지형(에베레스트 8km)에서도 지면 위로 상승 — 절대 5km 캡 아님(지면 상대)", () => {
    expect(maxRiseAltitude(8000, 1300, EYE)).toBeCloseTo(8000 + 1300 + EYE, 6); // 9301.7 (≠ 5000)
    expect(maxRiseAltitude(8000, HARD_CEILING + 2000, EYE)).toBeCloseTo(8000 + HARD_CEILING + EYE, 6);
  });
  it("캡 아래에서는 standY 에 단조 증가(지형 추종)", () => {
    expect(maxRiseAltitude(100, 200, EYE)).toBeGreaterThan(maxRiseAltitude(0, 200, EYE));
  });
  it("해수면 아래(음수 standY)도 정상 계산", () => {
    expect(maxRiseAltitude(-30, 100, EYE)).toBeCloseTo(71.7, 6);
  });
});

describe("applyDamage — 피해 전이(무적·사망 게이트)", () => {
  it("정상 피격: hp 차감 + applied true", () => {
    const r = applyDamage(100, 0, 30);
    expect(r).toEqual({ hp: 70, invuln: 0, applied: true });
  });

  // 머시 무적(피격 후 0.6초) 폐지(2026-08-26) — 그 창이 있으면 초당 1.67대로 상한이 걸려
  // **개체 수가 난이도 레버로 작동하지 않았다**(모기 2→32기에 3.31→4.94 dps).
  it("피격해도 무적을 충전하지 않는다 — 연속 피격이 그대로 들어온다", () => {
    let hp = 100, invuln = 0;
    for (let i = 0; i < 5; i++) {
      const r = applyDamage(hp, invuln, 10);
      expect(r.applied).toBe(true); // 다섯 대 모두 적중
      hp = r.hp; invuln = r.invuln;
    }
    expect(hp).toBe(50);
    expect(invuln).toBe(0);
  });

  it("무적 중(invuln>0)이면 무시 — 리스폰 보호가 쓰는 경로", () => {
    const r = applyDamage(70, 0.3, 30);
    expect(r).toEqual({ hp: 70, invuln: 0.3, applied: false });
  });

  it("리스폰 보호는 소모되지 않는다 — 흡수해도 남은 시간이 줄지 않는다(감쇠는 update 몫)", () => {
    const r = applyDamage(70, 1.5, 30);
    expect(r.invuln).toBe(1.5);
    expect(r.applied).toBe(false);
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

// 위치·HP 이력(적측 §6.6 역행체 + 자가 §2.8.3 링크 리와인드가 공유하는 링버퍼) — 0.1s 간격 표본 가정.
const HIST: PosHpSample[] = [
  { t: 0, x: 0, y: 0, z: 0, hp: 100 },
  { t: 1, x: 10, y: 0, z: 0, hp: 90 },
  { t: 2, x: 20, y: 0, z: 0, hp: 70 },
  { t: 3, x: 30, y: 0, z: 0, hp: 60 },
];

describe("historyLookup — 이력 조회(순수, 링크 리와인드/역행체 공유)", () => {
  it("posClock 기준 sec 초 전 이하의 가장 최근 표본을 반환", () => {
    expect(historyLookup(HIST, 3, 1)).toEqual({ t: 2, x: 20, y: 0, z: 0, hp: 70 }); // 3-1=2 → t=2
    expect(historyLookup(HIST, 3, 0.5)).toEqual({ t: 2, x: 20, y: 0, z: 0, hp: 70 }); // 2.5 이하 최근 = t=2
    expect(historyLookup(HIST, 3, 3)).toEqual({ t: 0, x: 0, y: 0, z: 0, hp: 100 });
  });

  it("이력이 짧으면(요청이 이력 전체보다 오래됨) 가장 오래된 표본으로 클램프", () => {
    expect(historyLookup(HIST, 3, 100)).toEqual({ t: 0, x: 0, y: 0, z: 0, hp: 100 });
  });

  it("이력이 비어있으면 null", () => {
    expect(historyLookup([], 5, 2)).toBeNull();
  });
});

describe("canCastLinkRewind — 시전 게이트(순수)", () => {
  it("사망·쿨다운 중·게이지 부족이면 거부, 조건 충족 시 허용", () => {
    expect(canCastLinkRewind(0, 100, 0, 50)).toBe(false); // 사망
    expect(canCastLinkRewind(50, 100, 5, 50)).toBe(false); // 쿨다운 중
    expect(canCastLinkRewind(50, 30, 0, 50)).toBe(false); // 게이지 부족
    expect(canCastLinkRewind(50, 55, 0, 50)).toBe(true);
  });
});

// 리스폰 보호 — 머시 무적을 없앤 뒤에도 **이것만은 남아야 한다**. 부활 직후 적에 둘러싸여
// 즉사하면 리스폰 예산이 순식간에 증발한다(회복 수단이 없어 되돌릴 방법도 없다).
describe("리스폰 보호 — 부활 직후 무적", () => {
  it("보호 중에는 연속 피격이 전부 무시된다", () => {
    let hp = 100, invuln = 1.5; // respawn(protectSec = 1.5) 직후
    for (let i = 0; i < 10; i++) {
      const r = applyDamage(hp, invuln, 20);
      expect(r.applied).toBe(false);
      hp = r.hp; invuln = r.invuln;
    }
    expect(hp).toBe(100); // 한 대도 안 맞았다
  });

  it("보호가 끝나면 곧바로 피해가 들어온다", () => {
    expect(applyDamage(100, 0.001, 20).applied).toBe(false);
    expect(applyDamage(100, 0, 20).applied).toBe(true);
  });
});
