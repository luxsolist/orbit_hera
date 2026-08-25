import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  toLegacy, fromLegacy, evaluateMissionV2, runnableV2, missionDurationV2, deployKillCredits,
  deployRoleCredits, deployRoleName, missionObjectiveTextV2, missionProgressTextV2, resonanceScore,
  DEFAULT_MISSIONS_V2, FREE_ROAM_V2, offTargetElapsed, pickMissionV2, type MissionSpecV2,
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
  it("변조 없는 기본 미션만 v1 과 동치 — 변조가 붙으면 v1 표현 불가(null)", () => {
    const legacy = DEFAULT_MISSIONS_V2.map(toLegacy);
    // 1번(정화 작전)만 변조가 없다. 2·3번(도시 방어·랜드마크 사수)은 aggro 변조가 붙어 v1 계약 밖.
    // 4번(지역 사수)은 killHealMul 폐지(2026-08-25 회복 전면 삭제)로 변조가 사라져 다시 v1 동치가 됐다.
    expect(legacy[0]).toEqual(DEFAULT_MISSIONS[0]);
    expect(legacy.slice(1, 3)).toEqual([null, null]);
    expect(legacy[3]).toEqual(DEFAULT_MISSIONS[3]);
    // 대조군: 변조를 걷어내면 다시 v1 과 동치가 된다(어댑터가 깨진 게 아님을 고정)
    const bare = DEFAULT_MISSIONS_V2.slice(1, 4).map((m) => toLegacy({ ...m, modifiers: undefined }));
    expect(bare).toEqual(DEFAULT_MISSIONS.slice(1, 4));
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
    // 목표치는 스펙에서 파생한다 — 물량 재조정(2026-08-25 HP×10·수 감축) 때마다 깨지지 않게.
    const half = Math.floor((surgical.goal as { count: number }).count / 2);
    expect(evaluateMissionV2(surgical, rt({ kills: half, buildingsDestroyed: 14 })).status).toBe("active");
    const o = evaluateMissionV2(surgical, rt({ kills: half, buildingsDestroyed: 15 }));
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
    expect(missionDurationV2(byId("purge"))).toBe(byId("purge").fail.timeLimit); //   격멸형 = 실패 타이머
    expect(missionDurationV2(byId("hold-city"))).toBe(300); //                          사수형 = 승리 타이머(hold)
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
    // 스폰 구성(§6.8) — 유효 3종은 통과, 오타는 제외(조용히 "even" 으로 흡수돼 난이도가 바뀌는 것 방지)
    for (const mix of ["kiter", "rusher", "even"] as const) {
      expect(runnableV2({ ...DEFAULT_MISSIONS_V2[0], spawnMix: mix })).toBe(true);
    }
    expect(runnableV2({ ...DEFAULT_MISSIONS_V2[0], spawnMix: "kitre" as never })).toBe(false);
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
    const cnt = (r: string) => (roster as { units: { role: string; count: number }[] }).units
      .filter((u) => u.role === r).reduce((a, u) => a + u.count, 0);
    expect(deployRoleCredits(roster, "marker")).toBe(cnt("marker"));
    expect(deployRoleCredits(roster, "rusher")).toBe(cnt("rusher"));
    expect(deployRoleCredits(roster, "elite")).toBe(0);
    const boss = DEFAULT_MISSIONS_V2.find((m) => m.id === "triple-projection")!.deploy;
    expect(deployRoleCredits(boss, "boss")).toBe(1);
    expect(deployRoleCredits(boss, "kiter")).toBe(4);
    expect(deployRoleCredits({ model: "horde", count: 100, unitHp: 300, concurrentCap: 50, reinforceInterval: 0.5, spawnRadius: 1000 }, "marker")).toBe(0);
  });

  it("purge-role 평가(훅 ③) — 대상 직무 처치만 목표에 잡히고, 잡몹 처치는 무시된다", () => {
    const hunt = DEFAULT_MISSIONS_V2.find((m) => m.id === "brand-hunt")!;
    const N = deployRoleCredits(hunt.deploy, "marker"); // 목표치 = 투입 소인체 수(스펙 파생)
    // 잡몹만 다 잡아도 소인체 0 이면 진행 0
    // 잡몹만 잡은 상태. 비표적 처치는 offTargetPenalty 로 시간을 깎으므로 투입 수만큼만 센다
    // (99 처럼 과장하면 깎인 시간이 제한을 넘겨 '실패'가 나온다 — 그건 다른 계약이다).
    const trash = deployKillCredits(hunt.deploy) - N;
    const trashOnly = rt({ kills: trash, roleKills: { rusher: trash } });
    expect(evaluateMissionV2(hunt, trashOnly).status).toBe("active");
    expect(evaluateMissionV2(hunt, trashOnly).progress).toBe(0);
    // 소인체 전멸 → 잡몹이 남아 있어도 승리
    const hunted = rt({ kills: N, roleKills: { marker: N } });
    expect(evaluateMissionV2(hunt, hunted).status).toBe("success");
    expect(evaluateMissionV2(hunt, rt({ roleKills: { marker: N - 1 } })).progress).toBeCloseTo((N - 1) / N, 6);
    // 복합 실패도 그대로 적용
    expect(evaluateMissionV2(hunt, rt({ roleKills: { marker: N - 1 }, deaths: 3 })).status).toBe("failed");
  });

  it("purge-role 표면 문구 — 직무 표시명(§8.2 허용 어휘), 인식 Ⅰ 기본값(revealed 생략)", () => {
    const hunt = DEFAULT_MISSIONS_V2.find((m) => m.id === "brand-hunt")!;
    const N = deployRoleCredits(hunt.deploy, "marker");
    expect(missionObjectiveTextV2(hunt)).toBe(`소인체 전멸 — ${N}기 / HUNT`);
    expect(missionProgressTextV2(hunt, rt({ roleKills: { marker: 2 } }))).toBe(`소인체 2 / ${N}`);
  });

  it("명칭 갱신(§8.3) — revealed=true 면 직무명이 '투영체'로 합쳐진다(근원=boss 만 구분 유지)", () => {
    const hunt = DEFAULT_MISSIONS_V2.find((m) => m.id === "brand-hunt")!;
    const N = deployRoleCredits(hunt.deploy, "marker");
    expect(missionObjectiveTextV2(hunt, true)).toBe(`투영체 전멸 — ${N}기 / HUNT`);
    expect(missionProgressTextV2(hunt, rt({ roleKills: { marker: 2 } }), true)).toBe(`투영체 2 / ${N}`);
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

  it("purge-all 평가 — 목표치는 투입 스펙에서 도출(편대 해체)", () => {
    const disband = DEFAULT_MISSIONS_V2.find((m) => m.id === "disband")!;
    const N = deployKillCredits(disband.deploy); // 별도 목표 수치 없이 투입에서 파생
    expect(evaluateMissionV2(disband, rt({ kills: N - 1 })).status).toBe("active");
    expect(evaluateMissionV2(disband, rt({ kills: N - 1 })).progress).toBeCloseTo((N - 1) / N, 6);
    expect(evaluateMissionV2(disband, rt({ kills: N })).status).toBe("success");
    expect(evaluateMissionV2(disband, rt({ kills: 0, elapsed: disband.fail.timeLimit })).status).toBe("failed"); // 시간 초과
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

// ─────────── 체감 분화 보정(2026-08-23) ───────────
// 실플레이에서 목표가 달라도 "전부 사냥"으로 느껴지던 문제 대응. 승리 조건만 다르고 **최적 전략이
// 같으면** 미션은 분화되지 않는다 — 비표적 처치에 비용을 주고, 생존에서 처치 보상을 뺀다.

describe("offTargetPenalty — 비표적 처치 비용(purge-role)", () => {
  const spec = (penalty?: number): MissionSpecV2 => ({
    id: "t", name: "t",
    goal: { type: "purge-role", role: "marker" },
    fail: { respawns: -1, timeLimit: 100, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: { model: "roster", units: [{ role: "marker", count: 3, hp: 100 }, { role: "rusher", count: 10, hp: 50 }], spawnRadius: 100 },
    zoneRadius: 0,
    ...(penalty ? { modifiers: { offTargetPenalty: penalty } } : {}),
  });
  const rt = (elapsed: number, kills: number, markerKills: number) => ({
    elapsed, kills, deaths: 0, buildingsDestroyed: 0, landmarksDestroyed: 0, roleKills: { marker: markerKills },
  }) as never;

  it("비용이 없으면 실경과만으로 판정(기존 계약)", () => {
    expect(evaluateMissionV2(spec(), rt(50, 20, 1)).status).toBe("active");
    expect(evaluateMissionV2(spec(), rt(100, 20, 1)).status).toBe("failed");
  });

  it("비표적 처치가 남은 시간을 깎는다", () => {
    // 경과 50s + 비표적 9기 × 6s = 104s ≥ 제한 100s → 시간 초과
    expect(evaluateMissionV2(spec(6), rt(50, 10, 1)).status).toBe("failed");
    // 같은 시간이라도 표적만 잡았으면 비용 0 → 진행 중
    expect(evaluateMissionV2(spec(6), rt(50, 1, 1)).status).toBe("active");
  });

  it("표적 처치는 비용에 포함되지 않는다", () => {
    expect(offTargetElapsed(spec(6), rt(50, 3, 3))).toBe(50);
    expect(offTargetElapsed(spec(6), rt(50, 5, 3))).toBe(50 + 2 * 6);
  });

  it("표적 전멸은 비용을 넘어 성공 — 대가를 치렀어도 끝냈으면 성공", () => {
    expect(evaluateMissionV2(spec(6), rt(90, 30, 3)).status).toBe("success");
  });

  it("purge-role 이 아니면 무시(다른 goal 에 새지 않는다)", () => {
    const purge: MissionSpecV2 = { ...spec(6), goal: { type: "purge", count: 5 } };
    expect(offTargetElapsed(purge, rt(50, 30, 0))).toBe(50);
  });

  it("HUD 에 깎인 시간을 병기한다 — 대가가 보이지 않으면 선택이 성립하지 않는다", () => {
    expect(missionProgressTextV2(spec(6), rt(50, 5, 2))).toContain("비표적 3 (−18s)");
    expect(missionProgressTextV2(spec(6), rt(50, 2, 2))).not.toContain("비표적"); // 표적만 잡으면 표기 없음
    expect(missionProgressTextV2(spec(), rt(50, 9, 2))).not.toContain("비표적");  // 비용 미설정 미션엔 미표기
  });
});

describe("runnableV2 — 신규 변조 지원", () => {
  const base: MissionSpecV2 = {
    id: "t", name: "t", goal: { type: "survive", seconds: 60 },
    fail: { respawns: -1, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: { model: "horde", count: 10, unitHp: 50, concurrentCap: 5, reinforceInterval: 1, spawnRadius: 100 },
    zoneRadius: 0,
  };
  it("offTargetPenalty 는 구동 가능", () => {
    expect(runnableV2({ ...base, modifiers: { offTargetPenalty: 6 } })).toBe(true);
  });
  it("폐지된 killHealMul 은 미지 변조로 거부된다 — 회복 전면 삭제(2026-08-25)", () => {
    expect(runnableV2({ ...base, modifiers: { killHealMul: 0 } as never })).toBe(false);
  });
  it("미지 변조는 여전히 제외", () => {
    expect(runnableV2({ ...base, modifiers: { bogus: 1 } as never })).toBe(false);
  });
});

// HUD 문자열·평가 분기 — 목표 유형마다 갈리는 순수 분기라 조용히 깨져도 테스트 없이는 안 보인다
// (화면엔 뭔가 뜨긴 하므로). guard 는 성공/실패 양쪽 전이가 모두 미검증이었다.
describe("evaluateMissionV2 — guard 전이", () => {
  const RT = (o: Partial<MissionRuntime> = {}): MissionRuntime =>
    ({ elapsed: 0, kills: 0, buildingsDestroyed: 0, landmarksDestroyed: 0, deaths: 0, ...o });
  const guard = (over: Partial<MissionSpecV2> = {}): MissionSpecV2 => ({
    id: "g", name: "g",
    goal: { type: "guard", target: "buildings", hold: 100 },
    fail: { respawns: 3, timeLimit: 0, maxBuildingLoss: 5, maxLandmarkLoss: 0 },
    deploy: { model: "none" }, zoneRadius: 1000, ...over,
  });

  it("hold 도달 = 성공", () => {
    const r = evaluateMissionV2(guard(), RT({ elapsed: 100 }));
    expect(r.status).toBe("success");
    expect(r.progress).toBe(1);
  });

  it("진행률은 elapsed/hold", () => {
    expect(evaluateMissionV2(guard(), RT({ elapsed: 25 })).progress).toBeCloseTo(0.25, 6);
  });

  it("손실 한도 도달 = 실패 — 시간이 남아 있어도", () => {
    const r = evaluateMissionV2(guard(), RT({ elapsed: 10, buildingsDestroyed: 5 }));
    expect(r.status).toBe("failed");
  });

  it("한도 미만이면 계속 진행", () => {
    expect(evaluateMissionV2(guard(), RT({ elapsed: 10, buildingsDestroyed: 4 })).status).toBe("active");
  });
});

describe("missionObjectiveTextV2 — 목표 유형별 문안", () => {
  const base: MissionSpecV2 = {
    id: "t", name: "t", goal: { type: "purge", count: 5 },
    fail: { respawns: 1, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: { model: "none" }, zoneRadius: 0,
  };
  const withGoal = (goal: MissionSpecV2["goal"], over: Partial<MissionSpecV2> = {}) =>
    missionObjectiveTextV2({ ...base, goal, ...over });

  it("survive / free-roam", () => {
    expect(withGoal({ type: "survive", seconds: 300 })).toContain("SURVIVE");
    expect(withGoal({ type: "free-roam" })).toContain("EXPLORE");
  });

  it("guard — 건물은 손실 한도, 랜드마크는 허용 파괴 수를 명시", () => {
    expect(withGoal({ type: "guard", target: "buildings", hold: 300 },
      { fail: { ...base.fail, maxBuildingLoss: 10 } })).toContain("10채 미만");
    // 랜드마크 한도 1 = 1채 잃으면 실패 → 허용 파괴 0
    expect(withGoal({ type: "guard", target: "landmarks", hold: 300 },
      { fail: { ...base.fail, maxLandmarkLoss: 1 } })).toContain("파괴 0");
    expect(withGoal({ type: "guard", target: "landmarks", hold: 300 },
      { fail: { ...base.fail, maxLandmarkLoss: 3 } })).toContain("≤2");
  });

  it("suture / score / experiment — 대기 콘텐츠도 문안은 존재", () => {
    expect(withGoal({ type: "suture" } as never)).toContain("SUTURE");
    expect(withGoal({ type: "score", target: 1000 } as never)).toContain("RESONATE");
    expect(withGoal({ type: "experiment", targets: 2, hold: 3 } as never)).toContain("OBSERVE");
  });
});

describe("missionProgressTextV2 — 손실 병기", () => {
  const RT = (o: Partial<MissionRuntime> = {}): MissionRuntime =>
    ({ elapsed: 0, kills: 0, buildingsDestroyed: 0, landmarksDestroyed: 0, deaths: 0, ...o });
  const spec = (over: Partial<MissionSpecV2>): MissionSpecV2 => ({
    id: "t", name: "t", goal: { type: "purge", count: 10 },
    fail: { respawns: 1, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: { model: "none" }, zoneRadius: 0, ...over,
  });

  it("건물 손실 한도가 있으면 진행 문자열에 병기", () => {
    const s = spec({ fail: { respawns: 1, timeLimit: 0, maxBuildingLoss: 8, maxLandmarkLoss: 0 } });
    expect(missionProgressTextV2(s, RT({ kills: 3, buildingsDestroyed: 2 }))).toContain("손실 2 / 8");
  });

  it("랜드마크 상실은 guard 에서 중복되지 않는다 — 본문이 이미 말하므로 병기를 뺀다", () => {
    const f = { respawns: 1, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 2 };
    // 비-guard: 진행 본문 뒤에 한도 병기로 붙는다
    expect(missionProgressTextV2(spec({ fail: f }), RT({ kills: 3, landmarksDestroyed: 1 }))).toBe("3 / 10 · 상실 1");
    // guard(랜드마크): "상실 N" 자체가 본문 — 한 번만 나온다
    const g = spec({ goal: { type: "guard", target: "landmarks", hold: 100 }, fail: f });
    expect(missionProgressTextV2(g, RT({ landmarksDestroyed: 1 }))).toBe("상실 1");
    expect(missionProgressTextV2(g, RT({ landmarksDestroyed: 0 }))).toBe("사수 중");
  });

  it("guard(건물)은 손실/한도를 본문으로 — 병기 없이", () => {
    const g = spec({
      goal: { type: "guard", target: "buildings", hold: 100 },
      fail: { respawns: 1, timeLimit: 0, maxBuildingLoss: 8, maxLandmarkLoss: 0 },
    });
    expect(missionProgressTextV2(g, RT({ buildingsDestroyed: 2 }))).toBe("손실 2 / 8");
  });

  it("한도가 없으면 병기하지 않는다", () => {
    expect(missionProgressTextV2(spec({}), RT({ kills: 3 }))).toBe("3 / 10");
  });
});

// pickMissionV2 — 캠페인 선택기(pickCampaignMission)가 null 일 때의 폴백 경로. 전장 진입을 막지
// 않는 것이 계약이라 빈 풀에서도 반드시 무언가를 돌려줘야 한다.
describe("pickMissionV2 — 비례 선택 + 폴백", () => {
  const pool = DEFAULT_MISSIONS_V2.slice(0, 4);

  it("빈 풀은 탐방으로 폴백 — 전투 진입이 막히지 않는다", () => {
    expect(pickMissionV2([], 0.5)).toBe(FREE_ROAM_V2);
  });

  it("u∈[0,1) 를 인덱스에 비례 배분", () => {
    expect(pickMissionV2(pool, 0)).toBe(pool[0]);
    expect(pickMissionV2(pool, 0.26)).toBe(pool[1]);
    expect(pickMissionV2(pool, 0.99)).toBe(pool[3]);
  });

  it("u 가 범위를 벗어나도 클램프 — 인덱스 밖 접근 없음", () => {
    expect(pickMissionV2(pool, 1)).toBe(pool[pool.length - 1]);
    expect(pickMissionV2(pool, 1.5)).toBe(pool[pool.length - 1]);
    expect(pickMissionV2(pool, -1)).toBe(pool[0]);
  });
});

// phased 투입의 재귀 집계 — 페이즈 안에 다시 투입 스펙이 들어가므로, 재귀를 빼먹으면 목표 개체수가
// 0 으로 잡혀 purge-all 이 즉시 성공해 버린다.
describe("투입 집계 — phased 재귀", () => {
  const inner = { model: "roster", units: [{ role: "kiter", count: 3, hp: 100 }, { role: "marker", count: 2, hp: 100 }], spawnRadius: 100 } as never;
  const phased = { model: "phased", phases: [{ deploy: inner }, { deploy: inner }] } as never;

  it("deployKillCredits — 전 페이즈 합산", () => {
    expect(deployKillCredits(inner)).toBe(5);
    expect(deployKillCredits(phased)).toBe(10);
  });

  it("deployRoleCredits — 직무별로 전 페이즈 합산", () => {
    expect(deployRoleCredits(phased, "kiter")).toBe(6);
    expect(deployRoleCredits(phased, "marker")).toBe(4);
    expect(deployRoleCredits(phased, "rusher")).toBe(0);
  });

  it("알 수 없는 모델은 0 — 방어적 기본값", () => {
    expect(deployKillCredits({ model: "none" } as never)).toBe(0);
  });
});

// 전장 소탕(2026-08-26) — 살아있는 개체도 대기 투입도 없으면 미션이 즉시 끝난다.
// 개체 수를 줄인 뒤 "다 잡았는데 제한시간까지 빈 전장에서 대기" 가 드러나 넣은 계약이다.
describe("evaluateMissionV2 — 전장 소탕 종료", () => {
  const RT = (o: Partial<MissionRuntime> = {}): MissionRuntime =>
    ({ elapsed: 0, kills: 0, buildingsDestroyed: 0, landmarksDestroyed: 0, deaths: 0, ...o });
  const spec = (goal: MissionSpecV2["goal"], over: Partial<MissionSpecV2> = {}): MissionSpecV2 => ({
    id: "t", name: "t", goal,
    fail: { respawns: 3, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: { model: "roster", units: [{ role: "kiter", count: 4, hp: 100 }], spawnRadius: 100 },
    zoneRadius: 1000, ...over,
  });

  it("생존 — 소탕이면 타이머를 다 채우지 않아도 성공", () => {
    const s = spec({ type: "survive", seconds: 300 });
    expect(evaluateMissionV2(s, RT({ elapsed: 10 })).status).toBe("active");
    const o = evaluateMissionV2(s, RT({ elapsed: 10, cleared: true }));
    expect(o.status).toBe("success");
    expect(o.reason).toContain("소탕");
  });

  it("사수 — 소탕이면 즉시 성공", () => {
    const s = spec({ type: "guard", target: "buildings", hold: 300 });
    expect(evaluateMissionV2(s, RT({ elapsed: 10 })).status).toBe("active");
    expect(evaluateMissionV2(s, RT({ elapsed: 10, cleared: true })).status).toBe("success");
  });

  it("실패 조건이 소탕보다 우선 — 마지막 적을 잡는 순간 리스폰이 소진돼도 실패", () => {
    const s = spec({ type: "survive", seconds: 300 });
    expect(evaluateMissionV2(s, RT({ elapsed: 10, cleared: true, deaths: 4 })).status).toBe("failed");
  });

  it("격멸 — 소탕했는데 목표 미달이면 도달 불가로 즉시 실패(빈 전장 대기 방지)", () => {
    const s = spec({ type: "purge", count: 99 }, { fail: { respawns: 3, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 } });
    expect(evaluateMissionV2(s, RT({ kills: 4 })).status).toBe("active");
    const o = evaluateMissionV2(s, RT({ kills: 4, cleared: true }));
    expect(o.status).toBe("failed");
    expect(o.reason).toContain("표적 소진");
  });

  it("격멸 — 목표를 채웠으면 소탕 여부와 무관하게 성공(성공 우선)", () => {
    const s = spec({ type: "purge", count: 4 });
    expect(evaluateMissionV2(s, RT({ kills: 4, cleared: true })).status).toBe("success");
  });

  it("동시 조사 — 소탕은 달성 불가 확정이므로 즉시 실패", () => {
    const s = spec({ type: "experiment", targets: 2, hold: 3 } as never,
      { fail: { respawns: 3, timeLimit: 420, maxBuildingLoss: 0, maxLandmarkLoss: 0 } });
    expect(evaluateMissionV2(s, RT({ elapsed: 10 })).status).toBe("active");
    const o = evaluateMissionV2(s, RT({ elapsed: 10, cleared: true }));
    expect(o.status).toBe("failed");
    expect(o.reason).toContain("표적 소진");
  });

  it("cleared 미지정은 종전 동작 — 구 런타임 호환", () => {
    const s = spec({ type: "survive", seconds: 300 });
    expect(evaluateMissionV2(s, RT({ elapsed: 10 })).status).toBe("active");
  });
});
