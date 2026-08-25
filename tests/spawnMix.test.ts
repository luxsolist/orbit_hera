import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { EnemyManager } from "../src/enemies/EnemyManager";
import { DEFAULT_PLASMOID, type SpawnMix } from "../src/enemies/PlasmoidSpec";

// 전장 스폰 구성(§6.8) — 적 구성은 **미션이 선언**하고 드론 종류는 관여하지 않는다.
// 종전에는 러셔=워커/카이터=플라이어로 자기정렬했으나(archetypeCount 의 matchingPlayers),
// 차원도약이 두 아키타입 모두를 두 드론에 유효하게 만들면서 그 결합이 근거를 잃었다.
const NO_PHASE = { ...DEFAULT_PLASMOID, phase: undefined }; // 위상 이탈은 확률 거동 — 개체수 검증을 흔든다

function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const makeManager = (seed: number, mode: "walk" | "fly", py: number) => {
  const world = {
    heightAt: () => 0, bounds: 100000, topAt: () => -Infinity,
    resolveCollision: (x: number, z: number) => ({ x, z }),
    segmentHitsBuilding: () => Infinity, buildings: null, update: () => {},
  } as any;
  const player = {
    worldPosition: new THREE.Vector3(0, py, 0), isDead: false,
    spec: { move: { mode } }, takeDamage: () => false, heal: () => {},
  } as any;
  return new EnemyManager(new THREE.Scene(), world, [player], NO_PHASE, lcg(seed));
};

const roleCounts = (em: EnemyManager) => {
  const out: Record<string, number> = { kiter: 0, rusher: 0, marker: 0 };
  for (const e of (em as any).enemies) if (e.state === "alive") out[e.role] = (out[e.role] ?? 0) + 1;
  return out;
};

/** 구성 mix 로 90초 돌린 뒤 살아있는 직무별 개체 수. */
function run(mix: SpawnMix, mode: "walk" | "fly", py = mode === "fly" ? 120 : 2) {
  const em = makeManager(9, mode, py);
  em.setSpawnMix(mix);
  em.setLeapMuls(0, 1); // 도약은 이 스위트의 관심사가 아니다(위치 이동이 개체수 판정을 흔들지 않게)
  em.start(true);
  for (let i = 0; i < 60 * 90; i++) em.update(1 / 60);
  return roleCounts(em);
}

describe("전장 구성 — 드론 종류와 무관", () => {
  for (const mix of ["kiter", "rusher", "even"] as const) {
    it(`${mix}: 워커와 플라이어가 같은 구성을 만난다`, () => {
      const w = run(mix, "walk"), f = run(mix, "fly");
      expect(f.kiter).toBe(w.kiter);
      expect(f.rusher).toBe(w.rusher);
    });
  }

  it("kiter 단독 = 리치 0", () => {
    for (const mode of ["walk", "fly"] as const) {
      const c = run("kiter", mode);
      expect(c.rusher).toBe(0);
      expect(c.kiter).toBeGreaterThan(0);
    }
  });

  it("rusher 단독 = 스키터 0", () => {
    for (const mode of ["walk", "fly"] as const) {
      const c = run("rusher", mode);
      expect(c.kiter).toBe(0);
      expect(c.rusher).toBeGreaterThan(0);
    }
  });

  it("even = 양쪽 모두, 각각 단독 구성보다 적게", () => {
    const e = run("even", "walk");
    expect(e.kiter).toBeGreaterThan(0);
    expect(e.rusher).toBeGreaterThan(0);
    expect(e.kiter).toBeLessThan(run("kiter", "walk").kiter);
    expect(e.rusher).toBeLessThan(run("rusher", "walk").rusher);
  });

  it("마커는 구성 축과 직교 — 세 구성에서 같은 수", () => {
    const m = (["kiter", "rusher", "even"] as const).map((x) => run(x, "walk").marker);
    expect(new Set(m).size).toBe(1);
    expect(m[0]).toBeGreaterThan(0);
  });
});

// 지면 기준 스폰이던 시절: 러셔 밴드가 0~60m 인데 인식 반경이 500m(3D)라, 플레이어가 560m 이상
// 고도에 있으면 신규 러셔가 인식조차 못 하고 건물만 뜯었다(플라이어 천장 1000m → 무적 지대).
describe("고고도 비행 플레이어 — 스폰 고도가 따라온다", () => {
  for (const py of [120, 400, 700]) {
    it(`py=${py}m: 리치가 전원 교전 상태로 스폰된다`, () => {
      const em = makeManager(9, "fly", py);
      em.setSpawnMix("rusher");
      em.start(true);
      for (let i = 0; i < 60 * 90; i++) em.update(1 / 60);
      const rs = (em as any).enemies.filter((e: any) => e.state === "alive" && e.role === "rusher");
      expect(rs.length).toBeGreaterThan(0);
      expect(rs.every((e: any) => e.targetIndex >= 0)).toBe(true); // 전원 플레이어 교전
    });
  }

  it("지상 플레이어는 종전과 동치 — 스폰 고도가 지면 근처", () => {
    // **스폰 순간**의 y 만 본다. 러셔는 고도 클램프가 없어(카이터만 clampKiterAltitude) 이후 박동·조향
    // 으로 지면을 살짝 오르내리는데(최저 −0.3 남짓), 그건 스폰 고도와 무관한 기존 거동이다.
    const em = makeManager(9, "walk", 2);
    em.setSpawnMix("rusher");
    em.setLeapMuls(0, 1);
    em.start(true);
    const seen = new Set<unknown>();
    const spawns: { role: string; y: number }[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      em.update(1 / 60);
      for (const e of (em as any).enemies) {
        if (e.state !== "alive" || seen.has(e)) continue;
        seen.add(e);
        spawns.push({ role: e.role, y: e.group.position.y });
      }
    }
    expect(spawns.length).toBeGreaterThan(0);
    const A = DEFAULT_PLASMOID.archetypes as Record<string, { spawnAltMin: number; spawnAltMax: number }>;
    for (const { role, y } of spawns) {
      expect(y).toBeGreaterThanOrEqual(0); // 지면 하한 클램프(SPAWN_GROUND_CLEARANCE)
      // 밴드는 직무마다 다르다(러셔 0~60 / 마커 40~160) — 자기 밴드 기준으로 본다.
      expect(y).toBeLessThanOrEqual(2 + A[role].spawnAltMax + 1); // 플레이어 고도 + 그 직무 밴드 상한
      expect(y).toBeGreaterThanOrEqual(Math.min(2 + A[role].spawnAltMin, 0.5) - 1e-6);
    }
  });
});
