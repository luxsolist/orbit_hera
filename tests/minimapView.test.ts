import { describe, it, expect } from "vitest";
import {
  minimapRadiusFor, approach, ringRadiiFor, pickEdgeMarkers, angDiff,
  MM_RADIUS_MIN, MM_RADIUS_MAX,
} from "../src/ui/minimapView";

// 미니맵 고도 줌 + 랜드마크 화살표의 **판단부**. 그리기와 달리 여기는 조용히 틀려도 화면이
// 그럴듯해 보인다(반경이 안 변하거나, 화살표가 테두리를 다 덮거나) — 수치로 못박는다.

describe("minimapRadiusFor — 고도가 낮으면 확대, 높으면 축소", () => {
  it("단조 증가 — 올라갈수록 넓게 담는다", () => {
    let prev = -Infinity;
    for (const agl of [0, 1, 5, 20, 37, 60, 100, 200, 400, 700, 1000, 3000]) {
      const r = minimapRadiusFor(agl);
      expect(r, `agl=${agl}`).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("보행 드론(eye≈1.7m)과 저공은 최대 확대 — 골목 단위 식별", () => {
    expect(minimapRadiusFor(1.7)).toBe(MM_RADIUS_MIN);
    expect(minimapRadiusFor(0)).toBe(MM_RADIUS_MIN);
    expect(minimapRadiusFor(20)).toBe(MM_RADIUS_MIN);
  });

  it("비행 천장(1000m) 부근에서 상한에 닿는다 — 상한이 멀면 고고도가 무의미해진다", () => {
    expect(minimapRadiusFor(1000)).toBeCloseTo(MM_RADIUS_MAX, 0);
    expect(minimapRadiusFor(5000)).toBe(MM_RADIUS_MAX);
  });

  it("비행 스폰 고도(100m)는 종전 고정값(70m)과 비슷한 범위 — 체감이 갑자기 뒤집히지 않게", () => {
    const r = minimapRadiusFor(100);
    expect(r).toBeGreaterThan(60);
    expect(r).toBeLessThan(100);
  });

  it("음수 고도(지형 관통·보정 오차)에도 발산하지 않는다", () => {
    expect(minimapRadiusFor(-50)).toBe(MM_RADIUS_MIN);
  });

  it("변화가 실제로 체감될 만큼은 된다 — 저고도↔고고도 6배 이상", () => {
    expect(MM_RADIUS_MAX / MM_RADIUS_MIN).toBeGreaterThanOrEqual(6);
  });
});

describe("approach — 프레임률 무관 추종", () => {
  it("같은 시간이면 프레임률이 달라도 같은 곳에 온다(dt 를 그대로 곱하면 깨진다)", () => {
    const step = (n: number, dt: number) => {
      let v = 45;
      for (let i = 0; i < n; i++) v = approach(v, 300, dt);
      return v;
    };
    expect(step(60, 1 / 60)).toBeCloseTo(step(600, 1 / 600), 1); // 1초를 60/600 프레임으로
  });

  it("dt=0(히트스톱)이면 멈춘다", () => {
    expect(approach(45, 300, 0)).toBe(45);
  });

  it("충분한 시간이 지나면 목표에 정확히 닿는다 — 미세 드리프트가 남지 않는다", () => {
    let v = 45;
    for (let i = 0; i < 300; i++) v = approach(v, 300, 1 / 60);
    expect(v).toBe(300);
  });

  it("목표를 넘어서지 않는다(오버슛 없음)", () => {
    let v = 45;
    for (let i = 0; i < 60; i++) { v = approach(v, 300, 1 / 60); expect(v).toBeLessThanOrEqual(300); }
  });
});

describe("ringRadiiFor — 링이 항상 둥근 수", () => {
  it("반경이 변해도 2~4개를 유지 — 하나면 척도를 못 읽고 많으면 지형을 덮는다", () => {
    for (let r = MM_RADIUS_MIN; r <= MM_RADIUS_MAX; r += 5) {
      const rings = ringRadiiFor(r);
      expect(rings.length, `R=${r}`).toBeGreaterThanOrEqual(2);
      expect(rings.length, `R=${r}`).toBeLessThanOrEqual(4);
    }
  });

  it("모든 링이 반경 안 — 테두리에 붙으면 외곽 링과 겹쳐 보인다", () => {
    for (let r = MM_RADIUS_MIN; r <= MM_RADIUS_MAX; r += 7) {
      for (const v of ringRadiiFor(r)) expect(v, `R=${r}`).toBeLessThan(r);
    }
  });

  it("암산 가능한 눈금만 쓴다(등간격)", () => {
    expect(ringRadiiFor(80)).toEqual([20, 40, 60]);
    expect(ringRadiiFor(300)).toEqual([100, 200]);
    expect(ringRadiiFor(45)).toEqual([20, 40]);
  });
});

describe("angDiff", () => {
  it("±π 경계를 넘어도 최단각", () => {
    expect(angDiff(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2, 6);
    expect(angDiff(0, Math.PI)).toBeCloseTo(Math.PI, 6);
    expect(angDiff(1, 1)).toBe(0);
  });
});

describe("pickEdgeMarkers — 테두리가 화살표로 뒤덮이지 않는다", () => {
  it("가까운 것부터 남는다", () => {
    const got = pickEdgeMarkers([{ a: 0, d: 300 }, { a: 2, d: 100 }, { a: 4, d: 200 }], []);
    expect(got.map((m) => m.d)).toEqual([100, 200, 300]);
  });

  it("각도가 겹치면 먼 쪽을 버린다 — 같은 방향에 여러 개면 하나만", () => {
    const got = pickEdgeMarkers([{ a: 0, d: 100 }, { a: 0.05, d: 150 }, { a: 0.1, d: 200 }], []);
    expect(got).toHaveLength(1);
    expect(got[0].d).toBe(100);
  });

  it("밀집 도시(랜드마크 193개)에서도 상한을 넘지 않는다", () => {
    const many = Array.from({ length: 193 }, (_, i) => ({ a: (i / 193) * Math.PI * 2 - Math.PI, d: 100 + i }));
    expect(pickEdgeMarkers(many, []).length).toBeLessThanOrEqual(4);
  });

  it("out 버퍼를 재사용한다 — 프레임마다 배열을 새로 만들지 않는다", () => {
    const buf: { a: number; d: number }[] = [];
    const r1 = pickEdgeMarkers([{ a: 0, d: 1 }], buf);
    const r2 = pickEdgeMarkers([{ a: 1, d: 2 }, { a: 3, d: 5 }], buf);
    expect(r1).toBe(buf);
    expect(r2).toBe(buf);
    expect(buf).toHaveLength(2); // 이전 결과가 남지 않는다
  });

  it("입력을 변형하지 않는다(정렬이 호출자 배열을 흔들면 다음 프레임이 어긋난다)", () => {
    const src = [{ a: 0, d: 300 }, { a: 2, d: 100 }];
    pickEdgeMarkers(src, []);
    expect(src[0].d).toBe(300);
  });

  it("후보가 없으면 빈 결과", () => {
    expect(pickEdgeMarkers([], [])).toEqual([]);
  });
});
