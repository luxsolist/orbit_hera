import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  CoreEnemy,
  advanceGlobalPulse,
  globalPulsePhase,
  dissolveDriftStep,
  KILL_STAGGER_SEC,
} from "../src/enemies/CoreEnemy";

// 인식 Ⅱ 계시 복선 3종(서사편 §1.10) — 박동 동기화 · 동시 경직 · 소산 표류.
// 표면적으로는 무해한 연출/테크닉이지만 계시 때 회수되는 단서라, 거동을 테스트로 고정한다.

const APP = { maxHp: 100, diameter: 2, color: 0xff3b30 };

describe("박동 동기화 — 전역 공유 위상", () => {
  it("advanceGlobalPulse 가 위상을 단조 증가시킨다(프레임당 1회 전진 모델)", () => {
    const p0 = globalPulsePhase();
    advanceGlobalPulse(0.1);
    const p1 = globalPulsePhase();
    expect(p1).toBeGreaterThan(p0);
    advanceGlobalPulse(0.1);
    expect(globalPulsePhase()).toBeGreaterThan(p1);
  });

  it("같은 프레임의 두 개체는 같은 위상으로 렌더된다(개체별 무작위 위상 없음)", () => {
    const a = new CoreEnemy(new THREE.Vector3(), APP, 5);
    const b = new CoreEnemy(new THREE.Vector3(), APP, 5);
    const t = new THREE.Vector3();
    a.update(0.016, t);
    b.update(0.016, t);
    // 박동 스케일 = baseScale·shrink·pulse — 동일 스펙이면 스케일이 정확히 일치해야 동기화다.
    expect(a.group.scale.x).toBeCloseTo(b.group.scale.x, 10);
  });
});

describe("동시 경직 — 처치 순간 전 개체 움찔", () => {
  it("경직 중에는 이동이 정지한다", () => {
    const e = new CoreEnemy(new THREE.Vector3(0, 0, 0), APP, 5);
    const target = new THREE.Vector3(100, 0, 0);
    e.stagger(KILL_STAGGER_SEC);
    e.update(0.1, target);
    expect(e.group.position.x).toBe(0); // 경직 — 전진 없음
    e.update(1.0, target); // 이 프레임에서 경직 잔여 소진(만료 프레임까지는 정지)
    e.update(0.1, target); // 해제 후 첫 프레임
    expect(e.group.position.x).toBeGreaterThan(0); // 다시 추격
  });

  it("경직 중에는 공격이 발동하지 않는다", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    const near = new THREE.Vector3();
    e.stagger(KILL_STAGGER_SEC);
    expect(e.isStaggered).toBe(true);
    expect(e.tryAttack(near, 3)).toBe(false); // 경직 게이트
    e.update(KILL_STAGGER_SEC + 0.01, near);
    expect(e.isStaggered).toBe(false);
    expect(e.tryAttack(near, 3)).toBe(true); // 해제 후 발동
  });

  it("dissolving 개체에는 경직이 걸리지 않는다", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    e.applyFrequencyHit(999);
    e.stagger(KILL_STAGGER_SEC);
    expect(e.isStaggered).toBe(false);
  });
});

describe("소산 표류 — 죽음의 방향(순수)", () => {
  it("앵커 방향 수평 표류, 진행도 비례, y 불변", () => {
    const pos = { x: 10, y: 5, z: 0 };
    const anchor = { x: 0, y: 0, z: 0 };
    const s = dissolveDriftStep(pos, anchor, 0.5, 0.1, 4);
    expect(s.x).toBeLessThan(0); // 앵커(원점) 방향 = -x
    expect(s.y).toBe(0);
    expect(Math.abs(s.z)).toBeLessThan(1e-9);
    // 진행도 2배 → 표류량 2배
    const s2 = dissolveDriftStep(pos, anchor, 1.0, 0.1, 4);
    expect(s2.x).toBeCloseTo(s.x * 2, 9);
  });

  it("진행도 0 이거나 앵커에 닿았으면 정지", () => {
    expect(dissolveDriftStep({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, 0.1)).toEqual({ x: 0, y: 0, z: 0 });
    expect(dissolveDriftStep({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1, 0.1)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("디졸브 중 개체가 앵커 쪽으로 흐른다(통합)", () => {
    const e = new CoreEnemy(new THREE.Vector3(20, 3, 0), APP, 5);
    e.driftAnchor = { x: 0, y: 0, z: 0 };
    e.applyFrequencyHit(999); // dissolving
    const x0 = e.group.position.x;
    e.update(0.2, new THREE.Vector3(20, 3, 0));
    expect(e.group.position.x).toBeLessThan(x0); // 원점(균열) 방향으로 흐름
    expect(e.group.position.y).toBe(3); // 수평 표류만
  });
});
