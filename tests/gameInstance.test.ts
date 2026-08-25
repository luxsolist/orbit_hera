import { describe, it, expect, vi } from "vitest";
import { GameInstance, runDeploy } from "../src/game/GameInstance";
import type { MissionSpec } from "../src/game/mission";
import { FREE_ROAM_V2 as FREE_ROAM, DEFAULT_MISSIONS_V2, fromLegacy } from "../src/game/missionV2";

// ── 경량 mock ────────────────────────────────────────────────────────────────
const makeEnemies = (killCount = 0) => ({ killCount } as any);
const makePlayers = (n = 1, mode: "walk" | "fly" = "walk") =>
  Array.from({ length: n }, () => ({
    isDead: false,
    spec: { move: { mode } },
  })) as any;
const makeBuildings = (b = 0, l = 0) => ({
  destroyedBuildings: b,
  destroyedLandmarks: l,
}) as any;

// v1 부분 명세로 조립 후 fromLegacy 로 v2 변환 — 어댑터 경로를 함께 검증(런타임은 v2).
const spec = (p: Partial<MissionSpec> = {}) =>
  fromLegacy({
    id: "t", name: "t", kind: "eradicate", duration: 60, killTarget: 10,
    maxBuildingLoss: 0, maxLandmarkLoss: 0, respawns: 2,
    zoneRadius: 5000, spawnCount: 100, spawnRadius: 1500, totalHp: 70000, bossHp: 10000,
    concurrentCap: 26, reinforceInterval: 1.5,
    ...p,
  });

