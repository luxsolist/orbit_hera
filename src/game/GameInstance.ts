import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { BuildingCombat } from "../world/BuildingCombat";
import type { MissionOutcome, MissionStatus, MissionRuntime } from "./mission";
import {
  evaluateMissionV2, missionObjectiveTextV2, missionProgressTextV2, missionDurationV2,
  type MissionSpecV2, type MissionDeploy,
} from "./missionV2";

/**
 * deploy 명세 → EnemyManager 투입기 매핑(훅 ①⑤⑥ 공용). phased 는 첫 페이즈만 실행하고
 * 이후 페이즈는 GameInstance 가 트리거(전멸/afterSec)마다 fresh=false 로 이어 투입한다
 * (킬/채점 카운터 유지, HUD 웨이브 = 페이즈 번호). none/빈 명세는 웨이브 폴백.
 */
export function runDeploy(enemies: EnemyManager, d: MissionDeploy, fresh: boolean): void {
  switch (d.model) {
    case "pyramid":
      if (d.count > 0) {
        enemies.startBurst(d.count, d.spawnRadius, d.totalHp, d.bossHp,
          { concurrentCap: d.concurrentCap, reinforceInterval: d.reinforceInterval, fresh });
        return;
      }
      break;
    case "horde":
      if (d.count > 0) {
        enemies.startHorde(d.count, d.unitHp, d.spawnRadius,
          { concurrentCap: d.concurrentCap, reinforceInterval: d.reinforceInterval, fresh });
        return;
      }
      break;
    case "roster":
      if (d.units.length > 0) {
        enemies.startRoster(d.units, d.spawnRadius, undefined, fresh);
        return;
      }
      break;
    case "boss":
      enemies.startBossDeploy(d, d.spawnRadius, fresh);
      return;
    case "phased":
      if (d.phases.length > 0) {
        runDeploy(enemies, d.phases[0].deploy, fresh);
        return;
      }
      break;
  }
  enemies.start(true); // 폴백 — 웨이브
}

/** HUD/오버레이용 인스턴스 상태 스냅샷(평문). */
export interface InstanceSnapshot {
  objective: string; //     정적 목표 문구
  detail: string; //        실시간 진행 상세
  timeLeft: number; //      잔여 시간(초). Infinity = 무제한
  respawnsLeft: number; //  잔여 리스폰. Infinity = 무한
  progress: number; //      0..1 주 목표 진행률
  status: MissionStatus;
  reason: string;
}

export interface InstanceOpts {
  mission: MissionSpecV2;
  players: PlayerController[]; // 멀티플레이 대응 — 팀 전체(현재 1인)
  enemies: EnemyManager;
  buildings?: BuildingCombat;
}

/**
 * 게임 인스턴스 — 한 번의 플레이타임을 관리하는 컨테이너.
 *
 * 게임 진입 시 생성되어 그 플레이타임의 **미션(목표/종료 조건)** · **경과 시간** · **리스폰 예산** ·
 * **플라즈모이드/건물/랜드마크 상태**를 집계하고, 매 프레임 미션 상태를 평가한다. 종료(성공/실패)는
 * `onEnd` 콜백으로 1회 통지한다. 멀티플레이 시 `players[]` 로 팀 전체를 이 인스턴스가 관장하도록 설계.
 *
 * 평가 로직 자체는 순수 [missionV2.ts](./missionV2.ts)(v2 — 복합 실패 조건, 훅 ②)에 두고,
 * 여기선 런타임 집계/타이머/콜백만 담당한다.
 */
export class GameInstance {
  readonly mission: MissionSpecV2;
  private players: PlayerController[];
  private enemies: EnemyManager;
  private buildings?: BuildingCombat;

  private elapsed = 0; //       경과 시간(초)
  private deaths = 0; //        누적 기체 파괴 수
  private respawnsUsed = 0; //  사용한 리스폰 수
  private phaseIdx = 0; //      phased 투입의 현재 페이즈(훅 ⑥)
  private _outcome: MissionOutcome = { status: "active", progress: 0, reason: "" };

