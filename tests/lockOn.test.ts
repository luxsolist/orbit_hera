import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  lockOnWishH, lockOnVerticalTarget, bestAlignedInCone, flyMoveDir,
  LOCK_FOLLOW_DIST, LOCK_BAND, LOCK_VERTICAL_DEAD,
} from "../src/player/PlayerController";

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────
const mag2 = (v: { x: number; z: number }) => Math.hypot(v.x, v.z);
const O = { x: 0, y: 0, z: 0 };
const FWD = { x: 0, y: 0, z: -1 }; // 정면 -z

// ─────────────────────────────────────────────────────────────────────────────
describe("lockOnWishH — 락온 수평 추적 방향", () => {
  // 플레이어 원점(0,0), 대상이 +z 방향

  it("대상이 followDist + band 초과 → 접근 방향 단위벡터", () => {
    const far = LOCK_FOLLOW_DIST + LOCK_BAND + 1; // 59m
    const w = lockOnWishH(0, 0, 0, far);
    expect(w.z).toBeGreaterThan(0);    // +z 방향 접근
    expect(mag2(w)).toBeCloseTo(1, 5); // 단위벡터
  });

  it("대상이 followDist - band 미만 → 후퇴 방향 단위벡터", () => {
    const near = LOCK_FOLLOW_DIST - LOCK_BAND - 1; // 41m
    const w = lockOnWishH(0, 0, 0, near);
    expect(w.z).toBeLessThan(0);       // -z 방향 후퇴
    expect(mag2(w)).toBeCloseTo(1, 5); // 단위벡터
  });

  it("대상이 밴드 안(정확히 followDist) → 영벡터(정지)", () => {
    const w = lockOnWishH(0, 0, 0, LOCK_FOLLOW_DIST);
    expect(w.x).toBe(0);
    expect(w.z).toBe(0);
  });

  it("밴드 하단 경계(followDist - band) → 영벡터", () => {
    const w = lockOnWishH(0, 0, 0, LOCK_FOLLOW_DIST - LOCK_BAND);
    expect(w.x).toBe(0);
    expect(w.z).toBe(0);
  });

  it("밴드 상단 경계(followDist + band) → 영벡터", () => {
    const w = lockOnWishH(0, 0, 0, LOCK_FOLLOW_DIST + LOCK_BAND);
    expect(w.x).toBe(0);
    expect(w.z).toBe(0);
  });

  it("대각선 방향도 단위벡터(방향 보존)", () => {
    const far = LOCK_FOLLOW_DIST + LOCK_BAND + 10;
    const w = lockOnWishH(0, 0, far * 0.6, far * 0.8); // 3:4 비율
    expect(mag2(w)).toBeCloseTo(1, 5);
    expect(w.x).toBeGreaterThan(0); // +x 성분
    expect(w.z).toBeGreaterThan(0); // +z 성분
  });

  it("대상과 같은 위치(dist≈0) → 영벡터(NaN 없음)", () => {
    const w = lockOnWishH(5, 5, 5, 5);
    expect(w.x).toBe(0);
    expect(w.z).toBe(0);
    expect(Number.isNaN(w.x)).toBe(false);
  });

  it("플레이어가 대상보다 멀리 있어도 후퇴 방향이 정확히 반전", () => {
    // 플레이어 (0,0), 대상 (0, 10) → 거리 10 < 50-8=42 → 후퇴(−z)
    const wClose = lockOnWishH(0, 0, 0, 10);
    // 플레이어 (0,0), 대상 (0, 100) → 거리 100 > 50+8=58 → 접근(+z)
    const wFar = lockOnWishH(0, 0, 0, 100);
    expect(wClose.z).toBeLessThan(0);   // 후퇴 = -z
    expect(wFar.z).toBeGreaterThan(0);  // 접근 = +z
    // 두 벡터는 서로 반대 방향
    expect(Math.sign(wClose.z)).toBe(-Math.sign(wFar.z));
  });

  it("커스텀 followDist/band 파라미터 적용", () => {
    // followDist=100, band=10 → 밴드 [90, 110]
    const wBand = lockOnWishH(0, 0, 0, 100, 100, 10); // 정확히 100 → 영벡터
    expect(wBand.x).toBe(0);
    expect(wBand.z).toBe(0);

    const wFar = lockOnWishH(0, 0, 0, 115, 100, 10); // 115 > 110 → 접근
    expect(wFar.z).toBeGreaterThan(0);

    const wNear = lockOnWishH(0, 0, 0, 85, 100, 10); // 85 < 90 → 후퇴
    expect(wNear.z).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("lockOnVerticalTarget — 락온 수직 추적 목표 속도", () => {
  const MAX = 45; // 비행 드론 verticalSpeed

  it("데드밴드 안(차이 ≤ dead) → 0(호버)", () => {
    expect(lockOnVerticalTarget(0, 0, MAX)).toBe(0);
    expect(lockOnVerticalTarget(0, LOCK_VERTICAL_DEAD, MAX)).toBe(0);
    expect(lockOnVerticalTarget(0, -LOCK_VERTICAL_DEAD, MAX)).toBe(0);
  });

  it("대상이 위에 있고 데드밴드 밖 → 양수(상승)", () => {
    const v = lockOnVerticalTarget(0, LOCK_VERTICAL_DEAD + 1, MAX);
    expect(v).toBeGreaterThan(0);
  });

  it("대상이 아래에 있고 데드밴드 밖 → 음수(하강)", () => {
    const v = lockOnVerticalTarget(0, -(LOCK_VERTICAL_DEAD + 1), MAX);
    expect(v).toBeLessThan(0);
  });

  it("최대 속도는 maxSpeed × 0.6 초과 불가", () => {
    const v = lockOnVerticalTarget(0, 9999, MAX); // 매우 먼 거리
    expect(Math.abs(v)).toBeLessThanOrEqual(MAX * 0.6 + 1e-6);
  });

  it("거리에 비례(가까울수록 속도 낮음)", () => {
    const vFar = lockOnVerticalTarget(0, 100, MAX);
    const vNear = lockOnVerticalTarget(0, LOCK_VERTICAL_DEAD + 2, MAX);
    expect(vFar).toBeGreaterThan(vNear); // 더 멀수록 빠름(상한 클램프 전)
  });

  it("커스텀 dead 파라미터 — dead=0이면 0차이도 추적", () => {
    const v = lockOnVerticalTarget(0, 1, MAX, 0);
    expect(v).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("bestAlignedInCone — 조준 콘 안 최적 락온 후보", () => {
  it("빈 배열 → -1", () => {
    expect(bestAlignedInCone(O, FWD, [], 30)).toBe(-1);
  });

  it("정면 단일 적 → 인덱스 0", () => {
    const pos = [{ x: 0, y: 0, z: -10 }]; // 정면 -z
    expect(bestAlignedInCone(O, FWD, pos, 30)).toBe(0);
  });

  it("콘 밖 적 → -1", () => {
    // coneDeg=10, cos=cos(10°)≈0.985. 직각(+x)은 cos=0 → 밖
    const pos = [{ x: 10, y: 0, z: 0 }];
    expect(bestAlignedInCone(O, FWD, pos, 10)).toBe(-1);
  });

  it("여러 적 중 가장 정렬된(중앙에 가까운) 적 선택", () => {
    // idx0: 정면(cos≈1), idx1: 약간 옆(cos 낮음) — 모두 30° 이내
    const pos = [
      { x: 0,   y: 0, z: -10 }, // 정면 cos≈1
      { x: 3,   y: 0, z: -10 }, // 살짝 옆 cos 낮음
    ];
    expect(bestAlignedInCone(O, FWD, pos, 30)).toBe(0); // 더 정렬된 0번
  });

  it("가장 정렬된 적 선택 — 거리 무관(거리 다른 두 적)", () => {
    // idx0: 정면 100m(cos=1), idx1: 살짝 위/앞 1m(cos 약간 낮음)
    const pos = [
      { x: 0,   y: 0, z: -100 }, // 정면 멀리
      { x: 1,   y: 0, z: -1 },   // 가깝지만 옆으로 치우침
    ];
    expect(bestAlignedInCone(O, FWD, pos, 30)).toBe(0); // 정렬도 우선
  });

  it("동일 위치(dist≈0) 적은 무시 → 나머지 정상 선택", () => {
    const pos = [
      { x: 0, y: 0, z: 0 },    // 완전 같은 위치(dist=0) → 무시
      { x: 0, y: 0, z: -10 },  // 정면 정상
    ];
    expect(bestAlignedInCone(O, FWD, pos, 30)).toBe(1);
  });

  it("후방 적 → -1(cos ≤ 0 제외)", () => {
    const pos = [{ x: 0, y: 0, z: 10 }]; // 뒤쪽 +z
    expect(bestAlignedInCone(O, FWD, pos, 90)).toBe(-1);
  });

  it("coneDeg=180 → 후방 제외 모두 포함(cos > cos(180°)=-1은 항상 true이나 뒤는 cos≤0)", () => {
    // cos(180°)=-1보다 크면 포함. 정면(cos=1)은 포함, 후방(cos=-1)은 ≤ -1 아니라 경계
    const pos = [
      { x: 0, y: 0, z: -10 }, // cos=1 → 포함
      { x: 10, y: 0, z: 0 },  // cos=0 → 포함(cos < coneCos(-1) false)
    ];
    // cos≤0이면 제외되므로 z=0인 옆은 cos=0이고 cos < coneCos(-1) 는 false → 포함
    // 하지만 후방(z>0)은 cos<0 → cos≤0 제외 조건에 걸림 → 실제로는 cos≤0이면 skip이 없음
    // 코드: if (cos < coneCos) continue → coneCos=cos(180°)=-1, cos≥-1이므로 항상 통과
    // 단, cos≤0도 통과(≠ ≤0 제외 없음, 오직 coneCos 미만만 제외)
    expect(bestAlignedInCone(O, FWD, pos, 180)).toBeGreaterThanOrEqual(0);
  });

  it("수직 방향 조준으로도 동작(+y 정면)", () => {
    const up = { x: 0, y: 1, z: 0 };
    const pos = [
      { x: 0, y: 10, z: 0 }, // 수직 위
      { x: 0, y: 0, z: -10 }, // 전방(콘 밖)
    ];
    expect(bestAlignedInCone(O, up, pos, 30)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("flyMoveDir — 비행 이동 방향(락온 수평 자동 전진 통합)", () => {
  // 정면(yaw=0, pitch=0) 기준: 전방 f3 = (0,0,-1), 우측 rightH = (1,0,0)
  const F3 = { x: 0, y: 0, z: -1 };
  const RIGHT = { x: 1, z: 0 };

  it("수동 전진(fb=1) → 시선 전방, 락온 wish 무시(수동 우선)", () => {
    const lock = { x: 1, z: 0 }; // 락온은 +x 접근이지만 수동 입력이 이김
    const mv = flyMoveDir(1, 0, F3, RIGHT, lock);
    expect(mv).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("수동 스트레이프(lr=1) → 우측, 락온 wish 무시", () => {
    const mv = flyMoveDir(0, 1, F3, RIGHT, { x: 0, z: -1 });
    expect(mv).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("핵심 회귀: 입력 없음 + 락온 → 락온 수평 wish로 자동 전진(이전엔 0이라 멈춤)", () => {
    const lock = lockOnWishH(0, 0, 0, 100); // 먼 거리(+z 접근) 단위벡터
    const mv = flyMoveDir(0, 0, F3, RIGHT, lock);
    expect(mv.x).toBeCloseTo(lock.x, 6);
    expect(mv.z).toBeCloseTo(lock.z, 6);
    expect(mv.z).toBeGreaterThan(0);          // +z 방향 접근
    expect(Math.hypot(mv.x, mv.z)).toBeGreaterThan(0); // 멈추지 않음
  });

  it("입력 없음 + 락온 wish가 대각선이어도 그대로 반영", () => {
    const lock = lockOnWishH(0, 0, 60, 80); // 거리 100(>58 접근), 3:4 → (0.6, 0.8)
    const mv = flyMoveDir(0, 0, F3, RIGHT, lock);
    expect(mv.x).toBeCloseTo(0.6, 6);
    expect(mv.z).toBeCloseTo(0.8, 6);
    expect(mv.y).toBe(0); // 수직 성분 없음(수직 추적은 별도)
  });

  it("입력 없음 + 락온 없음 → 영벡터(호버, 자동 전진 안 함)", () => {
    const mv = flyMoveDir(0, 0, F3, RIGHT, null);
    expect(mv).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("락온 밴드 안(wish=0) → 입력 없으면 영벡터(접근 정지/호버)", () => {
    const lock = lockOnWishH(0, 0, 0, LOCK_FOLLOW_DIST); // 밴드 안 → {0,0}
    const mv = flyMoveDir(0, 0, F3, RIGHT, lock);
    expect(mv).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("수동 입력이 하나라도 있으면(fb 또는 lr) 락온 무시 — 경계 보장", () => {
    const lock = { x: 1, z: 1 };
    expect(flyMoveDir(1, 0, F3, RIGHT, lock).x).toBe(0);   // fb만
    expect(flyMoveDir(0, 1, F3, RIGHT, lock).z).toBe(0);   // lr만(우측 → z=0)
    expect(flyMoveDir(-1, 0, F3, RIGHT, lock).z).toBe(1);  // 후진 → +z(락온 아님)
  });

  it("피치 포함 전방(위를 보고 전진) → 수직 성분 발생, 락온 미개입", () => {
    // pitch +45°: f3 = (0, sin45, -cos45)
    const f3 = { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 };
    const mv = flyMoveDir(1, 0, f3, RIGHT, { x: 1, z: 0 });
    expect(mv.y).toBeCloseTo(Math.SQRT1_2, 6); // 상승 성분
    expect(mv.x).toBe(0);                        // 락온(+x) 무시
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("드론 스펙 lockOn 값 — JSON 수치 검증", () => {
  const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));

  it("walker: followDist=60, band=12 (AA 스탠드오프 — maxMult 컷오프 75m 안 유지창 48–72m)", () => {
    const d = load("public/drones/walker.json");
    expect(d.lockOn?.followDist).toBe(60);
    expect(d.lockOn?.band).toBe(12);
  });

  it("flyer: followDist=24, band=12 (경주파 빔 refDist=24 정합 + 정지거리 v/accel≈12m 흡수)", () => {
    const d = load("public/drones/flyer.json");
    expect(d.lockOn?.followDist).toBe(24);
    expect(d.lockOn?.band).toBe(12);
  });

  it("walker lockOnWishH: 30m 거리 → 밴드 안(정지)", () => {
    const { followDist, band } = load("public/drones/walker.json").lockOn;
    const w = lockOnWishH(0, 0, 0, followDist, followDist, band);
    expect(w.x).toBe(0);
    expect(w.z).toBe(0);
  });

  it("walker lockOnWishH: 73m → 접근(60+12+1=73 > followDist+band=72)", () => {
    const { followDist, band } = load("public/drones/walker.json").lockOn;
    const w = lockOnWishH(0, 0, 0, followDist + band + 1, followDist, band);
    expect(Math.hypot(w.x, w.z)).toBeCloseTo(1, 5); // 접근 단위벡터
  });

  it("walker lockOnWishH: 47m → 후퇴(60-12-1=47 < followDist-band=48)", () => {
    const { followDist, band } = load("public/drones/walker.json").lockOn;
    const w = lockOnWishH(0, 0, 0, followDist - band - 1, followDist, band);
    expect(Math.hypot(w.x, w.z)).toBeCloseTo(1, 5); // 후퇴 단위벡터
  });

  it("flyer lockOnWishH: 37m → 접근(24+12+1=37 > followDist+band=36)", () => {
    const { followDist, band } = load("public/drones/flyer.json").lockOn;
    const w = lockOnWishH(0, 0, 0, followDist + band + 1, followDist, band);
    expect(Math.hypot(w.x, w.z)).toBeCloseTo(1, 5);
  });

  it("모든 드론의 followDist > band (밴드가 추적 거리보다 클 수 없음)", () => {
    for (const id of ["walker", "flyer"]) {
      const d = load(`public/drones/${id}.json`);
      if (!d.lockOn) continue;
      expect(d.lockOn.followDist).toBeGreaterThan(d.lockOn.band);
    }
  });
});
