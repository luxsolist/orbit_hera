import { describe, it, expect, vi } from "vitest";
import { GameInstance } from "../src/game/GameInstance";
import { FREE_ROAM, DEFAULT_MISSIONS } from "../src/game/mission";
import type { MissionSpec } from "../src/game/mission";

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

const spec = (p: Partial<MissionSpec> = {}): MissionSpec => ({
  id: "t", name: "t", kind: "eradicate", duration: 60, killTarget: 10,
  maxBuildingLoss: 0, maxLandmarkLoss: 0, respawns: 2,
  zoneRadius: 5000, spawnCount: 100, spawnRadius: 1500, totalHp: 70000, bossHp: 10000,
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
    const mission = DEFAULT_MISSIONS.find((m) => m.kind === "eradicate")!;
    const inst = new GameInstance({ mission, players: makePlayers(), enemies: makeEnemies(5) });
    inst.start();
    inst.update(10);
    const s = inst.snapshot();
    expect(s.objective).toBeTruthy();
    expect(s.detail).toBeTruthy(); // "5 / 100"
    expect(s.timeLeft).toBeCloseTo(mission.duration - 10, 4);
    expect(s.respawnsLeft).toBe(mission.respawns);
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
    const mission = DEFAULT_MISSIONS.find((m) => m.kind === "defend-buildings")!;
    const buildings = makeBuildings(3, 0);
    const inst = new GameInstance({ mission, players: makePlayers(), enemies: makeEnemies(), buildings });
    inst.start();
    inst.update(1);
    const s = inst.snapshot();
    expect(s.detail).toContain("3"); // "손실 3 / 10"
  });
});

describe("GameInstance.playerCount — MP 인원", () => {
  it("players 배열 길이 반환", () => {
    const inst = new GameInstance({ mission: FREE_ROAM, players: makePlayers(3), enemies: makeEnemies() });
    expect(inst.playerCount).toBe(3);
  });
});
