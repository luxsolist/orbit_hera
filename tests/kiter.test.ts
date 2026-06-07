import { describe, it, expect } from "vitest";
import { turnToward, kiterVelocity, stickyMinIndex, chooseTarget, type Boid, type KiterParams } from "../src/enemies/SeedEnemy";

// 도주형(카이터) 조향 순수 함수 가드 — keepDist 유지(도주/접근/선회) + 선회속도 캡 + 동시 개체수.

const O = { x: 0, y: 0, z: 0 };
const solo: Boid[] = [{ x: 0, y: 0, z: 0, r: 1 }];
const P: KiterParams = { speed: 10, turnRate: Math.PI, keepDist: 22, keepBand: 5 };

describe("turnToward — 속도벡터 선회 캡(구면보간)", () => {
  it("정지(cur=0)면 즉시 목표 방향(크기는 desired 크기)", () => {
    const v = turnToward(O, { x: 0, y: 0, z: 6 }, 0.1);
    expect(v.z).toBeCloseTo(6, 6);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(6, 6);
  });
  it("선회 한계 안이면 목표 방향 그대로", () => {
    const v = turnToward({ x: 10, y: 0, z: 0 }, { x: 9, y: 1, z: 0 }, Math.PI); // 큰 한계
    expect(v.x).toBeCloseTo(9, 6);
    expect(v.y).toBeCloseTo(1, 6);
  });
  it("한계를 넘으면 maxRad 만큼만 회전(각도 = maxRad, 크기 보존)", () => {
    const cur = { x: 10, y: 0, z: 0 }; // +x
    const des = { x: 0, y: 0, z: 10 }; // +z (90°)
    const v = turnToward(cur, des, Math.PI / 4); // 45°만 회전
    const ang = Math.acos((cur.x * v.x + cur.z * v.z) / (10 * Math.hypot(v.x, v.y, v.z)));
    expect(ang).toBeCloseTo(Math.PI / 4, 5);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(10, 5); // desired 크기 보존
  });
  it("정반대(antipodal)도 NaN 없이 스냅", () => {
    const v = turnToward({ x: 10, y: 0, z: 0 }, { x: -10, y: 0, z: 0 }, Math.PI / 4);
    expect(Number.isNaN(v.x)).toBe(false);
    expect(v.x).toBeCloseTo(-10, 6);
  });
});

describe("kiterVelocity — keepDist 유지 거동", () => {
  // O 를 targetVel(플레이어 정지)·curVel(초기)로 재사용 — 선회 회피는 별도 describe 에서 검증.
  it("너무 가까우면 플레이어 반대로 도주", () => {
    // 플레이어 +x 10m(= keepDist-band 17 미만) → -x 도주
    const v = kiterVelocity(O, { x: 10, y: 0, z: 0 }, O, O, P, 1, solo, 0, 2, 0.7);
    expect(v.x).toBeLessThan(0);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(10, 5);
  });
  it("너무 멀면 다가와서 사거리 진입(strafeMix 무관 — 양쪽 다 접근)", () => {
    // 플레이어 +x 40m(= keepDist+band 27 초과) → +x 접근
    expect(kiterVelocity(O, { x: 40, y: 0, z: 0 }, O, O, P, 1, solo, 0, 2, 0.7).x).toBeGreaterThan(0);
    const runner: KiterParams = { ...P, strafeMix: 0 };
    expect(kiterVelocity(O, { x: 40, y: 0, z: 0 }, O, O, runner, 1, solo, 0, 2, 0.7).x).toBeGreaterThan(0);
  });
  it("밴드 내 strafeMix=1(워커) → 접선 선회(반경 성분 거의 0)", () => {
    // 거리 22 = keepDist → 선회 스트레이프. 반경(+x) 성분 미미, 접선(z) 우세.
    const v = kiterVelocity(O, { x: 22, y: 0, z: 0 }, O, O, P, 1, solo, 0, 2, 0.7);
    expect(Math.abs(v.x)).toBeLessThan(Math.abs(v.z));
  });
  it("밴드 내 strafeMix=0(플라이어) → 플레이어 반대로 도주(전진 유도)", () => {
    // 같은 적정거리라도 도주형은 반경 방향(-x)으로 계속 멀어져 플레이어가 쫓아오게 함.
    const runner: KiterParams = { ...P, strafeMix: 0 };
    const v = kiterVelocity(O, { x: 22, y: 0, z: 0 }, O, O, runner, 1, solo, 0, 2, 0.7);
    expect(v.x).toBeLessThan(0); // -x 도주(반경)
    expect(Math.abs(v.z)).toBeLessThan(Math.abs(v.x)); // 접선 성분은 미미
  });
  it("합성 속도는 speed 로 클램프", () => {
    const v = kiterVelocity(O, { x: 5, y: 0, z: 0 }, O, O, P, 1, solo, 0, 2, 0.7);
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(10 + 1e-6);
  });
});

