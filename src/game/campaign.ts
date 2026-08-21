// 캠페인 전이(P0-2, TODO §9) — 순수 모듈. 미션 결과를 증거 4트랙·챕터·도시 상태·표류 벡터·
// 자매쌍에 적립한다. THREE/DOM 비의존 → 단위 테스트(tests/campaign.test.ts).
//
// 설계 원칙(§9.0): 진행 화폐 = 증거(클리어 수가 아님) · 스토리 본체 = 세계지도(오버레이) ·
// 계시는 플레이어가 수행(동시 타격 실험 — 5장 앵커, 성공 시에만 6장 진입).
// 챕터 가중 미션 선택기(pickCampaignMission)는 **규칙 기반 감독**(§10 단계 0) — 이후 LLM 감독이
// 같은 자리(가중 결정)를 이어받아도 검증 게이트(director.ts)를 똑같이 통과한다.
//
// 표면 어휘(§9.6): 이 파일의 플레이어 노출 문자열은 전부 물리 어휘(열지도·박자·방향·실험)만 쓴다.

import type { CampaignData, DriftVector } from "../core/progress";
import { DRIFT_VECTOR_CAP } from "../core/progress";
import type { MissionSpecV2 } from "./missionV2";
import { deployKillCredits } from "./missionV2";

// ─────────────────────────── 챕터 정본(§9.1) ───────────────────────────

export type EvidenceKey = "heatmap" | "pulse" | "drift" | "immortal";

export interface ChapterMeta {
  id: number;
  title: string; //     장 제목("국문 / ENGLISH" 규격은 UI 몫 — 여기선 국문)
  question: string; //  장마다 답하는 질문 하나
  brief: string; //     출격 전 수사 방향 안내(허용 어휘만)
  track: EvidenceKey | null; // 이 장이 모으는 증거(서장·실험·재독은 null)
}

export const CHAPTERS: readonly ChapterMeta[] = [
  { id: 0, title: "서장 — 첫 접촉", question: "무엇이 왔는가", track: null,
    brief: "미확인 발광체 침공 확인. 교전하고 색온도 분류를 확립하라." },
  { id: 1, title: "1장 — 열지도", question: "왜 이 도시들인가", track: "heatmap",
    brief: "침공이 오래 머문 자리부터 향한다. 얽힘이 짙은 장소를 방어하고 표적 패턴을 기록하라." },
  { id: 2, title: "2장 — 같은 박자", question: "왜 같은 박자로 뛰는가", track: "pulse",
    brief: "개체들의 명멸이 대륙을 건너 동기화된다. 대량 교전으로 경직 파형을 관측하라." },
  { id: 3, title: "3장 — 죽음의 방향", question: "죽은 것은 어디로 흐르나", track: "drift",
    brief: "소산 입자가 한 방향으로 흐른다. 격멸을 완수하고 표류 벡터를 지도에 남겨라." },
  { id: 4, title: "4장 — 격멸의 무의미", question: "왜 잡아도 줄지 않나", track: "immortal",
    brief: "격멸 누계와 재침공은 무상관이다. 무너졌던 도시를 다시 지켜 재출현 기록을 모아라." },
  { id: 5, title: "5장 — 실험", question: "…하나인가?", track: null,
    brief: "증거가 모였다. 다수 개체를 동시에 조사(照射)하면 무엇이 드러나는지 확인하라." },
  { id: 6, title: "6장 — 재독", question: "어떻게 이기는가", track: null,
    brief: "모든 기록을 다시 읽는다. 절단이 아니라 봉합이 답이다." },
] as const;

export const chapterMeta = (c: CampaignData): ChapterMeta => CHAPTERS[Math.min(6, Math.max(0, c.chapter))];

/** 계시 이후(6장) 여부 — 점수판 문법·명칭 갱신(재독 패키지)의 게이트. */
export const revealed = (c: CampaignData): boolean => c.chapter >= 6;

// ─────────────────────────── 자매쌍(§9.2-3) — 현재 등록 도시 기준 ───────────────────────────

