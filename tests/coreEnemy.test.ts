import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { CoreEnemy, getEnemy } from "../src/enemies/CoreEnemy";

const APP = { maxHp: 100, diameter: 2, color: 0xff3b30 };

describe("CoreEnemy 외형 주입", () => {
  it("appearance → hp/baseScale(=지름/2)/태깅", () => {
    const e = new CoreEnemy(new THREE.Vector3(1, 2, 3), APP, 5);
    expect(e.maxHp).toBe(100);
    expect(e.hp).toBe(100);
    expect(e.group.scale.x).toBeCloseTo(1, 6); // diameter 2 → baseScale 1
    expect(getEnemy(e.hitMesh)).toBe(e); // 레이캐스트 역참조
  });
});

describe("provoked 피격 유발 래치", () => {
  it("기본값 false — 스폰 직후엔 미도발", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    expect(e.provoked).toBe(false);
  });
});

describe("applyFrequencyHit 상태 전이", () => {
  it("체력 차감 → 0 이하면 dissolving, 사망 후 무시", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    expect(e.applyFrequencyHit(40)).toBe(false);
    expect(e.hp).toBe(60);
    expect(e.state).toBe("alive");
    expect(e.applyFrequencyHit(100)).toBe(true); // 치명타
    expect(e.state).toBe("dissolving");
    expect(e.hp).toBe(0);
    expect(e.applyFrequencyHit(10)).toBe(false); // 이미 비활성 → 무시
  });
});

describe("absorbEnergy 자가 회복(접촉 에너지 흡수)", () => {
  it("흡수량만큼 회복하되 maxHp 한도, 사망 후엔 무시", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    e.applyFrequencyHit(40); // hp 60
    e.absorbEnergy(25);
    expect(e.hp).toBe(85);
    e.absorbEnergy(999); // 최대치 클램프
    expect(e.hp).toBe(100);
    e.applyFrequencyHit(100); // dissolving
    e.absorbEnergy(50); // 비활성 → 무시
    expect(e.hp).toBe(0);
  });
});

describe("tryAttack 쿨다운 게이트", () => {
  it("사거리 밖=false, 안=1회 발동 후 쿨다운, 경과 후 재발동", () => {
    const e = new CoreEnemy(new THREE.Vector3(0, 0, 0), APP, 5);
    const near = new THREE.Vector3(0, 0, 0);
    expect(e.tryAttack(new THREE.Vector3(100, 0, 0), 3)).toBe(false); // 밖
    expect(e.tryAttack(near, 3)).toBe(true); // 첫 발동
    expect(e.tryAttack(near, 3)).toBe(false); // 쿨다운
    e.update(1.1, near); // 쿨다운 경과(>1.0s)
    expect(e.tryAttack(near, 3)).toBe(true); // 재발동
  });

  it("cooldown 인자로 간격 분기(드레인 간격) — 기본 1.0s 와 다르게", () => {
    const e = new CoreEnemy(new THREE.Vector3(0, 0, 0), APP, 5);
    const near = new THREE.Vector3(0, 0, 0);
    expect(e.tryAttack(near, 3, 1.5)).toBe(true); // 발동(쿨다운 1.5s)
    e.update(1.1, near); // 1.1s 경과 — 1.5s 미만이라 아직 쿨다운
    expect(e.tryAttack(near, 3, 1.5)).toBe(false);
    e.update(0.5, near); // 누적 1.6s > 1.5s
    expect(e.tryAttack(near, 3, 1.5)).toBe(true); // 재발동
  });
});

describe("grow 흡수=성장(체력↑·크기↑, 상한·사망 게이트)", () => {
  it("흡수량만큼 maxHp·hp 증가(최대치 동반 상승)", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5); // maxHp 100
    e.grow(20);
    expect(e.maxHp).toBe(120);
    expect(e.hp).toBe(120); // 만체 상태에서 성장 → 새 최대치까지
  });
  it("피격 후 성장: hp 는 maxHp 한도로만 회복", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    e.applyFrequencyHit(60); // hp 40 / maxHp 100
    e.grow(20); // maxHp 120, hp 60
    expect(e.maxHp).toBe(120);
    expect(e.hp).toBe(60);
  });
  it("시각 크기는 maxScale(초기 1.5배) 상한", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5); // baseScale 1 → 상한 1.5
    for (let i = 0; i < 50; i++) e.grow(50);
    e.update(0, new THREE.Vector3(0, 0, 0)); // 시각 갱신(만체 → shrink 1)
    expect(e.group.scale.x).toBeLessThanOrEqual(1.5 * 1.07); // 박동(±6%) 여유
  });
  it("사망/비양수 흡수는 무시", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    e.grow(0);
    expect(e.maxHp).toBe(100);
    e.applyFrequencyHit(100); // dissolving
    e.grow(50);
    expect(e.maxHp).toBe(100);
  });
});

describe("카이터(도주형) 거동 — setKiter 후 keepDist 유지", () => {
  const KP = { speed: 10, turnRate: Math.PI, keepDist: 22, keepBand: 5 };
  const steer = { vel: { x: 0, y: 0, z: 0 }, boids: [{ x: 0, y: 0, z: 0, r: 1 }], index: 0 };

  it("setKiter → isKiter true", () => {
    const e = new CoreEnemy(new THREE.Vector3(), APP, 5);
    expect(e.isKiter).toBe(false);
    e.setKiter(KP);
    expect(e.isKiter).toBe(true);
  });
  it("너무 가까우면 플레이어 반대로 도주", () => {
    const e = new CoreEnemy(new THREE.Vector3(0, 0, 0), APP, 5);
    e.setKiter(KP);
    e.update(0.1, new THREE.Vector3(5, 0, 0), 1, steer); // 거리 5 < keepDist-band(17)
    expect(e.group.position.x).toBeLessThan(0); // -x 로 도주
  });
  it("너무 멀면 플레이어 쪽으로 접근", () => {
    const e = new CoreEnemy(new THREE.Vector3(0, 0, 0), APP, 5);
    e.setKiter(KP);
    e.update(0.1, new THREE.Vector3(40, 0, 0), 1, steer); // 거리 40 > keepDist+band(27)
    expect(e.group.position.x).toBeGreaterThan(0); // +x 로 접근
  });
});
