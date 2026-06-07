import { describe, it, expect } from "vitest";
import { aimArrow, arrowOffset } from "../src/ui/aimArrows";

// 조준선 둘레 방향 화살표 — 카메라-로컬 좌표 → 둘레 각도/숨김 + 화면 오프셋(순수).

const TAN = Math.tan((10 * Math.PI) / 180); // 데드콘 10°

describe("aimArrow — 둘레 각도 + 중앙 데드콘", () => {
  it("위(y+)=0, 오른쪽(x+)=+90°, 아래(y-)=±180°, 왼쪽(x-)=-90°", () => {
    expect(aimArrow(0, 1, -1, TAN).angle).toBeCloseTo(0, 6);
    expect(aimArrow(1, 0, 0, TAN).angle).toBeCloseTo(Math.PI / 2, 6);
    expect(aimArrow(-1, 0, 0, TAN).angle).toBeCloseTo(-Math.PI / 2, 6);
    expect(Math.abs(aimArrow(0, -1, -1, TAN).angle)).toBeCloseTo(Math.PI, 6);
  });
  it("정면 중앙(전방 콘 안)이면 숨김", () => {
    expect(aimArrow(0.05, 0, -1, TAN).hidden).toBe(true); // 화면 이탈 0.05 < tan10°≈0.176
  });
  it("정면이라도 콘 밖이면 표시", () => {
    expect(aimArrow(0.5, 0, -1, TAN).hidden).toBe(false); // 0.5 > 0.176
  });
  it("후방(z≥0)은 중앙이라도 항상 표시", () => {
    expect(aimArrow(0.01, 0, 1, TAN).hidden).toBe(false);
  });
});

describe("arrowOffset — 둘레 각도 → 화면 오프셋(px)", () => {
  it("위=(0,-R), 오른쪽=(+R,0), 아래=(0,+R)", () => {
    const up = arrowOffset(0, 26);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(-26, 6);
    const right = arrowOffset(Math.PI / 2, 26);
    expect(right.x).toBeCloseTo(26, 6);
    expect(right.y).toBeCloseTo(0, 6);
    const down = arrowOffset(Math.PI, 26);
    expect(down.y).toBeCloseTo(26, 6);
  });
});
