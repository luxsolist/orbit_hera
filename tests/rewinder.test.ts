import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { EnemyManager } from "../src/enemies/EnemyManager";
import { DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";

// 역행체(P3 — 서사편 §6.6/§6.7): 시전 완료 시 반경 내 최근 격파가 되살아나고(처치 수 되감김)
// 플레이어 위치가 되감긴다. 카운터 정본 3종 — 시전 중 격파 / W1 동결·경직 / W2 계류(확정 기록).

const NO_PHASE = { ...DEFAULT_PLASMOID, phase: undefined };

const makeSetup = () => {
  const world = {
    heightAt: () => 0, bounds: 5000, topAt: () => -Infinity,
    resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
  } as never;
  const player = {
    worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
    spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    rewindPosition: vi.fn(),
  };
  const em = new EnemyManager(new THREE.Scene(), world, [player as never], NO_PHASE);
  return { em, player };
};

const tick = (em: EnemyManager, frames: number, dt = 1 / 30) => {
  for (let i = 0; i < frames; i++) em.update(dt);
};

describe("역행 시전 → 발동", () => {
  it("시전 완료 — 반경 내 최근 격파 부활 + 처치 수 되감김 + 플레이어 위치 역행 + 콜백", () => {
    const { em, player } = makeSetup();
    em.startRoster([
      { role: "rewinder", count: 1, hp: 7000 },
      { role: "rusher", count: 2, hp: 500 },
    ], 100);
    const rew = em.aliveEnemies.find((e) => e.role === "rewinder")!;
    // 격파 2 — 역행 후보 기록
    for (const r of em.aliveEnemies.filter((e) => e.role === "rusher")) {
      r.applyFrequencyHit(99999);
      em.registerKill(r);
    }
    expect(em.killCount).toBe(2);
    const castTicks: (number | null)[] = [];
    em.onRewindCast = (v) => castTicks.push(v);
    const onRewound = vi.fn();
    em.onRewound = onRewound;
    tick(em, 14); // 처치 동시 경직(0.35s) 소산 대기 — 경직은 시전 인터럽트(W1 문법)
    rew.rewCd = 0.01; // 즉시 시전 진입(기본 초기 쿨다운 생략)
    tick(em, 130); // ~4.3s — castSec 4 소진(격파 후 5s(rewindSec) 이내)
    expect(onRewound).toHaveBeenCalledTimes(1);
    expect(onRewound.mock.calls[0][0]).toBe(2); //  부활 2
    expect(em.killCount).toBe(0); //                전과 되감김
    expect(em.aliveEnemies.filter((e) => e.role === "rusher")).toHaveLength(2);
    expect(player.rewindPosition).toHaveBeenCalledWith(5); // 반경 내 플레이어 위치 역행
    expect(castTicks.some((v) => typeof v === "number")).toBe(true); // 예지 카운트다운
    expect(castTicks[castTicks.length - 1]).toBeNull(); //             종료 통지
  });

  it("W2 계류 중 격파는 확정 — 되살아나지 않는다(§9.2 '측정만이 비가역')", () => {
    const { em } = makeSetup();
    em.startRoster([
      { role: "rewinder", count: 1, hp: 7000 },
      { role: "rusher", count: 1, hp: 500 },
    ], 100);
    const rew = em.aliveEnemies.find((e) => e.role === "rewinder")!;
    const rusher = em.aliveEnemies.find((e) => e.role === "rusher")!;
    rusher.applyFrequencyHit(99999, { pinSec: 4 }); // 계류 상태로 격파
    em.registerKill(rusher);
    const onRewound = vi.fn();
    em.onRewound = onRewound;
    tick(em, 14); // 처치 동시 경직 소산 대기
    rew.rewCd = 0.01;
    tick(em, 130);
    expect(onRewound).toHaveBeenCalledTimes(1);
    expect(onRewound.mock.calls[0][0]).toBe(0); // 부활 없음 — 확정 기록
    expect(em.killCount).toBe(1);
  });

  it("시전 인터럽트 — 경직(W1 문법)이 시전을 끊고 쿨다운 재정렬", () => {
    const { em } = makeSetup();
    em.startRoster([{ role: "rewinder", count: 1, hp: 7000 }], 100);
    const rew = em.aliveEnemies[0];
    const onRewound = vi.fn();
    em.onRewound = onRewound;
    rew.rewCd = 0.01;
    tick(em, 30); // 시전 진입(~1s 경과)
    expect(rew.rewCastLeft).toBeGreaterThan(0);
    rew.stagger(0.5); // 경직 — 인터럽트
    tick(em, 1);
    expect(rew.rewCastLeft).toBe(0);
    tick(em, 120); // 원 시전이 완료됐을 시간까지 — 발동 없음
    expect(onRewound).not.toHaveBeenCalled();
  });
});
