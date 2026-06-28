import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { EnemyManager } from "../src/enemies/EnemyManager";
import { DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";

// 탐방 모드(start(false)) = 적 미스폰 / 전투 모드(start(true)) = 점진 스폰. EnemyManager.start 게이트 가드.

const makeManager = () => {
  const scene = new THREE.Scene();
  const world = { heightAt: () => 0, bounds: 1000, topAt: () => -Infinity, resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity } as any;
  const player = {
    worldPosition: new THREE.Vector3(0, 2, 0),
    isDead: false,
    spec: { move: { mode: "walk" } },
    takeDamage: () => false, // 머시 무적처럼 무피해 — 스폰 게이트만 검증
    heal: () => {},
  } as any;
  return new EnemyManager(scene, world, [player], DEFAULT_PLASMOID);
};

const tick = (em: EnemyManager, frames: number) => { for (let i = 0; i < frames; i++) em.update(1 / 60); };

describe("EnemyManager.start — 탐방/전투 모드 스폰 게이트", () => {
  it("탐방 모드(start(false)): 수백 프레임 동안 적이 한 마리도 스폰되지 않음", () => {
    const em = makeManager();
    let lastWave = -1;
    em.onWaveChange = (w) => (lastWave = w);
    em.start(false);
    tick(em, 600); // ~10초
    expect(em.aliveMarkers.length).toBe(0);
    expect(em.killCount).toBe(0);
    expect(lastWave).toBe(0); // 웨이브 0(전투 미시작)
  });

  it("전투 모드(start(true)): 시간이 지나면 적이 스폰됨", () => {
    const em = makeManager();
    em.start(true);
    tick(em, 600);
    expect(em.aliveMarkers.length).toBeGreaterThan(0);
  });
});
