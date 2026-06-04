import { describe, it, expect } from "vitest";
import { hudSizes, hudSizesFor } from "../src/ui/hudLayout";

// 화면 비례 HUD 위젯 크기(짧은변 기준, 상·하한 클램프) 순수 가드.

describe("hudSizes — 짧은변 비례 위젯 크기", () => {
  it("작은 폰(390)은 작게, 큰 태블릿(820)은 크게", () => {
    const phone = hudSizes(390);
    const tablet = hudSizes(820);
    expect(tablet.minimap).toBeGreaterThan(phone.minimap);
    expect(tablet.rearW).toBeGreaterThan(phone.rearW);
    expect(tablet.margin).toBeGreaterThanOrEqual(phone.margin);
  });

  it("아이폰 가로(390)는 기존 고정값(180)보다 작아짐", () => {
    expect(hudSizes(390).minimap).toBeLessThan(180);
  });
  it("아이패드 가로(820)는 기존 고정값(180)보다 커짐", () => {
    expect(hudSizes(820).minimap).toBeGreaterThan(180);
  });

  it("미니맵 상·하한 클램프(100~210)", () => {
    expect(hudSizes(50).minimap).toBe(100); // 하한
    expect(hudSizes(5000).minimap).toBe(210); // 상한
  });
  it("여백 상·하한 클램프(10~18)", () => {
    expect(hudSizes(50).margin).toBe(10);
    expect(hudSizes(5000).margin).toBe(18);
  });

  it("후방화면은 미니맵에 비례(가로 1.4·세로 0.82)", () => {
    const s = hudSizes(600);
    expect(s.rearW).toBe(Math.round(s.minimap * 1.4));
    expect(s.rearH).toBe(Math.round(s.minimap * 0.82));
  });

  it("가로가 충분한 landscape 는 짧은 변(min) 기준 그대로(미축소)", () => {
    expect(hudSizesFor(1280, 720)).toEqual(hudSizes(720));
  });
  it("가로가 좁으면(정사각/세로) 상단 행이 겹치지 않도록 축소", () => {
    const fitted = hudSizesFor(720, 1280); // 폭 720 — 위젯 3개가 들어가지 않음
    expect(fitted.minimap).toBeLessThan(hudSizes(720).minimap);
    expect(fitted.rearW).toBeLessThan(hudSizes(720).rearW);
  });
});
