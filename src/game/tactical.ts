// 다단계 택티컬 미션 (순수) — 단계(phase) 시퀀스 + 게이트 조건 + 적 조합(배치·역할·링크) 스펙.
// THREE/DOM 비의존 → 단위 테스트([tests/tactical.test.ts]). 런타임 스폰/무적링크/집계는
// EnemyManager·TacticalDirector 가 담당(이 파일은 "무엇을/언제" 만 정의·평가, "어떻게"는 런타임).
//
// 기존 단일목표 mission.ts 와 공존: 택티컬 미션은 kind:"tactical" + phases[] 로 별도 경로를 탄다.

/** 플라즈모이드 전술 역할 — 조합에 의미를 부여(처치 우선순위·의존성). */
export type PlasmoidRole =
  | "normal" //   일반 — 온도(색·강도) 롤
  | "anchor" //   앵커 — 살아있는 동안 shields[] 그룹을 무적화. **먼저 제거해야** 본대가 뚫린다
  | "keystone" // 핵심 — 처치가 단계 전이 트리거(우선 표적). 보통 anchor 뒤에 숨음
  | "spawner" //  분출원(모함) — 살아있는 동안 spawns 그룹을 주기 투입. 근원을 쳐야 멈춘다
  | "healer" //   치유 — buffs.targets 회복(확장)
  | "splitter"; //분열 — 처치 시 소형 개체로 분열(확장)

/** 배치 위치 지정 — 시작점/환형/랜드마크/절대점. */
export type PlacementSpec =
  | { kind: "spawnCenter" } //                            시작 위치(작전구역 중심)
  | { kind: "ring"; radius: number; arc?: [number, number] } // 시작점 둘레 환형(arc=각도범위 rad, 미지정 시 360°)
  | { kind: "landmark"; ref: string } //                  특정 랜드마크 주변
  | { kind: "point"; x: number; z: number; y?: number }; // 절대 좌표

/** 분출원(spawner) 주기 투입 정의 — every초마다 group 1회, 최대 max회. */
export interface SpawnLink {
  group: string; // 투입할 그룹 id(같은 phase의 SpawnGroup)
  every: number; // 투입 간격(초)
  max: number; //  최대 투입 횟수(스포너 제거 전까지)
}

/** 한 스폰 그룹 — 배치·조합·역할·의존성의 단위(id 로 게이트·링크가 참조). */
export interface SpawnGroup {
  id: string;
  role?: PlasmoidRole; //              기본 "normal"
  archetype: "rusher" | "kiter"; //    거머리(접근)/모기(원거리 드레인)
  count: number;
  tBand?: [number, number]; //         온도(색·강도) 범위 [0..1] — 미지정 시 미션 기본
  hp?: number; //                      명시 체력(미지정 시 온도 파생)
  at?: PlacementSpec; //               배치(미지정 시 ring 기본)
  spread?: number; //                  분산 반경(m)
  altBand?: [number, number]; //       고도 밴드(m, 지표 상대)
  shields?: string[]; //               (anchor) 살아있는 동안 무적화할 그룹 id 들
  spawns?: SpawnLink; //               (spawner) 주기 투입
  buffs?: { targets: string[]; kind: "heal" | "haste" | "enrage" }; // (healer 등)
}

/** 단계 전이/실패 조건 — 합성(all/any) 가능한 순수 술어. */
export type GateCond =
  | { type: "kills"; count: number } //                        이번 단계 누적 처치 ≥ count
  | { type: "killGroup"; group: string; downTo?: number } //   특정 그룹 생존 ≤ downTo(기본 0=전멸)
  | { type: "killRole"; role: PlasmoidRole; downTo?: number } //특정 역할 생존 ≤ downTo
  | { type: "clearField" } //                                  생존 플라즈모이드 0
  | { type: "survive"; seconds: number } //                    단계 진입 후 seconds 초 경과
  | { type: "reach"; zoneId: string } //                       지정 구역에 플레이어 진입
  | { type: "loseBuildings"; max: number } //                  이번 단계 건물 손실 ≥ max(주로 fail)
  | { type: "loseLandmarks"; max: number } //                  누적 랜드마크 손실 ≥ max(주로 fail)
  | { type: "all"; of: GateCond[] } //                         AND
  | { type: "any"; of: GateCond[] }; //                        OR

/** 한 단계 — 진입 시 조합 배치 + 전이/실패 게이트. */
export interface MissionPhase {
  id: string;
  name: string; //        배너 "교두보 확보 / SECURE"
  brief?: string; //      한 줄 지시(HUD)
  spawns: SpawnGroup[]; //진입 시 배치할 조합
  advance: GateCond; //   충족 → 다음 단계(마지막이면 미션 성공)
  fail?: GateCond; //     충족 → 미션 실패(전역 실패 조건과 OR)
  timeLimit?: number; //  단계 제한시간(초). 0/미지정 = 없음. 초과 시 fail
}

/** 택티컬 미션 — 단계 시퀀스. */
export interface TacticalMissionSpec {
  id: string;
  name: string; //                 "국문 / ENGLISH"
  kind: "tactical";
  respawns: number; //             <0 = 무한
  zoneRadius: number; //           교전 구역 반경(m)
  zones?: Record<string, { x: number; z: number; r: number }>; // reach 게이트용 명명 구역
  phases: MissionPhase[];
}

