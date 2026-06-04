import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { muzzleFrom, beamEnd, sideVector, emitterDamage } from "../src/weapons/beamFx";
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
