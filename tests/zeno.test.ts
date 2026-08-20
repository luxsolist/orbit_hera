import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { CoreEnemy, zenoExposureStep, zenoSlowMul, ZENO_GRACE } from "../src/enemies/CoreEnemy";

// 관측 고정(내부 id: zeno — 서사편 §7.2 W1) — 같은 대상 지속 조사 시 감속→동결.
// "빔을 붙들고 있는 것만으로 낙인 장전을 인터럽트"가 성립해야 한다(tryAttack 게이트).

const APP = { maxHp: 1000, diameter: 2, color: 0xff3b30 };
const Z = { slowPerSec: 0.4, freezeAfter: 1.2 };

describe("zeno 순수 함수 — 노출 누적/감쇠·감속 배수", () => {
  it("grace 이내 재조사면 노출 누적, 지나면 감쇠", () => {
    expect(zenoExposureStep(0.5, 0.1, ZENO_GRACE, 0.1)).toBeCloseTo(0.6, 9); // 지속 조사 → +dt
    expect(zenoExposureStep(0.5, ZENO_GRACE + 0.1, ZENO_GRACE, 0.1)).toBeCloseTo(0.3, 9); // 끊김 → −2·dt
    expect(zenoExposureStep(0.05, 9, ZENO_GRACE, 0.1)).toBe(0); // 0 하한
  });

  it("감속 배수 — 노출 비례 감속, 하한 클램프, 동결이면 0", () => {
    expect(zenoSlowMul(0, Z.slowPerSec, Z.freezeAfter)).toBe(1);
    expect(zenoSlowMul(0.5, Z.slowPerSec, Z.freezeAfter)).toBeCloseTo(0.8, 9); // 1 − 0.4·0.5
    expect(zenoSlowMul(1.19, Z.slowPerSec, Z.freezeAfter)).toBeGreaterThanOrEqual(0.3); // 하한
    expect(zenoSlowMul(1.2, Z.slowPerSec, Z.freezeAfter)).toBe(0); // 동결
  });
});

describe("CoreEnemy 관측 고정 — 감속·동결·해제", () => {
  const tick = (e: CoreEnemy, target: THREE.Vector3, frames: number, hit?: () => void) => {
    for (let i = 0; i < frames; i++) {
      hit?.();
      e.update(1 / 60, target);
    }
  };

  it("지속 조사 시 이동이 느려지다 동결된다", () => {
    const free = new CoreEnemy(new THREE.Vector3(0, 0, 0), APP, 10);
    const held = new CoreEnemy(new THREE.Vector3(0, 0, 0), APP, 10);
    const target = new THREE.Vector3(1000, 0, 0);
    tick(free, target, 30);
    tick(held, target, 30, () => held.applyZeno(Z)); // 매 프레임 피관측(지속 조사)
    expect(held.group.position.x).toBeLessThan(free.group.position.x); // 감속
    expect(held.isZenoFrozen).toBe(false); // 0.5s — 아직 동결 전

    const x0 = held.group.position.x;
    tick(held, target, 60, () => held.applyZeno(Z)); // 누적 1.5s ≥ freezeAfter 1.2
    expect(held.isZenoFrozen).toBe(true);
    // 동결 후에는 전진이 멈춘다(동결 시점까지의 미세 전진만 허용)
    const x1 = held.group.position.x;
    tick(held, target, 30, () => held.applyZeno(Z));
    expect(held.group.position.x).toBe(x1);
    expect(x1).toBeGreaterThan(x0 - 1e-9);
  });

  it("동결 중에는 공격(낙인 장전 포함)이 게이트된다 — W1 인터럽트", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    const near = new THREE.Vector3();
    tick(e, near, 90, () => e.applyZeno(Z)); // 1.5s 지속 조사 → 동결
    expect(e.isZenoFrozen).toBe(true);
    expect(e.tryAttack(near, 3)).toBe(false);
  });

  it("관측이 끊기면 노출이 감쇠해 동결이 풀린다", () => {
    const e = new CoreEnemy(new THREE.Vector3(0, 0, 0), APP, 10);
    const target = new THREE.Vector3(1000, 0, 0);
    tick(e, target, 90, () => e.applyZeno(Z));
    expect(e.isZenoFrozen).toBe(true);
    tick(e, target, 90); // 1.5s 무관측 — grace(0.5) 후 2배속 감쇠로 노출 소진
    expect(e.isZenoFrozen).toBe(false);
    expect(e.zenoMul).toBe(1); // 상태 해제 — 정상 속도 복귀
  });

  it("죽은/디졸브 개체에는 노출이 걸리지 않는다", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    e.applyFrequencyHit(99999); // dissolving
    e.applyZeno(Z);
    expect(e.zenoMul).toBe(1);
    expect(e.isZenoFrozen).toBe(false);
  });
});
