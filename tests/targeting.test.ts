import { describe, it, expect } from "vitest";
import { coneTargets, bestAlignedDir, nearestInCone, nearestVisibleInCone } from "../src/weapons/targeting";

// 에임 어시스트·자동발사·일제사격이 공유하는 콘 조준 선별의 순수 로직 가드.

const O = { x: 0, y: 0, z: 0 };
const FWD = { x: 0, y: 0, z: -1 }; // -Z 정면(게임 좌표계)
const CONE_45 = Math.cos(Math.PI / 4); // 반각 45°

describe("coneTargets — 콘+사거리 선별", () => {
  it("정면 적은 cos≈1, 방향 정규화", () => {
    const r = coneTargets(O, FWD, [{ x: 0, y: 0, z: -10 }], 100, CONE_45);
    expect(r).toHaveLength(1);
    expect(r[0].cos).toBeCloseTo(1, 6);
    expect(r[0].dist).toBeCloseTo(10, 6);
    expect(r[0].dir).toEqual({ x: 0, y: 0, z: -1 });
    expect(r[0].index).toBe(0);
  });
  it("등 뒤(cos≤0)·사거리 밖·콘 밖은 제외", () => {
    const ps = [
      { x: 0, y: 0, z: 10 }, // 등 뒤
      { x: 0, y: 0, z: -500 }, // 사거리 밖
      { x: 10, y: 0, z: 0 }, // 옆(90°, 콘 밖)
      { x: 0, y: 0, z: -10 }, // 정면(유일 유효)
    ];
    const r = coneTargets(O, FWD, ps, 100, CONE_45);
    expect(r.map((t) => t.index)).toEqual([3]);
  });
  it("동일점(dist≈0)은 제외", () => {
    expect(coneTargets(O, FWD, [{ x: 0, y: 0, z: 0 }], 100, CONE_45)).toHaveLength(0);
  });
  it("콘 경계각 안쪽만 포함", () => {
    const inside = { x: 0, y: 5, z: -10 }; // ~26.5° < 45°
    const outside = { x: 0, y: 20, z: -10 }; // ~63° > 45°
    expect(coneTargets(O, FWD, [inside], 100, CONE_45)).toHaveLength(1);
    expect(coneTargets(O, FWD, [outside], 100, CONE_45)).toHaveLength(0);
  });
});

describe("bestAlignedDir — 가장 정렬된 단일 타깃", () => {
  it("가장 정면에 가까운 적 방향 반환", () => {
    const ps = [
      { x: 3, y: 0, z: -10 }, // 약간 비스듬
      { x: 0, y: 0, z: -8 }, // 정면(가장 정렬)
    ];
    const d = bestAlignedDir(O, FWD, ps, 100, CONE_45);
    expect(d).toEqual({ x: 0, y: 0, z: -1 });
  });
  it("후보 없으면 null", () => {
    expect(bestAlignedDir(O, FWD, [{ x: 0, y: 0, z: 10 }], 100, CONE_45)).toBeNull();
  });
});

describe("nearestInCone — 거리순 N개", () => {
  it("거리 오름차순으로 max 개까지", () => {
    const ps = [
      { x: 0, y: 0, z: -30 },
      { x: 0, y: 0, z: -10 },
      { x: 0, y: 0, z: -20 },
    ];
    const r = nearestInCone(O, FWD, ps, 100, CONE_45, 2);
    expect(r.map((t) => t.index)).toEqual([1, 2]); // 10m, 20m
  });
  it("콘 밖은 개수에 포함되지 않음", () => {
    const ps = [
      { x: 0, y: 0, z: -10 },
      { x: 10, y: 0, z: 0 }, // 콘 밖
    ];
    expect(nearestInCone(O, FWD, ps, 100, CONE_45, 5)).toHaveLength(1);
  });
});

describe("nearestVisibleInCone — 시야 확보된 최근접(자동발사 건물 차폐)", () => {
  const ALL_VISIBLE = () => false; // 아무도 안 가림
  const FWD360 = -1; // coneCos=-1 = 360°

  it("아무도 안 가리면 최근접 적 반환", () => {
    const ps = [
      { x: 0, y: 0, z: -30 },
      { x: 0, y: 0, z: -10 }, // 최근접
      { x: 0, y: 0, z: -20 },
    ];
    const t = nearestVisibleInCone(O, FWD, ps, 100, CONE_45, ALL_VISIBLE);
    expect(t?.index).toBe(1);
  });

  it("최근접이 건물에 가리면 그 다음으로 가까운 시야 확보 적 선택", () => {
    const ps = [
      { x: 0, y: 0, z: -10 }, // 최근접이지만 가림
      { x: 0, y: 0, z: -20 }, // 시야 확보
      { x: 0, y: 0, z: -30 },
    ];
    const t = nearestVisibleInCone(O, FWD, ps, 100, CONE_45, (i) => i === 0);
    expect(t?.index).toBe(1);
  });

  it("모두 가리면 null (자동발사 안 함)", () => {
    const ps = [
      { x: 0, y: 0, z: -10 },
      { x: 0, y: 0, z: -20 },
    ];
    expect(nearestVisibleInCone(O, FWD, ps, 100, CONE_45, () => true)).toBeNull();
  });

  it("coneCos=-1(넓은 콘): 좁은 콘 밖의 비스듬한 적도 후보, 가까운 가린 적은 건너뜀", () => {
    const ps = [
      { x: 0, y: 0, z: -8 },    // 정면 8m, 가림
      { x: 17, y: 0, z: -10 },  // ~60° 비스듬(cos≈0.51, CONE_45 밖이나 coneCos=-1 안), 시야 확보
    ];
    const t = nearestVisibleInCone(O, FWD, ps, 100, FWD360, (i) => i === 0);
    expect(t?.index).toBe(1);
  });

  it("사거리 밖 적은 가림 여부와 무관하게 제외", () => {
    const ps = [{ x: 0, y: 0, z: -500 }]; // 사거리 100 밖
    expect(nearestVisibleInCone(O, FWD, ps, 100, FWD360, ALL_VISIBLE)).toBeNull();
  });
});
