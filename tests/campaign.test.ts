import { describe, it, expect } from "vitest";
import {
  CHAPTERS, chapterMeta, revealed, applyMissionResult, applyRevelation, evidenceGains,
  driftVectorFor, driftConvergence, pairAggravation, pairedCity, pickCampaignMission,
  missionWeight, DRIFT_ORIGIN, EXPERIMENT_MISSION_ID, type MissionReport,
} from "../src/game/campaign";
import { CAMPAIGN_DEFAULTS, DRIFT_VECTOR_CAP, validateCampaign, type CampaignData } from "../src/core/progress";
import type { MissionSpecV2 } from "../src/game/missionV2";

// 캠페인 전이(P0-2, TODO §9) — 순수 전이의 계약: 증거로만 챕터가 열리고(클리어 수 아님),
// 도시 상태·표류 벡터·자매쌍이 지도 서사(수사판)를 누적한다.

const report = (over: Partial<MissionReport> = {}): MissionReport => ({
  cityId: "seoul-stream", missionId: "purge-01", goalType: "purge", success: true,
  kills: 30, zenoFreezes: 0, cityLat: 37.58, cityLon: 126.98, ...over,
});

const mission = (id: string, goalType: string, count = 30): MissionSpecV2 => ({
  id, name: id, goal: { type: goalType } as MissionSpecV2["goal"],
  fail: { respawns: 2, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
  deploy: { model: "pyramid", count, totalHp: 8000, bossHp: 900, concurrentCap: 20, reinforceInterval: 3, spawnRadius: 900 },
  zoneRadius: 1500,
});

describe("증거 적립·챕터 전진", () => {
  it("서장 → 첫 성공으로 1장, 실패는 제자리", () => {
    const c0 = CAMPAIGN_DEFAULTS();
    expect(applyMissionResult(c0, report({ success: false }), 0.5).chapter).toBe(0);
    const c1 = applyMissionResult(c0, report(), 0.5);
    expect(c1.chapter).toBe(1);
    expect(chapterMeta(c1).track).toBe("heatmap");
  });

  it("트랙별 이득 — 방어=열지도, 대량 처치=박자, 격멸=방향, 재방어=불멸성", () => {
    expect(evidenceGains(report({ goalType: "guard", missionId: "deep-roots", kills: 0 }), false)).toEqual({ heatmap: 22 });
    const g = evidenceGains(report({ kills: 70, zenoFreezes: 6 }), false);
    expect(g.pulse).toBe(22 + 4); // 대형 격멸 + 경직 관측 보너스
    expect(g.drift).toBe(16);
    expect(evidenceGains(report({ goalType: "survive", kills: 10 }), true)).toEqual({ immortal: 20 });
    expect(evidenceGains(report({ success: false, kills: 99 }), true)).toEqual({}); // 실패는 무적립
  });

  it("현재 장 트랙 ×1 · 곁가지 ×0.5, 만충 시 챕터 전진(연쇄 포함)", () => {
    let c: CampaignData = { ...CAMPAIGN_DEFAULTS(), chapter: 1 };
    c = applyMissionResult(c, report({ goalType: "guard", missionId: "guard-landmark", kills: 0 }), 0.5);
    expect(c.evidence.heatmap).toBe(22); // 1장 트랙 — 온전
    c = applyMissionResult(c, report({ kills: 30 }), 0.5);
    expect(c.evidence.drift).toBe(8); //   곁가지 — 절반
    // 열지도 만충 → 2장. 곁가지로 박자도 이미 차 있으면 연쇄 전진.
    let full: CampaignData = { ...CAMPAIGN_DEFAULTS(), chapter: 1, evidence: { heatmap: 90, pulse: 100, drift: 0, immortal: 0 } };
    full = applyMissionResult(full, report({ goalType: "guard", missionId: "g", kills: 0 }), 0.5);
    expect(full.chapter).toBe(3); // 1→2(열지도 만충)→3(박자 이미 만충)
    expect(full.evidence.heatmap).toBe(100); // 상한 캡
  });

  it("5장→6장은 증거가 아니라 실험 성공(applyRevelation)만 연다", () => {
    const c5: CampaignData = { ...CAMPAIGN_DEFAULTS(), chapter: 5, evidence: { heatmap: 100, pulse: 100, drift: 100, immortal: 100 } };
    expect(applyMissionResult(c5, report({ kills: 80 }), 0.5).chapter).toBe(5); // 일반 미션으론 불변
    const c6 = applyRevelation(c5);
    expect(c6.chapter).toBe(6);
    expect(revealed(c6)).toBe(true);
    expect(applyRevelation(CAMPAIGN_DEFAULTS()).chapter).toBe(0); // 5장 밖에선 무시
  });
});

describe("도시 상태·표류 벡터·자매쌍", () => {
  it("도시 전이 — 성공=방어됨, 실패 1회=침공 중, 2회=함락, 재방어로 회복", () => {
    let c = applyMissionResult(CAMPAIGN_DEFAULTS(), report({ success: false }), 0.5);
    expect(c.cities["seoul-stream"]).toMatchObject({ state: "contested", falls: 1 });
    c = applyMissionResult(c, report({ success: false }), 0.5);
    expect(c.cities["seoul-stream"].state).toBe("fallen");
    c = applyMissionResult(c, report(), 0.5);
    expect(c.cities["seoul-stream"]).toMatchObject({ state: "defended", defenses: 1, falls: 2 });
  });

  it("표류 벡터 — 격멸 성공마다 진원 방향으로 1건 누적(지터 ±0.25rad 내)", () => {
    const c = applyMissionResult(CAMPAIGN_DEFAULTS(), report(), 0.5); // u=0.5 → 지터 0
    expect(c.driftVectors).toHaveLength(1);
    const v = c.driftVectors[0];
    expect(v.x).toBeCloseTo(126.98); // 도시 경위도 보존
    const exact = Math.atan2(-(DRIFT_ORIGIN.lat - 37.58), DRIFT_ORIGIN.lon - 126.98);
    expect(Math.atan2(v.dz, v.dx)).toBeCloseTo(exact, 5);
    // guard 성공은 벡터를 남기지 않는다(격멸 전용)
    const g = applyMissionResult(CAMPAIGN_DEFAULTS(), report({ goalType: "guard" }), 0.5);
    expect(g.driftVectors).toHaveLength(0);
  });

  it("삼각측량 교점 — 3장+벡터 3건부터 진원이 드러난다", () => {
    const c: CampaignData = {
      ...CAMPAIGN_DEFAULTS(), chapter: 3,
      driftVectors: [0, 0.3, 0.9].map((u) => driftVectorFor("s", 37, 127, u)),
    };
    expect(driftConvergence(c)).toMatchObject({ show: true, lat: DRIFT_ORIGIN.lat, lon: DRIFT_ORIGIN.lon });
    expect(driftConvergence({ ...c, chapter: 2 }).show).toBe(false);
    expect(driftConvergence({ ...c, driftVectors: c.driftVectors.slice(0, 2) }).show).toBe(false);
  });

  it("자매쌍 — 짝 함락 시 파문 가중, 양쪽 방어 시 유대 적립", () => {
    expect(pairedCity("seoul-stream")).toBe("busan-stream");
    expect(pairedCity("everest-stream")).toBeNull();
    let c: CampaignData = { ...CAMPAIGN_DEFAULTS(), cities: { "busan-stream": { state: "fallen", defenses: 0, falls: 2 } } };
    expect(pairAggravation(c, "seoul-stream")).toBe(0.8);
    expect(pairAggravation(c, "everest-stream")).toBe(1);
    c = { ...c, cities: { ...c.cities, "busan-stream": { state: "defended", defenses: 1, falls: 0 } } };
    const after = applyMissionResult(c, report(), 0.5);
    expect(after.pairs["seoul-stream"]).toEqual({ linked: "busan-stream", bond: 1 });
  });

  it("전이 결과는 항상 저장 검증을 통과하고 원본은 불변", () => {
    const c0 = CAMPAIGN_DEFAULTS();
    const c1 = applyMissionResult(c0, report(), 0.7);
    expect(validateCampaign(c1)).toBe(true);
    expect(c0.driftVectors).toHaveLength(0); // 순수성
    expect(c0.cities).toEqual({});
  });
});

describe("챕터 가중 미션 선택기(규칙 기반 감독 — §10 단계 0)", () => {
  const pool = [
    mission("guard-landmark", "guard"),
    mission("grand-purge", "purge-all", 80),
    mission("skirmish", "purge", 15),
    mission("last-stand", "survive"),
  ];

  it("장별 가중 — 1장 방어 / 2장 대형 격멸 / 4장 생존 우선", () => {
    expect(missionWeight(pool[0], 1)).toBeGreaterThan(missionWeight(pool[1], 1));
    expect(missionWeight(pool[1], 2)).toBeGreaterThan(missionWeight(pool[0], 2));
    expect(missionWeight(pool[3], 4)).toBeGreaterThan(missionWeight(pool[1], 4));
    expect(missionWeight(pool[2], 0)).toBe(3); // 서장 — 가벼운 교전
  });

  it("실험 앵커 — 5장에서만 등장(그 외 가중 0), 등장 시 최우선", () => {
    const exp = mission(EXPERIMENT_MISSION_ID, "purge", 12);
    expect(missionWeight(exp, 4)).toBe(0);
    expect(missionWeight(exp, 5)).toBe(8);
    // 가중 0 미션은 선택되지 않는다 — u 전 구간 확인
    const c4: CampaignData = { ...CAMPAIGN_DEFAULTS(), chapter: 4 };
    for (const u of [0, 0.3, 0.6, 0.999]) {
      expect(pickCampaignMission([...pool, exp], c4, u)?.id).not.toBe(EXPERIMENT_MISSION_ID);
    }
  });

  it("가중 선택은 u 에 결정적이고 풀이 비면 null", () => {
    const c1: CampaignData = { ...CAMPAIGN_DEFAULTS(), chapter: 1 };
    expect(pickCampaignMission(pool, c1, 0)?.id).toBe("guard-landmark"); // 첫 구간 = 최대 가중 선두
    expect(pickCampaignMission(pool, c1, 0.999)?.id).toBe("last-stand");
    expect(pickCampaignMission([], c1, 0.5)).toBeNull();
  });

  it("챕터 정본 — 7개 장, 1~4장만 증거 트랙 보유", () => {
    expect(CHAPTERS).toHaveLength(7);
    expect(CHAPTERS.filter((ch) => ch.track !== null).map((ch) => ch.track))
      .toEqual(["heatmap", "pulse", "drift", "immortal"]);
  });
});

// 경계 조건 — 무한 성장 방지와 부동소수 폴백. 둘 다 "평소엔 안 보이지만 깨지면 치명적"인 자리다.
describe("표류 벡터 상한 — 무한 누적 방지", () => {
  it("격멸 성공이 반복돼도 DRIFT_VECTOR_CAP 을 넘지 않는다(오래된 것부터 밀려남)", () => {
    let c: CampaignData = CAMPAIGN_DEFAULTS();
    for (let i = 0; i < DRIFT_VECTOR_CAP + 25; i++) {
      c = applyMissionResult(c, report({ cityLat: i % 80, cityLon: i % 170 }), 0.5);
    }
    expect(c.driftVectors.length).toBe(DRIFT_VECTOR_CAP);
    expect(validateCampaign(c)).toBe(true); // 저장 스키마 상한과 일치해야 로드가 깨지지 않는다
  });

  it("실패한 격멸은 벡터를 남기지 않는다", () => {
    const c = applyMissionResult(CAMPAIGN_DEFAULTS(), report({ success: false }), 0.5);
    expect(c.driftVectors.length).toBe(0);
  });
});

describe("pickCampaignMission — 경계", () => {
  const pool = [mission("a", "purge"), mission("b", "guard"), mission("c", "survive")];

  it("u=1 이면 마지막 항목으로 폴백 — 부동소수 잔차로 루프를 빠져나가도 null 이 아니다", () => {
    expect(pickCampaignMission(pool, CAMPAIGN_DEFAULTS(), 1)).toBe(pool[pool.length - 1]);
  });

  it("u=0 이면 첫 가중 항목", () => {
    expect(pickCampaignMission(pool, CAMPAIGN_DEFAULTS(), 0)).toBe(pool[0]);
  });

  it("빈 풀은 null", () => {
    expect(pickCampaignMission([], CAMPAIGN_DEFAULTS(), 0.5)).toBeNull();
  });
});

describe("missionWeight — 장별 가중(전 챕터)", () => {
  it("3장은 격멸 우대, 5~6장은 앵커 외 균등", () => {
    expect(missionWeight(mission("p", "purge-all"), 3)).toBe(3);
    expect(missionWeight(mission("g", "guard"), 3)).toBe(1);
    for (const ch of [5, 6]) {
      expect(missionWeight(mission("p", "purge-all"), ch)).toBe(1);
      expect(missionWeight(mission("g", "guard"), ch)).toBe(1);
    }
  });

  it("4장은 생존 > 방어 > 그 외", () => {
    expect(missionWeight(mission("s", "survive"), 4)).toBe(2.5);
    expect(missionWeight(mission("g", "guard"), 4)).toBe(2);
    expect(missionWeight(mission("p", "purge"), 4)).toBe(1);
  });
});
