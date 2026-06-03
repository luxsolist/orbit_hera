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
