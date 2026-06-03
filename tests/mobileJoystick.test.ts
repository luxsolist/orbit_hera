import { describe, it, expect } from "vitest";
import { joystickToKeys, stepScale } from "../src/core/MobileControls";

// 모바일 조이스틱 변위 → WASD 키/속도 배율 매핑(순수)의 데드존·8방향·속도 단계 가드.

const keys = (nx: number, ny: number) => [...joystickToKeys(nx, ny).keys].sort();

describe("joystickToKeys — 데드존·8방향 매핑", () => {
  it("데드존(0.2) 안에서는 키 없음", () => {
    expect(keys(0.1, -0.1)).toEqual([]);
  });
  it("정면 위로 끌면 KeyW(전진)", () => {
    expect(keys(0, -1)).toEqual(["KeyW"]);
  });
  it("아래로 끌면 KeyS(후진)", () => {
    expect(keys(0, 1)).toEqual(["KeyS"]);
  });
  it("우측 = KeyD, 좌측 = KeyA", () => {
    expect(keys(1, 0)).toEqual(["KeyD"]);
    expect(keys(-1, 0)).toEqual(["KeyA"]);
  });
  it("대각선(우상)은 KeyD+KeyW 동시", () => {
    expect(keys(0.8, -0.8)).toEqual(["KeyD", "KeyW"]);
  });
  it("축별 데드존 독립 — 한 축만 임계 초과 시 그 축만", () => {
    expect(keys(0.5, -0.1)).toEqual(["KeyD"]); // y는 데드존 안
  });
});

describe("stepScale — 변위 크기 → 속도 단계", () => {
  it("4단계 경계", () => {
    expect(stepScale(0.3)).toBe(0.3); // <0.4
    expect(stepScale(0.5)).toBe(0.55); // <0.6
    expect(stepScale(0.7)).toBe(0.8); // <0.85
    expect(stepScale(1)).toBe(1); // 최대 구간
  });
  it("단조 비감소", () => {
    let prev = 0;
    for (let m = 0; m <= 1.0001; m += 0.05) {
      const s = stepScale(m);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe("joystickToKeys — 속도 배율 연동", () => {
  it("큰 변위(대각선)는 크기 1로 클램프되어 최대 배율", () => {
    expect(joystickToKeys(1, -1).scale).toBe(1);
  });
  it("작은 변위는 낮은 배율", () => {
    expect(joystickToKeys(0.3, 0).scale).toBe(0.3);
  });
});
