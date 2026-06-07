import { describe, it, expect } from "vitest";
import { bracketOpacity, bracketHalfThick, bracketFrameRadius, RANGE, projectToScreen, labelText } from "../src/fx/TargetBrackets";

// 코너 브래킷 투명도 — 거리 무관 일정(거리별 농도/색 변화 제거) 순수 가드.

describe("bracketOpacity — 거리 무관 일정(페이드 제거)", () => {
  it("거리에 상관없이 동일한 투명도", () => {
    const a = bracketOpacity(0);
    expect(bracketOpacity(RANGE / 2)).toBe(a);
    expect(bracketOpacity(RANGE)).toBe(a);
    expect(bracketOpacity(RANGE * 3)).toBe(a);
    expect(bracketOpacity(-50)).toBe(a);
  });
  it("양수 투명도(보임)", () => {
    expect(bracketOpacity(0)).toBeGreaterThan(0);
  });
});

describe("bracketHalfThick — 화면상 두께 일정(거리 비례, 타깃 크기 무관)", () => {
  it("거리에 비례 + 거리0이면 0", () => {
    expect(bracketHalfThick(0)).toBe(0);
    expect(bracketHalfThick(200)).toBeCloseTo(bracketHalfThick(100) * 2, 6); // 선형
    expect(bracketHalfThick(100)).toBeGreaterThan(0);
  });
});

describe("bracketFrameRadius — 프레임 크기(타깃 맞춤 + 두께 대비 최소 보장 → 코너 외향)", () => {
  it("타깃이 크면 타깃 크기에 비례(두께 무시)", () => {
    const r = bracketFrameRadius(10, bracketHalfThick(50)); // 큰 타깃·근거리
    expect(r).toBeGreaterThan(10); // radius·MARGIN(>1)
  });
  it("멀어 두께가 커지면 최소 크기로 클램프(타깃보다 큼)", () => {
    const t = bracketHalfThick(2000); // 원거리 → 두꺼움
    const r = bracketFrameRadius(0.5, t); // 아주 작은 먼 타깃
    expect(r).toBeGreaterThan(0.5);
  });
  it("항상 두께 ≤ 프레임의 일정비율(코너 뾰족점 외향 보장: t/r ≤ 0.35)", () => {
    for (const [rad, dist] of [[0.5, 2000], [1, 500], [30, 50], [3, 1500]] as const) {
      const t = bracketHalfThick(dist);
      const r = bracketFrameRadius(rad, t);
      expect(t / r).toBeLessThanOrEqual(0.35 + 1e-9);
    }
  });
});

describe("projectToScreen — NDC → 화면 픽셀 + 가시성", () => {
  it("화면 중앙(0,0) → (w/2, h/2)", () => {
    const s = projectToScreen({ x: 0, y: 0, z: 0.5 }, 1920, 1080);
    expect(s.left).toBeCloseTo(960, 6);
    expect(s.top).toBeCloseTo(540, 6);
    expect(s.visible).toBe(true);
  });
  it("좌상단 NDC(-1,1) → (0,0), 우하단(1,-1) → (w,h) — Y 뒤집힘", () => {
    expect(projectToScreen({ x: -1, y: 1, z: 0 }, 1920, 1080)).toMatchObject({ left: 0, top: 0 });
    expect(projectToScreen({ x: 1, y: -1, z: 0 }, 1920, 1080)).toMatchObject({ left: 1920, top: 1080 });
  });
  it("z>1(카메라 뒤) → visible:false", () => {
    expect(projectToScreen({ x: 0, y: 0, z: 1.0001 }, 800, 600).visible).toBe(false);
    expect(projectToScreen({ x: 0, y: 0, z: 1 }, 800, 600).visible).toBe(true);
  });
});

describe("labelText — 체력 → 라벨 문자열(올림·음수 0)", () => {
  it("소수는 올림", () => expect(labelText(0.1)).toBe("1"));
  it("음수는 0", () => expect(labelText(-5)).toBe("0"));
  it("정수 보존", () => expect(labelText(100)).toBe("100"));
  it("99.9 → 100", () => expect(labelText(99.9)).toBe("100"));
});
