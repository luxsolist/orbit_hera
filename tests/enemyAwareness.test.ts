import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { EnemyManager, engagesPlayer } from "../src/enemies/EnemyManager";
import { DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";

// 위상 이탈(§2.1)은 확률 거동이라 투입/개체수 검증을 흔든다 — 본 스위트는 비활성 스펙 사용.
const NO_PHASE = { ...DEFAULT_PLASMOID, phase: undefined };

// 인식(awareness) 히스테리시스 + 피격 유발(provoke) 게이트 검증.
// 실제 상수: 인식 500m(=250000), 해제 900m(=810000), 피격 전파 100m.
const ACQUIRE = 500 * 500;
const LOSE = 900 * 900;

describe("engagesPlayer — 인식 히스테리시스 + provoke 우선", () => {
  it("표적 없음 → 항상 미교전(provoke 여부 무관)", () => {
    expect(engagesPlayer(false, true, 0, false, ACQUIRE, LOSE)).toBe(false);
    expect(engagesPlayer(false, true, 0, true, ACQUIRE, LOSE)).toBe(false); // provoked 라도 표적 없으면 미교전
  });

  it("미교전 상태: 인식 반경(500m) 안에서만 신규 인식", () => {
    expect(engagesPlayer(true, false, ACQUIRE, false, ACQUIRE, LOSE)).toBe(true); // 경계 포함
    expect(engagesPlayer(true, false, ACQUIRE + 1, false, ACQUIRE, LOSE)).toBe(false); // 살짝 밖 → 미인식
  });

  it("교전 중 상태: 해제 반경(900m)까지 추격 유지(히스테리시스)", () => {
    expect(engagesPlayer(true, true, LOSE, false, ACQUIRE, LOSE)).toBe(true); // 해제 경계 포함
    expect(engagesPlayer(true, true, LOSE + 1, false, ACQUIRE, LOSE)).toBe(false); // 밖 → 이탈
  });

  it("히스테리시스: 같은 거리(632m, 인식~해제 사이)라도 교전 중이면 유지·미교전이면 미인식", () => {
    const mid = 632 * 632; // 500 < 632 < 900
    expect(engagesPlayer(true, true, mid, false, ACQUIRE, LOSE)).toBe(true); // 이미 추격 → 유지
    expect(engagesPlayer(true, false, mid, false, ACQUIRE, LOSE)).toBe(false); // 아직 미인식 → 획득 안 함
  });

  it("provoked: 거리·교전이력 무관하게 교전(피격 유발 래치)", () => {
    const far = 5000 * 5000; // 인식/해제 반경을 한참 벗어난 거리
    expect(engagesPlayer(true, false, far, true, ACQUIRE, LOSE)).toBe(true); // 미교전+초원거리라도 provoked면 추격
    expect(engagesPlayer(true, false, far, false, ACQUIRE, LOSE)).toBe(false); // provoked 아니면 당연히 미인식(대조군)
  });
});

// provokeNear — 피격 개체 반경 100m 안의 살아있는 개체(피격 개체 자신 포함)만 provoked 로 전환.
const makeManager = () => {
  const scene = new THREE.Scene();
  const world = { heightAt: () => 0, bounds: 1000, topAt: () => -Infinity, resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity } as any;
  const player = {
    worldPosition: new THREE.Vector3(0, 2, 0),
    isDead: false,
    spec: { move: { mode: "walk" } },
    takeDamage: () => false,
    heal: () => {},
  } as any;
  return new EnemyManager(scene, world, [player], NO_PHASE);
};

const spawnAtLeast = (em: EnemyManager, n: number, maxFrames = 3000) => {
  em.start(true);
  for (let i = 0; i < maxFrames && em.aliveEnemies.length < n; i++) em.update(1 / 60);
  return em.aliveEnemies;
};

describe("EnemyManager.provokeNear — 피격 유발 전파(반경 100m)", () => {
  it("피격 개체 자신 + 반경 100m 안만 provoked, 밖은 불변", () => {
    const em = makeManager();
    const es = spawnAtLeast(em, 3);
    expect(es.length).toBeGreaterThanOrEqual(3);

    es.forEach((e) => expect(e.provoked).toBe(false)); // 스폰 직후 전원 미도발
    es[0].group.position.set(0, 0, 0);   // 피격 개체
    es[1].group.position.set(50, 0, 0);  // 50m — 반경 안
    es[2].group.position.set(150, 0, 0); // 150m — 반경 밖

    em.provokeNear(es[0]);

    expect(es[0].provoked).toBe(true);  // 피격 개체 자신(거리 0)
    expect(es[1].provoked).toBe(true);  // 반경 안
    expect(es[2].provoked).toBe(false); // 반경 밖 → 불변
  });

  it("경계(정확히 100m) 포함, 그 밖은 제외", () => {
    const em = makeManager();
    const es = spawnAtLeast(em, 3);
    es[0].group.position.set(0, 0, 0);
    es[1].group.position.set(100, 0, 0);    // 정확히 100m → 포함
    es[2].group.position.set(100.5, 0, 0);  // 100.5m → 제외

    em.provokeNear(es[0]);

    expect(es[1].provoked).toBe(true);
    expect(es[2].provoked).toBe(false);
  });

  it("연쇄 전파 없음 — 도발된 개체가 다시 이웃을 도발하지 않음", () => {
    const em = makeManager();
    const es = spawnAtLeast(em, 3);
    es[0].group.position.set(0, 0, 0);    // 피격 개체
    es[1].group.position.set(80, 0, 0);   // 피격 개체 기준 80m → 도발됨
    es[2].group.position.set(160, 0, 0);  // es[1] 기준 80m 이지만 피격 개체 기준 160m → 도발 안 됨

    em.provokeNear(es[0]);

    expect(es[1].provoked).toBe(true);
    expect(es[2].provoked).toBe(false); // 전파는 피격 개체 기준 1홉만
  });
});
