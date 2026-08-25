// 미션 시스템 v1 (순수) — 목표/종료 조건 데이터 계약의 구버전. **런타임은 v2 로 이관됨**
// (missionV2.ts — 훅 ② 복합 실패 조건, GameInstance 가 evaluateMissionV2 사용). 이 모듈은
// v1 타입/평가기(구 JSON 하위호환 어댑터 fromLegacy 의 입력 계약)와 공용 타입(MissionRuntime/
// MissionOutcome)의 출처로 유지된다. THREE/DOM 비의존([tests/mission.test.ts]).

export type MissionKind =
  | "eradicate" //        제한시간 내 플라즈모이드 N기 격멸
  | "defend-buildings" // 제한시간 동안 건물 손실 N채 미만으로 도시 방어
  | "defend-landmark" //  제한시간 동안 랜드마크 파괴 0으로 사수
  | "survival" //         제한시간 동안 최소 기체 손실로 지역 사수
  | "free-roam"; //       탐방 — 목표/종료 없음(자유 정찰)

export type MissionStatus = "active" | "success" | "failed";

/** 미션 명세(데이터) — `public/missions/index.json` 의 한 항목. 쓰지 않는 수치는 0(kind 로 분기). */
export interface MissionSpec {
  id: string;
  name: string; //            표시명 "국문 / ENGLISH"
  kind: MissionKind;
  duration: number; //        제한시간(초). 0 = 무제한(탐방)
  killTarget: number; //      eradicate — 목표 처치 수
  maxBuildingLoss: number; // defend-buildings — 허용 손실 채수(이상이면 실패)
  maxLandmarkLoss: number; // defend-landmark — 허용 랜드마크 손실(이상이면 실패)
  respawns: number; //        리스폰 허용 횟수. <0 = 무한
  zoneRadius: number; //      교전 구역 반경(m). 0 = 무제한(구역 없음). 플레이어는 이 밖으로 못 나간다.
  spawnCount: number; //      총 투입 수(초기 투입 + 증원). 0 = 레거시 웨이브 모드
  spawnRadius: number; //     초기 투입 분산 반경(m, 시작 위치 기준). 보통 zoneRadius 보다 작게.
  totalHp: number; //         투입 플라즈모이드 체력 총합(예산). 0 = 미사용(온도 롤 HP)
  bossHp: number; //          그 중 중간보스 1기의 체력(피라미드 배분의 최상층 — 증원 큐 마지막에 등장). 0 = 보스 없음
  concurrentCap: number; //   동시 개체 수 상한(1인 기준, MP ×인원). 0 = 일괄 스폰(전량 즉시 투입 — 레거시)
  reinforceInterval: number; // 증원 간격(s) — 상한 미만일 때 균열에서 1기씩 보충. concurrentCap 0 이면 미사용
}

/** 인스턴스가 집계한 현재 플레이타임 상태(평가 입력). */
export interface MissionRuntime {
  elapsed: number; //            경과 시간(초)
  kills: number; //              누적 플라즈모이드 처치 수
  buildingsDestroyed: number; // 파괴된 일반 건물 수
  landmarksDestroyed: number; // 파괴된 랜드마크 수
  deaths: number; //             누적 기체(플레이어) 파괴 수
  /** 투입 직무별 처치 수(훅 ③ purge-role — v2 전용, EnemyManager.roleKills). 미지정 = 0 취급. */
  roleKills?: Partial<Record<string, number>>;
  /** 동시 조사 실험(v2 experiment) — 지금 조사 중 개체 수 / 조건 유지 누적(s). 미지정 = 0 취급. */
  observeCount?: number;
  observeHold?: number;
  /**
   * 전장 소탕 — 살아있는 개체도, 대기 중인 투입(증원 큐·웨이브 예산·남은 페이즈)도 없다.
   * 생존/사수 목표는 이때 **즉시 성공**한다: 위협이 남아 있지 않은데 타이머만 보고 서 있는 건
   * 플레이가 아니다(개체 수를 줄인 뒤 빈 전장 대기가 길어져 드러난 문제 — 2026-08-26).
   * 미지정 = false 취급(구 데이터·부분 런타임 호환).
   */
  cleared?: boolean;
}