describe("kiterVelocity — 선회(원돌기) 수직 회피", () => {
  it("플레이어가 접선 이동(선회)하면 궤도 평면을 벗어나 상승", () => {
    const evader: KiterParams = { ...P, evadeGain: 1, orbitRef: 10 };
    // 플레이어 +x 22m, 속도 +z(시선 +x 에 수직 = 선회) → 궤도면 법선(수직 +y)으로 탈출.
    const v = kiterVelocity(O, { x: 22, y: 0, z: 0 }, { x: 0, y: 0, z: 20 }, O, evader, 1, solo, 0, 2, 0.7);
    expect(v.y).toBeGreaterThan(0);
  });
  it("플레이어가 정지면 회피 없음(수직 성분 0)", () => {
    const evader: KiterParams = { ...P, evadeGain: 1, orbitRef: 10 };
    const v = kiterVelocity(O, { x: 22, y: 0, z: 0 }, O, O, evader, 1, solo, 0, 2, 0.7);
    expect(Math.abs(v.y)).toBeLessThan(1e-6);
  });
  it("evadeGain=0(워커)이면 선회해도 수직 회피 없음", () => {
    const v = kiterVelocity(O, { x: 22, y: 0, z: 0 }, { x: 0, y: 0, z: 20 }, O, P, 1, solo, 0, 2, 0.7);
    expect(Math.abs(v.y)).toBeLessThan(1e-6);
  });
});

describe("stickyMinIndex — 멀티타깃 최근접 선택(히스테리시스)", () => {
  it("현재 표적 없으면(-1) 최소 점수 인덱스", () => {
    expect(stickyMinIndex([30, 10, 20], -1, 1.2)).toBe(1);
  });
  it("현재 표적이 최소의 hysteresis 배 이내면 유지(깜빡임 방지)", () => {
    // 현재 idx0(11) vs 최소 idx1(10) → 11 ≤ 10*1.2(12) → 유지
    expect(stickyMinIndex([11, 10], 0, 1.2)).toBe(0);
  });
  it("현재 표적이 충분히 멀어지면 교체", () => {
    // 현재 idx0(15) > 10*1.2(12) → 최소 idx1 로 교체
    expect(stickyMinIndex([15, 10], 0, 1.2)).toBe(1);
  });
  it("Infinity(사망/부재) 표적은 선택 안 됨", () => {
    expect(stickyMinIndex([Infinity, 10, Infinity], -1, 1.2)).toBe(1);
  });
  it("빈 배열은 -1", () => expect(stickyMinIndex([], -1, 1.2)).toBe(-1));
});

describe("chooseTarget — 거리 + 어그로 분산 표적 선택", () => {
  const scratch = () => [] as number[];
  it("부하 0 이면 최근접", () => {
    expect(chooseTarget([30, 10, 20], [0, 0, 0], -1, 0.4, 1.2, scratch())).toBe(1);
  });
  it("어그로 분산 — 동거리면 덜 추적된 표적", () => {
    // 거리 동일(10), 부하 [1,0] → 점수 [14,10] → idx1
    expect(chooseTarget([10, 10], [1, 0], -1, 0.4, 1.2, scratch())).toBe(1);
  });
  it("부하가 크면 더 가까운 표적도 회피(몰빵 방지)", () => {
    // 거리 [10,12], 부하 [2,0] → 점수 [18,12] → 더 먼 idx1 선택
    expect(chooseTarget([10, 12], [2, 0], -1, 0.4, 1.2, scratch())).toBe(1);
  });
  it("히스테리시스로 현재 표적 유지", () => {
    expect(chooseTarget([11, 10], [0, 0], 0, 0.4, 1.2, scratch())).toBe(0);
  });
  it("Infinity(사망/부재) 표적 제외, 전부 무효면 -1", () => {
    expect(chooseTarget([Infinity, 10], [0, 0], -1, 0.4, 1.2, scratch())).toBe(1);
    expect(chooseTarget([Infinity, Infinity], [0, 0], -1, 0.4, 1.2, scratch())).toBe(-1);
  });
});
