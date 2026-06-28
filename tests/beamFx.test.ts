import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { muzzleFrom, beamEnd, sideVector, emitterDamage, fireEmitters, type EmitterContext, type EmitterShot } from "../src/weapons/beamFx";
import { damageForDistance, type DamageFalloff } from "../src/weapons/WeaponSpec";

// 빔 끝점/머즐 좌표 순수 계산 가드(모든 무기가 공유 — 데미지숫자·임팩트·빔 시작 위치의 기준).

describe("muzzleFrom — 발사 머즐 위치(origin + dir*1.2 + (0,-0.5,0))", () => {
  it("정면(-z) 발사 → (0,-0.5,-1.2)", () => {
    const o = new THREE.Vector3(0, 0, 0);
    const m = muzzleFrom(o, new THREE.Vector3(0, 0, -1));
    expect(m.x).toBeCloseTo(0, 6);
    expect(m.y).toBeCloseTo(-0.5, 6);
    expect(m.z).toBeCloseTo(-1.2, 6);
  });
  it("origin 을 변형하지 않음(clone)", () => {
    const o = new THREE.Vector3(5, 5, 5);
    muzzleFrom(o, new THREE.Vector3(1, 0, 0));
    expect(o.toArray()).toEqual([5, 5, 5]);
  });
});

describe("beamEnd — 적중점 또는 사거리 끝", () => {
  it("미스(hit undefined) → origin + dir*range", () => {
    const e = beamEnd(undefined, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), 100);
    expect(e.toArray()).toEqual([0, 0, -100]);
  });
  it("히트 → 적중점 복사(원본 미변형)", () => {
    const point = new THREE.Vector3(0, 0, -7);
    const hit = { point } as unknown as THREE.Intersection;
    const e = beamEnd(hit, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), 100);
    expect(e.toArray()).toEqual([0, 0, -7]);
    e.x = 99; // 반환값은 복사본 → 원본 불변
    expect(point.x).toBe(0);
  });
});

describe("sideVector — dir 에 수직인 측면 단위벡터(듀얼 발사관 오프셋)", () => {
  it("정면(-z) → 길이 1, dir·up 모두에 수직", () => {
    const dir = new THREE.Vector3(0, 0, -1);
    const s = sideVector(dir);
    expect(s.length()).toBeCloseTo(1, 6);
    expect(s.dot(dir)).toBeCloseTo(0, 6);
    expect(s.dot(new THREE.Vector3(0, 1, 0))).toBeCloseTo(0, 6);
  });
  it("수직축과 평행(+y / -y) → +x 폴백(NaN 없음, 길이 1)", () => {
    for (const dir of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)]) {
      const s = sideVector(dir);
      expect(s.toArray()).toEqual([1, 0, 0]);
      expect(Number.isNaN(s.x)).toBe(false);
    }
  });
  it("임의 대각 → 단위 길이 유지", () => {
    const s = sideVector(new THREE.Vector3(1, 2, -3).normalize());
    expect(s.length()).toBeCloseTo(1, 6);
  });
  it("out 인자를 변형·반환(동일 참조)", () => {
    const out = new THREE.Vector3();
    const r = sideVector(new THREE.Vector3(0, 0, -1), out);
    expect(r).toBe(out);
  });
});

describe("emitterDamage — 발사관 수만큼 합산(듀얼=2×)", () => {
  const f: DamageFalloff = { refDist: 10, maxMult: 2, minMult: 0.25 };
  it("듀얼(n=2)은 같은 거리 단발(n=1)의 정확히 2배", () => {
    const single = emitterDamage(10, 30, 1, f);
    const dual = emitterDamage(10, 30, 2, f);
    expect(dual).toBeCloseTo(single * 2, 6);
  });
  it("refDist 에서 배수 1.0 → base×n", () => {
    expect(emitterDamage(10, 30, 2, f)).toBeCloseTo(60, 6);
  });
  it("damageForDistance(base×n) 과 동치", () => {
    expect(emitterDamage(37, 12, 3, f)).toBeCloseTo(damageForDistance(37, 12 * 3, f), 6);
  });
});

