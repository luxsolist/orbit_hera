import { describe, it, expect } from "vitest";
import { fadeOpacity } from "../src/intro/CinematicPlayer";

// 인트로 페이드 오버레이 불투명도(0=씬 보임, 1=검은 화면) 순수 가드 — 시작 페이드인 + 자연/스킵 페이드아웃.

const FIN = 0.8, FOUT = 2.0; // 페이드인 / 자연 종료 페이드아웃

describe("fadeOpacity", () => {
  it("시작 순간 완전 검정(1) → 페이드인으로 0", () => {
    expect(fadeOpacity(0, false, 0, FIN, FOUT)).toBeCloseTo(1, 6);
    expect(fadeOpacity(FIN / 2, false, 0, FIN, FOUT)).toBeCloseTo(0.5, 6);
  });
  it("페이드인 종료 후 투명(0)", () => {
    expect(fadeOpacity(FIN, false, 0, FIN, FOUT)).toBe(0);
    expect(fadeOpacity(5, false, 0, FIN, FOUT)).toBe(0);
  });
  it("종료 중 0→1 램프(fadeOut 길이 기준)", () => {
    expect(fadeOpacity(99, true, 0, FIN, FOUT)).toBeCloseTo(0, 6);
    expect(fadeOpacity(99, true, FOUT / 2, FIN, FOUT)).toBeCloseTo(0.5, 6);
    expect(fadeOpacity(99, true, FOUT, FIN, FOUT)).toBeCloseTo(1, 6);
  });
  it("종료 초과는 1로 클램프", () => {
    expect(fadeOpacity(99, true, FOUT * 3, FIN, FOUT)).toBe(1);
  });
  it("클릭 스킵(짧은 fadeOut 0.45)도 같은 비율", () => {
    expect(fadeOpacity(99, true, 0.225, FIN, 0.45)).toBeCloseTo(0.5, 6);
  });
});
