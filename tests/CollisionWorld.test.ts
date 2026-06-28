import { describe, it, expect } from "vitest";
import { CollisionWorld } from "../src/world/CollisionWorld";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe("CollisionWorld — circles", () => {
  it("pushes a circle-overlapping point out to the surface", () => {
    const c = new CollisionWorld();
    c.addCircle(0, 0, 5, 10);
    c.finalize();
    const r = c.resolveCollision(3, 0, 1, 0); // min = 5 + 1, +x 방향
    expect(near(r.x, 6)).toBe(true);
    expect(near(r.z, 0)).toBe(true);
  });

  it("lets the point pass when its feet are at/above the top (step-on)", () => {
    const c = new CollisionWorld();
    c.addCircle(0, 0, 5, 10);
    c.finalize();
    const r = c.resolveCollision(3, 0, 1, 10);
    expect(near(r.x, 3)).toBe(true);
  });

  it("topAt returns the circle top inside its radius, else -Infinity", () => {
    const c = new CollisionWorld();
    c.addCircle(0, 0, 5, 10);
    c.finalize();
    expect(c.topAt(0, 0)).toBe(10);
    expect(c.topAt(100, 0)).toBe(-Infinity);
  });
});

describe("CollisionWorld — AABB box (grid broadphase)", () => {
  it("pushes an interior point to the nearest edge + radius", () => {
    const c = new CollisionWorld();
    c.addAabbBox(-2, 2, -2, 2);
    c.finalize();
    const r = c.resolveCollision(1, 0, 1, 0); // 가장 가까운 변 x=2
    expect(near(r.x, 3)).toBe(true); // 2 + radius 1
    expect(near(r.z, 0)).toBe(true);
  });

  it("leaves a far point untouched", () => {
    const c = new CollisionWorld();
    c.addAabbBox(-2, 2, -2, 2);
    c.finalize();
    const r = c.resolveCollision(20, 20, 1, 0);
    expect(near(r.x, 20)).toBe(true);
    expect(near(r.z, 20)).toBe(true);
  });

  it("finds a long box spanning many grid cells (broadphase 정확성)", () => {
    const c = new CollisionWorld();
    c.addAabbBox(-100, 100, -1, 1); // 길고 큰 박스 → 여러 셀
    c.finalize();
    const r = c.resolveCollision(0, 0, 1, 0);
    expect(Math.abs(r.z)).toBeGreaterThan(1); // 박스 밖으로 밀려남
  });
});

describe("CollisionWorld — walls (step-on)", () => {
  it("blocks below the top but passes at/above the top", () => {
    const c = new CollisionWorld();
    c.addWallBox(-2, 2, -2, 2, 4);
    c.finalize();
    expect(near(c.resolveCollision(1, 0, 1, 0).x, 3)).toBe(true); // 발 낮음 → 막힘
    expect(near(c.resolveCollision(1, 0, 1, 4).x, 1)).toBe(true); // 발 윗면 이상 → 통과
  });
});

describe("CollisionWorld — footprint OBB vs concave triangles", () => {
  it("a convex square footprint blocks an interior point", () => {
    const c = new CollisionWorld();
    c.addFootprintBox([-2, -2, 2, -2, 2, 2, -2, 2], 0, 10);
    c.finalize();
    const r = c.resolveCollision(0.5, 0, 1, 0);
    expect(Math.hypot(r.x - 0.5, r.z - 0)).toBeGreaterThan(0.5); // 밖으로 밀림
  });

  it("a concave L footprint blocks the solid arm but not the empty notch", () => {
    const c = new CollisionWorld();
    // L: 좌측 세로바 + 하단 가로바. 우상단(x>2, z>2)은 폴리곤 밖(빈 노치).
    c.addFootprintBox([0, 0, 6, 0, 6, 2, 2, 2, 2, 6, 0, 6], 0, 10);
    c.finalize();
    const solid = c.resolveCollision(1, 1, 0.5, 0); // 솔리드 내부 → 밀림
    expect(Math.hypot(solid.x - 1, solid.z - 1)).toBeGreaterThan(0);
    const notch = c.resolveCollision(4, 4, 0.5, 0); // 빈 노치 → 통과
    expect(near(notch.x, 4)).toBe(true);
    expect(near(notch.z, 4)).toBe(true);
  });

  it("resolveCollision is a no-op before finalize() (격자 미구축 계약)", () => {
    const c = new CollisionWorld();
    c.addAabbBox(-2, 2, -2, 2);
    const r = c.resolveCollision(0, 0, 1, 0); // finalize 안 함 → 충돌 없음
    expect(near(r.x, 0)).toBe(true);
    expect(near(r.z, 0)).toBe(true);
  });
});

describe("CollisionWorld — building roof (step-on)", () => {
  it("blocks below the roof top but passes/stands at or above it", () => {
    const c = new CollisionWorld();
    c.addFootprintBox([-3, -3, 3, -3, 3, 3, -3, 3], 0, 12); // 옥상 높이 12
    c.finalize();
    const low = c.resolveCollision(0, 0, 1, 0); // 발 낮음 → 막힘
    expect(Math.hypot(low.x, low.z)).toBeGreaterThan(0.5);
    const high = c.resolveCollision(0, 0, 1, 12); // 발 옥상 이상 → 통과(올라서기)
    expect(near(high.x, 0)).toBe(true);
    expect(near(high.z, 0)).toBe(true);
    expect(c.topAt(0, 0)).toBe(12); // 옥상 위면 디딤
    expect(c.topAt(100, 0)).toBe(-Infinity);
  });

  it("a concave (triangulated) building roof is standable via topAt", () => {
    const c = new CollisionWorld();
    c.addFootprintBox([0, 0, 6, 0, 6, 2, 2, 2, 2, 6, 0, 6], 0, 9); // L자 → 삼각 콜라이더
    c.finalize();
    expect(c.topAt(1, 1)).toBe(9); // 솔리드 팔 위
    expect(c.topAt(4, 4)).toBe(-Infinity); // 빈 노치
  });
});

