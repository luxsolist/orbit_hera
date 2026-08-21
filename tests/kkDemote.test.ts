import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { EnemyManager } from "../src/enemies/EnemyManager";
import {
  DEFAULT_PLASMOID, kkLevelOf, kkLevelColors, colorAt, KK_LEVELS, KK_MIN_HP,
} from "../src/enemies/PlasmoidSpec";

// 준위 강등 브레이크포인트(P3 — 물리편 §2.3·overview §7 정본): 정예·보스가 HP 준위 경계를
// 하향 통과하면 색 강등(적색 쪽) + 짧은 경직. "깎이는 게 색으로 보인다" — 스폰지 방지 짝.

describe("kkLevelOf·kkLevelColors — 순수 계단", () => {
  it("준위 경계 — 75/50/25% 하향 계단(1..4)", () => {
    expect(kkLevelOf(100, 100)).toBe(4);
    expect(kkLevelOf(76, 100)).toBe(4);
    expect(kkLevelOf(75, 100)).toBe(3);
    expect(kkLevelOf(50, 100)).toBe(2);
    expect(kkLevelOf(25, 100)).toBe(1);
    expect(kkLevelOf(1, 100)).toBe(1);
  });

  it("준위색 — 최저온(적색)→스폰 온도(본색) 내림보간, 최상위=본색", () => {
    const spawnTemp = 9000;
    const colors = kkLevelColors(DEFAULT_PLASMOID, spawnTemp);
    expect(colors).toHaveLength(KK_LEVELS);
    expect(colors[KK_LEVELS - 1]).toBe(colorAt(DEFAULT_PLASMOID.color.stops, spawnTemp)); // 본색
    expect(colors[0]).toBe(colorAt(DEFAULT_PLASMOID.color.stops, DEFAULT_PLASMOID.color.stops[0].temp)); // 최저온
  });
});

describe("EnemyManager — 강등 연출 구동", () => {
  const makeManager = () => {
    const world = {
      heightAt: () => 0, bounds: 5000, topAt: () => -Infinity,
      resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
    } as never;
    const player = {
      worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as never;
    return new EnemyManager(new THREE.Scene(), world, [player], { ...DEFAULT_PLASMOID, phase: undefined });
  };

  it("정예(KK_MIN_HP 이상) — 경계 하향 통과 시 색 강등 + 경직, 잡몹은 무강등", () => {
    const em = makeManager();
    em.startRoster([
      { role: "elite", count: 1, hp: 4000 },
      { role: "rusher", count: 1, hp: 800 }, // KK_MIN_HP 미만 — 단일 준위
    ], 500);
    const elite = em.aliveEnemies.find((e) => e.maxHp === 4000)!;
    const grunt = em.aliveEnemies.find((e) => e.maxHp === 800)!;
    expect(elite.kkColors).not.toBeNull();
    expect(grunt.kkColors).toBeNull();
    const baseColor = elite.color;
    elite.applyFrequencyHit(1100); // 4000→2900 = 72.5% — 준위 3 진입
    em.update(1 / 30);
    expect(elite.kkCur).toBe(3);
    expect(elite.color).not.toBe(baseColor); // 적색 쪽 강등
    expect(elite.isStaggered).toBe(true); //   준위 붕괴 경직
    // 25% 아래로 — 최하 준위(1)까지 연쇄 강등
    elite.applyFrequencyHit(2000); // 900 = 22.5%
    em.update(1 / 30);
    expect(elite.kkCur).toBe(1);
    expect(elite.color).toBe(elite.kkColors![0]);
  });

  it("KK_MIN_HP 정본치 유지(정예·보스급 게이트)", () => {
    expect(KK_MIN_HP).toBe(3000);
  });
});
