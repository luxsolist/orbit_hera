import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SeedEnemy, getEnemy } from "../src/enemies/SeedEnemy";

const APP = { maxHp: 100, diameter: 2, color: 0xff3b30 };

describe("SeedEnemy 외형 주입", () => {
  it("appearance → hp/baseScale(=지름/2)/태깅", () => {
    const e = new SeedEnemy(new THREE.Vector3(1, 2, 3), APP, 5);
    expect(e.maxHp).toBe(100);
    expect(e.hp).toBe(100);
    expect(e.group.scale.x).toBeCloseTo(1, 6); // diameter 2 → baseScale 1
    expect(getEnemy(e.hitMesh)).toBe(e); // 레이캐스트 역참조
  });
});

describe("applyFrequencyHit 상태 전이", () => {
  it("체력 차감 → 0 이하면 dissolving, 사망 후 무시", () => {
    const e = new SeedEnemy(new THREE.Vector3(), APP, 5);
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
    const e = new SeedEnemy(new THREE.Vector3(), APP, 5);
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
    const e = new SeedEnemy(new THREE.Vector3(0, 0, 0), APP, 5);
    const near = new THREE.Vector3(0, 0, 0);
    expect(e.tryAttack(new THREE.Vector3(100, 0, 0), 3)).toBe(false); // 밖
    expect(e.tryAttack(near, 3)).toBe(true); // 첫 발동
    expect(e.tryAttack(near, 3)).toBe(false); // 쿨다운
    e.update(1.1, near); // 쿨다운 경과(>1.0s)
    expect(e.tryAttack(near, 3)).toBe(true); // 재발동
  });
});