/** 얽힘 자매도시 쌍 — 도시 카탈로그 확장(§9.7) 시 데이터로 승격. 지금은 등록 3도시 중 서울↔부산. */
export const PAIR_DEFS: readonly { a: string; b: string }[] = [
  { a: "seoul-stream", b: "busan-stream" },
];

export const pairedCity = (id: string): string | null => {
  for (const p of PAIR_DEFS) {
    if (p.a === id) return p.b;
    if (p.b === id) return p.a;
  }
  return null;
};

/**
 * 자매쌍 난이도 전이 — 짝 도시가 무너져 있으면 이 도시의 침공이 거세진다(파문 주기 단축 배수).
 * 한쪽 성패가 쌍에 전이되는 §9.2-3 의 최소 구현(추가 축은 도시 카탈로그와 함께).
 */
export function pairAggravation(c: CampaignData, cityId: string): number {
  const linked = pairedCity(cityId);
  if (!linked) return 1;
  const st = c.cities[linked]?.state;
  return st === "fallen" ? 0.8 : st === "contested" ? 0.9 : 1; // sweepPeriodMul 에 곱(작을수록 잦음)
}

// ─────────────────────────── 미션 결과 → 캠페인 전이 ───────────────────────────

/** 미션 1회의 캠페인 관점 요약 — Game.endMission 이 인스턴스/집계에서 구성. */
export interface MissionReport {
  cityId: string;
  missionId: string;
  goalType: string; //   MissionGoal["type"]
  success: boolean;
  kills: number;
  zenoFreezes: number;
  cityLat: number; //    표류 벡터 기록용(도시 위경도)
  cityLon: number;
}

/** 소산 표류의 진원 — 서태평양 해구(서사편 §1: 심해 균열). 3장 삼각측량의 교점. */
export const DRIFT_ORIGIN = { lat: 11.35, lon: 142.2 } as const;

const EVIDENCE_CAP = 100;
const GAIN = 16; //        정공법 1회 이득 — 장당 6~7회 수렴(계시까지 25~35출격 목표, §9.0)
const GAIN_STRONG = 22; // 장 취지에 정확히 부합(대형 격멸·유서 깊은 랜드마크 방어 등)

const isPurge = (g: string): boolean => g === "purge" || g === "purge-all" || g === "purge-role";
const isGuard = (g: string): boolean => g === "guard" || g === "suture";

/**
 * 미션 1회의 증거 이득(트랙별) — 순수. 한 미션이 여러 트랙에 걸칠 수 있다(대량 격멸=박자+방향).
 * `wasReDefense` = 무너진 적 있는 도시의 재방어(④불멸성).
 */
export function evidenceGains(r: MissionReport, wasReDefense: boolean): Partial<Record<EvidenceKey, number>> {
  if (!r.success) return {};
  const g: Partial<Record<EvidenceKey, number>> = {};
  if (isGuard(r.goalType)) {
    g.heatmap = /deep-roots|guard-landmark|bodyguard/.test(r.missionId) ? GAIN_STRONG : GAIN;
  }
  if (r.kills >= 20) g.pulse = (r.kills >= 60 ? GAIN_STRONG : GAIN) + Math.min(6, Math.floor(r.zenoFreezes / 3) * 2);
  if (isPurge(r.goalType)) g.drift = GAIN;
  if (wasReDefense) g.immortal = GAIN + 4;
  return g;
}

/** 표류 벡터 1건 — 도시 위경도에서 진원 방향(+지터 u∈[0,1)). 지도 오버레이가 그대로 화살표로 그린다. */
export function driftVectorFor(cityId: string, lat: number, lon: number, u: number): DriftVector {
  const dLon = DRIFT_ORIGIN.lon - lon;
  const dLat = DRIFT_ORIGIN.lat - lat;
  const jitter = (u - 0.5) * 0.5; // ±0.25rad — 3장 전엔 "조용한 이상 데이터"(§9.2-5)
  const a = Math.atan2(-dLat, dLon) + jitter; // 지도 y 는 북위가 위(-lat 방향)
  return { cityId, x: lon, z: lat, dx: Math.cos(a), dz: Math.sin(a), };
}

