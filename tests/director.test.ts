import { describe, it, expect } from "vitest";
import {
  validateDirectorAction, validateDirectorActions, DIRECTOR_LIMITS, type DirectorAction,
} from "../src/game/director";
import { surfaceClean } from "../src/game/surfaceVocab";

// Director 검증 게이트(TODO §10) — LLM/규칙 감독의 출력은 스키마·밸런스 봉투·표면 어휘를
// 서버측에서 강제 통과해야 엔진에 적용된다. 폭주·반전 누설을 구조적으로 차단하는 층.

describe("validateDirectorAction — 밸런스 봉투", () => {
  it("none/정상 변조는 통과", () => {
    expect(validateDirectorAction({ type: "none" }).ok).toBe(true);
    expect(validateDirectorAction({ type: "set-modifiers", modifiers: { aggro: "landmark" } }).ok).toBe(true);
    expect(validateDirectorAction({ type: "set-modifiers", modifiers: { sweepPeriodMul: 0.7, freqRegenMul: 1.2 } }).ok).toBe(true);
  });

  it("봉투 밖 변조는 거부(파문 폭주·회복 말살 차단)", () => {
    const low = validateDirectorAction({ type: "set-modifiers", modifiers: { sweepPeriodMul: 0.1 } });
    expect(low.ok).toBe(false);
    const drain = validateDirectorAction({ type: "set-modifiers", modifiers: { freqRegenMul: 0 } });
    expect(drain.ok).toBe(false);
    expect(validateDirectorAction({ type: "set-modifiers", modifiers: {} }).ok).toBe(false); // 빈 변조
  });

  it("증원 — 크레딧 상한·구동 가능성 게이트", () => {
    const ok = validateDirectorAction({
      type: "reinforce",
      deploy: { model: "roster", units: [{ role: "marker", count: 4, hp: 1200 }], spawnRadius: 800 },
    });
    expect(ok.ok).toBe(true);
    const tooBig = validateDirectorAction({
      type: "reinforce",
      deploy: { model: "horde", count: DIRECTOR_LIMITS.reinforceMaxCredits + 1, unitHp: 300, concurrentCap: 40, reinforceInterval: 0.5, spawnRadius: 1000 },
    });
    expect(tooBig.ok).toBe(false);
    const empty = validateDirectorAction({
      type: "reinforce",
      deploy: { model: "roster", units: [], spawnRadius: 800 },
    });
    expect(empty.ok).toBe(false);
  });

  it("brief — 표면 어휘 위반은 거부(반전 누설 차단), 정상 문구는 통과", () => {
    expect(validateDirectorAction({ type: "brief", text: "얽힘이 짙은 곳부터 무너진다 — 응축고를 지켜라." }).ok).toBe(true);
    const leak = validateDirectorAction({ type: "brief", text: "대상 영역 삭제 실패. 재시도한다." });
    expect(leak.ok).toBe(false);
    if (!leak.ok) expect(leak.reason).toBe("surface-vocab-violation");
    expect(validateDirectorAction({ type: "brief", text: "  " }).ok).toBe(false);
    expect(validateDirectorAction({ type: "brief", text: "가".repeat(DIRECTOR_LIMITS.briefMaxLen + 1) }).ok).toBe(false);
  });

  it("일괄 검증 — 통과/거부 분리(감사 로그 계약)", () => {
    const actions: DirectorAction[] = [
      { type: "none" },
      { type: "brief", text: "이 도시는 백업이다." }, // 금지 어휘
      { type: "set-modifiers", modifiers: { aggro: "building" } },
    ];
    const r = validateDirectorActions(actions);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toBe("surface-vocab-violation");
  });
});

describe("surfaceClean — 공용 표면 어휘 필터", () => {
  it("허용 어휘는 통과, 금지 어휘는 대소문자 무관 차단", () => {
    expect(surfaceClean("관측 계류 — 심판 파문이 온다")).toBe(true);
    expect(surfaceClean("Tombstone 각인")).toBe(false);
    expect(surfaceClean("시뮬레이션 종료")).toBe(false);
  });
});