// ─────────────────────────────────────────────────────────────────────────────
describe("GameInstance.start() — 리셋", () => {
  it("start() 후 elapsed=0, deaths=0, status=active", () => {
    const inst = new GameInstance({ mission: spec(), players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    expect(inst.elapsedSec).toBe(0);
    expect(inst.deathCount).toBe(0);
    expect(inst.isActive).toBe(true);
  });

  it("종료 후 start() 재호출 → 다시 active", () => {
    const inst = new GameInstance({ mission: spec({ duration: 0.1 }), players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    inst.update(1); // 시간 초과 → 실패
    expect(inst.isActive).toBe(false);
    inst.start();
    expect(inst.isActive).toBe(true);
    expect(inst.elapsedSec).toBe(0);
  });
});

describe("GameInstance.update() — 타이머 + 종료 전이", () => {
  it("매 프레임 elapsed 증가", () => {
    const inst = new GameInstance({ mission: spec({ duration: 100 }), players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    inst.update(0.1);
    expect(inst.elapsedSec).toBeCloseTo(0.1, 6);
    inst.update(0.4);
    expect(inst.elapsedSec).toBeCloseTo(0.5, 6);
  });

  it("시간 초과 → failed + onEnd 1회 호출", () => {
    const inst = new GameInstance({ mission: spec({ duration: 1 }), players: makePlayers(), enemies: makeEnemies() });
    const cb = vi.fn();
    inst.onEnd = cb;
    inst.start();
    inst.update(1.1);
    expect(inst.isActive).toBe(false);
    expect(inst.outcome.status).toBe("failed");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("종료 후 update 재호출 → onEnd 중복 없음(1회만)", () => {
    const inst = new GameInstance({ mission: spec({ duration: 0.1 }), players: makePlayers(), enemies: makeEnemies() });
    const cb = vi.fn();
    inst.onEnd = cb;
    inst.start();
    inst.update(1);
    inst.update(1);
    inst.update(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("eradicate: kills 목표 달성 → success", () => {
    const enemies = makeEnemies(10); // killCount=10
    const inst = new GameInstance({ mission: spec({ kind: "eradicate", killTarget: 10 }), players: makePlayers(), enemies });
    inst.start();
    inst.update(1);
    expect(inst.outcome.status).toBe("success");
  });
});

describe("GameInstance — free-roam 타이머 멈춤", () => {
  it("free-roam 은 elapsed 불변(시간 진행 없음)", () => {
    const inst = new GameInstance({ mission: FREE_ROAM, players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    inst.update(999);
    expect(inst.elapsedSec).toBe(0); // 탐방은 타이머 멈춤
    expect(inst.isActive).toBe(true); // 절대 종료 안 됨
  });

  it("free-roam timeLeft → Infinity", () => {
    const inst = new GameInstance({ mission: FREE_ROAM, players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    expect(inst.timeLeft).toBe(Infinity);
  });
});

describe("GameInstance.registerDeath() — 리스폰 예산", () => {
  it("respawns=2: 첫 사망(deaths=1) → true(리스폰)", () => {
    const inst = new GameInstance({ mission: spec({ respawns: 2 }), players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    expect(inst.registerDeath()).toBe(true);
    expect(inst.deathCount).toBe(1);
  });

  it("respawns=0: 첫 사망에 즉시 false(리스폰 0개)", () => {
    const inst = new GameInstance({ mission: spec({ respawns: 0 }), players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    expect(inst.registerDeath()).toBe(false); // 예산 없음
  });

  it("respawns=1: 첫 사망 true, 두 번째 false(소진)", () => {
    const inst = new GameInstance({ mission: spec({ respawns: 1 }), players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    expect(inst.registerDeath()).toBe(true);
    expect(inst.registerDeath()).toBe(false);
  });

  it("respawns<0(무한): 사망 10회도 모두 true", () => {
    const inst = new GameInstance({ mission: FREE_ROAM, players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    for (let i = 0; i < 10; i++) {
      expect(inst.registerDeath()).toBe(true);
    }
    expect(inst.deathCount).toBe(10);
  });
});

describe("GameInstance.finalize() — 즉시 종료 평가", () => {
  it("리스폰 소진 후 finalize → 즉시 failed", () => {
    const inst = new GameInstance({ mission: spec({ respawns: 0 }), players: makePlayers(), enemies: makeEnemies() });
    const cb = vi.fn();
    inst.onEnd = cb;
    inst.start();
    inst.registerDeath(); // 소진
    inst.finalize();
    expect(inst.isActive).toBe(false);
    expect(inst.outcome.status).toBe("failed");
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("GameInstance — timeLeft / respawnsLeft getters", () => {
  it("duration=0 → timeLeft=Infinity", () => {
    const inst = new GameInstance({ mission: FREE_ROAM, players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    expect(inst.timeLeft).toBe(Infinity);
  });

  it("시간 경과 후 timeLeft 감소, 0 미만은 0으로 클램프", () => {
    const inst = new GameInstance({ mission: spec({ duration: 10 }), players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    inst.update(7);
    expect(inst.timeLeft).toBeCloseTo(3, 5);
    inst.update(100); // 초과
    expect(inst.timeLeft).toBe(0);
  });

  it("respawnsLeft: respawns<0 → Infinity, 소진 후 0 이상", () => {
    const inf = new GameInstance({ mission: FREE_ROAM, players: makePlayers(), enemies: makeEnemies() });
    inf.start();
    expect(inf.respawnsLeft).toBe(Infinity);

    const limited = new GameInstance({ mission: spec({ respawns: 2 }), players: makePlayers(), enemies: makeEnemies() });
    limited.start();
    expect(limited.respawnsLeft).toBe(2);
    limited.registerDeath();
    expect(limited.respawnsLeft).toBe(1);
    limited.registerDeath();
    expect(limited.respawnsLeft).toBe(0);
  });
});

describe("GameInstance.snapshot()", () => {
  it("탐방이 아닌 경우 objective/detail/timeLeft/respawnsLeft 채워짐", () => {
    const mission = DEFAULT_MISSIONS_V2.find((m) => m.goal.type === "purge")!;
    const inst = new GameInstance({ mission, players: makePlayers(), enemies: makeEnemies(5) });
    inst.start();
    inst.update(10);
    const s = inst.snapshot();
    expect(s.objective).toBeTruthy();
    expect(s.detail).toBeTruthy(); // "5 / 45"
    expect(s.timeLeft).toBeCloseTo(mission.fail.timeLimit - 10, 4);
    expect(s.respawnsLeft).toBe(mission.fail.respawns);
    expect(s.status).toBe("active");
  });

  it("탐방은 timeLeft=Infinity, detail='', status=active", () => {
    const inst = new GameInstance({ mission: FREE_ROAM, players: makePlayers(), enemies: makeEnemies() });
    inst.start();
    const s = inst.snapshot();
    expect(s.timeLeft).toBe(Infinity);
    expect(s.detail).toBe("");
  });

  it("건물 손실 집계 — buildings 있을 때 snapshot에 반영", () => {
    const mission = DEFAULT_MISSIONS_V2.find((m) => m.goal.type === "guard" && m.goal.target === "buildings")!;
    const buildings = makeBuildings(3, 0);
    const inst = new GameInstance({ mission, players: makePlayers(), enemies: makeEnemies(), buildings });
    inst.start();
    inst.update(1);
    const s = inst.snapshot();
    expect(s.detail).toContain("3"); // "손실 3 / 10"
  });
});

describe("GameInstance — phased 페이즈 드라이버(훅 ⑥)", () => {
  const hordePhase = (count: number) =>
    ({ model: "horde", count, unitHp: 300, concurrentCap: 40, reinforceInterval: 0.4, spawnRadius: 1000 }) as const;
  const phasedMission = () => ({
    id: "p", name: "p / P",
    goal: { type: "survive", seconds: 300 } as const,
    fail: { respawns: 3, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "phased" as const,
      phases: [
        { deploy: hordePhase(10) },
        { deploy: hordePhase(20) }, // afterSec 없음 — 전멸 트리거
        { deploy: hordePhase(30), afterSec: 100 }, // 시각 트리거
      ],
    },
    zoneRadius: 3000,
  });
  const makeEnemiesMock = () => ({
    killCount: 0,
    fieldCleared: false,
    startHorde: vi.fn(),
    roleKills: {},
  }) as any;

  it("전멸 트리거 — fieldCleared 가 참이 되면 다음 페이즈를 fresh=false 로 투입", () => {
    const enemies = makeEnemiesMock();
    const inst = new GameInstance({ mission: phasedMission() as any, players: makePlayers(), enemies });
    inst.start();
    inst.update(1);
    expect(enemies.startHorde).not.toHaveBeenCalled(); // 페이즈 0 은 Game(beginPlay)이 투입 — 여기선 감시만
    enemies.fieldCleared = true;
    inst.update(1);
    expect(enemies.startHorde).toHaveBeenCalledTimes(1); // 페이즈 1 투입
    expect(enemies.startHorde.mock.calls[0][0]).toBe(20);
    expect(enemies.startHorde.mock.calls[0][3].fresh).toBe(false); // 카운터 유지
  });

  it("시각 트리거(afterSec) — 전멸과 무관하게 경과 시각 도달 시 투입", () => {
    const enemies = makeEnemiesMock();
    const inst = new GameInstance({ mission: phasedMission() as any, players: makePlayers(), enemies });
    inst.start();
    enemies.fieldCleared = true;
    inst.update(1); // 페이즈 1(전멸 트리거)
    enemies.fieldCleared = false;
    inst.update(50); // elapsed 51 < 100
    expect(enemies.startHorde).toHaveBeenCalledTimes(1);
    inst.update(50); // elapsed 101 ≥ 100 → 페이즈 2
    expect(enemies.startHorde).toHaveBeenCalledTimes(2);
    expect(enemies.startHorde.mock.calls[1][0]).toBe(30);
    inst.update(50); // 마지막 페이즈 — 더 없음
    expect(enemies.startHorde).toHaveBeenCalledTimes(2);
  });
});

describe("GameInstance.playerCount — MP 인원", () => {
  it("players 배열 길이 반환", () => {
    const inst = new GameInstance({ mission: FREE_ROAM, players: makePlayers(3), enemies: makeEnemies() });
    expect(inst.playerCount).toBe(3);
  });
});

// runDeploy — 미션 투입 디스패치. 미션 데이터(deploy 모델)를 실제 스폰 호출로 옮기는 유일한 지점이라
// 잘못 라우팅되면 미션이 통째로 다른 전투가 된다. 퇴화 스펙(count 0 등)은 웨이브 폴백으로 흘러야 한다.
describe("runDeploy — 투입 모델 디스패치", () => {
  /** 호출된 메서드 이름과 인자를 기록하는 EnemyManager 스텁. */
  const spy = () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const rec = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); };
    return {
      calls,
      em: {
        startBurst: rec("startBurst"), startHorde: rec("startHorde"), startRoster: rec("startRoster"),
        startBossDeploy: rec("startBossDeploy"), start: rec("start"),
      } as any,
    };
  };
  const only = (s: ReturnType<typeof spy>) => s.calls.map((c) => c.fn);

  it("pyramid → startBurst", () => {
    const s = spy();
    runDeploy(s.em, { model: "pyramid", count: 20, totalHp: 1000, bossHp: 0, concurrentCap: 6, reinforceInterval: 1.5, spawnRadius: 400 }, true);
    expect(only(s)).toEqual(["startBurst"]);
  });

  it("horde → startHorde", () => {
    const s = spy();
    runDeploy(s.em, { model: "horde", count: 40, unitHp: 200, concurrentCap: 10, reinforceInterval: 0.5, spawnRadius: 400 }, true);
    expect(only(s)).toEqual(["startHorde"]);
  });

  it("roster → startRoster", () => {
    const s = spy();
    runDeploy(s.em, { model: "roster", units: [{ role: "elite", count: 3, hp: 900 }], spawnRadius: 400 }, true);
    expect(only(s)).toEqual(["startRoster"]);
  });

  it("boss → startBossDeploy (count 게이트 없음 — 보스는 항상 투입)", () => {
    const s = spy();
    runDeploy(s.em, { model: "boss", groups: 1, groupHp: 5000, spawnRadius: 400 } as never, true);
    expect(only(s)).toEqual(["startBossDeploy"]);
  });

  it("phased → 첫 페이즈를 재귀 투입", () => {
    const s = spy();
    runDeploy(s.em, {
      model: "phased",
      phases: [
        { deploy: { model: "horde", count: 12, unitHp: 100, concurrentCap: 4, reinforceInterval: 1, spawnRadius: 300 } },
        { deploy: { model: "roster", units: [{ role: "kiter", count: 2, hp: 500 }], spawnRadius: 300 } },
      ],
    } as never, true);
    expect(only(s)).toEqual(["startHorde"]); // 2단계는 아직 투입되지 않는다
  });

  it("fresh 플래그가 그대로 전달된다", () => {
    const s = spy();
    runDeploy(s.em, { model: "roster", units: [{ role: "kiter", count: 1, hp: 100 }], spawnRadius: 100 }, false);
    expect(s.calls[0].args[3]).toBe(false); // startRoster(units, radius, projections, fresh)
  });

  it("퇴화 스펙은 웨이브 폴백 — 미션이 조용히 빈 전장이 되지 않는다", () => {
    for (const d of [
      { model: "pyramid", count: 0, totalHp: 0, bossHp: 0, concurrentCap: 0, reinforceInterval: 1, spawnRadius: 100 },
      { model: "horde", count: 0, unitHp: 1, concurrentCap: 1, reinforceInterval: 1, spawnRadius: 100 },
      { model: "roster", units: [], spawnRadius: 100 },
      { model: "phased", phases: [] },
      { model: "none" },
    ] as never[]) {
      const s = spy();
      runDeploy(s.em, d, true);
      expect(only(s)).toEqual(["start"]);
    }
  });
});

// 전장 소탕 주입(2026-08-26) — evaluateMissionV2 는 rt.cleared 를 보고 생존/사수를 조기 성공시킨다.
// GameInstance 가 그 값을 언제 true 로 넘기는지가 계약: **남은 페이즈가 있으면 지금 비어 있어도 아니다**.
describe("GameInstance — cleared 주입", () => {
  /** 투입이 일어나면 전장이 다시 채워진다 — 실제 EnemyManager 와 같게 fieldCleared 를 되돌린다. */
  const enemies = (fieldCleared: boolean) => {
    const em: any = { killCount: 0, roleKills: {}, observedCount: 0, fieldCleared };
    const fill = () => { em.fieldCleared = false; };
    em.startRoster = fill; em.startBurst = fill; em.startHorde = fill;
    em.startBossDeploy = fill; em.start = fill;
    return em;
  };
  const players = [{ isDead: false, spec: { move: { mode: "walk" } } } as any];
  const mk = (mission: any, fieldCleared: boolean) =>
    new GameInstance({ mission, enemies: enemies(fieldCleared), players } as any);

  const survive = (deploy: any) => ({
    id: "s", name: "s", goal: { type: "survive", seconds: 300 },
    fail: { respawns: 3, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy, zoneRadius: 1000,
  });
  const roster = { model: "roster", units: [{ role: "kiter", count: 2, hp: 100 }], spawnRadius: 100 };

  it("전장이 비면 생존 미션이 즉시 성공한다", () => {
    const inst = mk(survive(roster), true);
    inst.start();
    inst.update(1 / 60);
    expect(inst.outcome.status).toBe("success");
  });

  it("적이 남아 있으면 계속 진행", () => {
    const inst = mk(survive(roster), false);
    inst.start();
    inst.update(1 / 60);
    expect(inst.outcome.status).toBe("active");
  });

  it("phased — 비었을 때 다음 페이즈가 투입되므로 미션이 끝나지 않는다", () => {
    const phased = { model: "phased", phases: [{ deploy: roster }, { deploy: roster }] };
    // advancePhase 가 평가 **직전**에 돌아 다음 페이즈를 투입한다 → 전장이 다시 차서 소탕이 아니다.
    const inst = mk(survive(phased), true);
    inst.start();
    inst.update(1 / 60);
    expect(inst.outcome.status).toBe("active");
  });

  it("phased — 마지막 페이즈까지 소진되면 소탕으로 종료", () => {
    const phased = { model: "phased", phases: [{ deploy: roster }] }; // 페이즈 1개뿐
    const inst = mk(survive(phased), true);
    inst.start();
    inst.update(1 / 60);
    expect(inst.outcome.status).toBe("success");
  });
});
