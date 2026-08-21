import { describe, it, expect, vi } from "vitest";
import {
  evaluateMissionV2, runnableV2, missionObjectiveTextV2, missionProgressTextV2,
  DEFAULT_MISSIONS_V2, type MissionSpecV2,
} from "../src/game/missionV2";
import { GameInstance } from "../src/game/GameInstance";
import {
  sortieLinkReport, sutureReadout, REVELATION_LINES, applyRevelation, EXPERIMENT_MISSION_ID,
} from "../src/game/campaign";
import { CAMPAIGN_DEFAULTS, type CampaignData } from "../src/core/progress";
import { surfaceClean } from "../src/game/surfaceVocab";

// P1 계시 세트(TODO §9.4) — 동시 조사 실험(experiment 골) + 2연전 관측 보고 + 재독 점수판.
// "계시는 플레이어가 수행한다"(§9.0-4): targets기 동시 관측을 hold초 유지해야 성공.

const EXP: MissionSpecV2 = {
  id: EXPERIMENT_MISSION_ID, name: "동시 조사 실험 / THE EXPERIMENT",
  goal: { type: "experiment", targets: 5, hold: 6 },
  fail: { respawns: 3, timeLimit: 420, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
  deploy: { model: "roster", units: [{ role: "rusher", count: 8, hp: 1400 }], spawnRadius: 700 },
  zoneRadius: 2500,
};

const rt = (over: Record<string, number> = {}) => ({
  elapsed: 0, kills: 0, buildingsDestroyed: 0, landmarksDestroyed: 0, deaths: 0, ...over,
});

describe("experiment 골 — 평가·게이트·문구", () => {
  it("유지 누적이 hold 에 닿아야 성공, 그 전엔 진행률만", () => {
    expect(evaluateMissionV2(EXP, rt({ observeHold: 3 }))).toMatchObject({ status: "active", progress: 0.5 });
    expect(evaluateMissionV2(EXP, rt({ observeHold: 6 }))).toMatchObject({ status: "success", reason: "동시 조사 성립 / COHERENT" });
    expect(evaluateMissionV2(EXP, rt()).status).toBe("active"); // 런타임 미지정 = 0 취급
  });

  it("복합 실패 조건은 골과 무관하게 동작(리스폰·시간)", () => {
    expect(evaluateMissionV2(EXP, rt({ deaths: 4 })).status).toBe("failed");
    expect(evaluateMissionV2(EXP, rt({ elapsed: 421 })).status).toBe("failed");
    // 마감 프레임 동시 충족은 성공 우선(격멸형과 동일 정책)
    expect(evaluateMissionV2(EXP, rt({ observeHold: 6, deaths: 4 })).status).toBe("success");
  });

  it("runnableV2 — 유효 스펙만 통과, 내장 풀의 실험 미션이 구동 가능", () => {
    expect(runnableV2(EXP)).toBe(true);
    expect(runnableV2({ ...EXP, goal: { type: "experiment", targets: 0, hold: 6 } })).toBe(false);
    const built = DEFAULT_MISSIONS_V2.find((m) => m.id === EXPERIMENT_MISSION_ID);
    expect(built && runnableV2(built)).toBe(true);
  });

  it("HUD 문구 — 목표/진행이 표면 어휘로 나온다", () => {
    expect(missionObjectiveTextV2(EXP)).toContain("동시 조사");
    const text = missionProgressTextV2(EXP, rt({ observeCount: 3, observeHold: 2.25 }));
    expect(text).toBe("동시 3 / 5 · 유지 2.3 / 6s");
  });
});

describe("GameInstance — 동시 조사 유지 집계", () => {
  const makeEnemies = (observedCount: number) => ({ killCount: 0, observedCount, roleKills: {} }) as never;

  it("조건 충족 프레임만 유지가 차오르고, 끊기면 같은 속도로 감쇠(2026-08 e2e 하향)", () => {
    const enemies = { killCount: 0, observedCount: 5, roleKills: {} };
    const inst = new GameInstance({ mission: EXP, players: [] as never, enemies: enemies as never });
    inst.start();
    inst.update(2); // 5기 관측 중 — +2s
    expect(inst.snapshot().detail).toContain("유지 2.0");
    enemies.observedCount = 4; // 조건 이탈
    inst.update(1); //            -1s (1배속 — 진행이 남는다)
    expect(inst.snapshot().detail).toContain("유지 1.0");
    enemies.observedCount = 5;
    inst.update(5); //            +5s → 6s 도달 = 성공
    expect(inst.snapshot().status).toBe("success");
  });

  it("성공 전이는 onEnd 1회", () => {
    const inst = new GameInstance({ mission: EXP, players: [] as never, enemies: makeEnemies(9) });
    const onEnd = vi.fn();
    inst.onEnd = onEnd;
    inst.start();
    inst.update(6.01);
    inst.update(0.1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0][0].status).toBe("success");
  });
});

describe("2연전 관측 보고·재독 점수판(§9.4)", () => {
  it("sortieLinkReport — 2장 + 얽힘쌍 직전 대량 소산일 때만", () => {
    const base: CampaignData = { ...CAMPAIGN_DEFAULTS(), chapter: 2, lastSortie: { cityId: "busan-stream", kills: 55 } };
    expect(sortieLinkReport(base, "seoul-stream")).toContain("같은 박자");
    expect(sortieLinkReport(base, "everest-stream")).toBeNull(); //           쌍 아님
    expect(sortieLinkReport({ ...base, chapter: 3 }, "seoul-stream")).toBeNull(); // 장 밖
    expect(sortieLinkReport({ ...base, lastSortie: { cityId: "busan-stream", kills: 10 } }, "seoul-stream")).toBeNull(); // 소산 부족
    expect(sortieLinkReport(CAMPAIGN_DEFAULTS(), "seoul-stream")).toBeNull(); // 기록 없음
  });

  it("sutureReadout — 봉합도는 점수 비례·99% 상한", () => {
    expect(sutureReadout(12, 600)).toBe("절단된 투영 12 · 본체 1 · 봉합도 40%");
    expect(sutureReadout(3, 99999)).toContain("봉합도 99%");
    expect(sutureReadout(0, 0)).toContain("봉합도 0%");
  });

  it("계시·보고·점수판 문자열은 표면 어휘 가드를 통과(§9.6)", () => {
    expect(surfaceClean(REVELATION_LINES)).toBe(true);
    expect(surfaceClean(sutureReadout(5, 500))).toBe(true);
    const c: CampaignData = { ...CAMPAIGN_DEFAULTS(), chapter: 2, lastSortie: { cityId: "busan-stream", kills: 55 } };
    expect(surfaceClean(sortieLinkReport(c, "seoul-stream")!)).toBe(true);
  });

  it("applyRevelation 은 5장에서만 6장으로", () => {
    expect(applyRevelation({ ...CAMPAIGN_DEFAULTS(), chapter: 5 }).chapter).toBe(6);
    expect(applyRevelation({ ...CAMPAIGN_DEFAULTS(), chapter: 4 }).chapter).toBe(4);
  });
});
