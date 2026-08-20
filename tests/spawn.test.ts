import { describe, it, expect } from "vitest";
import { spawnHeightAboveGround } from "../src/player/PlayerController";
import { archetypeCount, pickSpawnType, DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";
import type { WalkMove, FlyMove } from "../src/player/DroneSpec";

// 스폰 로직 — 드론 시작 높이 + 인원/웨이브별 물량 + 구성 비례 아키타입(MP) 순수 함수 가드.

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

describe("archetypeCount — 아키타입별 웨이브·인원 비례 물량", () => {
  const rusher = DEFAULT_PLASMOID.archetypes.rusher; // 거머리: countBase 6, cap 12
  const kiter = DEFAULT_PLASMOID.archetypes.kiter; // 모기: countBase 3, cap 5
  it("웨이브1·매칭 1인 = countBase (거머리>모기)", () => {
    expect(archetypeCount(rusher, 1, 1)).toBe(6);
    expect(archetypeCount(kiter, 1, 1)).toBe(3);
  });
  it("2웨이브당 +1", () => {
    expect(archetypeCount(rusher, 3, 1)).toBe(7);
    expect(archetypeCount(kiter, 5, 1)).toBe(5);
  });
  it("countCap 상한", () => {
    expect(archetypeCount(rusher, 99, 1)).toBe(12);
    expect(archetypeCount(kiter, 99, 1)).toBe(5);
  });
  it("매칭 드론 수 비례(×N)", () => expect(archetypeCount(rusher, 1, 3)).toBe(18));
  it("매칭 드론 0이면 0 (자기정렬 — 단일 구성은 자기 타입만)", () => {
    expect(archetypeCount(rusher, 5, 0)).toBe(0);
    expect(archetypeCount(kiter, 5, 0)).toBe(0);
  });
});

describe("pickSpawnType — 잔여 예산 비율 가중 추첨(러셔/카이터/마커)", () => {
  it("한 종만 남으면 그 종(난수 무관)", () => {
    expect(pickSpawnType(6, 0, 0, () => 0.0)).toBe("rusher");
    expect(pickSpawnType(6, 0, 0, () => 0.99)).toBe("rusher");
    expect(pickSpawnType(0, 3, 0, () => 0.0)).toBe("kiter");
    expect(pickSpawnType(0, 0, 2, () => 0.0)).toBe("marker");
    expect(pickSpawnType(0, 0, 2, () => 0.99)).toBe("marker");
  });
  it("여럿 남으면 잔여 비율로 분기", () => {
    // 잔여 [3,1,0] → total 4: rand·4<3 이면 러셔
    expect(pickSpawnType(3, 1, 0, () => 0.1)).toBe("rusher"); // 0.4 < 3
    expect(pickSpawnType(3, 1, 0, () => 0.99)).toBe("kiter"); // 3.96 ≥ 3
    // 잔여 [2,1,1] → total 4: 구간 [0,2)=러셔 [2,3)=카이터 [3,4)=마커
    expect(pickSpawnType(2, 1, 1, () => 0.49)).toBe("rusher"); // 1.96
    expect(pickSpawnType(2, 1, 1, () => 0.6)).toBe("kiter"); // 2.4
    expect(pickSpawnType(2, 1, 1, () => 0.8)).toBe("marker"); // 3.2
  });
  it("예산 0 인 종은 배제(중간 종이 0 이어도 경계 안전)", () => {
    expect(pickSpawnType(2, 0, 2, () => 0.5)).toBe("marker"); // 2.0 ≥ 2(러셔 구간 밖) → 마커
    expect(pickSpawnType(2, 0, 2, () => 0.49)).toBe("rusher");
  });
  it("전부 0이면 null", () => expect(pickSpawnType(0, 0, 0, () => 0.5)).toBeNull());
});
