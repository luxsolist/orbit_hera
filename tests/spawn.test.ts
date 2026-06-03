import { describe, it, expect } from "vitest";
import { spawnHeightAboveGround } from "../src/player/PlayerController";
import { spawnAltitude, SPAWN_CEILING, SPAWN_BIAS } from "../src/enemies/EnemyManager";
import type { WalkMove, FlyMove } from "../src/player/DroneSpec";

// 최근 추가한 스폰 고도 로직(비행 드론 공중 투입 · 적 지면 편향 스폰)의 순수 함수 가드.

const WALK: WalkMove = {
  mode: "walk",
  speed: 16.7,
  groundAccel: 1,
  airAccel: 1,
  jump: { velocity: 28, riseGravity: 55, fallGravity: 50, fallTerminal: 25.5, maxRiseHeight: 100, coyoteTime: 0.1 },
};
const FLY: FlyMove = { mode: "fly", speed: 83, accel: 9, verticalSpeed: 26, ceiling: 140, rollDeg: 16, spawnHeight: 100 };

describe("spawnHeightAboveGround — 스폰 시 지면 대비 시작 높이", () => {
  it("보행: 시점 높이(eye)로 지면에 디딤", () => {
    expect(spawnHeightAboveGround(WALK, 1.7)).toBe(1.7);
  });
  it("비행: spawnHeight(공중 투입)", () => {
    expect(spawnHeightAboveGround(FLY, 2)).toBe(100);
  });
  it("비행: spawnHeight 가 천장 초과 시 ceiling 으로 클램프", () => {
    expect(spawnHeightAboveGround({ ...FLY, spawnHeight: 999 }, 2)).toBe(140);
  });
});

describe("spawnAltitude — 적 지면 편향 공중 스폰 고도", () => {
  it("경계: u=0 → 0, u=1 → SPAWN_CEILING", () => {
    expect(spawnAltitude(0)).toBe(0);
    expect(spawnAltitude(1)).toBeCloseTo(SPAWN_CEILING, 9);
  });
  it("범위: 모든 u∈[0,1) 에서 0 ≤ 고도 < SPAWN_CEILING", () => {
    for (let u = 0; u < 1; u += 0.05) {
      const a = spawnAltitude(u);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(SPAWN_CEILING);
    }
  });
  it("단조 증가", () => {
    let prev = -1;
    for (let u = 0; u <= 1; u += 0.05) {
      const a = spawnAltitude(u);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
  it("지상 편향: 중앙값(u=0.5) 이 고도 중점보다 한참 아래", () => {
    expect(SPAWN_BIAS).toBeGreaterThan(1); // 편향 전제
    expect(spawnAltitude(0.5)).toBeLessThan(SPAWN_CEILING / 2);
  });
});
