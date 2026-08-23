// 미션 명세 v2 — 승리(goal)/실패(fail)/투입(deploy)/변조(modifiers) 직교 분해(순수, THREE/DOM 비의존).
// 정본 설계·패턴 카탈로그는 docs/spec/06-missions.md.
//
// 훅 ② 복합 실패 조건부터 **런타임이 v2 를 직접 구동한다**(GameInstance → evaluateMissionV2):
// fail 4종(리스폰·시간·건물 한도·랜드마크 한도)이 goal 과 무관하게 동시 평가된다 — "격멸 + 건물 ≤N"
// 같은 복합 제약(패턴 19)이 성립. 아직 엔진이 못 구동하는 goal/deploy 는 runnableV2 가 풀에서 거른다.
// toLegacy() 는 v1(구 계약) 내보내기/문서화용으로 유지.

import type { MissionSpec, MissionOutcome, MissionRuntime } from "./mission";
import type { PlasmoidArchetype } from "../enemies/PlasmoidSpec";

// ─────────────────────────── 승리(goal) ───────────────────────────

export type MissionGoal =
  | { type: "purge"; count: number } //                       N기 격멸
  | { type: "purge-role"; role: PlasmoidArchetype | "elite" | "boss" } // 특정 직무만 전멸(잡몹 무시 가능)
  | { type: "purge-all" } //                                  투입 전량 격멸(로스터전)
  | { type: "survive"; seconds: number } //                   시간 생존
  | { type: "guard"; target: "landmarks" | "buildings"; hold: number } // 대상 사수 + 유지 시간(s)
  | { type: "suture"; gauge: number } //                      봉합 게이지(다단계 — 물리편 §2.4)
  | { type: "score"; target: number } //                      공명 점수 목표
  | { type: "experiment"; targets: number; hold: number } //  동시 조사 실험(§9 5장 앵커) — targets기 동시 관측을 hold초 유지
  | { type: "free-roam" }; //                                 탐방 — 목표/종료 없음

// ─────────────────────────── 실패(fail) — 복수 조합 ───────────────────────────

export interface MissionFail {
  respawns: number; //        리스폰 예산. <0 = 무한
  timeLimit: number; //       격멸형 시간 초과 실패(s). 0 = 무제한. survive/guard 는 goal 이 승리 타이머
  maxBuildingLoss: number; // 건물 손실 한도(도달 시 실패). 0 = 미사용
  maxLandmarkLoss: number; // 랜드마크 손실 한도. 0 = 미사용
}

// ─────────────────────────── 투입(deploy) ───────────────────────────

/** 유닛 배치 진형 — cluster: 링 위 한 점 밀집(기본) · ring: 전장 중심 포위 · line: 전선(중심을 바라보는 가로열). */
export type UnitFormation = "cluster" | "ring" | "line";

/**
 * 유닛 행동 — hunt: 현행 어그로(기본) · hold: 배치 지점 고수 · patrol: 유닛 중심 주위 순찰 ·
 * escort: `anchor` 유닛 추종(호위). hunt 외 행동도 **사거리 내 기회 공격은 수행**하며(낙인탄·드레인·접촉),
 * **피격(provoked) 시 진형을 버리고 hunt 로 전환** — 축을 건드리면 그 축이 응답한다.
 */
export type UnitBehavior = "hunt" | "hold" | "patrol" | "escort";

/**
 * 조합 단위(조합/진형/행동 정립 — 06-missions §6-8단계).
 * shield(훅 ⑤): 같은 투입의 다른 유닛(호위)이 살아있는 동안 받는 피해 배수(0..1) — "호위 붕괴".
 * anchor: escort 행동의 호위 대상 유닛 인덱스(units 배열 기준 — **escort 유닛보다 앞에 선언**되어야 함).
 */
export interface RosterUnit {
  role: PlasmoidArchetype | "elite" | "boss";
  count: number;
  hp: number; // 개체당 체력
  shield?: number;
  formation?: UnitFormation; // 기본 cluster
  behavior?: UnitBehavior; //  기본 hunt
  anchor?: number; //          escort 대상 유닛 인덱스
}

/** 보스 투입 확장(훅 ⑤) — 분출(성숙체)·소유 파문·그룹 수(쌍생)·회복 링크. */
export interface BossDeployExt {
  emit?: { role: PlasmoidArchetype; hp: number; count: number; interval: number }; // 잡몹 주기 분출
  ownSweep?: boolean; //  파문 원점이 살아있는 보스를 따라간다
  groups?: number; //     보스 그룹 수(기본 1 — 쌍생 = 2). purge-all/purge-role(boss) 크레딧 = groups
  healLink?: { range: number; rate: number }; // 그룹 간 상호 회복(range 내, 초당 rate)
}

export type MissionDeploy =
  | { model: "pyramid"; count: number; totalHp: number; bossHp: number; concurrentCap: number; reinforceInterval: number; spawnRadius: number } // 현행 점진 증원
  | { model: "horde"; count: number; unitHp: number; concurrentCap: number; reinforceInterval: number; spawnRadius: number } // 대량 저체력 군집
  | { model: "roster"; units: RosterUnit[]; spawnRadius: number } //                       고정 조합(증원 없음)
  | ({ model: "boss"; bossHp: number; projections?: number; escort?: RosterUnit[]; spawnRadius: number } & BossDeployExt) // 보스 ± 수행원(훅 ⑤ 확장)
  | { model: "phased"; phases: MissionPhase[] } //                                         다단계(훅 ⑥ — 페이즈 = HUD 웨이브 표기)
  | { model: "none" }; //                                                                  미투입(탐방 등 — 웨이브/스폰 없음)

/** 페이즈 실행 단위(훅 ⑥) — phased/none 을 제외한 기본 투입만. */
export type MissionDeployAction = Exclude<MissionDeploy, { model: "phased" } | { model: "none" }>;

