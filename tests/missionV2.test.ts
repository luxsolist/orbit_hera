import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  toLegacy, fromLegacy, evaluateMissionV2, runnableV2, missionDurationV2, deployKillCredits,
  deployRoleCredits, deployRoleName, missionObjectiveTextV2, missionProgressTextV2, resonanceScore,
  DEFAULT_MISSIONS_V2, FREE_ROAM_V2, type MissionSpecV2,
} from "../src/game/missionV2";
import { DEFAULT_MISSIONS, type MissionRuntime } from "../src/game/mission";
import { normalizeMissionPool } from "../src/game/missions";

// MissionSpec v2(승리/실패/투입/변조 직교 분해 — docs/spec/06-missions.md) 의 v1 호환 변환.
// 현 엔진 구동 부분집합만 변환되고(그 외 null), 현행 4미션은 v2 기술 ↔ v1 이 정확히 동치여야 한다.

const PYRAMID = {
  model: "pyramid",
  count: 45, totalHp: 70000, bossHp: 10000, concurrentCap: 26, reinforceInterval: 1.5, spawnRadius: 1500,
} as const;

describe("toLegacy — v2 → v1 동치 변환", () => {
  it("기본 풀 앞 4미션은 v1 DEFAULT_MISSIONS 와 동치, 5번째(정밀 정화)는 v1 표현 불가(null)", () => {
    const legacy = DEFAULT_MISSIONS_V2.map(toLegacy);
    expect(legacy.slice(0, 4)).toEqual(DEFAULT_MISSIONS);
    expect(legacy[4]).toBeNull(); // 복합 실패 조건(격멸+건물 한도)은 v1 계약 밖 — v2 전용
  });

  it("fromLegacy ∘ toLegacy = 항등(구동 가능 부분집합) — v1 JSON 하위호환 보장", () => {
    for (const v1 of DEFAULT_MISSIONS) {
      const v2 = fromLegacy(v1);
      expect(toLegacy(v2)).toEqual(v1);
    }
  });

  it("guard(landmarks) 는 한도 미지정 시 1로 보정(사수 = 최소 1 손실이 실패)", () => {
    const v2: MissionSpecV2 = {
      id: "g", name: "사수 / G",
      goal: { type: "guard", target: "landmarks", hold: 120 },
      fail: { respawns: 1, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
      deploy: PYRAMID, zoneRadius: 3000,
    };
    expect(toLegacy(v2)?.maxLandmarkLoss).toBe(1);
  });
});

describe("toLegacy — 현 엔진 미지원 조합은 null(훅 도입 대기)", () => {
  const base: MissionSpecV2 = {
    id: "x", name: "x / X",
    goal: { type: "purge", count: 10 },
    fail: { respawns: 3, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: PYRAMID, zoneRadius: 5000,
  };

  it("roster/boss/horde/phased 투입 — null (훅 ①)", () => {
    expect(toLegacy({ ...base, deploy: { model: "roster", units: [{ role: "marker", count: 4, hp: 1500 }], spawnRadius: 800 } })).toBeNull();
    expect(toLegacy({ ...base, deploy: { model: "boss", bossHp: 30000, projections: 3, spawnRadius: 500 } })).toBeNull();
    expect(toLegacy({ ...base, deploy: { model: "horde", count: 300, unitHp: 200, concurrentCap: 70, reinforceInterval: 0.5, spawnRadius: 1500 } })).toBeNull();
  });

  it("purge + 손실 한도(정밀 정화) — null (훅 ② 복합 실패 조건)", () => {
    expect(toLegacy({ ...base, fail: { ...base.fail, maxBuildingLoss: 3 } })).toBeNull();
  });

  it("purge-role / purge-all / suture / score — null (훅 ③⑤⑥)", () => {
    expect(toLegacy({ ...base, goal: { type: "purge-role", role: "marker" } })).toBeNull();
    expect(toLegacy({ ...base, goal: { type: "purge-all" } })).toBeNull();
    expect(toLegacy({ ...base, goal: { type: "suture", gauge: 100 } })).toBeNull();
    expect(toLegacy({ ...base, goal: { type: "score", target: 3000 } })).toBeNull();
  });

  it("변조(modifiers) 지정 — null (변조 레이어 미구현)", () => {
    expect(toLegacy({ ...base, modifiers: { sweepPeriodMul: 0.7 } })).toBeNull();
    expect(toLegacy({ ...base, modifiers: { aggro: "landmark" } })).toBeNull();
    expect(toLegacy({ ...base, modifiers: {} })).not.toBeNull(); // 빈 객체 = 변조 없음
  });

  it("guard(buildings) 는 건물 한도 없이는 판정 불가 — null", () => {
    expect(toLegacy({
      ...base,
      goal: { type: "guard", target: "buildings", hold: 300 },
      fail: { ...base.fail, timeLimit: 0 },
    })).toBeNull();
  });
});

// ─────────────────────────── 훅 ② — v2 런타임 평가 ───────────────────────────

const rt = (p: Partial<MissionRuntime> = {}): MissionRuntime => ({
  elapsed: 0, kills: 0, buildingsDestroyed: 0, landmarksDestroyed: 0, deaths: 0, ...p,
});

describe("evaluateMissionV2 — 복합 실패 조건(훅 ②)", () => {
  const surgical = DEFAULT_MISSIONS_V2.find((m) => m.id === "surgical")!;

  it("격멸 + 건물 한도 — 격멸 진행 중 건물 한도 도달이면 실패(패턴 19 성립)", () => {
    expect(evaluateMissionV2(surgical, rt({ kills: 20, buildingsDestroyed: 14 })).status).toBe("active");
    const o = evaluateMissionV2(surgical, rt({ kills: 20, buildingsDestroyed: 15 }));
    expect(o.status).toBe("failed");
    expect(o.reason).toContain("도시 함락");
  });

  it("실패 우선순위 — 랜드마크 > 건물 > 리스폰", () => {
    const m: MissionSpecV2 = {
      ...surgical,
      fail: { respawns: 0, timeLimit: 300, maxBuildingLoss: 5, maxLandmarkLoss: 1 },
    };
    const all = rt({ landmarksDestroyed: 1, buildingsDestroyed: 5, deaths: 1 });
    expect(evaluateMissionV2(m, all).reason).toContain("랜드마크 상실");
    expect(evaluateMissionV2(m, rt({ buildingsDestroyed: 5, deaths: 1 })).reason).toContain("도시 함락");
    expect(evaluateMissionV2(m, rt({ deaths: 1 })).reason).toContain("링크 상실");
  });

  it("v1 의미론 유지 — 격멸형은 마감 프레임 동시 충족 시 성공 우선, 생존형은 실패 우선", () => {
    expect(evaluateMissionV2(surgical, rt({ kills: 40, buildingsDestroyed: 15 })).status).toBe("success");
    const survive = DEFAULT_MISSIONS_V2.find((m) => m.id === "survive")!;
    expect(evaluateMissionV2(survive, rt({ elapsed: 300, deaths: 3 })).status).toBe("failed");
    expect(evaluateMissionV2(survive, rt({ elapsed: 300, deaths: 3 })).reason).toContain("전멸");
    expect(evaluateMissionV2(survive, rt({ elapsed: 300, deaths: 2 })).status).toBe("success");
  });

  it("survive/guard 에도 손실 한도가 걸린다(v1 은 불가능했던 조합)", () => {
    const m: MissionSpecV2 = {
      ...DEFAULT_MISSIONS_V2.find((x) => x.id === "survive")!,
      fail: { respawns: 2, timeLimit: 0, maxBuildingLoss: 8, maxLandmarkLoss: 0 },
    };
    expect(evaluateMissionV2(m, rt({ elapsed: 100, buildingsDestroyed: 8 })).status).toBe("failed");
  });

  it("free-roam 은 영원히 active", () => {
    expect(evaluateMissionV2(FREE_ROAM_V2, rt({ elapsed: 9999, deaths: 99 })).status).toBe("active");
  });
});

describe("v2 런타임 부속 — duration/runnable/로더 정규화", () => {
  it("missionDurationV2 — 격멸형=실패 타이머, 생존/사수형=승리 타이머, 탐방=0", () => {
    const byId = (id: string) => DEFAULT_MISSIONS_V2.find((m) => m.id === id)!;
    expect(missionDurationV2(byId("purge"))).toBe(300);
    expect(missionDurationV2(byId("hold-city"))).toBe(300);
    expect(missionDurationV2(byId("survive"))).toBe(300);
    expect(missionDurationV2(FREE_ROAM_V2)).toBe(0);
  });

  it("runnableV2 — 전 deploy 모델·전 변조 해금(훅 ①④⑤⑥), 빈 phased/buildingBrands 만 불가", () => {
    expect(DEFAULT_MISSIONS_V2.every(runnableV2)).toBe(true);
    expect(runnableV2({
      ...DEFAULT_MISSIONS_V2[0],
      deploy: { model: "roster", units: [{ role: "marker", count: 4, hp: 1500 }], spawnRadius: 800 },
    })).toBe(true); // 훅 ① — roster
    expect(runnableV2({ ...DEFAULT_MISSIONS_V2[0], deploy: { model: "phased", phases: [] } })).toBe(false); // 빈 페이즈
    expect(runnableV2({ ...DEFAULT_MISSIONS_V2[0], modifiers: { aggro: "landmark" } })).toBe(true); // 훅 ④
    expect(runnableV2({ ...DEFAULT_MISSIONS_V2[0], modifiers: { sweepPeriodMul: 0.7 } })).toBe(true); // 훅 ⑥
    expect(runnableV2({ ...DEFAULT_MISSIONS_V2[0], modifiers: { aggro: "building", freqRegenMul: 0.5 } })).toBe(true); // 혼합 가능
  });

  it("deployKillCredits — purge-all 목표치를 스펙에서 도출(보스 그룹 = 1크레딧)", () => {
    expect(deployKillCredits({ model: "pyramid", count: 45, totalHp: 1, bossHp: 1, concurrentCap: 1, reinforceInterval: 1, spawnRadius: 1 })).toBe(45);
    expect(deployKillCredits({ model: "horde", count: 150, unitHp: 350, concurrentCap: 55, reinforceInterval: 0.4, spawnRadius: 1500 })).toBe(150);
    expect(deployKillCredits({
      model: "roster",
      units: [{ role: "marker", count: 4, hp: 1 }, { role: "elite", count: 6, hp: 1 }, { role: "boss", count: 2, hp: 1 }],
      spawnRadius: 1,
    })).toBe(12);
    expect(deployKillCredits({ model: "boss", bossHp: 30000, escort: [{ role: "kiter", count: 4, hp: 800 }], spawnRadius: 800 })).toBe(5);
  });

  it("deployRoleCredits — 직무별 목표치(roster/boss 만 결정적, 그 외 0)", () => {
    const roster = DEFAULT_MISSIONS_V2.find((m) => m.id === "brand-hunt")!.deploy;
    expect(deployRoleCredits(roster, "marker")).toBe(6);
    expect(deployRoleCredits(roster, "rusher")).toBe(10);
    expect(deployRoleCredits(roster, "elite")).toBe(0);
    const boss = DEFAULT_MISSIONS_V2.find((m) => m.id === "triple-projection")!.deploy;
    expect(deployRoleCredits(boss, "boss")).toBe(1);
    expect(deployRoleCredits(boss, "kiter")).toBe(4);
    expect(deployRoleCredits({ model: "horde", count: 100, unitHp: 300, concurrentCap: 50, reinforceInterval: 0.5, spawnRadius: 1000 }, "marker")).toBe(0);
  });

  it("purge-role 평가(훅 ③) — 대상 직무 처치만 목표에 잡히고, 잡몹 처치는 무시된다", () => {
    const hunt = DEFAULT_MISSIONS_V2.find((m) => m.id === "brand-hunt")!;
    // 잡몹 16기를 다 잡아도(총 kills 16) 소인체 0 이면 진행 0
    const trashOnly = rt({ kills: 16, roleKills: { rusher: 10, kiter: 6 } });
    expect(evaluateMissionV2(hunt, trashOnly).status).toBe("active");
    expect(evaluateMissionV2(hunt, trashOnly).progress).toBe(0);
    // 소인체 6기 전멸 → 잡몹이 남아 있어도 승리
    const hunted = rt({ kills: 6, roleKills: { marker: 6 } });
    expect(evaluateMissionV2(hunt, hunted).status).toBe("success");
    expect(evaluateMissionV2(hunt, rt({ roleKills: { marker: 5 } })).progress).toBeCloseTo(5 / 6, 6);
    // 복합 실패도 그대로 적용
    expect(evaluateMissionV2(hunt, rt({ roleKills: { marker: 5 }, deaths: 3 })).status).toBe("failed");
  });

  it("purge-role 표면 문구 — 직무 표시명(§8.2 허용 어휘), 인식 Ⅰ 기본값(revealed 생략)", () => {
    const hunt = DEFAULT_MISSIONS_V2.find((m) => m.id === "brand-hunt")!;
    expect(missionObjectiveTextV2(hunt)).toBe("소인체 전멸 — 6기 / HUNT");
    expect(missionProgressTextV2(hunt, rt({ roleKills: { marker: 2 } }))).toBe("소인체 2 / 6");
  });

  it("명칭 갱신(§8.3) — revealed=true 면 직무명이 '투영체'로 합쳐진다(근원=boss 만 구분 유지)", () => {
    const hunt = DEFAULT_MISSIONS_V2.find((m) => m.id === "brand-hunt")!;
    expect(missionObjectiveTextV2(hunt, true)).toBe("투영체 전멸 — 6기 / HUNT");
    expect(missionProgressTextV2(hunt, rt({ roleKills: { marker: 2 } }), true)).toBe("투영체 2 / 6");
    expect(deployRoleName("rewinder", true)).toBe("투영체");
    expect(deployRoleName("cutter", false)).toBe("절단체");
    expect(deployRoleName("boss", true)).toBe("근원 투영체"); // 근원은 계시 후에도 구분 유지
  });

  it("runnableV2 — purge-role 은 대상 직무가 결정적으로 존재할 때만", () => {
    const hunt = DEFAULT_MISSIONS_V2.find((m) => m.id === "brand-hunt")!;
    expect(runnableV2(hunt)).toBe(true);
    expect(runnableV2({ ...hunt, goal: { type: "purge-role", role: "elite" } })).toBe(false); // 로스터에 없음
    expect(runnableV2({
      ...hunt,
      deploy: { model: "pyramid", count: 45, totalHp: 70000, bossHp: 10000, concurrentCap: 26, reinforceInterval: 1.5, spawnRadius: 1500 },
    })).toBe(false); // 확률 혼합 투입 — 목표치 도출 불가
  });

  it("purge-all 평가 — 스펙 도출 목표치로 성공/진행(편대 해체 = 18기)", () => {
    const disband = DEFAULT_MISSIONS_V2.find((m) => m.id === "disband")!;
    expect(evaluateMissionV2(disband, rt({ kills: 17 })).status).toBe("active");
    expect(evaluateMissionV2(disband, rt({ kills: 17 })).progress).toBeCloseTo(17 / 18, 6);
    expect(evaluateMissionV2(disband, rt({ kills: 18 })).status).toBe("success");
    expect(evaluateMissionV2(disband, rt({ kills: 0, elapsed: 300 })).status).toBe("failed"); // 시간 초과
  });

  it("훅 ⑤⑥ 크레딧 — boss groups·phased 합산", () => {
    const gem = DEFAULT_MISSIONS_V2.find((m) => m.id === "geminate")!;
    expect(deployKillCredits(gem.deploy)).toBe(2); // 그룹 2 = 크레딧 2
    const tide = DEFAULT_MISSIONS_V2.find((m) => m.id === "tide")!;
    expect(deployKillCredits(tide.deploy)).toBe(45 + 55 + 65); // 페이즈 합산
    const matured = DEFAULT_MISSIONS_V2.find((m) => m.id === "matured")!;
    expect(deployRoleCredits(matured.deploy, "boss")).toBe(1);
  });

  it("runnableV2 — 훅 ⑤⑥ 해금: phased·zoneShrink·freqRegenMul·sweepPeriodMul·buildingBrands 허용, emit×purge-all 불가", () => {
    expect(DEFAULT_MISSIONS_V2.every(runnableV2)).toBe(true); // 전 미션(변조·phased 포함) 구동 가능
    const matured = DEFAULT_MISSIONS_V2.find((m) => m.id === "matured")!;
    expect(runnableV2({ ...matured, goal: { type: "purge-all" } })).toBe(false); // 분출은 전량 격멸을 깨뜨림
    expect(runnableV2({ ...matured, goal: { type: "purge-role", role: "boss" } })).toBe(true);
    expect(runnableV2({ ...DEFAULT_MISSIONS_V2[0], modifiers: { buildingBrands: true } })).toBe(true); // P3 편입 완료(공성 낙인)
  });

  it("public/missions/index.json(v2) 은 내장 DEFAULT_MISSIONS_V2 와 동치", () => {
    const json = JSON.parse(readFileSync("public/missions/index.json", "utf8"));
    expect(normalizeMissionPool(json)).toEqual(DEFAULT_MISSIONS_V2);
  });

  it("normalizeMissionPool — v1 항목(goal 없음)은 fromLegacy 로 수용", () => {
    expect(normalizeMissionPool(DEFAULT_MISSIONS)).toEqual(DEFAULT_MISSIONS.map(fromLegacy));
  });

  it("fromLegacy — free-roam(v1) → goal free-roam + deploy none", () => {
    const fr = fromLegacy({
      id: "free-roam", name: "탐방 / EXPLORE", kind: "free-roam",
      duration: 0, killTarget: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0, respawns: -1,
      zoneRadius: 0, spawnCount: 0, spawnRadius: 0, totalHp: 0, bossHp: 0, concurrentCap: 0, reinforceInterval: 0,
    });
    expect(fr.goal).toEqual({ type: "free-roam" });
    expect(fr.deploy).toEqual({ model: "none" });
    expect(fr.fail.respawns).toBe(-1);
  });
});

describe("resonanceScore — 결과 화면 공명 점수(순수)", () => {
  const st = { markerKills: 2, zenoFreezes: 4, sweepCleanPasses: 3 };
  it("가중 합산 + 성공 보너스 500", () => {
    // 30×10 + 2×25 + 3×40 + 4×5 = 300+50+120+20 = 490 (+500)
    expect(resonanceScore(30, st, false)).toBe(490);
    expect(resonanceScore(30, st, true)).toBe(990);
  });
  it("무전과 실패 = 0", () => {
    expect(resonanceScore(0, { markerKills: 0, zenoFreezes: 0, sweepCleanPasses: 0 }, false)).toBe(0);
  });
});
