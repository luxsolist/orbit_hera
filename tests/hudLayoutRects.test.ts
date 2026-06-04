import { describe, it, expect } from "vitest";
import { hudLayoutRects, type Rect, type HudLayout } from "../src/ui/hudLayout";

// 다양한 기기/화면비(폰·폴더블·태블릿·PC 1:1·4:3·16:9·21:9)에서 전투 HUD 컴포넌트가
// 화면 밖으로 나가거나 서로 겹치지 않는지 가드. 게임은 가로(landscape) 고정이므로 가로 해상도로 검증.

// 논리(CSS) 픽셀 기준 가로 해상도.
const DEVICES: { name: string; w: number; h: number }[] = [
  // ── 아이폰 ──
  { name: "iPhone SE", w: 667, h: 375 },
  { name: "iPhone 8 Plus", w: 736, h: 414 },
  { name: "iPhone 13 mini", w: 812, h: 375 },
  { name: "iPhone 14", w: 844, h: 390 },
  { name: "iPhone 15", w: 852, h: 393 },
  { name: "iPhone 14 Pro Max", w: 932, h: 430 },
  // ── 갤럭시(S/A/Pixel) ──
  { name: "Galaxy S8", w: 740, h: 360 },
  { name: "Galaxy S22", w: 780, h: 360 },
  { name: "Galaxy A52", w: 800, h: 360 },
  { name: "Galaxy S23 Ultra", w: 915, h: 412 },
  { name: "Pixel 7", w: 873, h: 412 },
  // ── 갤럭시 폴더블 ──
  { name: "Z Flip5 (cover, near-square)", w: 748, h: 720 },
  { name: "Z Flip5 (main)", w: 882, h: 412 },
  { name: "Z Fold5 (cover, narrow-tall)", w: 904, h: 374 },
  { name: "Z Fold5 (main, near-square)", w: 884, h: 768 },
  // ── 아이패드 ──
  { name: "iPad mini", w: 1024, h: 768 },
  { name: "iPad 10.2", w: 1080, h: 810 },
  { name: "iPad Air", w: 1180, h: 820 },
  { name: "iPad Pro 11", w: 1194, h: 834 },
  { name: "iPad Pro 12.9", w: 1366, h: 1024 },
  // ── 갤럭시 탭 ──
  { name: "Galaxy Tab A", w: 1340, h: 800 },
  { name: "Galaxy Tab S8", w: 1280, h: 800 },
  { name: "Galaxy Tab S8 Ultra", w: 1848, h: 1184 },
  // ── PC 화면비 ──
  { name: "PC 1:1 small", w: 800, h: 800 },
  { name: "PC 1:1 large", w: 1080, h: 1080 },
  { name: "PC 4:3 1024", w: 1024, h: 768 },
  { name: "PC 4:3 1600", w: 1600, h: 1200 },
  { name: "PC 16:9 1366", w: 1366, h: 768 },
  { name: "PC 16:9 1920", w: 1920, h: 1080 },
  { name: "PC 16:9 2560", w: 2560, h: 1440 },
  { name: "PC 21:9 ultrawide", w: 2560, h: 1080 },
];

const EPS = 1; // 반올림 허용 오차(px)
const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const withinScreen = (r: Rect, L: HudLayout): boolean =>
  r.x >= -EPS && r.y >= -EPS && right(r) <= L.screen.w + EPS && bottom(r) <= L.screen.h + EPS;

describe("hudLayoutRects — 화면비 28종 컴포넌트 배치 무결성", () => {
  for (const d of DEVICES) {
    describe(`${d.name} (${d.w}×${d.h})`, () => {
      const L = hudLayoutRects(d.w, d.h);
      const boxes: [string, Rect][] = [
        ["rear", L.rear],
        ["minimap", L.minimap],
        ["gauges", L.gauges],
        ["buttons", L.buttons],
      ];

      it("모든 컴포넌트가 화면 안에 있음", () => {
        for (const [name, r] of boxes) {
          expect(withinScreen(r, L), `${name} 화면 이탈`).toBe(true);
        }
        // 코너 텍스트 시작점도 화면 안(아래로 잘리지 않음)
        expect(L.cornerTL.y).toBeLessThan(d.h);
        expect(L.cornerTR.y).toBeLessThan(d.h);
      });

      it("컴포넌트끼리 겹치지 않음", () => {
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            expect(overlap(boxes[i][1], boxes[j][1]), `${boxes[i][0]} ↔ ${boxes[j][0]} 겹침`).toBe(false);
          }
        }
      });

      it("상단 행 순서: 후방 → 게이지 → 미니맵 (간격 ≥ 0)", () => {
        expect(L.gauges.x).toBeGreaterThanOrEqual(right(L.rear) - EPS);
        expect(L.minimap.x).toBeGreaterThanOrEqual(right(L.gauges) - EPS);
      });

      it("게이지는 가로 중앙 정렬", () => {
        const center = L.gauges.x + L.gauges.w / 2;
        expect(Math.abs(center - d.w / 2)).toBeLessThanOrEqual(1); // 반올림 오차 1px 허용
      });

      it("코너 텍스트는 각 위젯 아래", () => {
        expect(L.cornerTL.y).toBeGreaterThanOrEqual(bottom(L.rear));
        expect(L.cornerTR.y).toBeGreaterThanOrEqual(bottom(L.minimap));
      });

      it("축소 배율은 (0, 1] 범위", () => {
        expect(L.scale).toBeGreaterThan(0);
        expect(L.scale).toBeLessThanOrEqual(1);
      });
    });
  }

  it("넓은 비율(16:9·21:9)은 축소 없이(scale=1) 표시", () => {
    for (const [w, h] of [[1920, 1080], [2560, 1080], [1366, 768]] as const) {
      expect(hudLayoutRects(w, h).scale).toBe(1);
    }
  });

  it("정사각(1:1)·근사정사각은 상단 행을 축소(scale<1)", () => {
    expect(hudLayoutRects(800, 800).scale).toBeLessThan(1);
    expect(hudLayoutRects(1080, 1080).scale).toBeLessThan(1);
  });
});
