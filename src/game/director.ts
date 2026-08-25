// Director — 게임 세계를 조작하는 감독 인터페이스(순수, THREE/DOM 비의존).
//
// 원칙: **"느린 마음, 빠른 손"** — 틱 루프(전술: 조향·공격·파문 실행)는 엔진이 결정론적으로 돌리고,
// 감독은 주기/이벤트 경계(파문·증원·페이즈)에서 **스키마가 강제된 노브만** 돌린다. LLM 은 이
// 인터페이스의 한 구현일 뿐이며(단계 1+ — docs/TODO.md §10), 규칙 기반 구현(P0 캠페인 선택기)이
// 기본이자 폴백이다 — 감독 부재/지연 시 게임은 완전 동작(우아한 강등).
//
// 서사 동형성(⚠️ 서사편 §1.10): 이 구조는 세계관의 실구현이다 — 본체(정리 작업 에이전트)의 개입이
// 파문·재시도 주기로 나타난다는 설정 = 감독의 개입 경계. 감독 결정 로그는 사고 로그 파편의 원천.
// 플레이어 노출 문자열은 반드시 표면 어휘 게이트(surfaceVocab)를 통과한다.

import type { MissionDeployAction, MissionModifiers, MissionSpecV2 } from "./missionV2";
import { deployKillCredits, runnableV2 } from "./missionV2";
import { surfaceClean } from "./surfaceVocab";
import type { MissionRuntime } from "./mission";

// ─────────────────────────── 관측(스냅샷) ───────────────────────────

/**
 * 인스턴스 집계 스냅샷 — 감독의 관측 입력. 원시 엔티티가 아니라 **집계치만**(토큰/대역폭 절약 +
 * 감독이 전술 개입할 수 없는 구조적 보장). 세계층(캠페인) 스냅샷은 CampaignState 정립 시 확장.
 */
export interface DirectorSnapshot {
  missionId: string;
  goalType: MissionSpecV2["goal"]["type"];
  runtime: MissionRuntime; // elapsed·kills·roleKills·손실·deaths
  respawnsLeft: number;
  aliveEnemies: number;
  reinforceQueued: number; // 잔여 증원(0 = 전장 소진 중)
  brandCount: number; //     플레이어 낙인 수
  score: number; //          현재 공명 점수(러버밴딩 입력)
  players: { count: number; avgHpFrac: number }; // 팀 규모·평균 체력 비율
}

// ─────────────────────────── 행동(액션) ───────────────────────────

/**
 * 감독 행동 — 전부 기존 엔진 노브의 재사용(신규 치트 경로 없음):
 * set-modifiers → setAggro/setSweepPeriodMul/freqRegenMul · reinforce → runDeploy(fresh=false) ·
 * brief → HUD 통신 메시지(엔진 훅 🔭 — 스키마만 선행) · none → 개입 없음(기본).
 */
export type DirectorAction =
  | { type: "none" }
  | { type: "set-modifiers"; modifiers: Pick<MissionModifiers, "aggro" | "sweepPeriodMul" | "freqRegenMul"> }
  | { type: "reinforce"; deploy: MissionDeployAction }
  | { type: "brief"; text: string };

/** 감독 인터페이스 — 구현: 규칙 기반(P0 캠페인 선택기) → LLM(단계 1 파일럿 → 단계 2 서버 상주). */
export interface Director {
  /** 주기/이벤트 경계에서 호출 — 다음 안전 경계(파문·증원·페이즈)에 적용할 행동들을 반환. */
  decide(snapshot: DirectorSnapshot): Promise<DirectorAction[]>;
}

// ─────────────────────────── 검증 게이트(밸런스 봉투) ───────────────────────────

/** 감독 행동의 허용 범위 — LLM 폭주를 구조적으로 차단하는 봉투. 조정은 이 상수에서만. */
export const DIRECTOR_LIMITS = {
  sweepPeriodMul: { min: 0.4, max: 2.0 }, //  파문 주기 배수 허용 범위
  freqRegenMul: { min: 0.5, max: 1.5 }, //    게이지 회복 배수 허용 범위
  reinforceMaxCredits: 30, //                 1회 증원 상한(처치 크레딧 기준)
  briefMaxLen: 200, //                        통신 메시지 길이 상한
} as const;

/**
 * 감독의 **한시 변조** 상태(순수). 감독이 건 배수를 영구 적용하면 복구 경로가 없다 — 출격 시작만이
 * 유일한 재설정 지점이라 한 번 걸리면 그 출격 내내 풀리지 않는다. freqRegenMul 0.5 에서는 오토파이어
 * (입력 무관 상시 소모)가 회복을 추월해 게이지가 0 에 고착됐다(2026-08-25 버그). "가만히 두면 기준값으로
 * 돌아간다"를 자료구조로 강제해, 감독이 유지를 원하면 매 주기 재선언하도록 뒤집는다.
 */
