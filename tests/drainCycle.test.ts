import { describe, it, expect } from "vitest";
import { DrainCycle } from "../src/weapons/DrainCycle";

// 게이지 소진형 특수무기 상태기계(발동/소진/사용후 쿨다운) 순수 가드.
const P = { cooldown: 30, drainRate: 50, fireInterval: 0.09, triggerFloor: 5 };
const mk = () => new DrainCycle(P);

describe("DrainCycle 발동 게이트", () => {
  it("freq ≤ triggerFloor 면 발동 안 함(strict >)", () => {
    const c = mk();
    const r = c.step(0.016, true, 5);
    expect(r.active).toBe(false);
    expect(r.fire).toBe(false);
    expect(c.isActive).toBe(false);
  });
  it("freq > floor + trigger → 즉시 발동·첫 발사", () => {
    const c = mk();
    const r = c.step(0.016, true, 6);
    expect(r.active).toBe(true);
    expect(r.fire).toBe(true); // 발동 프레임에 즉시 첫 발사
    expect(r.drain).toBeCloseTo(P.drainRate * 0.016, 6);
  });
  it("trigger 없으면 무동작", () => {
    const c = mk();
    const r = c.step(0.016, false, 100);
    expect(r).toEqual({ fire: false, drain: 0, active: false });
  });
});

describe("DrainCycle 발사 간격", () => {
  it("발동 후 fireInterval 마다 발사", () => {
    const c = mk();
    expect(c.step(0.01, true, 100).fire).toBe(true); // 첫 발사
    expect(c.step(0.05, false, 100).fire).toBe(false); // 0.05 < 0.09
    expect(c.step(0.05, false, 100).fire).toBe(true); // 누적 0.10 ≥ 0.09 → 발사
  });
});

describe("DrainCycle 사용후 쿨다운", () => {
  it("게이지 소진 시 종료 + 그때부터 쿨다운, 활성 중엔 쿨다운 0", () => {
    const c = mk();
    let freq = 100;
    // 활성 중: cooldownReady=0, remaining=full
    c.step(0.016, true, freq);
    expect(c.isActive).toBe(true);
    expect(c.cooldownReady).toBe(0);
    expect(c.cooldownRemainingSec).toBe(P.cooldown);
    // 게이지가 바닥나도록 구동(loop: step → drain 적용)
    let ended = false;
    for (let i = 0; i < 200 && !ended; i++) {
      const r = c.step(0.05, false, freq);
      freq = Math.max(0, freq - r.drain);
      if (!r.active) ended = true;
    }
    expect(c.isActive).toBe(false);
    expect(c.cooldownRemainingSec).toBeCloseTo(P.cooldown, 1); // 종료 직후 ≈ full
    expect(c.cooldownReady).toBeLessThan(0.1);
  });

  it("쿨다운 중 재발동 불가 → 쿨다운 경과 후 가능", () => {
    const c = mk();
    // 강제 종료: 낮은 freq 로 한 프레임에 소진
    c.step(0.016, true, 6); // 발동
    c.step(1.0, false, 1); // drain 50 ≫ 1 → 종료, cooldown=30
    expect(c.isActive).toBe(false);
    expect(c.step(0.016, true, 100).active).toBe(false); // 쿨다운 중 → 발동 불가
    // 쿨다운 경과
    for (let i = 0; i < 40; i++) c.step(1.0, false, 100);
    expect(c.cooldownReady).toBeCloseTo(1, 5);
    expect(c.step(0.016, true, 100).active).toBe(true); // 이제 발동
  });

  it("reset: 상태 초기화", () => {
    const c = mk();
    c.step(0.016, true, 100);
    c.reset();
    expect(c.isActive).toBe(false);
    expect(c.cooldownReady).toBe(1);
    expect(c.cooldownRemainingSec).toBe(0);
  });
});

// abort — 발동 중 사망(2026-08-25 회귀). 상태기계가 active 인 채 남으면 리스폰으로 가득 찬 게이지가
// 입력 없이 그대로 다시 소진된다. 단 reset 과 달리 **쿨다운은 환급하지 않는다**(사망이 이득이 되면
// "회복은 없고 리스폰만" 설계가 무너진다).
describe("DrainCycle.abort — 쓰다 만 종료", () => {
  it("활성 해제 + 쿨다운은 정상 시작(환급 없음)", () => {
    const c = mk();
    c.step(0.016, true, 100); // 발동
    expect(c.isActive).toBe(true);
    c.abort();
    expect(c.isActive).toBe(false);
    expect(c.cooldownRemainingSec).toBe(P.cooldown); // reset() 이었다면 0
    expect(c.cooldownReady).toBe(0);
  });

  it("중단 후에는 트리거를 눌러도 쿨다운 동안 재발동 불가", () => {
    const c = mk();
    c.step(0.016, true, 100);
    c.abort();
    expect(c.step(0.016, true, 100).active).toBe(false);
    for (let t = 0; t < P.cooldown; t += 0.1) c.step(0.1, false, 100); // 쿨다운 소진
    expect(c.step(0.016, true, 100).active).toBe(true); // 다 돌면 정상 발동
  });

  it("비활성 상태에서 abort 는 무동작 — 진행 중이던 쿨다운을 되감지 않는다", () => {
    const c = mk();
    c.step(0.016, true, 100);
    for (let i = 0; i < 200; i++) c.step(0.016, false, 100 - i * 0.8); // 게이지 소진 → 자연 종료
    expect(c.isActive).toBe(false);
    const before = c.cooldownRemainingSec;
    c.step(1, false, 0); // 쿨다운 1초 진행
    c.abort();
    expect(c.cooldownRemainingSec).toBeCloseTo(before - 1, 6); // 되감기 없음
  });
});
