import { describe, it, expect } from "vitest";
import { pursueStep } from "../src/enemies/SeedEnemy";

// 플라즈모이드 3D 추적(상하 포함, 지형/물체 무시)의 순수 스텝 가드.

const O = { x: 0, y: 0, z: 0 };
const mag = (a: { x: number; y: number; z: number }, b: typeof O) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("pursueStep — 플레이어 향한 3D 추적 1스텝", () => {
  it("정지거리 밖: speed·dt 만큼 이동(방향 무관 동일 속도)", () => {
    const speed = 10, dt = 0.1; // 1m
    for (const to of [
      { x: 100, y: 0, z: 0 },
      { x: 0, y: 100, z: 0 }, // 수직(상하) 추적
      { x: 0, y: 0, z: 100 },
      { x: 60, y: 60, z: 60 },
    ]) {
      const next = pursueStep(O, to, speed, dt, 2.2);
      expect(mag(next, O)).toBeCloseTo(speed * dt, 6);
    }
  });

  it("이동은 정확히 목표 방향(축 비율 보존)", () => {
    const next = pursueStep(O, { x: 3, y: 4, z: 0 }, 10, 0.5, 2.2); // 거리 5, 5m 전진
    expect(next.x).toBeCloseTo(3, 6);
    expect(next.y).toBeCloseTo(4, 6);
    expect(next.z).toBeCloseTo(0, 6);
  });

  it("정지거리 이내면 움직이지 않음(접촉 교전 거리)", () => {
    const to = { x: 2, y: 0, z: 0 }; // 거리 2 < 2.2
    const next = pursueStep(O, to, 10, 0.1, 2.2);
    expect(next).toEqual(O);
  });

  it("from 을 변경하지 않음(순수)", () => {
    const from = { x: 1, y: 2, z: 3 };
    pursueStep(from, { x: 100, y: 0, z: 0 }, 10, 0.1, 2.2);
    expect(from).toEqual({ x: 1, y: 2, z: 3 });
  });
});