// fireEmitters — 건물 시야 차폐(빔이 건물을 관통 못함) 분기. raycaster/enemies/world 를 목으로 주입.
// (무기 클래스는 makeGlowTexture 가 canvas/DOM 을 요구해 node 환경에서 생성 불가 → 공유 발사 함수만 직접 검증.)
function harness(opts: {
  hitDist?: number;      // 적 레이캐스트 적중 거리(생략 = 미스)
  bt?: number;           // segmentHitsBuilding 반환(생략 = Infinity = 건물 없음)
  killOnHit?: boolean;   // applyFrequencyHit 가 true(처치) 반환
  muzzleOffsets?: number[];
}) {
  const spawned: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const dmgs: { point: THREE.Vector3; dmg: number }[] = [];
  const applied: number[] = [];
  const kills: unknown[] = [];
  const onHits: THREE.Vector3[] = [];

  const hit = opts.hitDist !== undefined
    ? ({ distance: opts.hitDist, point: new THREE.Vector3(0, 0, -opts.hitDist), face: { normal: new THREE.Vector3(0, 0, 1) } } as unknown as THREE.Intersection)
    : undefined;
  const enemy = { state: "alive", applyFrequencyHit: (d: number) => { applied.push(d); return !!opts.killOnHit; } };

  const ctx = {
    raycaster: { set() {}, intersectObjects: () => (hit ? [hit] : []) },
    enemies: { hitMeshes: [], enemyFromHit: () => enemy, registerKill: (e: unknown) => kills.push(e) },
    damageNumbers: { spawn: (p: THREE.Vector3, d: number) => dmgs.push({ point: p.clone(), dmg: d }) },
    beamPool: { spawn: (f: THREE.Vector3, t: THREE.Vector3) => spawned.push({ from: f.clone(), to: t.clone() }) },
    world: { segmentHitsBuilding: () => opts.bt ?? Infinity },
  } as unknown as EmitterContext;

  const shot: EmitterShot = {
    origin: new THREE.Vector3(0, 0, 0),
    dir: new THREE.Vector3(0, 0, -1),
    muzzleOffsets: opts.muzzleOffsets ?? [0],
    baseDamage: 100,
    falloff: { refDist: 1000, maxMult: 1.5, minMult: 0.3 },
    range: 3000,
    style: { beamColor: 0, glowColor: 0, radius: 1, glowScale: 1 },
    onHit: (end) => onHits.push(end.clone()),
  };
  fireEmitters(ctx, shot);
  return { spawned, dmgs, applied, kills, onHits };
}

describe("fireEmitters — 건물 시야 차폐", () => {
  it("적 없음 + 건물 없음 → 빔이 사거리 끝까지, 피해 없음", () => {
    const r = harness({});
    expect(r.spawned).toHaveLength(1);
    expect(r.spawned[0].to.z).toBeCloseTo(-3000, 5);
    expect(r.dmgs).toHaveLength(0);
    expect(r.applied).toHaveLength(0);
  });

  it("적(200m) + 건물 없음 → 적 피해(거리 감쇠) + 빔이 적중점에서 멈춤 + onHit", () => {
    const r = harness({ hitDist: 200 });
    expect(r.applied).toEqual([150]); // clamp(1000/200=5 → 1.5)*100
    expect(r.dmgs).toHaveLength(1);
    expect(r.dmgs[0].dmg).toBeCloseTo(150, 5);
    expect(r.onHits).toHaveLength(1);
    expect(r.spawned[0].to.z).toBeCloseTo(-200, 5);
  });

  it("적(200m) + 건물(100m, 더 가까움) → 차폐: 피해 없음 + 빔이 건물에서 멈춤 + onHit 없음", () => {
    const r = harness({ hitDist: 200, bt: 100 / 3000 });
    expect(r.applied).toHaveLength(0);
    expect(r.dmgs).toHaveLength(0);
    expect(r.onHits).toHaveLength(0);
    expect(r.spawned[0].to.z).toBeCloseTo(-100, 5);
  });

  it("적(200m) + 건물(500m, 적보다 멀리) → 적 정상 피해(건물은 뒤에 있어 무관)", () => {
    const r = harness({ hitDist: 200, bt: 500 / 3000 });
    expect(r.applied).toEqual([150]);
    expect(r.spawned[0].to.z).toBeCloseTo(-200, 5);
  });

  it("적 없음 + 건물(100m) → 피해 없음 + 빔이 건물에서 멈춤", () => {
    const r = harness({ bt: 100 / 3000 });
    expect(r.dmgs).toHaveLength(0);
    expect(r.spawned[0].to.z).toBeCloseTo(-100, 5);
  });

  it("적 처치(applyFrequencyHit=true) → registerKill 호출", () => {
    const r = harness({ hitDist: 200, killOnHit: true });
    expect(r.kills).toHaveLength(1);
  });

  it("차폐 시에는 처치 판정 없음(registerKill 미호출)", () => {
    const r = harness({ hitDist: 200, killOnHit: true, bt: 100 / 3000 });
    expect(r.kills).toHaveLength(0);
    expect(r.applied).toHaveLength(0);
  });

  it("듀얼 발사관 → 빔 2개(각 발사관) + 데미지는 발사관 수만큼 합산(1회 적용)", () => {
    const r = harness({ hitDist: 200, muzzleOffsets: [-0.55, 0.55] });
    expect(r.spawned).toHaveLength(2);
    expect(r.spawned[0].to.z).toBeCloseTo(-200, 5);
    expect(r.spawned[1].to.z).toBeCloseTo(-200, 5);
    expect(r.applied).toEqual([300]); // 1.5*100*2
  });

  it("듀얼 발사관 + 차폐 → 빔 2개 모두 건물에서 멈춤, 피해 없음", () => {
    const r = harness({ hitDist: 200, muzzleOffsets: [-0.55, 0.55], bt: 100 / 3000 });
    expect(r.spawned).toHaveLength(2);
    expect(r.spawned[0].to.z).toBeCloseTo(-100, 5);
    expect(r.spawned[1].to.z).toBeCloseTo(-100, 5);
    expect(r.applied).toHaveLength(0);
  });
});
