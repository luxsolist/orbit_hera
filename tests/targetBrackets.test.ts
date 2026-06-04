import { describe, it, expect } from "vitest";
import { bracketOpacity, RANGE, projectToScreen, labelText } from "../src/fx/TargetBrackets";

// 코너 브래킷 거리 페이드(근접 진하게 ~ RANGE 흐리게, 양끝 클램프) 순수 가드.

describe("bracketOpacity — 거리 페이드", () => {
  it("근접(0) > 중간(RANGE/2) > 원거리(RANGE)", () => {
    const near = bracketOpacity(0);
    const mid = bracketOpacity(RANGE / 2);
    const far = bracketOpacity(RANGE);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(mid).toBeCloseTo((near + far) / 2, 6); // 선형
  });
  it("음수/초과는 클램프(0→근접, RANGE 초과→원거리값 유지)", () => {
    expect(bracketOpacity(-50)).toBeCloseTo(bracketOpacity(0), 6);
    expect(bracketOpacity(RANGE * 3)).toBeCloseTo(bracketOpacity(RANGE), 6);
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
