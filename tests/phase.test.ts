import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { CoreEnemy } from "../src/enemies/CoreEnemy";
import { phaseRoll, phaseTimings, DEFAULT_PLASMOID, type PhaseSpec } from "../src/enemies/PlasmoidSpec";

// 대위상 세트(P2, 물리편 §2.1·§2.2 + 서사편 §7 W2) — 위상 이탈 주기·일반 무기 무효·
// 관측 펄스(decohere 강제 실체화)·관측 계류(pin 재이탈 봉쇄)의 계약.

const PH: PhaseSpec = { minStrength: 0.35, chance: 0.7, cooldownMax: 16, cooldownMin: 9, durationMin: 2.5, durationMax: 5 };
const TGT = new THREE.Vector3(0, 0, 100);

const makeEnemy = () => new CoreEnemy(new THREE.Vector3(0, 10, 0), { maxHp: 5000, diameter: 4, color: 0xffffff });

/** 이탈 주기 2s/지속 1s 로 활성화(u=1 → 최초 타이머 = cooldown 전체). */
const withPhase = () => {
  const e = makeEnemy();
  e.enablePhase({ cooldown: 2, duration: 1 }, 1);
  return e;
};

describe("phaseRoll·phaseTimings — 스폰 롤(순수)", () => {
  it("강함 하한 미달·확률 밖은 미보유", () => {
    expect(phaseRoll(PH, 0.3, 0)).toBe(false); //  s < minStrength
    expect(phaseRoll(PH, 0.5, 0.69)).toBe(true);
    expect(phaseRoll(PH, 0.5, 0.71)).toBe(false); // 확률 밖
  });

  it("강할수록 자주(쿨다운↓)·오래(지속↑) — 경계 보간", () => {
    expect(phaseTimings(PH, 0.35)).toEqual({ cooldown: 16, duration: 2.5 });
    expect(phaseTimings(PH, 1)).toEqual({ cooldown: 9, duration: 5 });
    const mid = phaseTimings(PH, 0.675);
    expect(mid.cooldown).toBeCloseTo(12.5);
    expect(mid.duration).toBeCloseTo(3.75);
  });

  it("내장 스펙에 phase 블록 탑재(JSON 동치는 worldValidate 몫)", () => {
    expect(DEFAULT_PLASMOID.phase).toBeDefined();
  });
});

describe("CoreEnemy — 위상 이탈 상태기계", () => {
  it("실체 cooldown 경과 → 이탈, duration 경과 → 실체 복귀(주기 반복)", () => {
    const e = withPhase();
    e.update(1.9, TGT);
    expect(e.isPhased).toBe(false);
    e.update(0.2, TGT); // 2.1s — 이탈 진입
    expect(e.isPhased).toBe(true);
    e.update(1.05, TGT); // 지속 1s 소진 — 실체 복귀
    expect(e.isPhased).toBe(false);
  });

  it("이탈 중 일반 무기 무효(피해 0)·공격 불가", () => {
    const e = withPhase();
    e.update(2.1, TGT);
    expect(e.isPhased).toBe(true);
    expect(e.applyFrequencyHit(9999)).toBe(false);
    expect(e.hp).toBe(5000); // 무효 — 체력 불변
    expect(e.tryAttack(TGT, 1000, 1)).toBe(false);
  });

  it("관측 펄스(decohere) — 이탈 중 수동 명중이 실체화 + 피해 + 쿨 재시작", () => {
    const e = withPhase();
    e.update(2.1, TGT);
    expect(e.applyFrequencyHit(100, { decohere: true })).toBe(false); // 처치는 아님
    expect(e.isPhased).toBe(false);
    expect(e.hp).toBe(4900); // 실체화 후 피해 적용
    e.update(1.9, TGT); // 쿨 재시작 — 아직 실체
    expect(e.isPhased).toBe(false);
  });

  it("관측 계류(W2 pin) — 핀이 남아있는 동안 재이탈 봉쇄, 만료 후 이탈 재개", () => {
    const e = withPhase();
    e.applyFrequencyHit(10, { pinSec: 4 }); // 실체 상태에서 수동 명중 — 참조 핀
    e.update(3.9, TGT); // 쿨(2s)은 지났지만 핀(4s)이 잡고 있다
    expect(e.isPhased).toBe(false);
    e.update(0.2, TGT); // 핀 만료 → 이탈 진입
    expect(e.isPhased).toBe(true);
  });

  it("처치되면 isPhased 아님(디졸브 상태 우선)", () => {
    const e = withPhase();
    e.update(2.1, TGT);
    e.applyFrequencyHit(99999, { decohere: true });
    expect(e.state).toBe("dissolving");
    expect(e.isPhased).toBe(false);
  });
});
