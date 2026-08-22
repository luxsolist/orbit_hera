import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { CoreEnemy } from "../src/enemies/CoreEnemy";
import { BrandSystem, type BrandTarget } from "../src/enemies/BrandSystem";
import { DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";

// 공성 낙인(P3 잔여 — 미션 modifiers.buildingBrands, 06-missions 패턴 17 SIEGE BRAND).
// 마커가 건물/랜드마크에 낙인탄을 쏘고, 심판 파문이 그 낙인을 건물 피해로 전환한다.
// 계약은 플레이어 낙인과 동형(부착 무피해 → 파문 통과 시 피해 → 근원 격파로 소산) — 표적만 string id.

const APP = { maxHp: 100, diameter: 2, color: 0xff3b30 };
const TOMB = DEFAULT_PLASMOID.archetypes.marker.tomb;
const SWEEP = { period: 10, speed: 100, warnSec: 3, maxRadius: 500 };
const anchor = { x: 0, y: 0, z: 0 };

const makePlayerTarget = (): BrandTarget & { worldPosition: THREE.Vector3 } => ({
  worldPosition: new THREE.Vector3(9999, 0, 9999), // 시야 밖 — 이 테스트군의 무관 표적
  isDead: false,
});

/** BuildingCombat 구조 계약을 만족하는 최소 스텁 — targetPos/damage 만. */
function makeBuilding(x = 0, y = 2, z = 0) {
  let alive = true;
  let hp = 50;
  const calls: { amount: number }[] = [];
  return {
    calls,
    kill: () => { alive = false; },
    targetPos(_id: string, out: THREE.Vector3): boolean {
      if (!alive) return false;
      out.set(x, y, z);
      return true;
    },
    damage(_id: string, amount: number): "none" | "hit" | "destroyed" {
      if (!alive) return "none";
      calls.push({ amount });
      hp -= amount;
      if (hp <= 0) { alive = false; return "destroyed"; }
      return "hit";
    },
  };
}

const setup = () => {
  const scene = new THREE.Scene();
  const building = makeBuilding(0, 2, 0);
  const sys = new BrandSystem(scene, [makePlayerTarget()], SWEEP, building);
  const marker = new CoreEnemy(new THREE.Vector3(50, 2, 0), APP, 5);
  return { scene, building, sys, marker };
};

const tick = (sys: BrandSystem, sec: number, dt = 0.05) => {
  for (let t = 0; t < sec - 1e-9; t += dt) sys.update(dt, anchor, 0);
};

describe("buildingsRef 미지정 — 건물 낙인 완전 비활성(하위호환)", () => {
  it("launchBuilding 무동작, 파문이 지나가도 건물 피해 없음", () => {
    const scene = new THREE.Scene();
    const sys = new BrandSystem(scene, [makePlayerTarget()], SWEEP); // buildingsRef 없음
    const marker = new CoreEnemy(new THREE.Vector3(50, 2, 0), APP, 5);
    sys.launchBuilding(new THREE.Vector3(48, 2, 0), "b1", marker, TOMB);
    tick(sys, 12); // 유도탄 명중 + 파문 1주기
    expect(sys.buildingBrandCount("b1")).toBe(0);
  });
});

describe("건물 낙인 — 부착(무피해) → 파문 타격 → 소모", () => {
  it("유도탄 명중까지는 건물 피해 없음(부착만)", () => {
    const { sys, building, marker } = setup();
    sys.launchBuilding(new THREE.Vector3(48, 2, 0), "b1", marker, TOMB);
    tick(sys, 3); // 명중엔 충분, 파문(주기 10s) 전
    expect(sys.buildingBrandCount("b1")).toBe(1);
    expect(building.calls).toHaveLength(0);
  });

  it("파문 통과 시 낙인 수만큼 피해 적용 + 낙인 소모(다음 파문은 무피해)", () => {
    const { sys, building, marker } = setup();
    sys.launchBuilding(new THREE.Vector3(48, 2, 0), "b1", marker, TOMB);
    tick(sys, 3);
    const onHit = vi.fn();
    sys.onBuildingBrandHit = onHit;
    tick(sys, 8); // 파문 도래(period 10s, 진앙 anchor(0,0,0), 파면 속도 100 → 즉시 도달권)
    expect(onHit).toHaveBeenCalledTimes(1);
    expect(onHit.mock.calls[0]).toEqual(["b1", TOMB.sweepDamage, false]);
    expect(building.calls).toHaveLength(1);
    expect(sys.buildingBrandCount("b1")).toBe(0); // 소모
  });

  it("낙인 여럿 누적 시 파문 피해는 합산(brandDamage 동형)", () => {
    const { sys, building, marker } = setup();
    const m2 = new CoreEnemy(new THREE.Vector3(-50, 2, 0), APP, 5);
    sys.launchBuilding(new THREE.Vector3(48, 2, 0), "b1", marker, TOMB);
    sys.launchBuilding(new THREE.Vector3(-48, 2, 0), "b1", m2, TOMB);
    tick(sys, 3);
    expect(sys.buildingBrandCount("b1")).toBe(2);
    tick(sys, 8);
    expect(building.calls[0].amount).toBe(TOMB.sweepDamage * 2);
  });

  it("BRAND_CAP(5) 상한 — 그 이상은 부착 무시", () => {
    const { sys, building, marker } = setup();
    for (let i = 0; i < 7; i++) sys.launchBuilding(new THREE.Vector3(48, 2, 0), "b1", marker, TOMB);
    tick(sys, 3);
    expect(sys.buildingBrandCount("b1")).toBe(5);
    void building;
  });

  it("근원 마커 격파(notifyDead) — 그 마커가 붙인 유도탄·낙인 소산", () => {
    const { sys, marker } = setup();
    sys.launchBuilding(new THREE.Vector3(48, 2, 0), "b1", marker, TOMB);
    tick(sys, 0.1); // 아직 명중 전(유도탄 비행 중)
    sys.notifyDead(marker);
    tick(sys, 5);
    expect(sys.buildingBrandCount("b1")).toBe(0); // 유도탄도 소산됐으니 부착 자체가 없었던 것
  });
});

describe("EnemyManager 통합 — 마커 랜드마크 낙인(modifiers.buildingBrands)", () => {
  it("변조 비활성 시 마커는 건물에 무동작, 활성 시 낙인탄 발사 → 파문 피해까지", async () => {
    const { BuildingCombat } = await import("../src/world/BuildingCombat");
    const { EnemyManager } = await import("../src/enemies/EnemyManager");
    const group = new THREE.Group();
    const bc = new BuildingCombat();
    bc.registerLandmark(group, 40, 0, 30, 10, 10, 500);
    const world = {
      heightAt: () => 0, bounds: 5000, topAt: () => -Infinity, buildings: bc,
      resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
    } as never;
    const player = {
      // 랜드마크 근처(로스터 스폰 중심 = 플레이어 무게중심) — aggro:landmark 라 접근해도 표적 전환 없음.
      worldPosition: new THREE.Vector3(5, 2, 5), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as never;
    const em = new EnemyManager(new THREE.Scene(), world, [player], { ...DEFAULT_PLASMOID, phase: undefined });
    // 변조는 투입(start*) 후 지정 — start* 가 내부적으로 clear() 하며 aggro/buildingBrands 를 리셋한다.
    em.startRoster([{ role: "marker", count: 1, hp: 800 }], 20);
    em.setAggro("landmark");

    // 변조 비활성(기본값) — 오래 돌려도 랜드마크 낙인 없음(마커는 접근만 하고 접촉 공격도 없음)
    for (let i = 0; i < 300; i++) em.update(1 / 30);
    expect(bc.destroyedLandmarks).toBe(0);

    // 활성화 — 부착(장전 텔레그래프 포함) + 파문(주기 30s 기본) 도래까지 충분히 진행
    em.setBuildingBrands(true);
    for (let i = 0; i < 3600; i++) em.update(1 / 30); // 120s(마커 접근·장전·명중 + 파문 1주기)
    expect(em.stats.buildingBrandHits).toBeGreaterThan(0);
  });
});

describe("건물 소거/파괴 중 낙인 처리", () => {
  it("낙인 부착 후 건물이 파괴되면(targetPos false) 조용히 폐기 — 콜백 없음", () => {
    const { sys, building, marker } = setup();
    sys.launchBuilding(new THREE.Vector3(48, 2, 0), "b1", marker, TOMB);
    tick(sys, 3);
    expect(sys.buildingBrandCount("b1")).toBe(1);
    building.kill(); // 다른 수단으로 이미 파괴됨(예: 직접 격추)
    const onHit = vi.fn();
    sys.onBuildingBrandHit = onHit;
    tick(sys, 8);
    expect(onHit).not.toHaveBeenCalled();
    expect(sys.buildingBrandCount("b1")).toBe(0);
  });

  it("유도탄 비행 중 건물이 사라지면(targetPos false) 유도탄도 소산", () => {
    const { sys, building, marker } = setup();
    sys.launchBuilding(new THREE.Vector3(48, 2, 0), "b1", marker, TOMB);
    building.kill();
    tick(sys, 5);
    expect(sys.buildingBrandCount("b1")).toBe(0);
  });

  it("clear() — 건물 낙인/유도탄 전부 정리", () => {
    const { sys, marker } = setup();
    sys.launchBuilding(new THREE.Vector3(48, 2, 0), "b1", marker, TOMB);
    sys.clear();
    tick(sys, 3);
    expect(sys.buildingBrandCount("b1")).toBe(0);
  });
});