/** 평가 입력 — TacticalDirector 가 EnemyManager·BuildingCombat 에서 매 프레임 집계. */
export interface TacticalRuntime {
  phaseElapsed: number; //                                경과(단계 진입 기준, 초)
  killsThisPhase: number; //                              이번 단계 처치 수
  aliveByGroup: Readonly<Record<string, number>>; //      그룹 id → 생존 수
  aliveByRole: Readonly<Record<string, number>>; //       역할 → 생존 수
  aliveTotal: number; //                                  총 생존 수
  buildingsLostThisPhase: number; //                      이번 단계 건물 손실
  landmarksLost: number; //                               누적 랜드마크 손실
  reached: Readonly<Record<string, boolean>>; //          구역 id → 진입 여부
}

export type PhaseEval = "active" | "advance" | "fail";

/** 게이트 술어 — 순수. 같은 (cond, rt) 엔 항상 같은 결과. */
export function gateSatisfied(cond: GateCond, rt: TacticalRuntime): boolean {
  switch (cond.type) {
    case "kills": return rt.killsThisPhase >= cond.count;
    case "killGroup": return (rt.aliveByGroup[cond.group] ?? 0) <= (cond.downTo ?? 0);
    case "killRole": return (rt.aliveByRole[cond.role] ?? 0) <= (cond.downTo ?? 0);
    case "clearField": return rt.aliveTotal <= 0;
    case "survive": return rt.phaseElapsed >= cond.seconds;
    case "reach": return rt.reached[cond.zoneId] === true;
    case "loseBuildings": return rt.buildingsLostThisPhase >= cond.max;
    case "loseLandmarks": return rt.landmarksLost >= cond.max;
    case "all": return cond.of.every((c) => gateSatisfied(c, rt));
    case "any": return cond.of.some((c) => gateSatisfied(c, rt));
  }
}

/**
 * 단계 평가 — 실패를 전이보다 먼저 검사(마감 프레임 동시 충족 시 실패 우선, mission.ts 와 동일 정책).
 * timeLimit 초과도 실패. 그 외 advance 충족 시 전이.
 */
export function evaluatePhase(phase: MissionPhase, rt: TacticalRuntime): PhaseEval {
  if (phase.fail && gateSatisfied(phase.fail, rt)) return "fail";
  if (phase.timeLimit && phase.timeLimit > 0 && rt.phaseElapsed >= phase.timeLimit) return "fail";
  if (gateSatisfied(phase.advance, rt)) return "advance";
  return "active";
}

/**
 * 현재 무적 그룹 집합 — 살아있는 anchor 가 shields 하는 그룹은 무적. 순수.
 * TacticalDirector 가 매 처치 이벤트마다 호출해 CoreEnemy.invulnerable 을 갱신한다.
 */
export function shieldedGroups(
  groups: readonly SpawnGroup[],
  aliveByGroup: Readonly<Record<string, number>>,
): Set<string> {
  const shielded = new Set<string>();
  for (const g of groups) {
    if (g.role === "anchor" && g.shields && (aliveByGroup[g.id] ?? 0) > 0) {
      for (const t of g.shields) shielded.add(t);
    }
  }
  return shielded;
}

/**
 * 저작 무결성 검사 — 참조 깨짐(존재하지 않는 group/zone 참조)·도달 불가 단계를 잡는다. 순수.
 * 빈 배열이면 정상. 빌드/CI 게이트(validate-world 처럼)로 쓸 수 있다.
 */
export function validateTacticalMission(spec: TacticalMissionSpec): string[] {
  const errs: string[] = [];
  if (spec.phases.length === 0) errs.push("phases 가 비어있음");
  const zones = new Set(Object.keys(spec.zones ?? {}));
  for (const ph of spec.phases) {
    const ids = new Set(ph.spawns.map((s) => s.id));
    for (const s of ph.spawns) {
      for (const t of s.shields ?? []) if (!ids.has(t)) errs.push(`${ph.id}: anchor '${s.id}' 가 없는 그룹 '${t}' 를 shields`);
      if (s.spawns && !ids.has(s.spawns.group)) errs.push(`${ph.id}: spawner '${s.id}' 가 없는 그룹 '${s.spawns.group}' 를 spawns`);
      for (const t of s.buffs?.targets ?? []) if (!ids.has(t)) errs.push(`${ph.id}: '${s.id}' buffs 가 없는 그룹 '${t}'`);
    }
    walkGate(ph.advance, ph, ids, zones, errs);
    if (ph.fail) walkGate(ph.fail, ph, ids, zones, errs);
  }
  return errs;
}

/** advance/fail 게이트의 group/zone 참조 검사(재귀). */
function walkGate(c: GateCond, ph: MissionPhase, ids: Set<string>, zones: Set<string>, errs: string[]): void {
  if (c.type === "killGroup" && !ids.has(c.group)) errs.push(`${ph.id}: 게이트가 없는 그룹 '${c.group}' 를 참조`);
  if (c.type === "reach" && !zones.has(c.zoneId)) errs.push(`${ph.id}: 게이트가 없는 구역 '${c.zoneId}' 를 참조`);
  if (c.type === "all" || c.type === "any") for (const sub of c.of) walkGate(sub, ph, ids, zones, errs);
}
