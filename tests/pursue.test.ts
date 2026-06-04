import { describe, it, expect } from "vitest";
import { pursueStep, interceptPoint, separationVector, steerVelocity, type Boid } from "../src/enemies/SeedEnemy";

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

describe("interceptPoint — 예측 요격 조준점(원돌기 가로채기)", () => {
  it("정지 표적(속도 0)이면 표적 위치 그대로", () => {
    const aim = interceptPoint({ x: 50, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, O, 10, 1);
    expect(aim).toEqual({ x: 50, y: 0, z: 0 });
  });
  it("움직이는 표적이면 진행 방향으로 리드(미래 위치)", () => {
    // 거리 10, speed 10 → lead = min(1, 10/10)=1s. 표적 +z로 5m/s → +5 리드.
    const aim = interceptPoint({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 5 }, O, 10, 1);
    expect(aim.z).toBeCloseTo(15, 6);
  });
  it("maxLead 로 리드 시간 상한(먼 거리에서 과조준 방지)", () => {
    // 거리 100, speed 10 → 원래 10s지만 maxLead 1 로 클램프 → 리드 5m
    const aim = interceptPoint({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 5 }, O, 10, 1);
    expect(aim.z).toBeCloseTo(105, 6);
  });
});

describe("separationVector — 동료 밀어내기(한 점 뭉침 방지)", () => {
  const boids: Boid[] = [
    { x: 0, y: 0, z: 0, r: 1 },
    { x: 2, y: 0, z: 0, r: 1 }, // 0번과 반경합(2)+margin 안에서 겹침
  ];
  it("가까운 동료로부터 반대 방향으로 밀림", () => {
    const s = separationVector(boids, 0, 2); // reach=1+1+2=4 > dist 2 → 밀림
    expect(s.x).toBeLessThan(0); // 1번(+x)에서 멀어지는 -x
    expect(s.y).toBe(0);
    expect(s.z).toBe(0);
  });
  it("자기 자신은 제외(index 스킵)", () => {
    const lone: Boid[] = [{ x: 0, y: 0, z: 0, r: 1 }];
    expect(separationVector(lone, 0, 2)).toEqual({ x: 0, y: 0, z: 0 });
  });
  it("reach 밖 동료는 무시", () => {
    const far: Boid[] = [{ x: 0, y: 0, z: 0, r: 0.5 }, { x: 100, y: 0, z: 0, r: 0.5 }];
    expect(separationVector(far, 0, 1)).toEqual({ x: 0, y: 0, z: 0 });
  });
  it("완전 중첩(같은 위치)도 결정적으로 분리(NaN 없음)", () => {
    const stacked: Boid[] = [{ x: 5, y: 5, z: 5, r: 1 }, { x: 5, y: 5, z: 5, r: 1 }];
    const s = separationVector(stacked, 0, 2);
    expect(Number.isNaN(s.x)).toBe(false);
    expect(s.x).toBeGreaterThan(0);
  });
});

describe("steerVelocity — 추격+분리 합성(speed 클램프)", () => {
  const solo: Boid[] = [{ x: 0, y: 0, z: 0, r: 1 }];
  it("동료 없으면 순수 추격(목표 방향 speed)", () => {
    const v = steerVelocity(O, { x: 0, y: 0, z: 100 }, 10, 2.2, solo, 0, 2, 0.7);
    expect(v.z).toBeCloseTo(10, 6);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(10, 6);
  });
  it("stopDist 이내면 추격 성분 0(접촉 교전)", () => {
    const v = steerVelocity(O, { x: 0, y: 0, z: 2 }, 10, 2.2, solo, 0, 2, 0.7);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(0, 6);
  });
  it("정지거리 이내라도 동료가 겹치면 분리로 움직임(링 형성)", () => {
    const pair: Boid[] = [{ x: 0, y: 0, z: 0, r: 1 }, { x: 1, y: 0, z: 0, r: 1 }];
    const v = steerVelocity(O, { x: 0, y: 0, z: 1 }, 10, 2.2, pair, 0, 2, 0.7); // 목표 1m(정지권) 이내
    expect(v.x).toBeLessThan(0); // 동료(+x)에서 밀려 -x로 이동
  });
  it("합성 속도는 speed 로 클램프(분리가 강해도 초과 금지)", () => {
    const crowd: Boid[] = [
      { x: 0, y: 0, z: 0, r: 1 },
      { x: 0.1, y: 0, z: 0, r: 1 },
      { x: -0.1, y: 0, z: 0, r: 1 },
      { x: 0, y: 0.1, z: 0, r: 1 },
    ];
    const v = steerVelocity(O, { x: 0, y: 0, z: 100 }, 10, 2.2, crowd, 0, 2, 5);
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(10 + 1e-6);
  });
});
