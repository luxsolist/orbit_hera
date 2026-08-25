import { describe, it, expect } from "vitest";
import {
  gateSatisfied, evaluatePhase, shieldedGroups, validateTacticalMission,
  type TacticalRuntime, type SpawnGroup, type MissionPhase, type TacticalMissionSpec,
} from "../src/game/tactical";

// ─── 기본 런타임(빈 전장) ─────────────────────────────────────────────────────
const RT = (over: Partial<TacticalRuntime> = {}): TacticalRuntime => ({
  phaseElapsed: 0, killsThisPhase: 0, aliveByGroup: {}, aliveByRole: {},
  aliveTotal: 0, buildingsLostThisPhase: 0, landmarksLost: 0, reached: {}, ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
describe("gateSatisfied — 게이트 술어", () => {
  it("kills — 누적 처치 ≥ count", () => {
    expect(gateSatisfied({ type: "kills", count: 20 }, RT({ killsThisPhase: 19 }))).toBe(false);
    expect(gateSatisfied({ type: "kills", count: 20 }, RT({ killsThisPhase: 20 }))).toBe(true);
  });
  it("killGroup — 그룹 전멸(기본 downTo=0)", () => {
    expect(gateSatisfied({ type: "killGroup", group: "ward" }, RT({ aliveByGroup: { ward: 1 } }))).toBe(false);
    expect(gateSatisfied({ type: "killGroup", group: "ward" }, RT({ aliveByGroup: { ward: 0 } }))).toBe(true);
    expect(gateSatisfied({ type: "killGroup", group: "ward" }, RT({ aliveByGroup: {} }))).toBe(true); // 미존재=0
  });
  it("killGroup — downTo 로 일부만 남겨도 통과", () => {
    expect(gateSatisfied({ type: "killGroup", group: "swarm", downTo: 3 }, RT({ aliveByGroup: { swarm: 4 } }))).toBe(false);
    expect(gateSatisfied({ type: "killGroup", group: "swarm", downTo: 3 }, RT({ aliveByGroup: { swarm: 3 } }))).toBe(true);
  });
  it("killRole — 역할 전멸(anchor 모두 제거)", () => {
    expect(gateSatisfied({ type: "killRole", role: "anchor" }, RT({ aliveByRole: { anchor: 2 } }))).toBe(false);
    expect(gateSatisfied({ type: "killRole", role: "anchor" }, RT({ aliveByRole: { anchor: 0 } }))).toBe(true);
  });
  it("clearField / survive / reach", () => {
    expect(gateSatisfied({ type: "clearField" }, RT({ aliveTotal: 1 }))).toBe(false);
    expect(gateSatisfied({ type: "clearField" }, RT({ aliveTotal: 0 }))).toBe(true);
    expect(gateSatisfied({ type: "survive", seconds: 60 }, RT({ phaseElapsed: 59.9 }))).toBe(false);
    expect(gateSatisfied({ type: "survive", seconds: 60 }, RT({ phaseElapsed: 60 }))).toBe(true);
    expect(gateSatisfied({ type: "reach", zoneId: "ridge" }, RT({ reached: { ridge: true } }))).toBe(true);
    expect(gateSatisfied({ type: "reach", zoneId: "ridge" }, RT({ reached: {} }))).toBe(false);
  });
  it("loseBuildings / loseLandmarks — 실패형 임계", () => {
    expect(gateSatisfied({ type: "loseBuildings", max: 8 }, RT({ buildingsLostThisPhase: 7 }))).toBe(false);
    expect(gateSatisfied({ type: "loseBuildings", max: 8 }, RT({ buildingsLostThisPhase: 8 }))).toBe(true);
    expect(gateSatisfied({ type: "loseLandmarks", max: 1 }, RT({ landmarksLost: 1 }))).toBe(true);
  });
  it("all(AND) / any(OR) 합성", () => {
    const cond = { type: "all", of: [{ type: "killRole", role: "anchor" }, { type: "kills", count: 10 }] } as const;
    expect(gateSatisfied(cond, RT({ aliveByRole: { anchor: 0 }, killsThisPhase: 9 }))).toBe(false);
    expect(gateSatisfied(cond, RT({ aliveByRole: { anchor: 0 }, killsThisPhase: 10 }))).toBe(true);
    const any = { type: "any", of: [{ type: "clearField" }, { type: "survive", seconds: 30 }] } as const;
    expect(gateSatisfied(any, RT({ aliveTotal: 5, phaseElapsed: 30 }))).toBe(true); // 시간으로 통과
    expect(gateSatisfied(any, RT({ aliveTotal: 5, phaseElapsed: 10 }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("evaluatePhase — 단계 전이/실패 우선순위", () => {
  const phase: MissionPhase = {
    id: "p", name: "x", spawns: [],
    advance: { type: "kills", count: 5 },
    fail: { type: "loseBuildings", max: 3 },
    timeLimit: 120,
  };
  it("전이 미충족 → active", () => {
    expect(evaluatePhase(phase, RT({ killsThisPhase: 4 }))).toBe("active");
  });
  it("advance 충족 → advance", () => {
    expect(evaluatePhase(phase, RT({ killsThisPhase: 5 }))).toBe("advance");
  });
  it("fail 과 advance 동시 충족 → fail 우선", () => {
    expect(evaluatePhase(phase, RT({ killsThisPhase: 5, buildingsLostThisPhase: 3 }))).toBe("fail");
  });
  it("timeLimit 초과 → fail", () => {
    expect(evaluatePhase(phase, RT({ killsThisPhase: 4, phaseElapsed: 120 }))).toBe("fail");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("shieldedGroups — 앵커 무적 링크", () => {
  const groups: SpawnGroup[] = [
    { id: "ward", role: "anchor", archetype: "kiter", count: 2, shields: ["guardians", "keystone"] },
    { id: "guardians", role: "normal", archetype: "rusher", count: 8 },
    { id: "keystone", role: "keystone", archetype: "rusher", count: 1 },
  ];
  it("앵커 생존 → shields 그룹 무적", () => {
    const s = shieldedGroups(groups, { ward: 2, guardians: 8, keystone: 1 });
    expect(s.has("guardians")).toBe(true);
    expect(s.has("keystone")).toBe(true);
    expect(s.has("ward")).toBe(false); // 앵커 자신은 무적 아님 — 먼저 제거 가능
  });
  it("앵커 전멸 → 무적 해제", () => {
    const s = shieldedGroups(groups, { ward: 0, guardians: 8, keystone: 1 });
    expect(s.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("validateTacticalMission — 저작 무결성", () => {
  it("정상 미션은 오류 없음", () => {
    expect(validateTacticalMission(EXAMPLE)).toEqual([]);
  });
  it("깨진 참조(없는 그룹 shields / 없는 zone reach) 검출", () => {
    const broken: TacticalMissionSpec = {
      id: "b", name: "b", kind: "tactical", respawns: 2, zoneRadius: 3000,
      phases: [{
        id: "p1", name: "p1",
        spawns: [{ id: "a", role: "anchor", archetype: "kiter", count: 1, shields: ["ghost"] }],
        advance: { type: "reach", zoneId: "nowhere" },
      }],
    };
    const errs = validateTacticalMission(broken);
    expect(errs.some((e) => e.includes("ghost"))).toBe(true);
    expect(errs.some((e) => e.includes("nowhere"))).toBe(true);
  });

  it("빈 phases 검출 — 단계가 없으면 미션이 시작되자마자 끝난다", () => {
    const empty: TacticalMissionSpec = {
      id: "e", name: "e", kind: "tactical", respawns: 2, zoneRadius: 3000, phases: [],
    };
    expect(validateTacticalMission(empty).some((x) => x.includes("phases"))).toBe(true);
  });

  it("spawner 가 없는 그룹을 투입 대상으로 지목하면 검출", () => {
    const broken: TacticalMissionSpec = {
      id: "b", name: "b", kind: "tactical", respawns: 2, zoneRadius: 3000,
      phases: [{
        id: "p1", name: "p1",
        spawns: [{ id: "mother", archetype: "rusher", count: 1, spawns: { group: "phantom", everySec: 5, count: 2 } }],
        advance: { type: "kills", count: 1 },
      }],
    };
    expect(validateTacticalMission(broken).some((e) => e.includes("phantom"))).toBe(true);
  });

  it("buffs 가 없는 그룹을 대상으로 지목하면 검출", () => {
    const broken: TacticalMissionSpec = {
      id: "b", name: "b", kind: "tactical", respawns: 2, zoneRadius: 3000,
      phases: [{
        id: "p1", name: "p1",
        spawns: [{ id: "healer", archetype: "kiter", count: 1, buffs: { targets: ["nobody"], kind: "heal" } }],
        advance: { type: "kills", count: 1 },
      }],
    };
    expect(validateTacticalMission(broken).some((e) => e.includes("nobody"))).toBe(true);
  });

  it("killGroup 게이트가 없는 그룹을 참조하면 검출 — advance·fail 양쪽", () => {
    const mk = (where: "advance" | "fail"): TacticalMissionSpec => ({
      id: "b", name: "b", kind: "tactical", respawns: 2, zoneRadius: 3000,
      phases: [{
        id: "p1", name: "p1",
        spawns: [{ id: "a", archetype: "rusher", count: 1 }],
        advance: where === "advance" ? { type: "killGroup", group: "missing" } : { type: "kills", count: 1 },
        ...(where === "fail" ? { fail: { type: "killGroup", group: "missing" } as never } : {}),
      }],
    });
    for (const w of ["advance", "fail"] as const) {
      expect(validateTacticalMission(mk(w)).some((e) => e.includes("missing"))).toBe(true);
    }
  });
});

// ─── 예시 택티컬 미션(설계 시연 + 무결성 가드) ─────────────────────────────────
// 4단계: ① 교두보(kill-N) → ② 차단(앵커 제거로 무적 해제 후 핵심 처치) →
//        ③ 분출원 봉쇄(모함 제거, 건물 8채 손실 시 실패) → ④ 사수(60초 + 정화)
const EXAMPLE: TacticalMissionSpec = {
  id: "seoul-sever", name: "차단 작전 / SEVER", kind: "tactical",
  respawns: 3, zoneRadius: 5000,
  zones: { ridge: { x: 800, z: -600, r: 120 } },
  phases: [
    {
      id: "beachhead", name: "교두보 확보 / SECURE", brief: "20기 격멸로 거점 확보",
      spawns: [{ id: "swarm", role: "normal", archetype: "rusher", count: 30, at: { kind: "ring", radius: 400 }, spread: 200 }],
      advance: { type: "kills", count: 20 },
      fail: { type: "loseBuildings", max: 12 },
    },
    {
      id: "sever", name: "차단 / SEVER", brief: "워드(앵커)를 먼저 부숴 무적을 풀고 핵심을 제거",
      spawns: [
        { id: "ward", role: "anchor", archetype: "kiter", count: 2, tBand: [0.7, 0.9], at: { kind: "ring", radius: 300 }, shields: ["keystone"] },
        { id: "keystone", role: "keystone", archetype: "rusher", count: 1, hp: 8000, at: { kind: "spawnCenter" } },
        { id: "escort", role: "normal", archetype: "rusher", count: 12, at: { kind: "ring", radius: 250 } },
      ],
      advance: { type: "all", of: [{ type: "killGroup", group: "ward" }, { type: "killGroup", group: "keystone" }] },
    },
    {
      id: "choke", name: "분출원 봉쇄 / CHOKE", brief: "모함을 제거해 증원을 끊어라",
      spawns: [
        { id: "carrier", role: "spawner", archetype: "kiter", count: 1, hp: 12000, at: { kind: "point", x: 0, z: -900, y: 400 },
          spawns: { group: "adds", every: 6, max: 10 } },
        { id: "adds", role: "normal", archetype: "rusher", count: 6, at: { kind: "ring", radius: 350 } },
      ],
      advance: { type: "killGroup", group: "carrier" },
      fail: { type: "loseBuildings", max: 8 },
      timeLimit: 240,
    },
    {
      id: "hold", name: "사수 / HOLD", brief: "60초 버티며 잔존 정화",
      spawns: [{ id: "remnant", role: "normal", archetype: "kiter", count: 20, at: { kind: "ring", radius: 500 } }],
      advance: { type: "all", of: [{ type: "survive", seconds: 60 }, { type: "clearField" }] },
      fail: { type: "loseLandmarks", max: 1 },
    },
  ],
};

describe("EXAMPLE 미션 — 단계 진행 시나리오", () => {
  it("① 교두보: 19기 active → 20기 advance", () => {
    expect(evaluatePhase(EXAMPLE.phases[0], RT({ killsThisPhase: 19 }))).toBe("active");
    expect(evaluatePhase(EXAMPLE.phases[0], RT({ killsThisPhase: 20 }))).toBe("advance");
  });
  it("② 차단: 앵커 생존 중엔 핵심이 무적(advance 불가), 앵커 제거 후 핵심까지 잡아야 advance", () => {
    const p = EXAMPLE.phases[1];
    // 앵커 생존 → keystone 무적
    expect(shieldedGroups(p.spawns, { ward: 2, keystone: 1, escort: 12 }).has("keystone")).toBe(true);
    expect(evaluatePhase(p, RT({ aliveByGroup: { ward: 0, keystone: 1 } }))).toBe("active"); // 핵심 남음
    expect(evaluatePhase(p, RT({ aliveByGroup: { ward: 0, keystone: 0 } }))).toBe("advance");
    // 앵커 제거 → 무적 해제
    expect(shieldedGroups(p.spawns, { ward: 0, keystone: 1 }).size).toBe(0);
  });
  it("③ 분출원: 모함 생존 중 active, 제거 시 advance · 건물 8채 손실 시 fail", () => {
    const p = EXAMPLE.phases[2];
    expect(evaluatePhase(p, RT({ aliveByGroup: { carrier: 1 } }))).toBe("active");
    expect(evaluatePhase(p, RT({ aliveByGroup: { carrier: 0 } }))).toBe("advance");
    expect(evaluatePhase(p, RT({ aliveByGroup: { carrier: 1 }, buildingsLostThisPhase: 8 }))).toBe("fail");
  });
  it("④ 사수: 60초+정화 둘 다여야 성공 — 시간만으론 부족", () => {
    const p = EXAMPLE.phases[3];
    expect(evaluatePhase(p, RT({ phaseElapsed: 60, aliveTotal: 3 }))).toBe("active"); // 잔존 있음
    expect(evaluatePhase(p, RT({ phaseElapsed: 60, aliveTotal: 0 }))).toBe("advance");
  });
});