/**
 * 캠페인 전이 본체 — 순수(새 객체 반환). 도시 상태 전이 + 증거 적립(현재 장 트랙 ×1, 그 외 ×0.5) +
 * 표류 벡터 누적(상한 초과 시 오래된 것 제거) + 자매쌍 유대 + 챕터 전진(서장→1장은 첫 성공,
 * 1~4장은 해당 증거 만충, 5장→6장은 실험 성공(applyRevelation)만).
 */
export function applyMissionResult(c: CampaignData, r: MissionReport, u: number): CampaignData {
  const next: CampaignData = {
    chapter: c.chapter,
    evidence: { ...c.evidence },
    cities: Object.fromEntries(Object.entries(c.cities).map(([k, v]) => [k, { ...v }])),
    driftVectors: [...c.driftVectors],
    pairs: Object.fromEntries(Object.entries(c.pairs).map(([k, v]) => [k, { ...v }])),
  };

  // 도시 상태 — 성공=방어됨(재방어 판정은 전이 전 falls 기준), 실패=침공 중→2회부터 함락.
  const city = next.cities[r.cityId] ?? { state: "contested" as const, defenses: 0, falls: 0 };
  const wasReDefense = r.success && city.falls >= 1;
  if (r.success) {
    city.state = "defended";
    city.defenses += 1;
  } else {
    city.falls += 1;
    city.state = city.falls >= 2 ? "fallen" : "contested";
  }
  next.cities[r.cityId] = city;

  // 증거 적립 — 현재 장이 찾는 트랙은 온전히, 곁가지는 절반(수사 유도 — 강제 선형 아님, §9.2-1).
  const track = chapterMeta(next).track;
  for (const [key, gain] of Object.entries(evidenceGains(r, wasReDefense)) as [EvidenceKey, number][]) {
    const mul = track === null ? 0.75 : key === track ? 1 : 0.5;
    next.evidence[key] = Math.min(EVIDENCE_CAP, next.evidence[key] + Math.round(gain * mul));
  }

  // 표류 벡터 — 격멸 성공마다 지도에 1건 누적(③의 시각 본체, 3장 전에도 조용히 쌓인다).
  if (r.success && isPurge(r.goalType)) {
    next.driftVectors.push(driftVectorFor(r.cityId, r.cityLat, r.cityLon, u));
    if (next.driftVectors.length > DRIFT_VECTOR_CAP) next.driftVectors.splice(0, next.driftVectors.length - DRIFT_VECTOR_CAP);
  }

  // 직전 출격 요약 — 자매도시 2연전 관측 보고(sortieLinkReport)의 연결 고리.
  next.lastSortie = { cityId: r.cityId, kills: r.kills };

  // 자매쌍 유대 — 쌍 양쪽이 방어됨이면 유대 +1(연출·향후 공명 보너스 기반).
  const linked = pairedCity(r.cityId);
  if (linked) {
    const bond = next.pairs[r.cityId]?.bond ?? 0;
    const both = r.success && next.cities[linked]?.state === "defended";
    next.pairs[r.cityId] = { linked, bond: both ? bond + 1 : bond };
  }

  // 챕터 전진 — 증거로만 연다(§9.0-3). 곁가지 적립으로 이미 차 있으면 연쇄 전진.
  if (next.chapter === 0 && r.success) next.chapter = 1;
  while (next.chapter >= 1 && next.chapter <= 4) {
    const t = CHAPTERS[next.chapter].track;
    if (t && next.evidence[t] >= EVIDENCE_CAP) next.chapter += 1;
    else break;
  }
  return next;
}

/** 계시(5장 실험 성공) — 6장 진입. 실험 미션 성공 경로에서만 호출(§9.0-4). */
export function applyRevelation(c: CampaignData): CampaignData {
  if (c.chapter !== 5) return c;
  return { ...c, chapter: 6 };
}

