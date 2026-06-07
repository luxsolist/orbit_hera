import { describe, it, expect } from "vitest";
import { bracketOpacity, RANGE, projectToScreen, labelText } from "../src/fx/TargetBrackets";

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
