import { describe, it, expect } from "vitest";
import {
  evaluateMission, missionObjectiveText, missionProgressText, pickMission,
  FREE_ROAM, DEFAULT_MISSIONS, type MissionSpec, type MissionRuntime,
} from "../src/game/mission";

const rt = (p: Partial<MissionRuntime> = {}): MissionRuntime => ({
  elapsed: 0, kills: 0, buildingsDestroyed: 0, landmarksDestroyed: 0, deaths: 0, ...p,
});

const spec = (p: Partial<MissionSpec>): MissionSpec => ({
  id: "t", name: "t", kind: "eradicate", duration: 300,
  killTarget: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0, respawns: 3,
  zoneRadius: 5000, spawnCount: 500, spawnRadius: 1500, totalHp: 70000, bossHp: 10000, ...p,
});

describe("evaluateMission — eradicate", () => {
  const m = spec({ kind: "eradicate", killTarget: 10, duration: 300, respawns: 2 });

  it("active before target with progress", () => {
    const o = evaluateMission(m, rt({ kills: 4 }));
    expect(o.status).toBe("active");
    expect(o.progress).toBeCloseTo(0.4);
  });
  it("success at/after target", () => {
    expect(evaluateMission(m, rt({ kills: 10 })).status).toBe("success");
    expect(evaluateMission(m, rt({ kills: 11 })).status).toBe("success");
  });
  it("fails on time out before target", () => {
    expect(evaluateMission(m, rt({ kills: 9, elapsed: 300 })).status).toBe("failed");
  });
  it("fails when deaths exceed respawn budget", () => {
    expect(evaluateMission(m, rt({ kills: 5, deaths: 3 })).status).toBe("failed"); // respawns=2 → 3rd death
    expect(evaluateMission(m, rt({ kills: 5, deaths: 2 })).status).toBe("active");
  });
  it("success takes priority over a simultaneous timeout", () => {
    expect(evaluateMission(m, rt({ kills: 10, elapsed: 300 })).status).toBe("success");
  });
});

describe("evaluateMission — defend-buildings", () => {
  const m = spec({ kind: "defend-buildings", maxBuildingLoss: 10, duration: 300, respawns: 3 });

  it("active while under loss cap and within time", () => {
    expect(evaluateMission(m, rt({ buildingsDestroyed: 9, elapsed: 100 })).status).toBe("active");
  });
  it("fails when building loss hits the cap", () => {
    expect(evaluateMission(m, rt({ buildingsDestroyed: 10, elapsed: 100 })).status).toBe("failed");
  });
  it("succeeds at time out if cap not reached", () => {
    expect(evaluateMission(m, rt({ buildingsDestroyed: 9, elapsed: 300 })).status).toBe("success");
  });
  it("loss-fail takes priority over a simultaneous timeout", () => {
    expect(evaluateMission(m, rt({ buildingsDestroyed: 10, elapsed: 300 })).status).toBe("failed");
  });
});

describe("evaluateMission — defend-landmark", () => {
  const m = spec({ kind: "defend-landmark", maxLandmarkLoss: 1, duration: 300, respawns: 3 });
  it("fails when a landmark is lost", () => {
    expect(evaluateMission(m, rt({ landmarksDestroyed: 1, elapsed: 50 })).status).toBe("failed");
  });
  it("succeeds at time out if intact", () => {
    expect(evaluateMission(m, rt({ landmarksDestroyed: 0, elapsed: 300 })).status).toBe("success");
  });
});

describe("evaluateMission — survival", () => {
  const m = spec({ kind: "survival", duration: 300, respawns: 2 });
  it("succeeds by surviving to time out", () => {
    expect(evaluateMission(m, rt({ elapsed: 300, deaths: 2 })).status).toBe("success");
  });
  it("fails when respawns exhausted", () => {
    expect(evaluateMission(m, rt({ elapsed: 100, deaths: 3 })).status).toBe("failed");
  });
});

describe("evaluateMission — free-roam", () => {
  it("never ends", () => {
    const o = evaluateMission(FREE_ROAM, rt({ elapsed: 99999, deaths: 99 }));
    expect(o.status).toBe("active");
  });
});

describe("pickMission", () => {
  const pool = DEFAULT_MISSIONS;
  it("maps u in [0,1) across the pool", () => {
    expect(pickMission(pool, 0)).toBe(pool[0]);
    expect(pickMission(pool, 0.999)).toBe(pool[pool.length - 1]);
  });
  it("clamps out-of-range u", () => {
    expect(pickMission(pool, -1)).toBe(pool[0]);
    expect(pickMission(pool, 1)).toBe(pool[pool.length - 1]);
    expect(pickMission(pool, 5)).toBe(pool[pool.length - 1]);
  });
  it("falls back to free-roam on empty pool", () => {
    expect(pickMission([], 0.5)).toBe(FREE_ROAM);
  });
});

describe("text helpers", () => {
  it("objective + progress reflect each kind", () => {
    const e = spec({ kind: "eradicate", killTarget: 60 });
    expect(missionObjectiveText(e)).toContain("60");
    expect(missionProgressText(e, rt({ kills: 12 }))).toBe("12 / 60");
    expect(missionProgressText(e, rt({ kills: 80 }))).toBe("60 / 60"); // 진행은 목표로 클램프

    const d = spec({ kind: "defend-buildings", maxBuildingLoss: 10 });
    expect(missionProgressText(d, rt({ buildingsDestroyed: 3 }))).toBe("손실 3 / 10");

    const g = spec({ kind: "defend-landmark", maxLandmarkLoss: 1 });
    expect(missionProgressText(g, rt())).toBe("사수 중");
    expect(missionProgressText(g, rt({ landmarksDestroyed: 1 }))).toBe("상실 1");
  });
});

describe("DEFAULT_MISSIONS catalog", () => {
  it("covers each combat mission kind with sane values", () => {
    const kinds = new Set(DEFAULT_MISSIONS.map((m) => m.kind));
    expect(kinds).toEqual(new Set(["eradicate", "defend-buildings", "defend-landmark", "survival"]));
    for (const m of DEFAULT_MISSIONS) {
      expect(m.duration).toBeGreaterThan(0);
      expect(m.respawns).toBeGreaterThanOrEqual(0);
      expect(m.id).toBeTruthy();
      expect(m.zoneRadius).toBeGreaterThan(0); // 전 미션 교전 구역 제한
      expect(m.spawnCount).toBeGreaterThan(0); // 전 미션 일괄 스폰
      expect(m.spawnRadius).toBeGreaterThan(0); // 스폰 분산 반경
      expect(m.spawnRadius).toBeLessThanOrEqual(m.zoneRadius); // 스폰은 구역 안
      expect(m.totalHp).toBeGreaterThan(0); // 체력 총합 예산
      expect(m.bossHp).toBeLessThan(m.totalHp); // 보스는 총합 미만
    }
  });
});
