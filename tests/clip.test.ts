import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { bbox, polyArea, clipRect, clipSeg, clipPolylineToRect } from "../scripts/clip.mjs";

// 청크 분배 클립 기하 — 폴리곤(Sutherland-Hodgman)·폴리라인(Liang-Barsky). build-world 핵심, 순수.

describe("clip.bbox / polyArea", () => {
  it("bbox = 평면 최소/최대", () => {
    expect(bbox([0, 0, 10, 4, 3, 8])).toEqual([0, 0, 10, 8]);
  });
  it("polyArea = shoelace 절댓값(10×10 사각형=100)", () => {
    expect(polyArea([0, 0, 10, 0, 10, 10, 0, 10])).toBeCloseTo(100);
  });
});

describe("clip.clipRect — 폴리곤 사각형 클립(Sutherland-Hodgman)", () => {
  it("큰 사각형을 작은 창으로 클립 → 창 크기", () => {
    const out = clipRect([-5, -5, 15, -5, 15, 15, -5, 15], 0, 0, 10, 10);
    expect(polyArea(out)).toBeCloseTo(100); // 0..10 사각형
  });
  it("완전히 밖 → 빈 결과", () => {
    expect(clipRect([20, 20, 30, 20, 30, 30, 20, 30], 0, 0, 10, 10)).toEqual([]);
  });
  it("완전히 안 → 원형 보존(면적 동일)", () => {
    const out = clipRect([2, 2, 8, 2, 8, 8, 2, 8], 0, 0, 10, 10);
    expect(polyArea(out)).toBeCloseTo(36);
  });
});

describe("clip.clipSeg — 선분 사각형 클립(Liang-Barsky)", () => {
  it("가로지르는 선분 → 경계 교점 구간", () => {
    const r = clipSeg(-5, 5, 15, 5, 0, 0, 10, 10);
    expect(r.C).toEqual([0, 5]); expect(r.D).toEqual([10, 5]);
    expect(r.cFromStart).toBe(false); expect(r.dToEnd).toBe(false);
  });
  it("완전히 밖 → null", () => {
    expect(clipSeg(-5, -5, -1, -1, 0, 0, 10, 10)).toBeNull();
  });
  it("완전히 안 → 양끝 보존", () => {
    const r = clipSeg(2, 2, 8, 8, 0, 0, 10, 10);
    expect(r.cFromStart).toBe(true); expect(r.dToEnd).toBe(true);
  });
});

describe("clip.clipPolylineToRect — 폴리라인 연속 조각", () => {
  it("사각형을 들어왔다 나가는 폴리라인 → 내부 조각 1개", () => {
    // (-5,5)→(15,5): 0..10 구간만 남음
    const pieces = clipPolylineToRect([-5, 5, 15, 5], 0, 0, 10, 10);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toEqual([0, 5, 10, 5]);
  });
  it("두 번 들어오는 폴리라인 → 조각 2개(끊김)", () => {
    // 안→밖→안: (2,5)→(20,5)→(20,8)→(2,8)
    const pieces = clipPolylineToRect([2, 5, 20, 5, 20, 8, 2, 8], 0, 0, 10, 10);
    expect(pieces.length).toBe(2);
  });
  it("완전히 밖 → 빈 배열", () => {
    expect(clipPolylineToRect([20, 20, 30, 30], 0, 0, 10, 10)).toEqual([]);
  });
});