/** 계시 연출 텍스트(§9.1 5장) — 실험 성공 결과 패널. 표면 어휘만(투영·근원·필라멘트 허용). */
export const REVELATION_LINES =
  "필라멘트 감지 — 모든 접점이 하나의 근원으로 이어져 있다.\n" +
  "궤적을 재생한다… 우리는 점을 쫓고 있었다. 손가락이 아니라 손이었다.\n" +
  "분류 재독 — 개체가 아니다. 한 존재의 투영이다.";

/**
 * 자매도시 2연전 관측 보고(2장 앵커, §9.4) — 직전 출격이 이 도시의 얽힘쌍이었고 대량 소산이
 * 있었다면, 이번 출격 브리핑을 대륙 간 동시 경직 보고로 대체한다. 아니면 null.
 */
export function sortieLinkReport(c: CampaignData, cityId: string): string | null {
  if (c.chapter !== 2 || !c.lastSortie) return null;
  if (pairedCity(c.lastSortie.cityId) !== cityId || c.lastSortie.kills < 40) return null;
  return "관측 보고 — 직전 전장에서 대량 소산이 일던 순간, 이 도시의 개체들이 동시에 경직했다. 대륙을 건너, 같은 박자다.";
}

/** 재독 점수판(6장, §9.4 재독 패키지) — 계시 후 결과 문법: 절단된 투영 / 본체 1 / 봉합도. */
export function sutureReadout(kills: number, score: number): string {
  const pct = Math.min(99, Math.max(0, Math.round(score / 15)));
  return `절단된 투영 ${kills} · 본체 1 · 봉합도 ${pct}%`;
}

/** 3장 삼각측량 교점 — 벡터 3건 이상 + 3장 도달 시 진원이 지도에 드러난다(§9.4). */
export function driftConvergence(c: CampaignData): { show: boolean; lat: number; lon: number } {
  return { show: c.chapter >= 3 && c.driftVectors.length >= 3, ...DRIFT_ORIGIN };
}

// ─────────────────────────── 챕터 가중 미션 선택기(규칙 기반 감독 — §10 단계 0) ───────────────────────────

/** 5장 앵커(동시 타격 실험) 미션 id — 선택기·해금 게이트가 공유. */
export const EXPERIMENT_MISSION_ID = "experiment-strike";

/** 이 장이 지금 이 미션에서 증거를 잘 얻는가 — 선택 가중(전조 콘솔 강조와 동일 논리). */
export function missionWeight(m: MissionSpecV2, chapter: number): number {
  const g = m.goal.type;
  if (m.id === EXPERIMENT_MISSION_ID) return chapter === 5 ? 8 : 0; // 앵커 — 5장에서만 등장·강조
  switch (chapter) {
    case 0: return isPurge(g) && deployKillCredits(m.deploy) <= 25 ? 3 : 1; // 서장 — 가벼운 교전 우선
    case 1: return isGuard(g) ? 3 : 1;
    case 2: return isPurge(g) && deployKillCredits(m.deploy) >= 40 ? 3 : g === "survive" ? 2 : 1;
    case 3: return isPurge(g) ? 3 : 1;
    case 4: return g === "survive" ? 2.5 : isGuard(g) ? 2 : 1;
    default: return 1; // 5~6장 — 앵커 외 자유(재독)
  }
}

/**
 * 챕터 가중 랜덤 선택 — pickMissionV2 의 캠페인 대체(순수, u∈[0,1)). 가중 0 미션은 제외.
 * 규칙 기반 감독의 "느린 결정"(출격 단위) — LLM 감독(§10 단계 1)이 이 가중을 이어받을 수 있다.
 */
export function pickCampaignMission(pool: readonly MissionSpecV2[], c: CampaignData, u: number): MissionSpecV2 | null {
  const w = pool.map((m) => missionWeight(m, c.chapter));
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0 || pool.length === 0) return pool[0] ?? null;
  let t = u * total;
  for (let i = 0; i < pool.length; i++) {
    t -= w[i];
    if (t < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