describe("CollisionWorld — segmentBlocked (빔/드레인 건물 시야 차폐)", () => {
  it("OBB 건물(옥상 높이 12)을 가로지르는 낮은 빔은 막힌다(t∈[0,1])", () => {
    const c = new CollisionWorld();
    c.addFootprintBox([-3, -3, 3, -3, 3, 3, -3, 3], 0, 12); // [-3,3]² 옥상 12
    c.finalize();
    // (-10,2)→(10,2) 건물 한가운데 통과, 높이 2 < 옥상 12 → 차폐
    const t = c.segmentBlocked(-10, 2, 0, 10, 2, 0);
    expect(t).toBeLessThanOrEqual(1);
    expect(t).toBeGreaterThan(0);
    // 진입 지점 ≈ x=-3 → 전체 20m 중 7m → t≈0.35
    expect(t).toBeCloseTo(0.35, 2);
  });

  it("옥상(top) 위로 지나가는 빔은 통과(Infinity)", () => {
    const c = new CollisionWorld();
    c.addFootprintBox([-3, -3, 3, -3, 3, 3, -3, 3], 0, 12);
    c.finalize();
    expect(c.segmentBlocked(-10, 20, 0, 10, 20, 0)).toBe(Infinity); // y=20 > 옥상 12
  });

  it("건물 footprint 를 벗어난 빔은 통과(Infinity)", () => {
    const c = new CollisionWorld();
    c.addFootprintBox([-3, -3, 3, -3, 3, 3, -3, 3], 0, 12);
    c.finalize();
    expect(c.segmentBlocked(-10, 2, 50, 10, 2, 50)).toBe(Infinity); // z=50 footprint 밖
  });

  it("파괴되어 개방된(openBuildingAt) 건물은 차폐하지 않는다", () => {
    const c = new CollisionWorld();
    c.addFootprintBox([-3, -3, 3, -3, 3, 3, -3, 3], 0, 12);
    c.finalize();
    expect(c.segmentBlocked(-10, 2, 0, 10, 2, 0)).toBeLessThanOrEqual(1); // 파괴 전 막힘
    c.openBuildingAt(0, 0); // 잔해 위 통과 개방(top=-Infinity)
    expect(c.segmentBlocked(-10, 2, 0, 10, 2, 0)).toBe(Infinity); // 이제 통과
  });

  it("바위(원기둥) 도 낮은 빔을 막는다", () => {
    const c = new CollisionWorld();
    c.addCircle(0, 0, 5, 10);
    c.finalize();
    expect(c.segmentBlocked(-20, 2, 0, 20, 2, 0)).toBeLessThanOrEqual(1); // 반경 5 관통
    expect(c.segmentBlocked(-20, 15, 0, 20, 15, 0)).toBe(Infinity); // 윗면 10 위로
  });

  it("오목(L자) 건물 — 솔리드 팔은 막고 빈 노치만 지나는 빔은 통과", () => {
    const c = new CollisionWorld();
    c.addFootprintBox([0, 0, 6, 0, 6, 2, 2, 2, 2, 6, 0, 6], 0, 9); // L자 → 삼각 콜라이더
    c.finalize();
    expect(c.segmentBlocked(-5, 2, 1, 11, 2, 1)).toBeLessThanOrEqual(1); // 바닥 팔(z=1) 관통 → 막힘
    expect(c.segmentBlocked(3, 2, 4, 5, 2, 4)).toBe(Infinity); // 빈 노치(x2~6,z2~6) 안만 지남
  });

  it("담장(addWallBox) 도 낮은 빔을 막고 윗면 위로는 통과", () => {
    const c = new CollisionWorld();
    c.addWallBox(-1, 1, -10, 10, 5); // x[-1,1], z[-10,10], 윗면 5
    c.finalize();
    expect(c.segmentBlocked(-10, 2, 0, 10, 2, 0)).toBeLessThanOrEqual(1); // y2 < 5 → 막힘
    expect(c.segmentBlocked(-10, 8, 0, 10, 8, 0)).toBe(Infinity); // y8 > 5 → 통과
  });

  it("진입 시 옥상 위였다가 footprint 내부에서 옥상 아래로 내려오는 하강 빔은 막힌다", () => {
    const c = new CollisionWorld();
    c.addAabbBox(-3, 3, -3, 3, 10); // 옥상 10
    c.finalize();
    // (-3,20)→(3,0): 진입 y≈20>10, 내부 하강해 옥상 10 아래로 교차(t=0.5)
    expect(c.segmentBlocked(-3, 20, 0, 3, 0, 0)).toBeCloseTo(0.5, 5);
  });

  it("건물 내부(옥상 아래)에서 출발하는 빔은 즉시 막힘(t≈0)", () => {
    const c = new CollisionWorld();
    c.addAabbBox(-3, 3, -3, 3, 10);
    c.finalize();
    expect(c.segmentBlocked(0, 2, 0, 50, 2, 0)).toBeCloseTo(0, 6);
  });

  it("막힘 없으면 Infinity (빈 세계)", () => {
    const c = new CollisionWorld();
    c.finalize();
    expect(c.segmentBlocked(-10, 2, 0, 10, 2, 0)).toBe(Infinity);
  });
});