export interface MissionOutcome {
  status: MissionStatus;
  progress: number; // 0..1 — 주 목표 진행률(HUD 게이지용)
  reason: string; //  짧은 상태/결과 사유("국문 / ENGLISH")
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 미션 상태를 순수 평가한다(부수효과 없음). 같은 (spec, rt) 엔 항상 같은 결과.
 * 실패 조건을 시간초과-성공보다 먼저 검사해 마감 프레임의 동시 충족을 실패로 우선한다.
 */
export function evaluateMission(spec: MissionSpec, rt: MissionRuntime): MissionOutcome {
  if (spec.kind === "free-roam") return { status: "active", progress: 0, reason: "탐방 / EXPLORE" };

  const timeUp = spec.duration > 0 && rt.elapsed >= spec.duration;
  const deathFail = spec.respawns >= 0 && rt.deaths > spec.respawns; // 리스폰 예산 초과
  const timeProg = spec.duration > 0 ? clamp01(rt.elapsed / spec.duration) : 0;

  switch (spec.kind) {
    case "eradicate": {
      const progress = spec.killTarget > 0 ? clamp01(rt.kills / spec.killTarget) : 1;
      if (rt.kills >= spec.killTarget) return { status: "success", progress: 1, reason: "격멸 완료 / CLEARED" };
      if (deathFail) return { status: "failed", progress, reason: "링크 상실 / LINK LOST" };
      if (timeUp) return { status: "failed", progress, reason: "시간 초과 / TIME OUT" };
      return { status: "active", progress, reason: "" };
    }
    case "defend-buildings": {
      if (rt.buildingsDestroyed >= spec.maxBuildingLoss) return { status: "failed", progress: timeProg, reason: "도시 함락 / CITY LOST" };
      if (deathFail) return { status: "failed", progress: timeProg, reason: "링크 상실 / LINK LOST" };
      if (timeUp) return { status: "success", progress: 1, reason: "방어 성공 / DEFENDED" };
      return { status: "active", progress: timeProg, reason: "" };
    }
    case "defend-landmark": {
      if (rt.landmarksDestroyed >= spec.maxLandmarkLoss) return { status: "failed", progress: timeProg, reason: "랜드마크 상실 / LANDMARK LOST" };
      if (deathFail) return { status: "failed", progress: timeProg, reason: "링크 상실 / LINK LOST" };
      if (timeUp) return { status: "success", progress: 1, reason: "방어 성공 / DEFENDED" };
      return { status: "active", progress: timeProg, reason: "" };
    }
    case "survival": {
      if (deathFail) return { status: "failed", progress: timeProg, reason: "전멸 / WIPED OUT" };
      if (timeUp) return { status: "success", progress: 1, reason: "사수 성공 / HELD" };
      return { status: "active", progress: timeProg, reason: "" };
    }
  }
  return { status: "active", progress: 0, reason: "" }; // 도달 불가(위 switch 가 비탐방 전 kind 처리)
}

/** 정적 목표 문구(HUD 상단 배너). */
export function missionObjectiveText(spec: MissionSpec): string {
  switch (spec.kind) {
    case "eradicate": return `플라즈모이드 ${spec.killTarget}기 격멸 / PURGE`;
    case "defend-buildings": return `도시 방어 — 건물 손실 ${spec.maxBuildingLoss}채 미만 / DEFEND`;
    case "defend-landmark": return `랜드마크 사수 — 파괴 0 / GUARD`;
    case "survival": return `지역 사수 — 최소 손실 / SURVIVE`;
    case "free-roam": return `탐방 / EXPLORE`;
  }
}

/** 실시간 진행 상세(HUD 보조). */
export function missionProgressText(spec: MissionSpec, rt: MissionRuntime): string {
  switch (spec.kind) {
    case "eradicate": return `${Math.min(rt.kills, spec.killTarget)} / ${spec.killTarget}`;
    case "defend-buildings": return `손실 ${rt.buildingsDestroyed} / ${spec.maxBuildingLoss}`;
    case "defend-landmark": return rt.landmarksDestroyed > 0 ? `상실 ${rt.landmarksDestroyed}` : "사수 중";
    case "survival": return `처치 ${rt.kills}`;
    case "free-roam": return "";
  }
}

/** 미션 풀에서 u∈[0,1) 비례로 하나 선택(순수 — 난수 주입). 빈 풀은 탐방으로 폴백. */
export function pickMission(pool: readonly MissionSpec[], u: number): MissionSpec {
  if (pool.length === 0) return FREE_ROAM;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(u * pool.length)));
  return pool[i];
}

/** 탐방(목표/종료 없음, 무한 리스폰, 구역/스폰 없음) — 평화 모드 기본 미션. */
export const FREE_ROAM: MissionSpec = {
  id: "free-roam", name: "탐방 / EXPLORE", kind: "free-roam",
  duration: 0, killTarget: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0, respawns: -1,
  zoneRadius: 0, spawnCount: 0, spawnRadius: 0, totalHp: 0, bossHp: 0, concurrentCap: 0, reinforceInterval: 0,
};

/** 내장 미션 풀(폴백/테스트 기준 — `public/missions/index.json` 과 동치). */
// 전 미션 공통: 반경 5km 교전 구역 + 시작 위치 반경 1.5km 초기 투입 후 균열에서 점진 증원(동시 26 상한).
// 총 45기·체력 총합 7만(피라미드: 잡몹→중견→정예 순 증원, 중간보스 1만은 마지막). 일괄 100 스폰은
// 도시 붕괴 속도·압력 곡선 문제로 폐기(플레이테스트 근거) — 수치는 계속 플레이테스트로 조정.
export const DEFAULT_MISSIONS: MissionSpec[] = [
  { id: "purge", name: "정화 작전 / PURGE", kind: "eradicate", duration: 570, killTarget: 6, maxBuildingLoss: 0, maxLandmarkLoss: 0, respawns: 3, zoneRadius: 5000, spawnCount: 6, spawnRadius: 1500, totalHp: 168182, bossHp: 100000, concurrentCap: 3, reinforceInterval: 1.5 },
  { id: "hold-city", name: "도시 방어 / HOLD THE CITY", kind: "defend-buildings", duration: 300, killTarget: 0, maxBuildingLoss: 10, maxLandmarkLoss: 0, respawns: 3, zoneRadius: 5000, spawnCount: 6, spawnRadius: 1500, totalHp: 168182, bossHp: 100000, concurrentCap: 3, reinforceInterval: 1.5 },
  { id: "guard-landmark", name: "랜드마크 사수 / GUARD", kind: "defend-landmark", duration: 300, killTarget: 0, maxBuildingLoss: 0, maxLandmarkLoss: 1, respawns: 3, zoneRadius: 5000, spawnCount: 6, spawnRadius: 1500, totalHp: 168182, bossHp: 100000, concurrentCap: 3, reinforceInterval: 1.5 },
  { id: "survive", name: "지역 사수 / SURVIVE", kind: "survival", duration: 300, killTarget: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0, respawns: 2, zoneRadius: 5000, spawnCount: 6, spawnRadius: 1500, totalHp: 168182, bossHp: 100000, concurrentCap: 3, reinforceInterval: 1.5 },
];