export interface TimedMod {
  mul: number; // 현재 적용 배수
  left: number; // 잔여(s). 0 이하 = 기준값 적용 중
}

/** 변조 없음(= 미션 기준값 그대로). */
export function baseMod(base: number): TimedMod {
  return { mul: base, left: 0 };
}

/** 변조 적용/갱신 — 같은 값 재선언은 시계만 갱신(changed=false → 호출부가 고지를 생략해 배너 도배 방지). */
export function setMod(cur: TimedMod, mul: number, durationSec: number): { next: TimedMod; changed: boolean } {
  return { next: { mul, left: durationSec }, changed: cur.mul !== mul };
}

/** 1프레임 감쇠 — 잔여가 0 이하로 떨어지면 기준값 복귀. expired=기준값과 달랐던 것이 실제로 되돌아감. */
export function stepMod(cur: TimedMod, base: number, dt: number): { next: TimedMod; expired: boolean } {
  if (cur.left <= 0) return { next: cur, expired: false };
  const left = cur.left - dt;
  if (left > 0) return { next: { mul: cur.mul, left }, expired: false };
  return { next: { mul: base, left: 0 }, expired: cur.mul !== base };
}

export type DirectorVerdict =
  | { ok: true; action: DirectorAction }
  | { ok: false; reason: string };

/**
 * 감독 행동 검증(순수) — 스키마·봉투·표면 어휘를 서버측에서 강제한다. 통과분만 엔진에 적용되고,
 * 거부는 사유와 함께 감사 로그로 남긴다(감독 품질 계측 + 사고 로그 파편 원천).
 */
export function validateDirectorAction(action: DirectorAction): DirectorVerdict {
  switch (action.type) {
    case "none":
      return { ok: true, action };
    case "set-modifiers": {
      const m = action.modifiers;
      const keys = Object.keys(m) as (keyof typeof m)[];
      if (keys.length === 0) return { ok: false, reason: "empty-modifiers" };
      for (const k of keys) {
        if (k === "aggro") {
          if (m.aggro !== undefined && !["player", "landmark", "building"].includes(m.aggro)) {
            return { ok: false, reason: "bad-aggro" };
          }
        } else if (k === "sweepPeriodMul" || k === "freqRegenMul") {
          const v = m[k];
          const lim = DIRECTOR_LIMITS[k];
          if (v !== undefined && (typeof v !== "number" || v < lim.min || v > lim.max)) {
            return { ok: false, reason: `out-of-envelope:${k}` };
          }
        } else {
          return { ok: false, reason: `unsupported-modifier:${String(k)}` };
        }
      }
      return { ok: true, action };
    }
    case "reinforce": {
      const credits = deployKillCredits(action.deploy);
      if (credits <= 0) return { ok: false, reason: "empty-deploy" };
      if (credits > DIRECTOR_LIMITS.reinforceMaxCredits) return { ok: false, reason: "reinforce-too-large" };
      // 투입 자체가 엔진 구동 가능해야 함 — 최소 스펙으로 감싸 runnable 게이트 재사용
      const probe: MissionSpecV2 = {
        id: "__director", name: "감독 증원 / DIRECTOR",
        goal: { type: "survive", seconds: 1 },
        fail: { respawns: -1, timeLimit: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0 },
        deploy: action.deploy, zoneRadius: 0,
      };
      if (!runnableV2(probe)) return { ok: false, reason: "deploy-not-runnable" };
      return { ok: true, action };
    }
    case "brief": {
      const t = action.text?.trim();
      if (!t) return { ok: false, reason: "empty-brief" };
      if (t.length > DIRECTOR_LIMITS.briefMaxLen) return { ok: false, reason: "brief-too-long" };
      if (!surfaceClean(t)) return { ok: false, reason: "surface-vocab-violation" }; // 반전 누설 차단(§8.1)
      return { ok: true, action };
    }
    default:
      return { ok: false, reason: "unknown-action" };
  }
}

/** 행동 목록 일괄 검증 — 통과분과 거부 사유를 분리 반환(감사 로그용). */
export function validateDirectorActions(actions: readonly DirectorAction[]): {
  accepted: DirectorAction[];
  rejected: { action: DirectorAction; reason: string }[];
} {
  const accepted: DirectorAction[] = [];
  const rejected: { action: DirectorAction; reason: string }[] = [];
  for (const a of actions) {
    const v = validateDirectorAction(a);
    if (v.ok) accepted.push(v.action);
    else rejected.push({ action: a, reason: v.reason });
  }
  return { accepted, rejected };
}
