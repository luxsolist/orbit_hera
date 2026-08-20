import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { CoreEnemy } from "../src/enemies/CoreEnemy";
import { BrandSystem, homingStep, sweepCrossed, brandDamage, type BrandTarget } from "../src/enemies/BrandSystem";
import { DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";

// 낙인 + 심판 파문(서사편 §6.1 ① MARK) — 전투의 새 박자.
// 낙인 자체는 무피해, 파문 통과 시에만 피해. 카운터 = 유도탄 회피 / 근원 마커 격파.

const APP = { maxHp: 100, diameter: 2, color: 0xff3b30 };
const TOMB = DEFAULT_PLASMOID.archetypes.marker.tomb;
const SWEEP = { period: 10, speed: 100, warnSec: 3, maxRadius: 500 };

const makeTarget = (x = 0, y = 2, z = 0): BrandTarget & { worldPosition: THREE.Vector3 } => ({
  worldPosition: new THREE.Vector3(x, y, z),
  isDead: false,
});

describe("homingStep — 낙인 유도탄 호밍(순수)", () => {
  it("표적 방향으로 등속 전진(직선 케이스)", () => {
    const r = homingStep({ x: 0, y: 0, z: 0 }, { x: 22, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, 22, Math.PI, 0.1);
    expect(r.pos.x).toBeCloseTo(2.2, 6);
    expect(r.pos.y).toBeCloseTo(0, 6);
  });

  it("선회 상한 — 급기동 표적을 즉시 따라돌지 못한다(회피 가능성)", () => {
    // 속도 +x, 표적이 정측면(+z) — 선회 캡 30°/s·dt0.1 = 3° 만 회전
    const r = homingStep({ x: 0, y: 0, z: 0 }, { x: 22, y: 0, z: 0 }, { x: 0, y: 0, z: 100 }, 22, THREE.MathUtils.degToRad(30), 0.1);
    const ang = Math.atan2(r.vel.z, r.vel.x);
    expect(ang).toBeGreaterThan(0);
    expect(ang).toBeLessThan(THREE.MathUtils.degToRad(3.5)); // 캡 준수 — 스트레이프로 흘릴 수 있다
  });
});

describe("sweepCrossed / brandDamage — 파면 판정(순수)", () => {
  it("파면 반개구간 [prev, cur) 교차만 참 — 진앙 포함, 상한은 다음 프레임", () => {
    expect(sweepCrossed(90, 110, 100)).toBe(true);
    expect(sweepCrossed(90, 110, 90)).toBe(true); // 하한 포함
    expect(sweepCrossed(90, 110, 110)).toBe(false); // 상한 제외(다음 프레임 하한으로 처리 — 중복 없음)
    expect(sweepCrossed(90, 110, 200)).toBe(false);
    expect(sweepCrossed(0, 6.5, 0)).toBe(true); // 진앙(균열 중심에 선 표적) — 개시 프레임에 쓸림
  });

  it("낙인 피해 합산 — 낙인 1개당 근원 sweepDamage", () => {
    expect(brandDamage([{ damage: 30 }, { damage: 30 }, { damage: 10 }])).toBe(70);
    expect(brandDamage([])).toBe(0);
  });
});

describe("BrandSystem — 낙인 부착·파문 타격·근원 격파 소산", () => {
  const setup = () => {
    const scene = new THREE.Scene();
    const target = makeTarget(0, 2, 0);
    const sys = new BrandSystem(scene, [target], SWEEP);
    const marker = new CoreEnemy(new THREE.Vector3(50, 2, 0), APP, 5);
    return { scene, target, sys, marker };
  };
  const anchor = { x: 0, y: 0, z: 0 };
  const tick = (sys: BrandSystem, sec: number, dt = 0.05) => {
    for (let t = 0; t < sec - 1e-9; t += dt) sys.update(dt, anchor, 0);
  };

  it("유도탄이 표적에 닿으면 낙인 부착(무피해) — 파문 통과 시에만 피해", () => {
    const { target, sys, marker } = setup();
    const hits: number[] = [];
    sys.onSweepHit = (_idx, dmg) => hits.push(dmg);
    sys.launch(new THREE.Vector3(20, 2, 0), 0, marker, TOMB);
    tick(sys, 2); // 20m / 22m·s⁻¹ — 명중까지 충분
    expect(sys.brandCount(0)).toBe(1);
    expect(hits.length).toBe(0); // 낙인 자체는 무피해

    // 파문 도래 — 표적을 앵커에서 200m 로 옮겨 파면 교차 시점 명확화
    target.worldPosition.set(200, 2, 0);
    tick(sys, SWEEP.period + 200 / SWEEP.speed + 0.2);
    expect(hits).toEqual([TOMB.sweepDamage]); // 낙인 1개 × sweepDamage
    expect(sys.brandCount(0)).toBe(0); // 파문이 낙인을 소모
  });

  it("진앙(앵커 위 표적)도 파문에 쓸린다 — 낙인 무한 누적 면제 구멍 없음", () => {
    const { target, sys, marker } = setup();
    const hits: number[] = [];
    sys.onSweepHit = (_idx, dmg) => hits.push(dmg);
    target.worldPosition.set(0, 2, 0); // 앵커(0,0) 정중앙
    sys.launch(new THREE.Vector3(20, 2, 0), 0, marker, TOMB);
    tick(sys, 2); // 낙인 부착
    expect(sys.brandCount(0)).toBe(1);
    tick(sys, SWEEP.period + 0.5); // 파문 개시 직후 진앙부터 쓸림
    expect(hits).toEqual([TOMB.sweepDamage]);
    expect(sys.brandCount(0)).toBe(0);
  });

  it("낙인은 표적당 상한(5)까지만 쌓인다", () => {
    const { sys, marker } = setup();
    for (let i = 0; i < 8; i++) {
      sys.launch(new THREE.Vector3(10, 2, 0), 0, marker, TOMB);
      tick(sys, 1);
    }
    expect(sys.brandCount(0)).toBe(5);
  });

  it("낙인 없는 표적은 파문이 지나가도 무해(전장 박자만)", () => {
    const { sys } = setup();
    let hit = 0;
    sys.onSweepHit = () => hit++;
    tick(sys, SWEEP.period + SWEEP.maxRadius / SWEEP.speed + 0.5);
    expect(hit).toBe(0);
  });

  it("근원 마커 격파 시 그 낙인·유도탄이 소산한다(마커 우선 격파 카운터)", () => {
    const { sys, marker } = setup();
    const other = new CoreEnemy(new THREE.Vector3(60, 2, 0), APP, 5);
    sys.launch(new THREE.Vector3(10, 2, 0), 0, marker, TOMB);
    tick(sys, 1.5); // 명중 → marker 낙인 1
    sys.launch(new THREE.Vector3(10, 2, 0), 0, other, TOMB);
    tick(sys, 1.5); // 명중 → other 낙인 1
    expect(sys.brandCount(0)).toBe(2);
    sys.notifyDead(marker);
    expect(sys.brandCount(0)).toBe(1); // marker 소유분만 소산
  });

  it("파문 예고 — warnSec 이내 잔여 초, 파면 확장 중 0, 그 외 null", () => {
    const { sys } = setup();
    expect(sys.warnLeft).toBeNull(); // period 10 > warnSec 3
    tick(sys, SWEEP.period - SWEEP.warnSec + 0.1);
    const w = sys.warnLeft;
    expect(w).not.toBeNull();
    expect(w!).toBeLessThanOrEqual(SWEEP.warnSec);
    tick(sys, SWEEP.warnSec); // 파면 개시
    expect(sys.warnLeft).toBe(0);
  });

  it("setPeriodMul — 파문 주기 배수(변조 sweepPeriodMul): 잦아진 주기로 재무장 + 현재 카운트다운 클램프", () => {
    const { sys } = setup();
    sys.setPeriodMul(0.5); // period 10 → 5: 대기 중 카운트다운도 5로 클램프
    tick(sys, 4.6);
    expect(sys.warnLeft).not.toBeNull(); // 5초 주기 기준 잔여 ≤ warnSec(3)
    tick(sys, 0.5 + SWEEP.maxRadius / SWEEP.speed + 0.3); // 파면 통과 완료
    tick(sys, 4.6); // 다음 주기도 5초로 재무장됐다면 예고가 다시 떠야 함
    expect(sys.warnLeft).not.toBeNull();
  });

  it("clear — 낙인·유도탄 정리 + 주기 재무장", () => {
    const { sys, marker } = setup();
    sys.launch(new THREE.Vector3(20, 2, 0), 0, marker, TOMB);
    tick(sys, 2);
    expect(sys.brandCount(0)).toBe(1);
    sys.clear();
    expect(sys.brandCount(0)).toBe(0);
    expect(sys.warnLeft).toBeNull();
  });
});