/**
 * 미션 페이즈(훅 ⑥) — afterSec 지정 시 미션 경과 그 시점에 투입(밀물 — 잔존과 겹칠 수 있음),
 * 미지정 시 이전 페이즈 전멸(fieldCleared) 때 투입. 킬/채점 카운터는 페이즈를 관통해 누적된다.
 */
export interface MissionPhase {
  deploy: MissionDeployAction;
  afterSec?: number;
}

// ─────────────────────────── 변조(modifiers) ───────────────────────────

export interface MissionModifiers {
  sweepPeriodMul?: number; // 파문 주기 배수(<1 = 잦게)
  zoneShrink?: { everySec: number; step: number; minRadius: number }; // 구역 축소
  freqRegenMul?: number; // 게이지 회복 배수(옅은 장 — 물리편 §2.5)
  aggro?: "player" | "landmark" | "building"; // 어그로 성향(랜드마크 직행 등)
  buildingBrands?: boolean; // 건물/랜드마크 낙인 허용(공성 낙인 — 커터 단계)
  /**
   * 비표적 처치 1기당 시간 차감(s) — `purge-role` 전용. 0/미지정 = 비용 없음.
   *
   * 왜: 표적만 세는 미션인데 잡몹 처치에 아무 대가가 없으면 최적해가 늘 "전부 죽인다"로 수렴해
   * "골라 죽이기"라는 미션 문법이 성립하지 않는다. 시간을 깎아 **선택**을 강제한다.
   */
  offTargetPenalty?: number;
  /**
   * 처치 HP 환수 배수(0 = 환수 없음, 미지정 = 1). 생존 미션에서 낮춘다.
   *
   * 왜: 처치가 위협 감소 + 체력 회복까지 겸하면 `survive` 에서도 교전이 항상 이득이라 회피가
   * 선택지가 되지 않는다. 증원이 처치를 즉시 메우므로(concurrentCap), 환수를 빼면 "굳이 다 잡을
   * 이유"가 사라진다.
   */
  killHealMul?: number;
}

// ─────────────────────────── 명세 ───────────────────────────

export interface MissionSpecV2 {
  id: string;
  name: string; // 표시명 "국문 / ENGLISH" — 표면 어휘 규칙 준수(06-missions §7)
  brief?: string; // 브리핑 한 줄(세계관 통로) — 표면 어휘만
  goal: MissionGoal;
  fail: MissionFail;
  deploy: MissionDeploy;
  zoneRadius: number; // 작전구역(m). 0 = 무제한
  modifiers?: MissionModifiers;
}

// ─────────────────────────── v1 변환 ───────────────────────────

/** 변조가 실질적으로 비었는가(현 엔진은 변조 미지원 — 값이 있으면 변환 불가). */
function noModifiers(m?: MissionModifiers): boolean {
  return !m || Object.values(m).every((v) => v === undefined);
}

/**
 * v2 → v1 변환(순수) — 현 엔진이 구동 가능한 부분집합만:
 * goal `purge`/`survive`/`guard` × deploy `pyramid` × 변조 없음. 그 외는 null(엔진 훅 도입 시 해제).
 * guard 는 한도 축(fail)과 함께 v1 kind 로 내린다: landmarks → defend-landmark(한도 기본 1),
 * buildings → defend-buildings(fail.maxBuildingLoss 필수).
 */
export function toLegacy(v2: MissionSpecV2): MissionSpec | null {
  if (v2.deploy.model !== "pyramid" || !noModifiers(v2.modifiers)) return null;
  const d = v2.deploy;
  const base = {
    id: v2.id,
    name: v2.name,
    respawns: v2.fail.respawns,
    zoneRadius: v2.zoneRadius,
    spawnCount: d.count,
    spawnRadius: d.spawnRadius,
    totalHp: d.totalHp,
    bossHp: d.bossHp,
    concurrentCap: d.concurrentCap,
    reinforceInterval: d.reinforceInterval,
    killTarget: 0,
    maxBuildingLoss: 0,
    maxLandmarkLoss: 0,
  };
  switch (v2.goal.type) {
    case "purge":
      // v1 eradicate 는 손실 한도 미평가 — 한도가 걸린 purge(정밀 정화)는 훅 ② 전까지 변환 불가
      if (v2.fail.maxBuildingLoss > 0 || v2.fail.maxLandmarkLoss > 0) return null;
      return { ...base, kind: "eradicate", duration: v2.fail.timeLimit, killTarget: v2.goal.count };
    case "survive":
      return { ...base, kind: "survival", duration: v2.goal.seconds };
    case "guard":
      if (v2.goal.target === "landmarks") {
        return { ...base, kind: "defend-landmark", duration: v2.goal.hold, maxLandmarkLoss: Math.max(1, v2.fail.maxLandmarkLoss) };
      }
      if (v2.fail.maxBuildingLoss <= 0) return null; // 건물 사수엔 한도가 곧 판정 기준
      return { ...base, kind: "defend-buildings", duration: v2.goal.hold, maxBuildingLoss: v2.fail.maxBuildingLoss };
    default:
      return null; // purge-role / purge-all / suture / score — 훅 ①③⑤⑥ 대기
  }
}

// ─────────────────────────── v2 런타임(훅 ② — 복합 실패 조건) ───────────────────────────

