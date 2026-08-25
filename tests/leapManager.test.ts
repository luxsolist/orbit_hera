import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { EnemyManager } from "../src/enemies/EnemyManager";
import { DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";

// 차원도약 상태기계 통합 가드(§6.7) — 순수 표본(leap.test.ts) 밖의 "실제로 옮겨지는가"를 본다.
// 위상 이탈은 확률 거동이라 도약 인터럽트와 섞이므로 비활성 스펙으로 고정한다.
const NO_PHASE = { ...DEFAULT_PLASMOID, phase: undefined };
const SKEETER = DEFAULT_PLASMOID.archetypes.kiter.leap!;
const LEECH = DEFAULT_PLASMOID.archetypes.rusher.leap!;

/** 시드 고정 난수 — 도약 확률/표본을 결정적으로. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// 플레이어 고도 py 를 바꿔가며 검증한다 — 착지 고도가 **플레이어 기준**이 됐으므로 비행 케이스가 본론.
// 구성은 "even" 고정(양쪽 아키타입이 모두 나와야 두 도약을 한 번에 검증할 수 있다).
const makeManager = (seed = 5, py = 2) => {
  const scene = new THREE.Scene();
  const world = {
    heightAt: () => 0, bounds: 100000, topAt: () => -Infinity,
    resolveCollision: (x: number, z: number) => ({ x, z }),
    segmentHitsBuilding: () => Infinity, // 건물 없음 — 착지점이 항상 유효
    buildings: null, update: () => {},
  } as any;
  const player = {
    worldPosition: new THREE.Vector3(0, py, 0),
    isDead: false,
    spec: { move: { mode: "walk" } },
    takeDamage: () => false,
    heal: () => {},
  } as any;
  const em = new EnemyManager(scene, world, [player], NO_PHASE, lcg(seed));
  em.setSpawnMix("even");
  return em;
};
const GROUND_CLEARANCE = 1.5; // EnemyManager.LEAP_GROUND_CLEARANCE

const tick = (em: EnemyManager, frames: number) => { for (let i = 0; i < frames; i++) em.update(1 / 60); };

/** 플레이어(원점) 기준 수평거리. */
const hdist = (e: any) => Math.hypot(e.group.position.x, e.group.position.z);

/** 살아있는 개체를 직무별로 — 내부 배열 접근(테스트 전용). */
const alive = (em: EnemyManager, role: string) =>
  (em as any).enemies.filter((e: any) => e.state === "alive" && e.role === role);

/**
 * 도약 포착 — 한 프레임 안의 **위치 불연속**을 찾는다. 정상 이동은 프레임당 최대 speed/60 m
 * (스키터 89 → 1.5m, 리치 17 → 0.28m, 돌진 2.6배여도 0.74m)라 jumpMin 을 넘을 수 없다.
 * 반환: 도약 **직후**의 {수평거리, 고도} 목록.
 */
function captureLeaps(em: EnemyManager, role: string, frames: number, jumpMin: number): { d: number; y: number }[] {
  const prev = new Map<any, THREE.Vector3>();
  const landed: { d: number; y: number }[] = [];
  for (let i = 0; i < frames; i++) {
    em.update(1 / 60);
    for (const e of alive(em, role)) {
      const p = e.group.position;
      const before = prev.get(e);
      if (before && before.distanceTo(p) > jumpMin) landed.push({ d: hdist(e), y: p.y });
      prev.set(e, p.clone());
    }
  }
  return landed;
}

describe("차원도약 — 실제 이동", () => {
  it("스키터가 텔레그래프 후 150~450m 도넛 안으로 옮겨진다", () => {
    const em = makeManager(5);
    em.start(true);
    const landed = captureLeaps(em, "kiter", 60 * 150, 100); // 정상 이동은 프레임당 1.5m 상한
    expect(landed.length).toBeGreaterThan(0);
    for (const { d } of landed) {
      expect(d).toBeGreaterThanOrEqual(SKEETER.minDist - 1);
      expect(d).toBeLessThanOrEqual(SKEETER.maxDist + 1);
    }
  });

  it("리치가 12~25m 링 안으로 옮겨진다 — 플레이어 위에 겹치지 않는다", () => {
    const em = makeManager(5);
    em.start(true);
    const landed = captureLeaps(em, "rusher", 60 * 200, 5); // 정상 이동은 돌진 포함 프레임당 0.74m
    expect(landed.length).toBeGreaterThan(0);
    for (const { d } of landed) {
      expect(d).toBeGreaterThanOrEqual(LEECH.minDist - 1); // 0m(플레이어 위)에 착지하지 않는다
      expect(d).toBeLessThanOrEqual(LEECH.maxDist + 1);
    }
  });

  it("착지 고도가 항상 지면 위 — 지하로 도약하지 않는다", () => {
    // 착지 **순간**의 y 만 본다. 러셔는 고도 클램프가 없어(카이터만 clampKiterAltitude) 착지 후
    // 박동·조향으로 지면을 살짝 오르내리는데, 그건 도약과 무관한 기존 거동이다(도약을 꺼도 −0.26).
    for (const py of [2, 100, 400]) {
      for (const [role, jump] of [["kiter", 100], ["rusher", 5]] as const) {
        const em = makeManager(13, py);
        em.start(true);
        const landed = captureLeaps(em, role, 60 * 200, jump);
        expect(landed.length).toBeGreaterThan(0);
        for (const { y } of landed) expect(y).toBeGreaterThanOrEqual(GROUND_CLEARANCE - 1e-6);
      }
    }
  });

  it("착지 고도가 플레이어를 따라간다 — 비행 중에도 발밑 수백 m 에 떨어지지 않는다", () => {
    // 지면 기준이던 시절: 플레이어 300m 상공일 때 리치가 299m **아래**에 착지해 회피 강제가
    // 0% 달성이었다(실측). 러셔의 일반 이동은 원래 3D 추격이므로 도약만 예외였던 것.
    for (const py of [100, 400]) {
      const em = makeManager(5, py);
      em.start(true);
      for (const { y } of captureLeaps(em, "rusher", 60 * 200, 5)) {
        expect(Math.abs(y - py)).toBeLessThanOrEqual(Math.abs(LEECH.dyMin) + 1); // ±10m 안
      }
    }
  });

  it("스키터는 플레이어보다 위에 내린다 — 지면에 붙지 않는 한", () => {
    for (const py of [2, 300]) {
      const em = makeManager(29, py);
      em.start(true);
      const landed = captureLeaps(em, "kiter", 60 * 200, 100);
      expect(landed.length).toBeGreaterThan(0);
      for (const { y } of landed) {
        expect(y).toBeGreaterThanOrEqual(py + SKEETER.dyMin - 1e-6);
        expect(y).toBeLessThanOrEqual(py + SKEETER.dyMax + 1e-6);
      }
    }
  });

  it("동시 텔레그래프 수가 상한을 넘지 않는다", () => {
    const em = makeManager(29);
    em.start(true);
    const cap = SKEETER.concurrentCap + LEECH.concurrentCap;
    for (let i = 0; i < 60 * 120; i++) {
      em.update(1 / 60);
      expect(em.leapCastingCount).toBeLessThanOrEqual(cap);
    }
  });

  it("도약이 관측 노출을 끊는다 — 붙들고 있던 지속조사가 리셋", () => {
    const em = makeManager(5);
    em.setLeapMuls(0, 1); // 도약 비활성 — 여기선 노출 누적/리셋만 격리 검증
    em.start(true);
    tick(em, 60 * 30);
    const ks = alive(em, "kiter");
    expect(ks.length).toBeGreaterThan(0);
    const e = ks[0];
    const Z = { slowPerSec: 0.4, freezeAfter: 1.2 };
    // 동결까지 1.2초 노출이 필요 — 60fps 면 72프레임. 여유를 둬 100프레임 지속 조사.
    for (let i = 0; i < 100; i++) { e.applyZeno(Z); em.update(1 / 60); }
    expect(e.isZenoFrozen).toBe(true); // 붙들고 있으면 동결
    e.resetZenoExposure(); // = 도약이 하는 일
    expect(e.isZenoFrozen).toBe(false);
    expect(e.zenoMul).toBe(1);
  });
});

describe("난이도 노브", () => {
  it("확률 0 이면 도약이 일어나지 않는다(쿨다운만 소모)", () => {
    const em = makeManager(41);
    em.setLeapMuls(0, 1);
    em.start(true);
    for (let i = 0; i < 60 * 120; i++) {
      em.update(1 / 60);
      expect(em.leapCastingCount).toBe(0); // 텔레그래프 자체가 시작되지 않음
    }
  });

  it("확률을 올리면 도약 시전이 더 자주 관측된다", () => {
    const castFrames = (chanceMul: number, cdMul: number) => {
      const em = makeManager(77);
      em.setLeapMuls(chanceMul, cdMul);
      em.start(true);
      let n = 0;
      for (let i = 0; i < 60 * 150; i++) { em.update(1 / 60); n += em.leapCastingCount; }
      return n;
    };
    expect(castFrames(2, 0.5)).toBeGreaterThan(castFrames(0.5, 2));
  });
});

// 착지점 기각·시전 취소 — 계약의 예외 경로. 정상 경로만 덮으면 "왜 도약하지 않는가"가 검증되지 않는다.
describe("차원도약 — 기각·취소 경로", () => {
  /** 카이터 1기를 확보하고 도약 시전이 시작될 때까지 돌린다. 못 잡으면 null. */
  function castingKiter(em: EnemyManager, frames = 60 * 120) {
    for (let i = 0; i < frames; i++) {
      em.update(1 / 60);
      const c = alive(em, "kiter").find((e: any) => e.leapCastLeft > 0);
      if (c) return c;
    }
    return null;
  }

  it("인터럽트(동료 처치 경직)가 시전을 취소하고 쿨다운을 재설정한다", () => {
    const em = makeManager(5);
    em.start(true);
    const e = castingKiter(em);
    expect(e).not.toBeNull();
    expect(e.leapTarget).not.toBeNull();
    e.stagger(0.5); // = 어디선가 동료가 처치됨(leapInterrupted 의 staggered)
    em.update(1 / 60);
    expect(e.leapCastLeft).toBe(0); // 시전 파기
    expect(e.leapTarget).toBeNull(); // 낡은 착지점도 함께 버린다
    expect(e.leapCd).toBeGreaterThan(0); // 완전 리셋이 아니라 짧은 재정렬 쿨다운
  });

  it("취소된 시전은 동시 상한을 점유하지 않는다", () => {
    const em = makeManager(5);
    em.start(true);
    const e = castingKiter(em);
    expect(e).not.toBeNull();
    e.stagger(0.5);
    em.update(1 / 60);
    em.update(1 / 60);
    expect(alive(em, "kiter").every((k: any) => k !== e || k.leapCastLeft === 0)).toBe(true);
  });

  it("도약 스펙이 없는 아키타입은 무동작 — 구 데이터 하위호환", () => {
    const noLeap = {
      ...NO_PHASE,
      archetypes: {
        ...NO_PHASE.archetypes,
        kiter: { ...NO_PHASE.archetypes.kiter, leap: undefined },
        rusher: { ...NO_PHASE.archetypes.rusher, leap: undefined },
      },
    };
    const world = {
      heightAt: () => 0, bounds: 100000, topAt: () => -Infinity,
      resolveCollision: (x: number, z: number) => ({ x, z }),
      segmentHitsBuilding: () => Infinity, buildings: null, update: () => {},
    } as any;
    const player = {
      worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as any;
    const em = new EnemyManager(new THREE.Scene(), world, [player], noLeap, lcg(5));
    em.setSpawnMix("even");
    em.start(true);
    for (let i = 0; i < 60 * 120; i++) {
      em.update(1 / 60);
      expect(em.leapCastingCount).toBe(0);
    }
  });

  it("시야가 전부 막히면 착지점을 못 찾아 도약하지 않는다", () => {
    // segmentHitsBuilding ≤ 1 = 막힘. 모든 후보가 기각되면 pickLeapDest 가 null → 시전 미개시.
    const world = {
      heightAt: () => 0, bounds: 100000, topAt: () => -Infinity,
      resolveCollision: (x: number, z: number) => ({ x, z }),
      segmentHitsBuilding: () => 0.5, buildings: null, update: () => {},
    } as any;
    const player = {
      worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as any;
    const em = new EnemyManager(new THREE.Scene(), world, [player], NO_PHASE, lcg(5));
    em.setSpawnMix("even");
    em.start(true);
    for (let i = 0; i < 60 * 120; i++) {
      em.update(1 / 60);
      expect(em.leapCastingCount).toBe(0);
    }
  });

  it("작전구역 밖으로는 착지하지 않는다", () => {
    // 스키터 도약은 수평 150~450m — 구역 반경 120m 면 후보가 전부 구역 밖이라 기각된다.
    const em = makeManager(5);
    em.setZone(0, 0, 120);
    em.start(true);
    for (let i = 0; i < 60 * 120; i++) {
      em.update(1 / 60);
      for (const e of alive(em, "kiter")) {
        if (!e.leapTarget) continue;
        expect(Math.hypot(e.leapTarget.x, e.leapTarget.z)).toBeLessThanOrEqual(120);
      }
    }
  });
});
