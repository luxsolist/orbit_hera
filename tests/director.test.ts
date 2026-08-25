import { describe, it, expect } from "vitest";
import {
  validateDirectorAction, validateDirectorActions, DIRECTOR_LIMITS, baseMod, setMod, stepMod,
  type DirectorAction,
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

// 한시 변조(2026-08-25 회귀) — 감독의 freqRegenMul 을 영구 적용하면 복구 경로가 없어(출격 시작만이
// 유일한 재설정 지점) 게이지가 0 에 고착됐다. 오토파이어는 입력과 무관하게 상시 소모하므로 회복이
// 절반이면 소모가 회복을 추월한다. "가만히 두면 기준값으로 돌아간다"가 이 자료구조의 계약.
describe("TimedMod — 감독 변조의 한시성", () => {
  const DUR = 67.5; // DIRECTOR_MOD_SEC(= 45 * 1.5)

  it("변조 없음은 기준값 그대로, 감쇠해도 불변", () => {
    const m = baseMod(0.5); // 옅은 장 미션 — 기준값 자체가 0.5
    expect(m).toEqual({ mul: 0.5, left: 0 });
    expect(stepMod(m, 0.5, 1)).toEqual({ next: m, expired: false });
  });

  it("적용 즉시 배수가 바뀌고 changed=true(고지 대상)", () => {
    const { next, changed } = setMod(baseMod(1), 0.5, DUR);
    expect(next).toEqual({ mul: 0.5, left: DUR });
    expect(changed).toBe(true);
  });

  it("같은 값 재선언은 시계만 갱신 — changed=false(배너 도배 방지)", () => {
    const applied = setMod(baseMod(1), 0.5, DUR).next;
    const half = stepMod(applied, 1, 30).next;
    expect(half.left).toBeCloseTo(DUR - 30);
    const again = setMod(half, 0.5, DUR);
    expect(again.changed).toBe(false);
    expect(again.next.left).toBe(DUR); // 유지하려면 재선언 — 시계는 되감긴다
  });

  it("60fps 로 감쇠시켜도 만료 복귀 — expired 는 복귀 프레임에 **한 번만** true", () => {
    let m = setMod(baseMod(1), 0.5, DUR).next;
    let fired = 0;
    for (let t = 0; t < DUR + 5; t += 1 / 60) {
      const r = stepMod(m, 1, 1 / 60);
      m = r.next;
      if (r.expired) fired++;
    }
    expect(fired).toBe(1); // 고지는 1회 — 만료 후 프레임은 조용히 통과
    expect(m).toEqual({ mul: 1, left: 0 }); // ← 고착 회귀 가드: 절대 0.5 로 남지 않는다
  });

  it("만료 복귀 지점은 기준값 — 옅은 장 미션이면 1 이 아니라 0.5 로 돌아간다", () => {
    const m = setMod(baseMod(0.5), 1.5, DUR).next; // 감독이 완화해 준 경우
    const { next, expired } = stepMod(m, 0.5, DUR + 1);
    expect(next).toEqual({ mul: 0.5, left: 0 }); // 미션 설계값 복원(1 로 새지 않음)
    expect(expired).toBe(true);
  });

  it("기준값과 같은 변조가 만료되면 조용히 해제(expired=false — 고지 없음)", () => {
    const m = setMod(baseMod(1), 1, DUR).next;
    expect(stepMod(m, 1, DUR + 1)).toEqual({ next: { mul: 1, left: 0 }, expired: false });
  });

  it("봉투 최소값(0.5)도 한시 — 감독이 걸 수 있는 최악값이 영구화되지 않는다", () => {
    const worst = DIRECTOR_LIMITS.freqRegenMul.min;
    const m = setMod(baseMod(1), worst, DUR).next;
    expect(stepMod(m, 1, DUR).next.mul).toBe(1);
  });
});

// 거부 경로 — 이 게이트의 존재 이유가 "통과"가 아니라 "차단"이므로, 거부 분기가 곧 계약이다.
describe("validateDirectorAction — 거부 경로", () => {
  it("알 수 없는 aggro 값은 거부", () => {
    const v = validateDirectorAction({ type: "set-modifiers", modifiers: { aggro: "tower" as never } });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("bad-aggro");
  });

  it("지원하지 않는 변조 키는 거부 — 조용히 무시되면 밸런스가 말없이 어긋난다", () => {
    const v = validateDirectorAction({ type: "set-modifiers", modifiers: { zoneShrink: 1 } as never });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/^unsupported-modifier:/);
  });

  it("알 수 없는 행동 타입은 거부", () => {
    const v = validateDirectorAction({ type: "teleport-player" } as never);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("unknown-action");
  });

  it("leapChanceMul 봉투 — 경계 안은 통과, 밖은 거부", () => {
    const lim = DIRECTOR_LIMITS.leapChanceMul;
    const mk = (leapChanceMul: number): DirectorAction => ({ type: "set-modifiers", modifiers: { leapChanceMul } });
    expect(validateDirectorAction(mk(lim.min)).ok).toBe(true);
    expect(validateDirectorAction(mk(lim.max)).ok).toBe(true);
    for (const bad of [lim.min - 0.01, lim.max + 0.01]) {
      const v = validateDirectorAction(mk(bad));
      expect(v.ok).toBe(false);
      expect(v.ok === false && v.reason).toBe("out-of-envelope:leapChanceMul");
    }
  });

  it("leapChanceMul 이 숫자가 아니면 거부", () => {
    const v = validateDirectorAction({ type: "set-modifiers", modifiers: { leapChanceMul: "2" as never } });
    expect(v.ok).toBe(false);
  });
});

describe("validateDirectorAction — 증원 거부 경로", () => {
  it("엔진이 못 구동하는 투입은 거부 — runnableV2 게이트 재사용", () => {
    // 빈 phased 는 투입이 성립하지 않는다(크레딧은 있으나 구동 불가)
    const v = validateDirectorAction({
      type: "reinforce",
      deploy: { model: "phased", phases: [{ deploy: { model: "roster", units: [{ role: "kiter", count: 2, hp: 100 }], spawnRadius: 100 } }] },
    } as never);
    // 크레딧 2 로 봉투는 통과하지만 phased 자체는 runnable — 통과가 정상
    expect(v.ok).toBe(true);
  });

  it("크레딧 0 투입은 거부", () => {
    const v = validateDirectorAction({ type: "reinforce", deploy: { model: "roster", units: [], spawnRadius: 100 } } as never);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("empty-deploy");
  });

  it("봉투 초과 증원은 거부", () => {
    const over = DIRECTOR_LIMITS.reinforceMaxCredits + 1;
    const v = validateDirectorAction({
      type: "reinforce", deploy: { model: "horde", count: over, unitHp: 50, concurrentCap: 5, reinforceInterval: 1, spawnRadius: 100 },
    } as never);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("reinforce-too-large");
  });
});