  /** 미션 종료(성공/실패)로 전이하는 프레임에 1회 호출. */
  onEnd?: (outcome: MissionOutcome) => void;

  constructor(opts: InstanceOpts) {
    this.mission = opts.mission;
    this.players = opts.players;
    this.enemies = opts.enemies;
    this.buildings = opts.buildings;
  }

  /** 새 플레이타임 시작 — 카운터/상태 리셋. */
  start(): void {
    this.elapsed = 0;
    this.deaths = 0;
    this.respawnsUsed = 0;
    this.phaseIdx = 0;
    this._outcome = { status: "active", progress: 0, reason: "" };
  }

  get isActive(): boolean { return this._outcome.status === "active"; }
  get outcome(): MissionOutcome { return this._outcome; }
  get elapsedSec(): number { return this.elapsed; }
  get deathCount(): number { return this.deaths; }
  get playerCount(): number { return this.players.length; } // MP — 팀 인원

  get timeLeft(): number {
    const dur = missionDurationV2(this.mission);
    if (dur <= 0) return Infinity;
    return Math.max(0, dur - this.elapsed);
  }

  get respawnsLeft(): number {
    if (this.mission.fail.respawns < 0) return Infinity;
    return Math.max(0, this.mission.fail.respawns - this.respawnsUsed);
  }

  /** 현재 시스템 상태를 평가 입력으로 집계(부수효과 없음). */
  private runtime(): MissionRuntime {
    return {
      elapsed: this.elapsed,
      kills: this.enemies.killCount,
      buildingsDestroyed: this.buildings?.destroyedBuildings ?? 0,
      landmarksDestroyed: this.buildings?.destroyedLandmarks ?? 0,
      deaths: this.deaths,
      roleKills: this.enemies.roleKills, // 직무별 처치(훅 ③ purge-role)
    };
  }

  /** 매 프레임 — 타이머 진행 + 미션 평가. 종료 전이 시 onEnd 1회(이후 비활성). */
  update(dt: number): void {
    if (this._outcome.status !== "active") return;
    if (this.mission.goal.type !== "free-roam") this.elapsed += dt;
    this.advancePhase(); // phased 투입 — 다음 페이즈 트리거 감시(훅 ⑥)
    const out = evaluateMissionV2(this.mission, this.runtime());
    this._outcome = out;
    if (out.status !== "active") this.onEnd?.(out);
  }

  /** phased — 다음 페이즈 조건(afterSec 지정 시 그 시각, 아니면 현 전장 전멸) 충족 시 이어 투입. */
  private advancePhase(): void {
    const d = this.mission.deploy;
    if (d.model !== "phased" || this.phaseIdx >= d.phases.length - 1) return;
    const next = d.phases[this.phaseIdx + 1];
    const ready = next.afterSec !== undefined ? this.elapsed >= next.afterSec : this.enemies.fieldCleared;
    if (!ready) return;
    this.phaseIdx++;
    runDeploy(this.enemies, next.deploy, false); // 카운터 유지 — HUD 웨이브 = 페이즈 번호
  }

  /**
   * 플레이어(기체) 사망 통지. 리스폰 예산이 남으면 true(호출부가 제자리 부활) · 소진이면 false.
   * false 면 다음 `update` 평가에서 deaths>respawns 로 미션이 실패 전이한다.
   */
  registerDeath(): boolean {
    this.deaths++;
    const budget = this.mission.fail.respawns;
    if (budget < 0 || this.respawnsUsed < budget) {
      this.respawnsUsed++;
      return true;
    }
    return false;
  }

  /** 사망 직후, 리스폰 불가일 때 즉시 종료 평가를 강제(다음 프레임을 기다리지 않음). */
  finalize(): void {
    this.update(0);
  }

  snapshot(): InstanceSnapshot {
    const rt = this.runtime();
    return {
      objective: missionObjectiveTextV2(this.mission),
      detail: missionProgressTextV2(this.mission, rt),
      timeLeft: this.timeLeft,
      respawnsLeft: this.respawnsLeft,
      progress: this._outcome.progress,
      status: this._outcome.status,
      reason: this._outcome.reason,
    };
  }
}