/** 탐방(목표/종료 없음, 무한 리스폰, 구역/투입 없음) — 평화 모드 기본 미션. */
export const FREE_ROAM_V2: MissionSpecV2 = {
  id: "free-roam", name: "탐방 / EXPLORE",
  goal: { type: "free-roam" },
  fail: { respawns: -1, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
  deploy: { model: "none" },
  zoneRadius: 0,
};

/** HUD 타이머 기준(초) — 격멸형은 실패 타이머(timeLimit), 생존/사수형은 승리 타이머. 0 = 무제한. */
export function missionDurationV2(spec: MissionSpecV2): number {
  switch (spec.goal.type) {
    case "survive": return spec.goal.seconds;
    case "guard": return spec.goal.hold;
    case "free-roam": return 0;
    default: return spec.fail.timeLimit;
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 투입 명세의 총 처치 크레딧(순수) — `purge-all` 목표치를 스펙에서 도출한다.
 * 보스(다중 투영)는 그룹당 1크레딧(pyramid 큐의 보스 = count 에 포함, roster 는 count = 그룹 수).
 * phased/none 은 0(현 단계 미정의 — runnableV2 가 거른다).
 */
export function deployKillCredits(d: MissionDeploy): number {
  switch (d.model) {
    case "pyramid": return d.count;
    case "horde": return d.count;
    case "roster": return d.units.reduce((a, u) => a + u.count, 0);
    case "boss": return Math.max(1, d.groups ?? 1) + (d.escort?.reduce((a, u) => a + u.count, 0) ?? 0);
    case "phased": return d.phases.reduce((a, p) => a + deployKillCredits(p.deploy), 0);
    default: return 0;
  }
}

/** 투입에 잡몹 분출(emit)이 있는가 — purge-all 과 조합하면 목표치가 깨지므로 runnable 게이트가 거른다. */
export function deployHasEmit(d: MissionDeploy): boolean {
  if (d.model === "boss") return !!d.emit;
  if (d.model === "phased") return d.phases.some((p) => deployHasEmit(p.deploy));
  return false;
}

/** purge-role 대상 직무의 표면 표시명(§8.2 허용 어휘) — 단계 Ⅰ(계시 전) 명칭. 목표/진행 문구용. */
export const DEPLOY_ROLE_NAMES: Record<RosterUnit["role"], string> = {
  rusher: "거머리", kiter: "모기", marker: "소인체", cutter: "절단체", rewinder: "역행체", elite: "정예", boss: "거대 투영",
};

/**
 * 직무 표시명 — **명칭 갱신(§8.3)**: 인식 Ⅰ 동안은 습성별 명칭(DEPLOY_ROLE_NAMES) 그대로, 인식 Ⅱ
 * 확립(6장 재독) 후엔 개별 습성 구분이 "그것(투영체)" 하나로 합쳐진다(도감 병합과 같은 규칙 —
 * 명칭이 바뀌는 것 자체가 계시의 연출). 근원(boss)만 단일 표적 특수성으로 구분을 유지.
 */
export function deployRoleName(role: RosterUnit["role"], revealed: boolean): string {
  if (!revealed) return DEPLOY_ROLE_NAMES[role];
  return role === "boss" ? "근원 투영체" : "투영체";
}

/**
 * 특정 직무의 투입 크레딧(순수) — `purge-role` 목표치. 직무 구성이 결정적인 투입(roster/boss)만
 * 산출 가능하다: pyramid/horde 는 아키타입이 확률 혼합이라 0(→ runnableV2 가 거른다).
 * 보스는 그룹당 1크레딧(roleKills 집계와 동일 계약).
 */
export function deployRoleCredits(d: MissionDeploy, role: RosterUnit["role"]): number {
  switch (d.model) {
    case "roster": return d.units.filter((u) => u.role === role).reduce((a, u) => a + u.count, 0);
    case "boss":
      if (role === "boss") return Math.max(1, d.groups ?? 1);
      return d.escort?.filter((u) => u.role === role).reduce((a, u) => a + u.count, 0) ?? 0;
    case "phased": return d.phases.reduce((a, p) => a + deployRoleCredits(p.deploy, role), 0);
    default: return 0;
  }
}

/**
 * v2 평가(순수) — **fail 4종을 goal 과 무관하게 동시 평가**(훅 ②: "격멸 + 건물 ≤N" 성립).
 * v1 의 마감 프레임 의미론 유지: 격멸형은 목표 달성이 동시 실패보다 우선, 생존/사수형은 실패 우선.
 * 실패 우선순위: 랜드마크 → 건물 → 리스폰 → 시간(격멸형 한정). 미구동 goal(purge-role/all·suture·
 * score)은 active 고정 — 풀 편입은 runnableV2 가 거른다(훅 ③⑤⑥ 대기).
 */
/**
 * 비표적 처치 비용을 반영한 실효 경과(s). `purge-role` + `offTargetPenalty` 에서만 elapsed 보다 크다.
 * 비표적 수 = 전체 처치 − 표적 직무 처치(런타임에 새 카운터를 두지 않고 기존 집계에서 파생). 순수.
 */
export function offTargetElapsed(spec: MissionSpecV2, rt: MissionRuntime): number {
  const g = spec.goal;
  const penalty = spec.modifiers?.offTargetPenalty ?? 0;
  if (g.type !== "purge-role" || penalty <= 0) return rt.elapsed;
  const off = Math.max(0, rt.kills - (rt.roleKills?.[g.role] ?? 0));
  return rt.elapsed + off * penalty;
}

export function evaluateMissionV2(spec: MissionSpecV2, rt: MissionRuntime): MissionOutcome {
  const g = spec.goal;
  if (g.type === "free-roam") return { status: "active", progress: 0, reason: "탐방 / EXPLORE" };
  const f = spec.fail;
  const lmFail = f.maxLandmarkLoss > 0 && rt.landmarksDestroyed >= f.maxLandmarkLoss;
  const bldFail = f.maxBuildingLoss > 0 && rt.buildingsDestroyed >= f.maxBuildingLoss;
  const deathFail = f.respawns >= 0 && rt.deaths > f.respawns;
  const deathReason = g.type === "survive" ? "전멸 / WIPED OUT" : "링크 상실 / LINK LOST";
  const failReason = lmFail
    ? "랜드마크 상실 / LANDMARK LOST"
    : bldFail
      ? "도시 함락 / CITY LOST"
      : deathFail
        ? deathReason
        : null;

  switch (g.type) {
    case "purge":
    case "purge-all": {
      // purge-all 목표치는 투입 스펙에서 도출(deployKillCredits) — 별도 런타임 입력 불요
      const count = g.type === "purge" ? g.count : deployKillCredits(spec.deploy);
      const progress = count > 0 ? clamp01(rt.kills / count) : 1;
      if (count > 0 && rt.kills >= count) return { status: "success", progress: 1, reason: "격멸 완료 / CLEARED" }; // 동시 충족 시 성공 우선(v1 동일)
      if (failReason) return { status: "failed", progress, reason: failReason };
      if (f.timeLimit > 0 && rt.elapsed >= f.timeLimit) return { status: "failed", progress, reason: "시간 초과 / TIME OUT" };
      return { status: "active", progress, reason: "" };
    }
    case "purge-role": {
      // 특정 직무만 전멸 — 잡몹 처치는 목표에 안 잡힌다(직무별 집계 rt.roleKills, 훅 ③)
      const target = deployRoleCredits(spec.deploy, g.role);
      const roleKills = rt.roleKills?.[g.role] ?? 0;
      const progress = target > 0 ? clamp01(roleKills / target) : 1;
      if (target > 0 && roleKills >= target) return { status: "success", progress: 1, reason: "표적 격멸 완료 / HUNTED" };
      if (failReason) return { status: "failed", progress, reason: failReason };
      // 비표적 처치 비용 — 전체 처치에서 표적분을 뺀 수만큼 시간이 앞당겨진다(런타임 추가 입력 불요).
      if (f.timeLimit > 0 && offTargetElapsed(spec, rt) >= f.timeLimit) {
        return { status: "failed", progress, reason: "시간 초과 / TIME OUT" };
      }
      return { status: "active", progress, reason: "" };
    }
    case "survive": {
      const progress = clamp01(rt.elapsed / g.seconds);
      if (failReason) return { status: "failed", progress, reason: failReason }; // 마감 동시 충족은 실패 우선(v1 동일)
      if (rt.elapsed >= g.seconds) return { status: "success", progress: 1, reason: "사수 성공 / HELD" };
      return { status: "active", progress, reason: "" };
    }
    case "guard": {
      const progress = clamp01(rt.elapsed / g.hold);
      if (failReason) return { status: "failed", progress, reason: failReason };
      if (rt.elapsed >= g.hold) return { status: "success", progress: 1, reason: "방어 성공 / DEFENDED" };
      return { status: "active", progress, reason: "" };
    }
    case "experiment": {
      // 동시 조사 유지 — 성공 우선(격멸형과 동일 정책). 유지 시간 집계는 런타임(GameInstance) 몫.
      const hold = rt.observeHold ?? 0;
      const progress = g.hold > 0 ? clamp01(hold / g.hold) : 1;
      if (hold >= g.hold) return { status: "success", progress: 1, reason: "동시 조사 성립 / COHERENT" };
      if (failReason) return { status: "failed", progress, reason: failReason };
      if (f.timeLimit > 0 && rt.elapsed >= f.timeLimit) return { status: "failed", progress, reason: "시간 초과 / TIME OUT" };
      return { status: "active", progress, reason: "" };
    }
    default:
      return { status: "active", progress: 0, reason: "" }; // 훅 ③⑤⑥ 대기 — runnableV2 게이트가 선별
  }
}

/** 정적 목표 문구(HUD 상단 배너). revealed(§8.3 명칭 갱신) 미지정 시 인식 Ⅰ 명칭(기존 계약 유지). */
export function missionObjectiveTextV2(spec: MissionSpecV2, revealed = false): string {
  const g = spec.goal;
  switch (g.type) {
    case "purge": return `플라즈모이드 ${g.count}기 격멸 / PURGE`;
    case "survive": return `지역 사수 — 최소 손실 / SURVIVE`;
    case "guard": {
      if (g.target !== "landmarks") return `도시 방어 — 건물 손실 ${spec.fail.maxBuildingLoss}채 미만 / DEFEND`;
      const allowed = Math.max(0, spec.fail.maxLandmarkLoss - 1);
      return allowed === 0 ? `랜드마크 사수 — 파괴 0 / GUARD` : `랜드마크 사수 — 파괴 ≤${allowed} / GUARD`;
    }
    case "free-roam": return "탐방 / EXPLORE";
    case "purge-role": return `${deployRoleName(g.role, revealed)} 전멸 — ${deployRoleCredits(spec.deploy, g.role)}기 / HUNT`;
    case "purge-all": return `전량 격멸 — ${deployKillCredits(spec.deploy)}기 / CLEAR`;
    case "suture": return `균열 봉합 / SUTURE`;
    case "score": return `공명 ${g.target} 달성 / RESONATE`;
    case "experiment": return `동시 조사 — ${g.targets}기를 ${g.hold}초 붙들어라 / OBSERVE`;
  }
}

/** 실시간 진행 상세(HUD 보조) — 복합 제약(건물/랜드마크 한도)은 어느 goal 이든 병기한다. */
export function missionProgressTextV2(spec: MissionSpecV2, rt: MissionRuntime, revealed = false): string {
  const f = spec.fail;
  const limits: string[] = [];
  if (f.maxBuildingLoss > 0) limits.push(`손실 ${rt.buildingsDestroyed} / ${f.maxBuildingLoss}`);
  if (f.maxLandmarkLoss > 0 && spec.goal.type !== "guard") limits.push(`상실 ${rt.landmarksDestroyed}`);
  const withLimits = (main: string) => (limits.length ? `${main} · ${limits.join(" · ")}` : main);
  switch (spec.goal.type) {
    case "purge": return withLimits(`${Math.min(rt.kills, spec.goal.count)} / ${spec.goal.count}`);
    case "purge-all": {
      const total = deployKillCredits(spec.deploy);
      return withLimits(`${Math.min(rt.kills, total)} / ${total}`);
    }
    case "purge-role": {
      const g = spec.goal;
      const total = deployRoleCredits(spec.deploy, g.role);
      const roleKills = Math.min(rt.roleKills?.[g.role] ?? 0, total);
      // 비표적 처치 비용이 걸린 미션은 깎인 시간을 병기 — 대가가 보이지 않으면 선택이 성립하지 않는다.
      const penalty = spec.modifiers?.offTargetPenalty ?? 0;
      const off = penalty > 0 ? Math.max(0, rt.kills - (rt.roleKills?.[g.role] ?? 0)) : 0;
      const cost = off > 0 ? ` · 비표적 ${off} (−${Math.round(off * penalty)}s)` : "";
      return withLimits(`${deployRoleName(g.role, revealed)} ${roleKills} / ${total}${cost}`);
    }
    case "survive": return withLimits(`처치 ${rt.kills}`);
    case "guard":
      if (spec.goal.target === "buildings") return `손실 ${rt.buildingsDestroyed} / ${f.maxBuildingLoss}`;
      return rt.landmarksDestroyed > 0 ? `상실 ${rt.landmarksDestroyed}` : "사수 중";
    case "experiment":
      return withLimits(`동시 ${rt.observeCount ?? 0} / ${spec.goal.targets} · 유지 ${(rt.observeHold ?? 0).toFixed(1)} / ${spec.goal.hold}s`);
    case "free-roam": return "";
    default: return withLimits(`처치 ${rt.kills}`);
  }
}

// 엔진이 지원하는 변조 키(훅 ④⑥에서 해금) — 그 외 변조가 지정된 미션은 풀에서 제외.
const SUPPORTED_MODIFIERS = new Set<keyof MissionModifiers>([
  "aggro", "zoneShrink", "freqRegenMul", "sweepPeriodMul", "buildingBrands", "offTargetPenalty", "killHealMul",
]);

/**
 * 현 엔진이 구동 가능한가 — goal(purge/purge-all/purge-role/survive/guard/free-roam) ×
 * deploy 전 모델(phased 는 훅 ⑥ — 페이즈 1개 이상) × 지원 변조(aggro·zoneShrink·freqRegenMul·
 * sweepPeriodMul — buildingBrands 는 커터 단계 대기). purge-role(훅 ③)은 직무 구성이 결정적인
 * 투입에서 대상 직무 크레딧 > 0 일 때만. purge-all × 분출(emit)은 목표치가 깨지므로 불가.
 * suture·score goal 은 대기(각인/봉합 콘텐츠 단계).
 */
export function runnableV2(spec: MissionSpecV2): boolean {
  const g = spec.goal;
  const goalOk =
    g.type === "purge" || g.type === "survive" || g.type === "guard" || g.type === "free-roam" ||
    (g.type === "experiment" && g.targets > 0 && g.hold > 0) ||
    (g.type === "purge-all" && !deployHasEmit(spec.deploy)) ||
    (g.type === "purge-role" && deployRoleCredits(spec.deploy, g.role) > 0);
  const deployOk = spec.deploy.model !== "phased" || spec.deploy.phases.length > 0;
  const modifiersOk = !spec.modifiers ||
    (Object.entries(spec.modifiers) as [keyof MissionModifiers, unknown][])
      .every(([k, v]) => v === undefined || SUPPORTED_MODIFIERS.has(k));
  return goalOk && deployOk && modifiersOk;
}

/** 결과 화면 채점 입력(EnemyManager.stats 부분집합) — 표면 어휘 독해는 implements/08. */
export interface CombatScoreStats {
  markerKills: number; //      근원 격파
  zenoFreezes: number; //      관측 고정(동결 진입 수)
  sweepCleanPasses: number; // 파문 무상 통과
}

/**
 * 공명 점수(순수) — "어떻게 싸웠는가"의 집계. W5 공명 각인(서사편 §7)의 선행 형태:
 * 실패 유형이 다양할수록(정화·근원 격파·무상 통과·관측 고정) 점수가 오른다.
 */
export function resonanceScore(kills: number, st: CombatScoreStats, success: boolean): number {
  return kills * 10 + st.markerKills * 25 + st.sweepCleanPasses * 40 + st.zenoFreezes * 5 + (success ? 500 : 0);
}

/** 미션 풀에서 u∈[0,1) 비례로 하나 선택(순수 — 난수 주입). 빈 풀은 탐방으로 폴백. */
export function pickMissionV2(pool: readonly MissionSpecV2[], u: number): MissionSpecV2 {
  if (pool.length === 0) return FREE_ROAM_V2;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(u * pool.length)));
  return pool[i];
}

/** v1 → v2 어댑터(순수) — 구 JSON/외부 데이터 하위호환(로더가 goal 필드 부재 시 적용). */
export function fromLegacy(v1: MissionSpec): MissionSpecV2 {
  const deploy: MissionDeploy = v1.spawnCount > 0
    ? {
        model: "pyramid", count: v1.spawnCount, totalHp: v1.totalHp, bossHp: v1.bossHp,
        concurrentCap: v1.concurrentCap, reinforceInterval: v1.reinforceInterval, spawnRadius: v1.spawnRadius,
      }
    : { model: "none" };
  const fail: MissionFail = { respawns: v1.respawns, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 };
  const base = { id: v1.id, name: v1.name, deploy, zoneRadius: v1.zoneRadius };
  switch (v1.kind) {
    case "eradicate":
      return { ...base, goal: { type: "purge", count: v1.killTarget }, fail: { ...fail, timeLimit: v1.duration } };
    case "defend-buildings":
      return { ...base, goal: { type: "guard", target: "buildings", hold: v1.duration }, fail: { ...fail, maxBuildingLoss: v1.maxBuildingLoss } };
    case "defend-landmark":
      return { ...base, goal: { type: "guard", target: "landmarks", hold: v1.duration }, fail: { ...fail, maxLandmarkLoss: v1.maxLandmarkLoss } };
    case "survival":
      return { ...base, goal: { type: "survive", seconds: v1.duration }, fail };
    case "free-roam":
      return { ...base, goal: { type: "free-roam" }, fail };
  }
}

/**
 * 내장 미션 풀 v2 — `public/missions/index.json`(v2) 과 동치(테스트 고정).
 *
 * **변조가 미션의 체감을 가른다**: 승리 조건만 다르고 적 행동이 같으면 모든 미션이 "사냥" 하나로
 * 수렴한다(2026-08-23 실플레이 피드백). 그래서 사수형에는 aggro(표적 직행), 생존형에는
 * killHealMul: 0(교전 유인 제거), purge-role 에는 offTargetPenalty(골라 죽이기의 대가)를 건다.
 * 그 결과 1번(정화 작전)만 v1 `DEFAULT_MISSIONS` 와 `toLegacy` 동치이고 — v1 은 변조 축이 없다 —
 * 나머지는 v2 전용이다.
 */
export const DEFAULT_MISSIONS_V2: MissionSpecV2[] = [
  {
    id: "purge", name: "정화 작전 / PURGE",
    goal: { type: "purge", count: 45 },
    fail: { respawns: 3, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: { model: "pyramid", count: 45, totalHp: 70000, bossHp: 10000, concurrentCap: 26, reinforceInterval: 1.5, spawnRadius: 1500 },
    zoneRadius: 5000,
  },
  {
    id: "hold-city", name: "도시 방어 / HOLD THE CITY",
    goal: { type: "guard", target: "buildings", hold: 300 },
    fail: { respawns: 3, timeLimit: 0, maxBuildingLoss: 10, maxLandmarkLoss: 0 },
    deploy: { model: "pyramid", count: 45, totalHp: 70000, bossHp: 10000, concurrentCap: 26, reinforceInterval: 1.5, spawnRadius: 1500 },
    zoneRadius: 5000,
    modifiers: { aggro: "building" }, // 적이 건물로 직행 — 사수 미션이 실제로 '지키러 가는' 미션이 되도록
  },
  {
    id: "guard-landmark", name: "랜드마크 사수 / GUARD",
    goal: { type: "guard", target: "landmarks", hold: 300 },
    fail: { respawns: 3, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 1 },
    deploy: { model: "pyramid", count: 45, totalHp: 70000, bossHp: 10000, concurrentCap: 26, reinforceInterval: 1.5, spawnRadius: 1500 },
    zoneRadius: 5000,
    modifiers: { aggro: "landmark" }, // 적이 랜드마크로 직행 — 없으면 잃을 대상이 없어 사실상 생존전이었다
  },
  {
    id: "survive", name: "지역 사수 / SURVIVE",
    goal: { type: "survive", seconds: 300 },
    fail: { respawns: 2, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: { model: "pyramid", count: 45, totalHp: 70000, bossHp: 10000, concurrentCap: 26, reinforceInterval: 1.5, spawnRadius: 1500 },
    zoneRadius: 5000,
    modifiers: { killHealMul: 0 }, // 처치 환수 없음 — 교전이 항상 이득이면 회피가 선택지가 안 된다
  },
  {
    // 패턴 19 정밀 정화(06-missions §3-F) — 훅 ② 복합 실패 조건의 첫 소비처: 격멸 + 건물 손실 한도.
    // 광역 난사 대신 우선순위 사냥·위치 선정을 시험한다. 한도 15는 초기값(원 설계 ≤3은 어그로 변조
    // 도입 후 하향 예정) — 플레이테스트로 조정.
    id: "surgical", name: "정밀 정화 / SURGICAL",
    brief: "얽힘이 짙은 구역이다. 무너뜨리지 말고 걷어내라.",
    goal: { type: "purge", count: 40 },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 15, maxLandmarkLoss: 0 },
    deploy: { model: "pyramid", count: 40, totalHp: 60000, bossHp: 10000, concurrentCap: 22, reinforceInterval: 1.5, spawnRadius: 1200 },
    zoneRadius: 4000,
    modifiers: { aggro: "building" }, // 훅 ④ — 적이 도시만 노린다: 때려서 어그로를 끌어와야 한도가 버틴다
  },
  {
    // 패턴 15 오래 선 자리(aggro: landmark — 훅 ④) — 적이 플레이어를 무시하고 랜드마크로 직행.
    // "얽힘이 짙은 곳부터 푼다"(06-missions §8 택소노미)의 첫 체감 — 브리핑이 세계관 계시 통로.
    id: "deep-roots", name: "오래 선 자리 / DEEP ROOTS",
    brief: "오래 머문 자리일수록 얽힘이 짙다 — 그들이 먼저 노린다.",
    goal: { type: "guard", target: "landmarks", hold: 300 },
    fail: { respawns: 3, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 1 },
    deploy: { model: "pyramid", count: 45, totalHp: 70000, bossHp: 10000, concurrentCap: 26, reinforceInterval: 1.5, spawnRadius: 1500 },
    zoneRadius: 5000,
    modifiers: { aggro: "landmark" },
  },
  {
    // 패턴 1 대정화(horde — 훅 ①) — 균일 저체력 대량 군집, 살포/광역·복선 노출의 본산.
    id: "grand-purge", name: "대정화 / GRAND PURGE",
    brief: "오늘은 세는 날이 아니다 — 쓸어내는 날이다.",
    goal: { type: "purge-all" },
    fail: { respawns: 3, timeLimit: 360, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: { model: "horde", count: 150, unitHp: 350, concurrentCap: 55, reinforceInterval: 0.4, spawnRadius: 1500 },
    zoneRadius: 5000,
    modifiers: { sweepPeriodMul: 0.7 }, // 파문 잦게 — 군집전의 전장 박자 강화
  },
  {
    // 패턴 5 편대 해체(roster — 훅 ①) — 고정 조합·증원 없음: 어느 축부터 무너뜨릴지 선택하는 전투.
    id: "disband", name: "편대 해체 / DISBAND",
    brief: "저들은 편대를 이뤘다 — 축 하나를 고르면, 나머지가 무너진다.",
    goal: { type: "purge-all" },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "roster",
      units: [
        { role: "marker", count: 4, hp: 1500, behavior: "hold" },
        { role: "elite", count: 6, hp: 3500, formation: "ring", behavior: "patrol" },
        { role: "kiter", count: 8, hp: 900, behavior: "escort", anchor: 1 },
      ],
      spawnRadius: 1000,
    },
    zoneRadius: 3500,
  },
  {
    // 패턴 6 근원 사냥(purge-role — 훅 ③) — 소인체만 전멸하면 승리: 잡몹 호위를 뚫고 표적을
    // 식별·타격하는 훈련. 낙인 압력 아래에서 "근원을 격파하라"가 곧 승리 조건이 된다.
    id: "brand-hunt", name: "근원 사냥 / BRAND HUNT",
    brief: "손가락질하는 자들을 찾아라 — 심판은 그들이 없으면 오지 않는다.",
    goal: { type: "purge-role", role: "marker" },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "roster",
      units: [
        { role: "marker", count: 6, hp: 1200, behavior: "hold" },
        { role: "rusher", count: 10, hp: 400, behavior: "escort", anchor: 0 },
        { role: "kiter", count: 6, hp: 500, behavior: "escort", anchor: 0 },
      ],
      spawnRadius: 1000,
    },
    zoneRadius: 3500,
    modifiers: { offTargetPenalty: 6, sweepPeriodMul: 0.6 }, // 낙인 압력 극대 — 근원 격파의 절박함
  },
  {
    // 패턴 10 삼중 투영(boss — 훅 ①) — HP 공유 개념 숙달전(§2.6): 가장 느리고 가까운 구가 정답.
    id: "triple-projection", name: "삼중 투영 / TRIPLE PROJECTION",
    brief: "셋으로 보이는 것은 하나다 — 어느 그림자를 붙들어도 같은 손이 아파한다.",
    goal: { type: "purge-all" },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "boss", bossHp: 30000, projections: 3,
      escort: [{ role: "kiter", count: 4, hp: 800 }],
      spawnRadius: 800,
    },
    zoneRadius: 3000,
  },
  {
    // 패턴 7 호위 붕괴(shield — 훅 ⑤) — 호위 생존 중 정예 피해 30%: 걷어낼 것인가, 뚫을 것인가.
    id: "bodyguard", name: "호위 붕괴 / BODYGUARD",
    brief: "저 하나를 지키려 전부가 모였다 — 호위를 걷어내면 벽은 유리가 된다.",
    goal: { type: "purge-role", role: "elite" },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "roster",
      units: [
        { role: "elite", count: 1, hp: 12000, shield: 0.3, behavior: "hold" },
        { role: "rusher", count: 12, hp: 400, behavior: "escort", anchor: 0 },
        { role: "kiter", count: 6, hp: 500, behavior: "escort", anchor: 0 },
      ],
      spawnRadius: 900,
    },
    zoneRadius: 3500,
    modifiers: { offTargetPenalty: 6 }, // 호위를 무의미하게 몰살하지 않도록
  },
  {
    // 패턴 11 성숙체(emit + ownSweep — 훅 ⑤) — 방치 균열이 키운 거체: 파문을 소유하고 잡몹을 분출한다.
    id: "matured", name: "성숙체 / THE MATURED",
    brief: "너무 오래 두었다 — 이제 저것이 파문의 중심이다.",
    goal: { type: "purge-role", role: "boss" },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "boss", bossHp: 25000, projections: 1, spawnRadius: 700,
      emit: { role: "rusher", hp: 300, count: 3, interval: 8 },
      ownSweep: true,
    },
    zoneRadius: 3000,
  },
  {
    // 패턴 12 쌍생(groups 2 + healLink — 훅 ⑤) — 붙어 있으면 서로 되살린다: 떼어놓거나 함께 태워라.
    id: "geminate", name: "쌍생 / GEMINATE PAIR",
    brief: "둘은 서로를 되살린다 — 떼어놓거나, 함께 태워라.",
    goal: { type: "purge-all" },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "boss", bossHp: 16000, projections: 1, groups: 2, spawnRadius: 900,
      healLink: { range: 500, rate: 400 },
    },
    zoneRadius: 3500,
  },
  {
    // 패턴 9 정예 소탕(roster — 훅 ①) — 청백 정예만: 관측 고정으로 붙들고 각개격파.
    id: "cull", name: "정예 소탕 / CULL",
    brief: "떼는 없다 — 하나하나가 폭풍이다. 붙들고, 끊어라.",
    goal: { type: "purge-all" },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "roster",
      units: [{ role: "elite", count: 7, hp: 4000, formation: "ring", behavior: "patrol" }],
      spawnRadius: 900,
    },
    zoneRadius: 3000,
  },
  {
    // 패턴 8 이중 전선(roster 다지점 — 훅 ①⑥) — 고공축(모기·소인체) vs 지상축(정예·거머리):
    // 유닛별 클러스터 배치가 두 전선을 만든다. 드론 선택이 공략 순서를 결정.
    id: "two-fronts", name: "이중 전선 / TWO FRONTS",
    brief: "하늘과 땅, 두 전선이 열렸다 — 순서를 정하는 쪽이 이긴다.",
    goal: { type: "purge-all" },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "roster",
      units: [
        { role: "marker", count: 4, hp: 1200, formation: "line", behavior: "hold" },
        { role: "kiter", count: 8, hp: 900, behavior: "escort", anchor: 0 },
        { role: "elite", count: 4, hp: 3000, formation: "line", behavior: "hold" },
        { role: "rusher", count: 8, hp: 400, behavior: "escort", anchor: 2 },
      ],
      spawnRadius: 1400,
    },
    zoneRadius: 4000,
  },
  {
    // 패턴 3 최후 저지선(zoneShrink — 훅 ⑥) — 조여드는 경계 안에서 버틴다.
    id: "last-stand", name: "최후 저지선 / LAST STAND",
    brief: "물러설 자리가 줄어든다 — 경계가 닫히기 전에 버텨라.",
    goal: { type: "survive", seconds: 240 },
    fail: { respawns: 2, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: { model: "horde", count: 130, unitHp: 300, concurrentCap: 45, reinforceInterval: 0.5, spawnRadius: 1400 },
    zoneRadius: 4000,
    modifiers: { killHealMul: 0, zoneShrink: { everySec: 45, step: 800, minRadius: 1200 } },
  },
  {
    // 패턴 2 해일(phased — 훅 ⑥) — 밀물·썰물: 90초마다 더 큰 파도가 겹쳐 온다.
    id: "tide", name: "해일 / TIDE",
    brief: "파도는 세 번 온다 — 썰물에 숨을 고르라.",
    goal: { type: "survive", seconds: 270 },
    fail: { respawns: 2, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "phased",
      phases: [
        { deploy: { model: "horde", count: 45, unitHp: 300, concurrentCap: 40, reinforceInterval: 0.4, spawnRadius: 1400 } },
        { deploy: { model: "horde", count: 55, unitHp: 320, concurrentCap: 45, reinforceInterval: 0.4, spawnRadius: 1400 }, afterSec: 90 },
        { deploy: { model: "horde", count: 65, unitHp: 350, concurrentCap: 50, reinforceInterval: 0.35, spawnRadius: 1400 }, afterSec: 180 },
      ],
    },
    zoneRadius: 4500,
    modifiers: { killHealMul: 0 }, // 처치 환수 없음 — 썰물에 숨 고르기가 유효하도록
  },
  {
    // 패턴 20 옅은 장(freqRegenMul — 훅 ⑥) — 게이지 회복 절반: 볼리 한 발의 가치가 오른다.
    id: "thin-field", name: "옅은 장 / THIN FIELD",
    brief: "이곳의 장은 옅다 — 한 발 한 발이 값이다.",
    goal: { type: "purge-all" },
    fail: { respawns: 2, timeLimit: 300, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "roster",
      units: [
        { role: "elite", count: 5, hp: 3000 },
        { role: "marker", count: 4, hp: 1200 },
        { role: "kiter", count: 6, hp: 700 },
      ],
      spawnRadius: 900,
    },
    zoneRadius: 3000,
    modifiers: { freqRegenMul: 0.5 },
  },
  {
    // 커터 콘텐츠(P3 — §6.3 의존성 절단, 20종 카탈로그 밖 신규). 절단체가 건물을 뿌리째 들어올린다:
    // 격추하면 재안착(W4 복구 사격으로 가속) — "쏘는 것"과 "되돌리는 것"이 같은 무기. (패턴 17 공성
    // 낙인/SIEGE BRAND — buildingBrands 변조 — 는 별도 미션 siege-brand.)
    id: "severance", name: "절단 공성 / SEVERANCE",
    brief: "그들이 건물을 뿌리째 들어올린다 — 떨어뜨려라. 떨어지면 다시 붙는다.",
    goal: { type: "guard", target: "landmarks", hold: 240 },
    fail: { respawns: 3, timeLimit: 0, maxBuildingLoss: 25, maxLandmarkLoss: 1 },
    deploy: {
      model: "roster",
      units: [
        { role: "cutter", count: 6, hp: 2200 },
        { role: "marker", count: 3, hp: 1200 },
        { role: "rusher", count: 6, hp: 900 },
      ],
      spawnRadius: 1200,
    },
    zoneRadius: 3500,
    modifiers: { aggro: "landmark" },
  },
  {
    // 패턴 17 공성 낙인 / SIEGE BRAND(06-missions §7 — P3 buildingBrands 편입). 소인체가 랜드마크에
    // 낙인탄을 발사 — 심판 파문이 오기 전에 마커를 끊거나(마커 우선 격파) 랜드마크에서 떼어놔야 한다.
    id: "siege-brand", name: "공성 낙인 / SIEGE BRAND",
    brief: "저들이 벽에 낙인을 새긴다 — 파문이 오기 전에 마커를 끊어라.",
    goal: { type: "guard", target: "landmarks", hold: 260 },
    fail: { respawns: 3, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 1 },
    deploy: {
      model: "roster",
      units: [
        { role: "marker", count: 10, hp: 1100 },
        { role: "rusher", count: 5, hp: 900 },
      ],
      spawnRadius: 1300,
    },
    zoneRadius: 4200,
    modifiers: { aggro: "landmark", buildingBrands: true },
  },
  {
    // 역행체 사냥(P3 §6.6) — 미니보스 슬롯 우선순위 표적 플레이. 시전을 못 끊으면 전과가 되감긴다:
    // 잡몹을 아무리 잡아도 역행체가 살아있는 한 처치 수가 줄어드는 미션(purge-role 이 정답 구조).
    id: "retro-hunt", name: "역행 사냥 / RETROGRADE HUNT",
    brief: "잡은 것이 되돌아온다 — 세지 말고, 시전자를 끊어라.",
    goal: { type: "purge-role", role: "rewinder" },
    fail: { respawns: 2, timeLimit: 420, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "roster",
      units: [
        // hunt(접근 유영) — hold 배치는 시전 사거리(360m) 밖에 정박해 역행이 발동하지 않는다(e2e 검증)
        { role: "rewinder", count: 2, hp: 7000 },
        { role: "rusher", count: 8, hp: 1000 },
        { role: "marker", count: 2, hp: 1200 },
      ],
      spawnRadius: 900,
    },
    zoneRadius: 3000,
    modifiers: { offTargetPenalty: 8 }, // 되살아나는 잡몹을 세지 말고 시전자를 끊도록
  },
  {
    // 캠페인 5장 앵커(§9.1) — 동시 조사 실험. 격멸이 아니라 "동시에 붙들기"가 목표(관측이 무기).
    // 성공 = 인식 Ⅱ 계시(Game.endMission 이 applyRevelation — 6장 진입). 선택기는 5장에서만 노출.
    id: "experiment-strike", name: "동시 조사 실험 / THE EXPERIMENT",
    brief: "넷을 한 번에 붙들어라 — 그들이 정말 여럿인지 확인한다.",
    goal: { type: "experiment", targets: 4, hold: 5 },
    fail: { respawns: 3, timeLimit: 420, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
    deploy: {
      model: "roster",
      units: [
        { role: "rusher", count: 8, hp: 1400, formation: "ring", behavior: "patrol" },
        { role: "kiter", count: 6, hp: 1000, behavior: "hold" },
      ],
      spawnRadius: 700,
    },
    zoneRadius: 2500,
  },
];
