// 미션 시스템 (순수) — 게임 인스턴스의 목표/종료 조건을 데이터로 정의하고 평가한다.
// THREE/DOM 비의존 → 단위 테스트 가능([tests/mission.test.ts]). 런타임 집계/부수효과는 GameInstance 가 담당.

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
  spawnCount: number; //      일괄 스폰 수(랜덤 크기·색). 0 = 레거시 웨이브 모드
  spawnRadius: number; //     일괄 스폰 분산 반경(m, 시작 위치 기준). 보통 zoneRadius 보다 작게.
  totalHp: number; //         일괄 스폰 플라즈모이드 체력 총합(예산). 0 = 미사용(온도 롤 HP)
  bossHp: number; //          그 중 중간보스 1기의 체력(나머지 count−1 기가 totalHp−bossHp 를 나눠 가짐). 0 = 보스 없음
}

/** 인스턴스가 집계한 현재 플레이타임 상태(평가 입력). */
export interface MissionRuntime {
  elapsed: number; //            경과 시간(초)
  kills: number; //              누적 플라즈모이드 처치 수
  buildingsDestroyed: number; // 파괴된 일반 건물 수
  landmarksDestroyed: number; // 파괴된 랜드마크 수
  deaths: number; //             누적 기체(플레이어) 파괴 수
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
  zoneRadius: 0, spawnCount: 0, spawnRadius: 0, totalHp: 0, bossHp: 0,
};

/** 내장 미션 풀(폴백/테스트 기준 — `public/missions/index.json` 과 동치). */
// 전 미션 공통: 반경 5km 교전 구역 + 시작 위치 반경 1.5km 안에 일괄 100 스폰. 체력 총합 7만(중간보스 1만 + 99기 6만). 수치는 플레이테스트로 조정.
export const DEFAULT_MISSIONS: MissionSpec[] = [
  { id: "purge", name: "정화 작전 / PURGE", kind: "eradicate", duration: 300, killTarget: 100, maxBuildingLoss: 0, maxLandmarkLoss: 0, respawns: 3, zoneRadius: 5000, spawnCount: 100, spawnRadius: 1500, totalHp: 70000, bossHp: 10000 },
  { id: "hold-city", name: "도시 방어 / HOLD THE CITY", kind: "defend-buildings", duration: 300, killTarget: 0, maxBuildingLoss: 10, maxLandmarkLoss: 0, respawns: 3, zoneRadius: 5000, spawnCount: 100, spawnRadius: 1500, totalHp: 70000, bossHp: 10000 },
  { id: "guard-landmark", name: "랜드마크 사수 / GUARD", kind: "defend-landmark", duration: 300, killTarget: 0, maxBuildingLoss: 0, maxLandmarkLoss: 1, respawns: 3, zoneRadius: 5000, spawnCount: 100, spawnRadius: 1500, totalHp: 70000, bossHp: 10000 },
  { id: "survive", name: "지역 사수 / SURVIVE", kind: "survival", duration: 300, killTarget: 0, maxBuildingLoss: 0, maxLandmarkLoss: 0, respawns: 2, zoneRadius: 5000, spawnCount: 100, spawnRadius: 1500, totalHp: 70000, bossHp: 10000 },
];
