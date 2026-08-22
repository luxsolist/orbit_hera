import * as THREE from "three";
import { CoreEnemy, chooseTarget, matchupMul, engageKeepDist, buildBoidGrid, recomputeSteer, advanceGlobalPulse, KILL_STAGGER_SEC, CORE_GEO, SHELL_GEOS, MARKER_TELEGRAPH_SEC, type Boid } from "./CoreEnemy";
import type { GameWorld } from "../world/GameWorld";
import type { PlayerController } from "../player/PlayerController";
import { bestAlignedInCone } from "../player/PlayerController";
import { DrainBeams } from "../fx/DrainBeams";
import { BrandSystem } from "./BrandSystem";
import {
  DEFAULT_PLASMOID, rollAppearance, contactDamage, archetypeCount, pickSpawnType, pickBurstType, colorStrength01,
  distributeHp, pyramidHp, appearanceForHp, strength, phaseRoll, phaseTimings,
  kkLevelOf, kkLevelColors, KK_MIN_HP, KK_DEMOTE_STAGGER,
  type PlasmoidSpec, type PlasmoidKiterArchetype, type PlasmoidArchetype,
} from "./PlasmoidSpec";
import { clampToDisk, type Vec3 } from "../core/math";

const ATTACK_RANGE = 3.2; // 접촉 교전 거리(피해는 PlasmoidSpec.contact 로 산출)
const RUSHER_DASH_MIN = 15; // 러셔 돌진 발동 밴드(m) — 너무 가까우면 불필요, 멀면 무의미(P3 안티카이팅)
const RUSHER_DASH_MAX = 60;
const REWIND_REVIVE_CAP = 8; // 역행 1회 부활 상한(§6.6) — 폭주 방지
const SPAWN_INTERVAL = 0.35; // 개체 점진 스폰 간격(s)
const BURST_ROLL_WAVE = 12; // 일괄 스폰 외형 롤의 가상 웨이브 — 전 온도(색) 스펙트럼 해금(크기 다양성은 개체 rand 유지)
const KITER_GROUND_CLEARANCE = 1.5; // 도주형이 가라앉지 않는 지면 위 최소 높이(m)
const KITER_CEILING = 1020; // 도주형 상승 상한(지면 대비, m) — 비행 천장(1000) 근처까지 추격 가능(고고도 이탈 방지)
const TARGET_HYSTERESIS = 1.2; // 표적 교체 문턱 — 현재 표적이 최근접의 1.2배 이내면 유지(깜빡임 방지)
// 플레이어 인식 범위(awareness) — 기본은 건물 공격, 플레이어가 이 안에 들면 플레이어 공격으로 전환.
// 한번 인식하면 LOSE 거리까지 계속 추격(히스테리시스: 들어오면 계속, 벗어나면 다시 건물). 플레이테스트로 조정.
const AWARENESS_RADIUS = 500; // 인식(전환) 반경(m)
const AWARENESS_RADIUS_SQ = AWARENESS_RADIUS * AWARENESS_RADIUS;
const AWARENESS_LOSE_RADIUS = 900; // 인식 해제 반경(m) — 이보다 멀어지면 건물 공격 복귀(획득의 1.8배 히스테리시스)
// 피격 유발 인식 — 플레이어가 때린 플라즈모이드 반경 이 거리 안의 개체도 플레이어를 인식(provoked 래치).
const PROVOKE_RADIUS = 100; // 피격 전파 반경(m)
const PROVOKE_RADIUS_SQ = PROVOKE_RADIUS * PROVOKE_RADIUS;
const AWARENESS_LOSE_SQ = AWARENESS_LOSE_RADIUS * AWARENESS_LOSE_RADIUS;

/**
 * 플레이어 교전 여부(순수) — provoked(피격 유발)면 거리 무관 교전.
 * 아니면 인식 반경 히스테리시스: 미교전(wasEngaged=false)은 acquireSq 안에서만 신규 인식,
 * 교전 중(wasEngaged=true)은 loseSq 까지 유지(그 밖이면 이탈). 표적이 없으면(hasTarget=false) 미교전.
 */
export function engagesPlayer(
  hasTarget: boolean, wasEngaged: boolean, targetDistSq: number, provoked: boolean, acquireSq: number, loseSq: number,
): boolean {
  if (!hasTarget) return false;
  if (provoked) return true;
  return targetDistSq <= (wasEngaged ? loseSq : acquireSq);
}

const BUILDING_SEEK_R = 700; // 플레이어가 멀 때 공격할 주변 건물 탐색 반경(m)
const LOCK_ACQUIRE_RANGE = 5000; // 락온 획득 사거리(m) — 5km(자동사격/빔 2km보다 김). 이 밖의 적은 락온/자동추적 불가.
const STEER_STRIDE = 3; // 원거리 적 조향 재계산 주기(프레임) — 라운드로빈 분산
const NEAR_DIST = 250; // 이 거리(m) 이내는 매 프레임 재계산(교전 감각 — 스폰 반경 전체 커버, 끊김 방지)
const NEAR_DIST_SQ = NEAR_DIST * NEAR_DIST;
const INST_CAP = 2048; // 셸/코어 InstancedMesh 최대 인스턴스 수
const CORE_BLOOM = 0.55; // 코어 발광 세기 → instanceColor 배수(코어 단독 인스턴싱 때 승인된 값 유지)
const SHELL_BASE = 0.5; // 셸 본체 기조(개체색 배수, 자체발광)
const PHASE_DIM = 0.16; // 위상 이탈(§2.1) 중 발광 감쇠 배수 — 반투명한 잔상처럼 보이게
const SHELL_FLASH = 2.6; // 피격 번쩍임 시 셸 색 가산(색조 유지)
const GLOW_STRENGTH = 2.0; // 색 강도 비례 발광 가산 — glow = 1 + 2·g01 (청백일수록 밝게 빛남/블룸)

const _m4 = new THREE.Matrix4(); // 인스턴스 행렬 임시
const _col = new THREE.Color(); // 인스턴스 색 임시
const AGGRO_PENALTY = 0.4; // 어그로 분산 — 이미 표적이 된 플레이어당 거리 점수 가산(한 명에게 몰빵 방지)
const MISMATCH_PENALTY = 3.0; // 상성 불일치 표적 점수 배수(>1) — 적이 자기 상성 드론을 우선(MP 혼합팀). 절대 배제 아닌 가중
const KITER_CLOSE_MUL = 1.0; // 카이터가 비상성(워커) 표적을 노릴 때 keepDist 배수. 워커가 장거리 빔(AA)을 갖게 되어 좁힐 필요 없음 → 모기는 거리 유지, 워커가 지상에서 격추.
const KITER_CROSS_FRAC = 0.5; // 매칭 완화 — 워커도 카이터(모기)를 끌어오는 교차 비율(워커 1인당 모기 물량 ×이 값). 워커=만능 AA, 플라이어는 공중 특화 유지(러셔는 워커 전용).
const MARKER_BURST_FRAC = 0.15; // 미션 투입 중 마커(소인체) 비율 — 미션 종류 비례 개편(§6.8) 전 임시 상수
// 점진 투입(균열 증원) — 초기엔 잡몹 소수, 이후 균열에서 강도 오름차순 보충(피라미드 큐).
const RIFT_OFFSET_FRAC = 0.5; // 균열 앵커를 전장 중심에서 투입 반경 ×이 값만큼 이격 — 위협 방향이 읽히게
const INITIAL_CAP_FRAC = 0.6; // 초기 투입 수 = 동시 상한 ×이 값(즉시 교전 밀도)
const REINFORCE_RETRY = 0.3; // 상한 초과로 증원 보류 시 재시도 간격(s)
const REINFORCE_R_MIN = 40; // 증원 스폰 링 내반경(m, 균열 앵커 기준)
const REINFORCE_R_MAX = 200; // 증원 스폰 링 외반경(m)
// 다중 투영 보스(§2.6) — 보스 예산 1기가 HP 공유 구체 여러 개로 투영된다(하나의 손, 여러 그림자).
const BOSS_PROJECTIONS = 3; // 투영 수
const BOSS_SPEED_MULS = [0.6, 0.85, 1.1] as const; // 투영별 속도 차 — "가장 느리고 가까운 구를 때린다"
const BOSS_VIS_HP_FRAC = 0.5; // 투영 렌더 크기 산정 HP 비율(전 풀 크기로 3기를 그리면 과대)
const BOSS_KILL_REFUND = 15; // 보스 처치 환수(그룹당 1회)
const BOSS_FILAMENT_CD = 0.18; // 피격 시 투영 간 빛 필라멘트 스로틀(s) — "이어져 있다"는 복선 연출
const ROSTER_CLUSTER_R = 70; // 로스터 유닛 그룹 산개 반경(m) — 그룹이 한 덩어리로 읽히게
const LINE_SPACING = 28; // line 진형 개체 간격(m)
const PATROL_R = 60; // patrol 행동 — 유닛 중심 순회 반경(m)
const PATROL_RATE = 0.25; // patrol 각속도(rad/s)
const BOSS_EMIT_ALIVE_CAP = 40; // 분출 게이트 — 전장 생존 수가 이 이상이면 분출 보류(무한 팽창 방지)
const BOSS_EMIT_R_MIN = 30; // 분출 위치 링(보스 투영 기준, m)
const BOSS_EMIT_R_MAX = 90;
const HEAL_FX_CD = 0.5; // 회복 링크 필라멘트 연출 간격(s) — "이어져 있다"의 가독(끊으려면 떼어놓아라)

/**
 * 조합 투입 단위(훅 ① + 진형/행동 정립 — 06-missions §2 `RosterUnit` 의 엔진측 계약, 구조 동일).
 * role: 아키타입 그대로 | `elite`(고체력 러셔 — 색·크기는 HP 가 결정) | `boss`(다중 투영 그룹 ×count).
 * shield(훅 ⑤): 지정 시 이 유닛은 **같은 투입의 다른 유닛(호위)이 살아있는 동안** 받는 피해가
 * shield 배(0..1)로 감쇄 — "호위 붕괴" 문법. 호위 전멸 시 감쇄 해제.
 * formation/behavior/anchor: 배치 진형·행동(escort 는 앞선 유닛 인덱스 anchor 추종) — spawnRosterUnits.
 */
export interface DeployUnit {
  role: PlasmoidArchetype | "elite" | "boss";
  count: number;
  hp: number;
  shield?: number;
  formation?: "cluster" | "ring" | "line";
  behavior?: "hunt" | "hold" | "patrol" | "escort";
  anchor?: number;
}

/**
 * 진형 배치점(순수) — 유닛의 i번째 개체 (x,z).
 * cluster: unitC 주위 원판 산개(기본) · ring: 전장 중심(fieldC) 포위 원(반경 lim×0.45, 균등각+지터) ·
 * line: unitC 를 지나며 **중심을 바라보는 가로 전선**(축 = 중심→unitC 수직, 간격 LINE_SPACING).
 */
export function formationPos(
  formation: "cluster" | "ring" | "line", i: number, count: number,
  fieldC: { x: number; z: number }, unitC: { x: number; z: number }, lim: number, rand: () => number
): { x: number; z: number } {
  if (formation === "ring") {
    const ang = (i / Math.max(1, count)) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const r = lim * 0.45;
    return { x: fieldC.x + Math.cos(ang) * r, z: fieldC.z + Math.sin(ang) * r };
  }
  if (formation === "line") {
    const dx = unitC.x - fieldC.x, dz = unitC.z - fieldC.z;
    const d = Math.hypot(dx, dz) || 1;
    const ax = -dz / d, az = dx / d; // 중심→unitC 에 수직(전선 축)
    const off = (i - (count - 1) / 2) * LINE_SPACING + (rand() - 0.5) * 8;
    return { x: unitC.x + ax * off, z: unitC.z + az * off };
  }
  const a = rand() * Math.PI * 2;
  const rr = Math.sqrt(rand()) * ROSTER_CLUSTER_R;
  return { x: unitC.x + Math.cos(a) * rr, z: unitC.z + Math.sin(a) * rr };
}

/** 보스 투입 구성(훅 ⑤ — deploy `boss` 의 엔진측 계약). */
export interface BossDeployCfg {
  bossHp: number; //       그룹당 체력(HP 공유 풀)
  projections?: number; // 그룹당 투영 수(기본 BOSS_PROJECTIONS)
  groups?: number; //      보스 그룹 수(쌍생 = 2). 기본 1
  escort?: DeployUnit[]; // 수행원(로스터 규칙과 동일 — shield 사용 가능)
  emit?: { role: PlasmoidArchetype; hp: number; count: number; interval: number }; // 잡몹 주기 분출(성숙체)
  ownSweep?: boolean; //   보스 소유 파문 — 파문 원점이 살아있는 보스를 따라간다
  healLink?: { range: number; rate: number }; // 그룹 간 상호 회복(쌍생) — range 내면 초당 rate
}

const _centroid = new THREE.Vector3(); // 스폰 무게중심 임시(프레임당 동기 사용)
const _sweepAnchor: Vec3 = { x: 0, y: 0, z: 0 }; // 보스 소유 파문 앵커 임시(프레임당 동기 사용)
const _ftarget = new THREE.Vector3(); // 진형 행동 이동 표적 임시(프레임당 동기 사용)
const _btarget = new THREE.Vector3(); // 건물 표적 좌표 임시(프레임당 동기 사용)
const ZERO_VEL: Vec3 = { x: 0, y: 0, z: 0 }; // 정적 건물 표적 — 예측 리드 없음

/** 멀티타깃 — 한 프레임의 플레이어 스냅샷(위치·추정속도·생존). 인덱스는 players 와 정합. */
interface Target {
  pos: THREE.Vector3;
  vel: Vec3;
  player: PlayerController;
  alive: boolean;
}

/**
 * 적 스폰/웨이브/처치 집계 관리. MP 대응: 전장의 플레이어 여럿(players[])을 받아
 * 개체별 최근접 표적(히스테리시스+어그로 분산)을 고른다. 개체 행동은 드론이 아니라
 * **고유 아키타입**(rusher/kiter)으로 결정 — 어느 드론이 플레이하든 무관(자기정렬).
 */
export class EnemyManager {
  private enemies: CoreEnemy[] = [];
  private scene: THREE.Scene;
  private world: GameWorld;
  private players: PlayerController[];
  private spec: PlasmoidSpec;
  private kiterArche: PlasmoidKiterArchetype; // 카이터 공격 파라미터(전 개체 공유)
  private drain: DrainBeams;
  private coreInst: THREE.InstancedMesh; // 발광 코어 일괄 렌더(드로우콜 1개)
  // 역할 실루엣(P3 §6.7) — 직무별 셸 InstancedMesh(형태=직무 채널). 레이캐스트는 4개 모두 대상.
  private shellInsts: Record<PlasmoidArchetype, THREE.InstancedMesh>;
  private instanceEnemiesBy = new Map<THREE.Object3D, CoreEnemy[]>(); // 메시별 instanceId → 적 역참조

  wave = 0;
  killCount = 0;
  private frame = 0; // 프레임 분산 라운드로빈 위상
  private timeSec = 0; // 전투 경과(patrol 궤도 위상 등 시간 기반 행동용)
  private spawnTimer = 0;
  private peaceful = false; // 탐방 모드 — 웨이브 미시작 + 클리어 시 자동 재시작 억제
  private burstMode = false; // 일괄 스폰 모드 — 웨이브 미사용(미션: 구역 내 N마리 한번에) + 클리어 시 자동 재시작 억제
  private riftAnchor: Vec3 = { x: 0, y: 0, z: 0 }; // 소산 표류 앵커(균열 위치 프록시 — 일괄 스폰 중심). 개체와 공유 참조.
  // 작전구역(존) — 플라즈모이드도 이 원(중심·반경) 밖으로 못 나간다. radius 0 = 무제한.
  private zoneCx = 0;
  private zoneCz = 0;
  private zoneR = 0;
  private _clampOut = { x: 0, z: 0 }; // clampToDisk 결과 재사용
  private pendingRusher = 0; // 아키타입별 잔여 스폰 예산(거머리 떼 / 모기 소수정예 / 소인체 독립 조절)
  private pendingKiter = 0;
  private pendingMarker = 0;
  private brand: BrandSystem; // 낙인 유도탄 + 심판 파문(서사편 §6.1)
  // 점진 투입(균열 증원) 상태 — startBurst(concurrentCap>0)가 채우고 tickReinforce 가 소비
  private reinforceQueue: { hp: number; boss: boolean }[] = []; // 잔여 증원(강도 오름차순, 마지막 = 보스)
  private reinforceTimer = 0;
  private reinforceInterval = 1.5;
  private concurrentCap = 0; // 0 = 점진 투입 비활성(레거시 일괄)
  private burstCx = 0; // 초기 투입 중심(플레이어 무게중심 스냅샷)
  private burstCz = 0;
  private burstLim = 0; // 초기 투입 분산 반경(월드 경계 클램프 후)
  private burstWalkers = 0; // 투입 시점 드론 구성(아키타입 추첨용 스냅샷)
  private burstFlyers = 0;
  // 군집 조향용 — 플레이어별 속도 추정(예측 요격) + 살아있는 적 스냅샷(분리)
  private prevPos: THREE.Vector3[] = [];
  private vels: Vec3[] = [];
  private hasPrev = false;
  private boids: Boid[] = [];
  private targets: Target[] = [];
  private dists: number[] = []; // pickTarget 스크래치(할당 회피)
  private scores: number[] = []; // chooseTarget 스크래치
  private load: number[] = [];
  private playerIsFlyer: boolean[] = []; // 플레이어별 비행 여부(상성 타깃팅) — buildTargets 에서 갱신
  private matchMul: number[] = []; // pickTarget 상성 가중 스크래치

  onKill?: (enemy?: CoreEnemy) => void; // 처치 통지 — enemy 로 XP(강함 비례)·채점 등 후처리
  onPlayerHit?: (damage: number, source?: Vec3) => void; // source = 피해 발원 위치(방향 인디케이터용)
  onWaveChange?: (wave: number) => void;
  onSweepPass?: (branded: boolean) => void; // 심판 파문이 플레이어 위치를 통과(화면 펄스·저음)

  // 전투 채점 집계(결과 화면) — 표면 어휘만(§8.2): 근원 격파·파문 무상 통과·관측 고정
  readonly stats = { markerKills: 0, zenoFreezes: 0, sweepHits: 0, sweepCleanPasses: 0, buildingBrandHits: 0 };
  // 역행체(P3 §6.6) — 최근 격파 기록(역행 시 부활 후보). W2 계류 중 격파는 확정 — 역행 불능(§9.2).
  private killLog: { t: number; x: number; z: number; maxHp: number; role: PlasmoidArchetype; deployRole: CoreEnemy["deployRole"]; pinned: boolean }[] = [];
  // 역행 부활 대기열 — 시전 완료가 update 순회 중 일어나므로 스폰은 다음 프레임 서두로 지연
  // (순회 중 push 는 boids/steer 인덱스 정합을 깨뜨린다).
  private pendingRevive: { x: number; z: number; maxHp: number; role: PlasmoidArchetype; deployRole: CoreEnemy["deployRole"] }[] = [];
  /** 예지 HUD(2.8.1) — 역행 시전 잔여(s). null = 시전 종료/취소. */
  onRewindCast?: (secLeft: number | null) => void;
  /** 역행 발동 통지 — revived = 되살아난 격파 수(HUD 처치 수 갱신·연출). */
  onRewound?: (revived: number) => void;
  // 투입 직무별 처치 집계(훅 ③ purge-role) — 보스는 그룹당 1(처치 크레딧과 동일 계약)
  readonly roleKills: Record<PlasmoidArchetype | "elite" | "boss", number> = {
    rusher: 0, kiter: 0, marker: 0, cutter: 0, rewinder: 0, elite: 0, boss: 0,
  };
  // 어그로 성향(훅 ④ — 미션 변조 `modifiers.aggro`): player = 현행(인식 반경 내 플레이어 전환),
  // building/landmark = 표적 직행 — 플레이어는 **때려야만**(provoked) 어그로가 끌린다.
  private aggro: "player" | "landmark" | "building" = "player";
  private buildingBrandsEnabled = false; // 공성 낙인(modifiers.buildingBrands) — 미션 변조, clear 가 리셋
  private bossGroups: CoreEnemy[][] = []; // 다중 투영 보스 그룹들(필라멘트·동반 소산 — roster 는 복수 가능)
  private bossFilamentCd = 0;
  // 보스 행동(훅 ⑤ — startBossDeploy 가 설정, clear 가 해제)
  private bossEmit: BossDeployCfg["emit"] | null = null; // 잡몹 주기 분출
  private bossEmitTimer = 0;
  private bossOwnSweep = false; // 파문 원점 = 살아있는 보스(없으면 균열 폴백)
  private bossHealLink: BossDeployCfg["healLink"] | null = null; // 그룹 간 상호 회복
  private healFxCd = 0;
  private shieldGroups: { shielded: CoreEnemy[]; escorts: CoreEnemy[] }[] = []; // 호위 방패(훅 ⑤)

  constructor(
    scene: THREE.Scene, world: GameWorld, players: PlayerController[],
    spec: PlasmoidSpec = DEFAULT_PLASMOID
  ) {
    this.scene = scene;
    this.world = world;
    this.players = players;
    this.spec = spec;
    this.kiterArche = spec.archetypes.kiter;
    this.drain = new DrainBeams(scene);
    // 낙인/파문 — 파문이 낙인 붙은 플레이어를 통과하면 피해(머시 무적은 takeDamage 가 거름, 낙인은 소모됨)
    this.brand = new BrandSystem(scene, players, spec.sweep, world.buildings ?? undefined);
    this.brand.onSweepHit = (idx, dmg) => {
      const pl = this.players[idx];
      if (pl && pl.takeDamage(dmg)) this.onPlayerHit?.(dmg, this.riftAnchor); // 발원 = 균열(파문 원점)
    };
    // 공성 낙인(modifiers.buildingBrands) — 파문이 낙인 붙은 건물/랜드마크를 통과하면 피해
    this.brand.onBuildingBrandHit = () => { this.stats.buildingBrandHits++; };
    this.brand.onSweepPass = (_idx, branded) => {
      // 통과 임팩트(펄스·저음) + 채점 집계 — 낙인 없이 넘기면 "무상 통과"(잘한 판의 지표)
      if (branded) this.stats.sweepHits++;
      else this.stats.sweepCleanPasses++;
      this.onSweepPass?.(branded);
    };

    // 코어 InstancedMesh — 살아있는/디졸브 개체 코어 일괄 렌더(MeshBasic + instanceColor = 발광).
    this.coreInst = new THREE.InstancedMesh(CORE_GEO, new THREE.MeshBasicMaterial(), INST_CAP);
    this.coreInst.frustumCulled = false;
    this.coreInst.count = 0;
    scene.add(this.coreInst);

    // 셸 InstancedMesh — 살아있는 적 본체 일괄 렌더 + 레이캐스트 대상. 자체발광(MeshBasic — 조명에 탁해지지 않게)
    // + DoubleSide(코앞 적 내부 적중) + 그림자. **직무별 4형태**(P3 §6.7 — 형태=직무 채널 분리).
    const shellMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const makeShell = (geo: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(geo, shellMat, INST_CAP);
      m.frustumCulled = false;
      m.castShadow = true;
      m.count = 0;
      scene.add(m);
      this.instanceEnemiesBy.set(m, []);
      return m;
    };
    this.shellInsts = {
      rusher: makeShell(SHELL_GEOS.rusher),
      kiter: makeShell(SHELL_GEOS.kiter),
      marker: makeShell(SHELL_GEOS.marker),
      cutter: makeShell(SHELL_GEOS.cutter),
      rewinder: makeShell(SHELL_GEOS.rewinder),
    };
  }

  /**
   * 인스턴스 버퍼 일괄 기록(매 프레임 마지막):
   *  - 셸: 살아있는 적만(레이캐스트 대상) → instanceEnemies 로 instanceId 역참조. 색 = 개체색·SHELL_BASE(+피격 가산).
   *  - 코어: 살아있는+디졸브 개체 → 발광색(coreBright). 디졸브 중 셸은 개별 메시(디졸브 셰이더).
   */
  private updateInstances() {
    let ci = 0;
    const counts: Record<PlasmoidArchetype, number> = { rusher: 0, kiter: 0, marker: 0, cutter: 0, rewinder: 0 };
    for (const list of this.instanceEnemiesBy.values()) list.length = 0;
    for (const e of this.enemies) {
      if (e.state === "dead") continue;
      const p = e.group.position, scale = e.group.scale.x;
      const phaseDim = e.isPhased ? PHASE_DIM : 1; // 위상 이탈(§2.1) — 반투명·발광 감소(어둡게)
      // 코어(살아있는 + 디졸브 — 디졸브 시 coreScale 수축)
      if (ci < INST_CAP) {
        const cs = scale * e.coreScale;
        _m4.makeScale(cs, cs, cs).setPosition(p.x, p.y, p.z);
        this.coreInst.setMatrixAt(ci, _m4);
        _col.set(e.color).multiplyScalar(Math.max(0, e.coreBright) * CORE_BLOOM * e.glow * phaseDim); // 강체일수록 밝게(블룸)
        this.coreInst.setColorAt(ci, _col);
        ci++;
      }
      // 셸은 살아있는 적만, **직무별 메시**에 인스턴스(디졸브 중은 개별 메시가 그림)
      if (e.state === "alive") {
        const mesh = this.shellInsts[e.role] ?? this.shellInsts.rusher;
        const si = counts[e.role]++;
        if (si >= INST_CAP) continue;
        _m4.makeScale(scale, scale, scale).setPosition(p.x, p.y, p.z);
        mesh.setMatrixAt(si, _m4);
        _col.set(e.color).multiplyScalar((SHELL_BASE * e.glow + SHELL_FLASH * e.flash) * phaseDim); // 강체 발광 + 피격 가산
        mesh.setColorAt(si, _col);
        this.instanceEnemiesBy.get(mesh)![si] = e;
      }
    }
    for (const [role, mesh] of Object.entries(this.shellInsts) as [PlasmoidArchetype, THREE.InstancedMesh][]) {
      mesh.count = Math.min(INST_CAP, counts[role]);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.boundingSphere = null; // 적이 매 프레임 이동 → 레이캐스트 광역검사용 경계구 재계산(데미지 적중)
    }
    this.coreInst.count = ci;
    this.coreInst.instanceMatrix.needsUpdate = true;
    if (this.coreInst.instanceColor) this.coreInst.instanceColor.needsUpdate = true;
  }

  /** 레이캐스트 적중 → 적(직무별 셸 InstancedMesh 의 instanceId 역참조). 없으면 undefined. */
  enemyFromHit(hit: THREE.Intersection): CoreEnemy | undefined {
    if (hit.instanceId === undefined) return undefined;
    return this.instanceEnemiesBy.get(hit.object)?.[hit.instanceId];
  }

  /**
   * 살아있는 적 목록(aliveWorldPositions 와 동일 순서) — 콘 조준 index 역참조용.
   * 위상 이탈(§2.1) 개체는 제외 — 자동발사·에임 어시스트·특수 콘이 게이지를 낭비하지 않게.
   */
  get aliveEnemies(): readonly CoreEnemy[] {
    return this.enemies.filter((e) => e.state === "alive" && !e.isPhased);
  }

  /** 레이캐스트 대상 — 살아있는 적은 셸 InstancedMesh 1개(instanceId 로 역참조). */
  get hitMeshes(): THREE.Object3D[] {
    return Object.values(this.shellInsts);
  }

  /** 무기 콘 조준 입력용 — 살아있는 적의 월드 좌표(평문). aliveEnemies 와 동일 순서(인덱스 정합). */
  get aliveWorldPositions(): Vec3[] {
    const out: Vec3[] = [];
    for (const e of this.enemies) {
      if (e.state === "alive" && !e.isPhased) { // 위상 이탈 제외 — aliveEnemies 와 동일 필터(인덱스 정합)
        const p = e.group.position; // 살아있는 그룹은 씬 밖(인스턴스 렌더) — position 이 곧 월드좌표(부모 없음)
        out.push({ x: p.x, y: p.y, z: p.z });
      }
    }
    return out;
  }

  /** 코너 브래킷·체력표시용 — 살아있는 적의 월드 위치 + 시각 반경(= group.scale) + 현재 체력. 위상 이탈 제외(확률 구름). */
  get aliveMarkers(): readonly { pos: THREE.Vector3; radius: number; hp: number }[] {
    const out: { pos: THREE.Vector3; radius: number; hp: number }[] = [];
    for (const e of this.enemies) {
      if (e.state === "alive" && !e.isPhased) out.push({ pos: e.group.position, radius: e.group.scale.x, hp: e.hp });
    }
    return out;
  }

  /**
   * 위상 이탈 중인 개체 목록(중력 렌즈 왜곡 §2.7.1 — 배경 일렁임 소스). 질량-에너지는 그대로라
   * 시각적으로만 숨을 뿐, 그 자리는 렌즈처럼 배경을 왜곡한다. 카메라 근접순 정렬(LENS_MAX_POINTS 컷).
   */
  phasedMarkers(cameraPos: THREE.Vector3): { x: number; y: number; z: number; radiusWorld: number; strength: number }[] {
    const out: { x: number; y: number; z: number; radiusWorld: number; strength: number; d: number }[] = [];
    for (const e of this.enemies) {
      if (e.state !== "alive" || !e.isPhased) continue;
      const p = e.group.position;
      out.push({ x: p.x, y: p.y, z: p.z, radiusWorld: e.group.scale.x, strength: 1, d: p.distanceToSquared(cameraPos) });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /** 미니맵용 살아있는 적 위치 스냅샷(읽기 전용). 위상 이탈 개체는 phased 플래그 — 빈 원(확률 구름)으로 그림. */
  get aliveSnapshot(): readonly { x: number; z: number; phased?: boolean }[] {
    const out: { x: number; z: number; phased?: boolean }[] = [];
    for (const e of this.enemies) {
      if (e.state === "alive") {
        out.push({ x: e.group.position.x, z: e.group.position.z, phased: e.isPhased || undefined });
      }
    }
    return out;
  }

  /** 어그로 성향 설정(훅 ④) — 미션 변조. 투입(start*) 후 호출(clear 가 "player" 로 리셋). */
  setAggro(mode: "player" | "landmark" | "building"): void {
    this.aggro = mode;
  }

  /** 공성 낙인 허용(modifiers.buildingBrands, 훅 ④) — 미션 변조. 투입 후 호출(clear 가 false 로 리셋). */
  setBuildingBrands(enabled: boolean): void {
    this.buildingBrandsEnabled = enabled;
  }

  /** 작전구역(존) 설정 — 플라즈모이드를 이 원 안으로 제한. radius≤0 이면 해제. */
  setZone(cx: number, cz: number, radius: number): void {
    this.zoneCx = cx;
    this.zoneCz = cz;
    this.zoneR = radius > 0 ? radius : 0;
  }

  /** 전투 시작. spawn=false 면 웨이브를 시작하지 않음(탐방 모드 — 적 미스폰, 자유 탐방). */
  start(spawn = true) {
    this.clear();
    this.wave = 0;
    this.killCount = 0;
    this.peaceful = !spawn;
    this.burstMode = false;
    // 균열 앵커(소산 표류·파문 중심) — 웨이브 모드는 전투 개시 지점(플레이어 무게중심)을 균열 프록시로
    const c = this.playersCentroid(_centroid);
    this.riftAnchor.x = c.x;
    this.riftAnchor.z = c.z;
    if (spawn) this.startNextWave();
    else this.onWaveChange?.(0); // 탐방 모드 — HUD 웨이브 0
  }

  /**
   * 미션 투입 — 웨이브 대신 **체력 총합 = totalHp** 예산으로 `count` 마리를 투입한다.
   * HP가 클수록 색은 고온(청백)·크기 대형(`appearanceForHp`). 아키타입은 전장 구성 비례(자기정렬).
   * **MP 1인당 스케일**: count·totalHp·동시 상한을 살아있는 플레이어 수 N 배(보스는 팀당 1기 유지).
   * 클리어 후 자동 재시작하지 않는다(미션 종료는 인스턴스가 판정).
   *
   * `concurrentCap > 0`(점진 투입): 피라미드 배분(`pyramidHp` — 잡몹→중견→정예→보스 순 큐)으로
   * 초기 소수만 즉시 투입하고, 나머지는 **균열 앵커**(중심에서 이격 — 위협 방향)에서
   * `reinforceInterval` 간격으로 동시 상한 미만일 때 1기씩 증원. 뒤로 갈수록 강해지고 보스가 마지막.
   * `concurrentCap ≤ 0`(레거시 일괄): 전량 즉시 투입(`distributeHp`, [0]=보스).
   */
  startBurst(count: number, radius: number, totalHp: number, bossHp: number,
    opts?: { concurrentCap?: number; reinforceInterval?: number; fresh?: boolean }) {
    const cap0 = Math.max(0, opts?.concurrentCap ?? 0);
    const n = this.beginMissionDeploy(radius, cap0 > 0, opts?.fresh ?? true); // 레거시 일괄은 균열 앵커 = 전장 중심
    // MP 1인당 스케일 — 인원 N 만큼 물량·체력 총합·동시 상한을 키운다(보스 1기는 팀 공유).
    count = Math.round(count * n);
    totalHp = totalHp * n;
    const cap = Math.round(cap0 * n);
    this.reinforceInterval = opts?.reinforceInterval && opts.reinforceInterval > 0 ? opts.reinforceInterval : 1.5;

    if (cap <= 0) {
      // 레거시 일괄 — 전량 즉시(구 모델. 미션 데이터가 concurrentCap 0 일 때만)
      const hps = distributeHp(totalHp, bossHp, count, Math.random); // [0] = 보스
      for (let i = 0; i < count; i++) this.spawnBurstOne({ hp: hps[i], boss: i === 0 && bossHp > 0 }, true);
    } else {
      this.concurrentCap = cap;
      const hps = pyramidHp(totalHp, bossHp, count, Math.random); // 잡몹→중견→정예, 마지막 = 보스
      this.reinforceQueue = hps.map((hp, i) => ({ hp, boss: bossHp > 0 && i === hps.length - 1 }));
      // 초기 투입 — 상한의 일부(잡몹 위주: 큐 앞쪽)를 전장에 넓게 배치해 즉시 교전 밀도 확보
      const initial = Math.min(this.reinforceQueue.length, Math.max(1, Math.ceil(cap * INITIAL_CAP_FRAC)));
      for (let i = 0; i < initial; i++) this.spawnBurstOne(this.reinforceQueue.shift()!, true);
      this.reinforceTimer = this.reinforceInterval;
    }
    this.onWaveChange?.(this.wave);
  }

  /**
   * 대량 군집 투입(deploy `horde` — 훅 ①, 06-missions §1) — 균일 저체력 `unitHp` × `count`.
   * 피라미드와 같은 균열 증원 인프라(동시 상한 + 간격 보충)를 쓰되 강도 상승 곡선/보스 없음 —
   * 핵앤슬래시 전용 압력(패턴 1~4). MP 는 물량·상한 ×인원.
   */
  startHorde(count: number, unitHp: number, radius: number,
    opts: { concurrentCap: number; reinforceInterval: number; fresh?: boolean }) {
    const n = this.beginMissionDeploy(radius, true, opts.fresh ?? true);
    count = Math.round(count * n);
    this.concurrentCap = Math.max(1, Math.round(opts.concurrentCap * n));
    this.reinforceInterval = opts.reinforceInterval > 0 ? opts.reinforceInterval : 0.5;
    this.reinforceQueue = Array.from({ length: count }, () => ({ hp: unitHp, boss: false }));
    const initial = Math.min(this.reinforceQueue.length, Math.max(1, Math.ceil(this.concurrentCap * INITIAL_CAP_FRAC)));
    for (let i = 0; i < initial; i++) this.spawnBurstOne(this.reinforceQueue.shift()!, true);
    this.reinforceTimer = this.reinforceInterval;
    this.onWaveChange?.(this.wave);
  }

  /**
   * 고정 조합 투입(deploy `roster` — 훅 ①) — 증원 없이 전량 즉시. 유닛 그룹마다 전장 링 위
   * 한 점 주위에 **밀집 배치**(진형 자리 — 편대 가독; formation 필드는 조합 정립 단계에서 확장).
   * role: rusher/kiter/marker = 아키타입 그대로, `elite` = 고체력 러셔(색·크기는 HP 가 결정 — 청백),
   * `boss` = 다중 투영 그룹(count = 그룹 수, 팀 공유 — MP 스케일 제외). MP 는 비보스 물량 ×인원.
   */
  startRoster(units: readonly DeployUnit[], radius: number, bossProjections = BOSS_PROJECTIONS, fresh = true) {
    const n = this.beginMissionDeploy(radius, true, fresh);
    this.spawnRosterUnits(units, n, bossProjections);
    this.onWaveChange?.(this.wave);
  }

  /**
   * 보스 투입(deploy `boss` — 훅 ⑤) — 그룹 ×groups 의 다중 투영 + 수행원(escort, 로스터 규칙).
   * 분출(emit)·소유 파문(ownSweep)·회복 링크(healLink)는 update 루프의 보스 행동으로 구동된다.
   */
  startBossDeploy(cfg: BossDeployCfg, radius: number, fresh = true) {
    const n = this.beginMissionDeploy(radius, true, fresh);
    const groups = Math.max(1, cfg.groups ?? 1);
    const projections = cfg.projections ?? BOSS_PROJECTIONS;
    for (let g = 0; g < groups; g++) this.spawnBossProjections(cfg.bossHp, projections);
    if (cfg.escort?.length) this.spawnRosterUnits(cfg.escort, n, projections);
    this.bossEmit = cfg.emit ?? null;
    this.bossEmitTimer = cfg.emit?.interval ?? 0;
    this.bossOwnSweep = !!cfg.ownSweep;
    this.bossHealLink = cfg.healLink ?? null;
    this.onWaveChange?.(this.wave);
  }

  /**
   * 로스터 유닛 스폰 공통 — 진형 배치(formationPos) + 행동 태깅 + 직무 태깅 + 호위 방패(shield) 수집.
   * escort 행동 유닛은 **앞선 유닛(anchor 인덱스)** 의 중심 곁에 배치되고 그 개체들을 추종한다
   * (라운드로빈 배정, 앵커 전멸 시 formationStep 이 재앵커/hunt 폴백).
   */
  private spawnRosterUnits(units: readonly DeployUnit[], n: number, bossProjections: number) {
    const shielded: CoreEnemy[] = [];
    const escorts: CoreEnemy[] = [];
    const fieldC = { x: this.burstCx, z: this.burstCz };
    const unitCenters: { x: number; z: number }[] = [];
    const unitMembers: CoreEnemy[][] = [];
    units.forEach((u, ui) => {
      if (u.role === "boss") {
        const before = this.bossGroups.length;
        for (let i = 0; i < u.count; i++) this.spawnBossProjections(u.hp, bossProjections);
        unitMembers[ui] = this.bossGroups.slice(before).flat();
        unitCenters[ui] = { x: this.riftAnchor.x, z: this.riftAnchor.z };
        return;
      }
      // 유닛 중심 — 기본: 링 반경 35~65% 위 한 점. escort 는 앵커 유닛 중심 곁(+80m 이격).
      let cx: number, cz: number;
      const anchorC = u.behavior === "escort" ? unitCenters[u.anchor ?? 0] : undefined;
      if (anchorC) {
        const a = Math.random() * Math.PI * 2;
        cx = anchorC.x + Math.cos(a) * 80;
        cz = anchorC.z + Math.sin(a) * 80;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const cr = this.burstLim * (0.35 + Math.random() * 0.3);
        cx = this.burstCx + Math.cos(ang) * cr;
        cz = this.burstCz + Math.sin(ang) * cr;
      }
      unitCenters[ui] = { x: cx, z: cz };
      const members: CoreEnemy[] = [];
      const type: PlasmoidArchetype = u.role === "elite" ? "rusher" : u.role;
      const total = u.count * n;
      for (let i = 0; i < total; i++) {
        const pos = formationPos(u.formation ?? "cluster", i, total, fieldC, unitCenters[ui], this.burstLim, Math.random);
        const e = this.spawnOne(type, pos.x, pos.z, BURST_ROLL_WAVE, u.hp);
        e.deployRole = u.role; // elite 등 미션 계약 직무 태깅(purge-role 집계 — 행동은 type 그대로)
        e.behavior = u.behavior ?? "hunt";
        if (e.behavior === "hold" || e.behavior === "patrol") {
          e.station = { x: pos.x, y: 0, z: pos.z }; // 배치 지점 고수/그 주위 순회(진형 유지)
          e.patrolPhase = (i / Math.max(1, total)) * Math.PI * 2;
        }
        members.push(e);
        if (u.shield !== undefined) {
          e.damageMul = Math.min(1, Math.max(0, u.shield)); // 받는 피해 배수 0..1
          shielded.push(e);
        } else escorts.push(e);
      }
      unitMembers[ui] = members;
    });
    // escort 앵커 배정 — 앞선 유닛의 개체 목록(공유 참조)을 라운드로빈으로 추종
    units.forEach((u, ui) => {
      if (u.behavior !== "escort") return;
      const anchors = unitMembers[u.anchor ?? 0];
      const members = unitMembers[ui] ?? [];
      if (!anchors?.length || anchors === members) {
        for (const e of members) e.behavior = "hunt"; // 앵커 부재/자기참조 — 폴백
        return;
      }
      for (const e of members) e.escortGroup = anchors;
    });
    if (shielded.length && escorts.length) this.shieldGroups.push({ shielded, escorts });
    else for (const e of shielded) e.damageMul = 1; // 호위 없는 방패는 무효(즉시 원복)
  }

  /**
   * 미션 투입 공통 준비 — 모드 플래그·드론 구성/전장 중심 스냅샷·균열 앵커 배치.
   * offsetRift=true 면 앵커를 중심에서 이격(위협 방향 — 소산 표류·파문·증원이 한 점을 가리킴).
   * fresh=false(페이즈 계속 — 훅 ⑥)면 필드·킬/채점 카운터를 유지하고 웨이브 표기만 +1(페이즈 = 웨이브).
   * 반환: MP 스케일 N(살아있는 인원, ≥1).
   */
  private beginMissionDeploy(radius: number, offsetRift: boolean, fresh = true): number {
    if (fresh) {
      this.clear();
      this.wave = 1;
      this.killCount = 0;
    } else {
      this.wave += 1;
    }
    this.peaceful = false;
    this.burstMode = true;
    let walkers = 0, flyers = 0;
    for (const pl of this.players) {
      if (pl.spec.move.mode === "fly") flyers++;
      else walkers++;
    }
    this.burstWalkers = walkers;
    this.burstFlyers = flyers;
    const c = this.playersCentroid(_centroid);
    this.burstCx = c.x; // 스냅샷 — 루프 중 갱신되는 임시 벡터 회피
    this.burstCz = c.z;
    this.burstLim = Math.min(radius > 0 ? radius : 1500, this.world.bounds - 6);
    if (offsetRift) {
      const ang = Math.random() * Math.PI * 2;
      const rd = this.burstLim * RIFT_OFFSET_FRAC;
      this.riftAnchor.x = c.x + Math.cos(ang) * rd;
      this.riftAnchor.z = c.z + Math.sin(ang) * rd;
    } else {
      this.riftAnchor.x = c.x;
      this.riftAnchor.z = c.z;
    }
    return Math.max(1, walkers + flyers);
  }

  /** 미션 투입 1마리 — 보스는 다중 투영으로, 그 외엔 아키타입 추첨 + 배치(wide=전장 원판 / 균열 링). */
  private spawnBurstOne(entry: { hp: number; boss: boolean }, wide: boolean) {
    if (entry.boss) {
      this.spawnBossProjections(entry.hp);
      return;
    }
    // 매칭 완화 — 워커도 카이터(모기)를 일부 끌어오도록 플라이어 가중에 워커 교차분을 더한다.
    const type: PlasmoidArchetype =
      Math.random() < MARKER_BURST_FRAC
        ? "marker"
        : pickBurstType(this.burstWalkers, this.burstFlyers + this.burstWalkers * KITER_CROSS_FRAC, Math.random);
    const ang = Math.random() * Math.PI * 2;
    let x: number, z: number;
    if (wide) {
      const rr = Math.sqrt(Math.random()) * this.burstLim; // 원판 균등 분포(√ 보정)
      x = this.burstCx + Math.cos(ang) * rr;
      z = this.burstCz + Math.sin(ang) * rr;
    } else {
      const rr = REINFORCE_R_MIN + Math.random() * (REINFORCE_R_MAX - REINFORCE_R_MIN); // 균열 주변 링
      x = this.riftAnchor.x + Math.cos(ang) * rr;
      z = this.riftAnchor.z + Math.sin(ang) * rr;
    }
    this.spawnOne(type, x, z, BURST_ROLL_WAVE, entry.hp);
  }

  /**
   * 다중 투영 보스(§2.6) — 보스 예산 1기를 **HP 공유 구체 BOSS_PROJECTIONS 기**로 균열 주변에 투영.
   * 어느 구를 때려도 같은 풀이 줄고(같은 체력이니까 — 가장 느리고 가까운 구가 정답), 풀 소진 시
   * 전 투영 동반 소산(처치 크레딧·환수는 1회 — 미션 격멸 수 계약 유지). 피격 시 투영 사이에 빛
   * 필라멘트가 스치는 연출은 update 루프(§1.10 계시 복선 — "이어져 있다").
   */
  private spawnBossProjections(totalHp: number, projections = BOSS_PROJECTIONS) {
    const pool = { hp: totalHp, maxHp: totalHp, killCredited: false };
    const ap = appearanceForHp(this.spec, totalHp * BOSS_VIS_HP_FRAC);
    const g01 = colorStrength01(this.spec.color.stops, ap.temp);
    const lim = this.world.bounds - 6;
    const group: CoreEnemy[] = [];
    this.bossGroups.push(group);
    for (let i = 0; i < projections; i++) {
      const ang = (i / projections) * Math.PI * 2 + Math.random() * 0.7;
      const rr = REINFORCE_R_MIN + Math.random() * (REINFORCE_R_MAX - REINFORCE_R_MIN);
      const x = THREE.MathUtils.clamp(this.riftAnchor.x + Math.cos(ang) * rr, -lim, lim);
      const z = THREE.MathUtils.clamp(this.riftAnchor.z + Math.sin(ang) * rr, -lim, lim);
      const y = this.world.heightAt(x, z) + 30 + Math.random() * 50;
      const spd = this.spec.archetypes.rusher.speedMin * BOSS_SPEED_MULS[i % BOSS_SPEED_MULS.length];
      const e = new CoreEnemy(new THREE.Vector3(x, y, z), { maxHp: totalHp, diameter: ap.diameter, color: ap.color }, spd);
      e.role = "rusher"; // 저속 접촉 압박형(추격) — 낙인/드레인 없음
      e.deployRole = "boss"; // 투입 직무 — purge-role(boss) 집계(크레딧은 그룹당 1: registerKill 1회 계약)
      e.sharedPool = pool;
      e.killRefund = BOSS_KILL_REFUND;
      e.archetypeName = this.spec.archetypes.rusher.name;
      e.glow = 1 + GLOW_STRENGTH * g01;
      e.driftAnchor = this.riftAnchor;
      e.kkColors = kkLevelColors(this.spec, ap.temp); // 준위 강등 — 공유 풀 미러 HP 로 전 투영 동시 강등
      e.applySilhouette(SHELL_GEOS.rusher);
      this.enemies.push(e);
      group.push(e);
    }
  }

  /** 균열 증원 — 동시 개체 수가 상한 미만일 때 간격마다 큐에서 1기(처치가 곧 증원 유입 = 압력 항상성). */
  private tickReinforce(dt: number) {
    if (!this.burstMode || this.reinforceQueue.length === 0) return;
    this.reinforceTimer -= dt;
    if (this.reinforceTimer > 0) return;
    let alive = 0;
    for (const e of this.enemies) if (e.state === "alive") alive++;
    if (alive >= this.concurrentCap) {
      this.reinforceTimer = REINFORCE_RETRY; // 상한 — 자리 날 때까지 짧게 재시도
      return;
    }
    this.spawnBurstOne(this.reinforceQueue.shift()!, false);
    this.reinforceTimer = this.reinforceInterval;
  }

  private startNextWave() {
    this.wave += 1;
    // 아키타입별 독립 물량 — 러셔는 워커 수, 카이터는 플라이어 수에 비례(자기정렬). 단일 구성은 자기 타입만.
    let walkers = 0, flyers = 0;
    for (const pl of this.players) {
      if (pl.spec.move.mode === "fly") flyers++;
      else walkers++;
    }
    const a = this.spec.archetypes;
    this.pendingRusher = archetypeCount(a.rusher, this.wave, walkers);
    // 매칭 완화 — 카이터(모기) 물량 = 플라이어 정수 비례 + 워커 교차분(워커도 공중 원거리 적에 대응).
    // walkers=0이면 교차분 0 → 종전(플라이어 비례)과 동치. 러셔는 워커 전용 유지(플라이어=공중 특화).
    this.pendingKiter =
      archetypeCount(a.kiter, this.wave, flyers) +
      Math.round(archetypeCount(a.kiter, this.wave, walkers) * KITER_CROSS_FRAC);
    // 마커(소인체) — 드론 종류 무관 전원 비례(낙인탄은 지상/공중 모두 위협 — §6.7 대응 축은 사냥 상성)
    this.pendingMarker = archetypeCount(a.marker, this.wave, walkers + flyers);
    this.spawnTimer = 0;
    this.onWaveChange?.(this.wave);
  }

  /** 살아있는 플레이어들의 무게중심(없으면 원점) — 스폰 기준점. */
  private playersCentroid(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    let n = 0;
    for (const pl of this.players) {
      if (pl.isDead) continue;
      out.add(pl.worldPosition);
      n++;
    }
    if (n > 0) out.multiplyScalar(1 / n);
    return out;
  }

  /** 개체 1마리 스폰. px/pz 를 주면 그 (x,z)에(일괄 스폰), 없으면 무게중심 주변 근거리 밴드에 배치.
   *  hpOverride 를 주면 그 HP로 외형 산출(예산 배분 일괄 스폰), 없으면 온도 롤(rollAppearance). */
  private spawnOne(type: PlasmoidArchetype, px?: number, pz?: number, rollWave = this.wave, hpOverride?: number) {
    const a = this.spec.archetypes;
    const arche =
      type === "kiter" ? a.kiter :
      type === "marker" ? a.marker :
      type === "cutter" ? (a.cutter ?? a.rusher) : //     스펙 없는 구 데이터 — 러셔 폴백
      type === "rewinder" ? (a.rewinder ?? a.rusher) :
      a.rusher;

    // 위치: 명시(일괄 스폰) 또는 플레이어 무게중심 주변 근거리 밴드. 고도는 아키타입 밴드(카이터=상공, 러셔=지표).
    const lim = this.world.bounds - 6;
    let x: number, z: number;
    if (px !== undefined && pz !== undefined) {
      x = THREE.MathUtils.clamp(px, -lim, lim);
      z = THREE.MathUtils.clamp(pz, -lim, lim);
    } else {
      const c = this.playersCentroid(_centroid);
      const angle = Math.random() * Math.PI * 2;
      const radius = 55 + Math.random() * 150;
      x = THREE.MathUtils.clamp(c.x + Math.cos(angle) * radius, -lim, lim);
      z = THREE.MathUtils.clamp(c.z + Math.sin(angle) * radius, -lim, lim);
    }
    const alt = arche.spawnAltMin + Math.random() * (arche.spawnAltMax - arche.spawnAltMin);
    const y = this.world.heightAt(x, z) + alt;

    // 외형/체력/색. hpOverride(예산 배분 일괄 스폰)면 그 HP로 색·크기 산출(HP↑=청백·대형);
    // 아니면 온도 롤(rollAppearance, 저온편향). 일괄 스폰은 전 색 스펙트럼 해금(rollWave).
    let app: { maxHp: number; diameter: number; color: number };
    let temp: number;
    if (hpOverride != null) {
      const ap = appearanceForHp(this.spec, hpOverride);
      app = { maxHp: hpOverride, diameter: ap.diameter, color: ap.color };
      temp = ap.temp;
    } else {
      const roll = rollAppearance(this.spec, rollWave, Math.random);
      app = { maxHp: roll.maxHp, diameter: roll.diameter, color: roll.color };
      temp = roll.temp;
    }
    // 색 강도 g01(0=적색/약, 1=청백/강) — 속도 감속·발광을 한 노브로.
    const g01 = colorStrength01(this.spec.color.stops, temp);
    const spd = arche.speed + (arche.speedMin - arche.speed) * g01; // 적색=speed(최고), 청백=speedMin(최저)
    let enemy: CoreEnemy;
    if (type === "kiter") {
      const k = a.kiter;
      enemy = new CoreEnemy(new THREE.Vector3(x, y, z), app);
      // 개체 고유 방위(구면 균등 무작위 단위벡터) — keepDist 구 위 이 방향을 향해 xy·z 고르게 분산(z 위/아래 무작위).
      const cz = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - cz * cz));
      enemy.setKiter({
        speed: spd,
        turnRate: THREE.MathUtils.degToRad(k.turnRateDeg),
        keepDist: k.keepDist,
        keepBand: k.keepBand,
        strafeMix: k.strafeMix,
        orbitRef: k.orbitRef,
        evadeGain: k.evadeGain,
        homeDir: { x: rr * Math.cos(th), y: cz, z: rr * Math.sin(th) },
      });
    } else if (type === "marker") {
      // 마커(소인체) — 중거리 유영(카이터 이동 재사용, 회피 옵션 없음) + 낙인탄(공격은 update 루프에서 분기).
      const mk = a.marker;
      enemy = new CoreEnemy(new THREE.Vector3(x, y, z), app);
      const cz = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - cz * cz));
      enemy.setKiter({
        speed: spd,
        turnRate: THREE.MathUtils.degToRad(mk.turnRateDeg),
        keepDist: mk.keepDist,
        keepBand: mk.keepBand,
        homeDir: { x: rr * Math.cos(th), y: cz, z: rr * Math.sin(th) },
      });
    } else if (type === "rewinder" && a.rewinder) {
      // 역행체(§6.6) — 후방 원거리 유영(카이터 이동 재사용) + 역행 시전(rewinderCast 가 구동).
      const rw = a.rewinder;
      enemy = new CoreEnemy(new THREE.Vector3(x, y, z), app);
      const cz = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - cz * cz));
      enemy.setKiter({
        speed: spd,
        turnRate: THREE.MathUtils.degToRad(rw.turnRateDeg),
        keepDist: rw.keepDist,
        keepBand: rw.keepBand,
        homeDir: { x: rr * Math.cos(th), y: cz, z: rr * Math.sin(th) },
      });
      enemy.rewCd = rw.rollback.castCd * 0.5; // 첫 시전은 반 쿨다운 후(등장 인지 시간)
    } else {
      // 러셔 — 추격+접촉(setKiter 미호출 → isKiter false).
      enemy = new CoreEnemy(new THREE.Vector3(x, y, z), app, spd);
    }
    enemy.role = type;
    enemy.deployRole = type; // 투입 직무 기본값 = 행동 직무(roster 의 elite 는 호출부가 덮어씀)
    enemy.applySilhouette(SHELL_GEOS[type]); // 디졸브 개별 메시도 직무 형태(P3 §6.7)
    enemy.glow = 1 + GLOW_STRENGTH * g01; // 청백(강)일수록 밝게 빛남(블룸)
    enemy.killRefund = arche.killRefund;
    enemy.archetypeName = arche.name;
    enemy.driftAnchor = this.riftAnchor; // 소산 표류 앵커(공유 참조) — 죽음이 균열 방향을 가리킴
    // 준위 강등(P3 §2.3) — 정예·보스급만 색 계단 주입(HP 경계 하향 통과 시 강등 연출)
    if (app.maxHp >= KK_MIN_HP) enemy.kkColors = kkLevelColors(this.spec, temp);
    // 위상 이탈(§2.1) — 강한 개체(strength≥minStrength)가 확률 보유. 주기는 강함 보간(자주·오래).
    const ph = this.spec.phase;
    if (ph) {
      const s = strength(this.spec, app.maxHp);
      if (phaseRoll(ph, s, Math.random())) enemy.enablePhase(phaseTimings(ph, s), Math.random());
    }
    this.enemies.push(enemy);
    // 살아있는 동안은 셸 InstancedMesh 로 렌더 — 그룹(개별 메시)은 디졸브 시작 시에만 씬에 추가.
    return enemy;
  }

  /** 도주형 고도 클램프 — 지면 아래로 가라앉지 않고(시인성), 수직 회피로 천장 위로 달아나지 않게(추격 가능). */
  private clampKiterAltitude(p: THREE.Vector3) {
    const ground = this.world.heightAt(p.x, p.z);
    const lo = ground + KITER_GROUND_CLEARANCE, hi = ground + KITER_CEILING;
    if (p.y < lo) p.y = lo;
    else if (p.y > hi) p.y = hi;
  }

  /**
   * 공격 1회(아키타입·표적 공통) — 사거리/쿨다운 통과 시 표적(플레이어 1개 or 건물 buildingId 1개)에 피해.
   * 적중 시 **흡수=성장**(`grow`) — 카이터(드레인)·러셔(접촉) 동일. 카이터는 `from→to` 드레인 빔, 플레이어 피해 시 onPlayerHit.
   * 카이터는 고정 `drainDamage`, 러셔는 강함 비례 `contactDamage`를 흡수량 = 가하는 피해 = 성장량으로 삼는다.
   * 반환: 이 타격으로 **건물이 파괴**됐으면 true(호출부가 건물 표적 해제).
   */
  private attack(enemy: CoreEnemy, targetPos: THREE.Vector3, from: THREE.Vector3, player: PlayerController | null, buildingId: string | null): boolean {
    if (enemy.role === "marker") return false; // 마커는 접촉/드레인 없음 — 낙인탄 전용(markerFire, 건물 낙인은 커터 단계 🔭)
    const drain = enemy.role === "kiter"; // 이동은 마커도 카이터형(isKiter) — 공격 분기는 직무(role)로
    const k = this.kiterArche;
    const range = drain ? k.attackRange : ATTACK_RANGE;
    const cooldown = drain ? k.drainInterval : 1.0;
    const amount = drain ? k.drainDamage : contactDamage(this.spec, enemy.maxHp);
    // 드레인빔(원거리)은 건물을 관통 못함 — 표적 플레이어와의 사이가 건물로 막히면 드레인 불가(쿨다운 미소모, 시야 확보 시 재시도).
    if (drain && player && this.world.segmentHitsBuilding(from.x, from.y, from.z, targetPos.x, targetPos.y, targetPos.z) <= 1) return false;
    if (!enemy.tryAttack(targetPos, range, cooldown)) return false;

    let landed = false, destroyed = false;
    if (player) {
      landed = player.takeDamage(amount);
    } else if (buildingId && this.world.buildings) {
      const res = this.world.buildings.damage(buildingId, amount);
      landed = res !== "none";
      destroyed = res === "destroyed";
    }
    if (landed) {
      enemy.grow(amount); // 흡수=성장(러셔·카이터 공통)
      if (drain) this.drain.spawn(from, targetPos, enemy.color);
      if (player) this.onPlayerHit?.(amount, from); // 발원 = 가해 개체 위치(피해 방향 인디케이터)
    }
    return destroyed;
  }

  /**
   * 커터(절단체) 행동 — 표적 건물 상단으로 접근 → 부착 → 절단 채널(severSec) → 납치 개시 →
   * 부양 동반(riding). 채널은 관측 고정(W1)·경직·위상 이탈이 일시정지시킨다("붙들면 인터럽트").
   * 격추 시 재안착은 update 루프의 사망 분기(releaseAbduct)가 담당.
   */
  private cutterStep(enemy: CoreEnemy, p: THREE.Vector3, dt: number): void {
    const bc = this.world.buildings;
    const cu = this.spec.archetypes.cutter;
    if (!bc || !cu) { enemy.update(dt, p, 1); return; } // 스펙/건물 없음 — 부유 대기
    // 납치 동반 — 부양하는 건물 상단에 얹혀 함께 상승. anchor 소멸 = 소거 완료(다음 표적) 또는 해제.
    if (enemy.cutterRide) {
      const top = bc.abductAnchor(enemy.cutterRide);
      if (top) {
        p.set(top.x, top.y + enemy.group.scale.x * 1.4, top.z);
        enemy.update(dt, p, 0); // 이동 없음 — 비주얼만 진행
        return;
      }
      enemy.cutterRide = null;
      enemy.buildingId = null;
      enemy.cutterSever = 0;
    }
    // 표적 확보 — 어그로 변조(landmark)면 랜드마크 직행, 아니면 탐색 반경 내 최근접 건물.
    if (enemy.buildingId == null || !bc.targetTop(enemy.buildingId, _btarget)) {
      enemy.cutterSever = 0;
      const found = this.aggro === "landmark"
        ? bc.nearestLandmark(p.x, p.z)
        : bc.nearestTarget(p.x, p.z, cu.seekRange);
      if (!found) { enemy.update(dt, p, 1); return; }
      enemy.buildingId = found.id;
      if (!bc.targetTop(found.id, _btarget)) return;
    }
    if (p.distanceTo(_btarget) > cu.attachRange) { // 접근(건물 상단으로)
      enemy.update(dt, _btarget, 1);
      return;
    }
    // 부착 — 상단에 정착해 절단 채널. 붙들리면(동결/경직/이탈) 채널 정지.
    p.lerp(_btarget, Math.min(1, dt * 4));
    enemy.update(dt, p, 0);
    if (enemy.isZenoFrozen || enemy.isStaggered || enemy.isPhased) return;
    enemy.cutterSever += dt;
    if (enemy.cutterSever >= cu.severSec) {
      if (bc.beginAbduct(enemy.buildingId!)) enemy.cutterRide = enemy.buildingId;
      else { enemy.buildingId = null; } // 이미 파괴/납치됨 — 재탐색
      enemy.cutterSever = 0;
    }
  }

  /**
   * 2순위 표적 — 플레이어가 사거리 밖일 때 주변 건물을 자동 공격(흡수=성장).
   * 건물 표적을 확보/유지하고 접근·접촉(러셔)/원거리 드레인(카이터)으로 피해를 준다.
   */
  private buildingStep(enemy: CoreEnemy, p: THREE.Vector3, dt: number, boids: Boid[], grid: ReturnType<typeof buildBoidGrid> | undefined, myIdx: number) {
    const bc = this.world.buildings;
    if (!bc) { enemy.update(dt, p, 1); return; } // 건물 없는 전장 → 정지(부유)
    // 현 표적이 없거나(또는 파괴/언로드됨) → 재탐색. aggro=landmark 면 랜드마크 직행(거리 무제한 —
    // "그들이 먼저 노린다"), 없으면 일반 건물 폴백.
    if (enemy.buildingId == null || !bc.targetPos(enemy.buildingId, _btarget)) {
      const found = this.aggro === "landmark"
        ? bc.nearestLandmark(p.x, p.z) ?? bc.nearestTarget(p.x, p.z, BUILDING_SEEK_R)
        : bc.nearestTarget(p.x, p.z, BUILDING_SEEK_R);
      enemy.buildingId = found ? found.id : null;
      if (!found) { enemy.update(dt, p, 1); return; } // 주변 건물 없음 → 정지
      _btarget.set(found.x, found.y, found.z);
    }
    const recompute = recomputeSteer(p.distanceToSquared(_btarget), NEAR_DIST_SQ, this.frame, myIdx, STEER_STRIDE);
    const steer = { vel: ZERO_VEL, boids, index: myIdx, grid, recompute };
    enemy.update(dt, _btarget, 1, steer);
    if (enemy.isKiter) this.clampKiterAltitude(p); // 도주형은 지면 아래로 가라앉지 않게
    // 공성 낙인(modifiers.buildingBrands) — 마커는 접촉 없이 낙인탄으로. 비활성 시 마커는 건물에 무동작(기존).
    if (enemy.role === "marker" && this.buildingBrandsEnabled) {
      this.markerFireBuilding(enemy, p, _btarget, enemy.buildingId!, dt);
    } else if (this.attack(enemy, _btarget, p, null, enemy.buildingId)) enemy.buildingId = null; // 파괴 시 표적 해제
  }

  /**
   * 마커(소인체) 공격 — 사거리·시야(건물 비차폐)·쿨다운 통과 시 **장전 조준선(텔레그래프)** 후
   * 낙인 유도탄 발사(P3 §6.7 — 발사 전 0.7s 조준선으로 회피/인터럽트 여지). 관측 고정(zeno) 동결·
   * 경직·위상 이탈은 장전을 캔슬한다 — "빔을 붙들고 있는 것만으로 장전 인터럽트"(W1).
   */
  private markerFire(enemy: CoreEnemy, from: THREE.Vector3, targetPos: THREE.Vector3, targetIdx: number, dt: number): void {
    const tomb = this.spec.archetypes.marker.tomb;
    // 장전 중 — 점멸 조준선 + 만료 시 발사(차폐되면 불발). 붙들리면 캔슬.
    if (enemy.markerAimLeft > 0) {
      if (enemy.isZenoFrozen || enemy.isStaggered || enemy.isPhased) { enemy.markerAimLeft = 0; return; }
      enemy.markerAimLeft -= dt;
      if ((this.frame & 3) === 0) this.drain.spawn(from, targetPos, enemy.color); // 점멸 조준선
      if (enemy.markerAimLeft <= 0 &&
        this.world.segmentHitsBuilding(from.x, from.y, from.z, targetPos.x, targetPos.y, targetPos.z) > 1) {
        this.brand.launch(from, targetIdx, enemy, tomb);
      }
      return;
    }
    if (this.world.segmentHitsBuilding(from.x, from.y, from.z, targetPos.x, targetPos.y, targetPos.z) <= 1) return; // 차폐
    if (!enemy.tryAttack(targetPos, tomb.fireRange, tomb.fireInterval)) return;
    enemy.markerAimLeft = MARKER_TELEGRAPH_SEC; // 장전 개시 — 조준선 텔레그래프
  }

  /** 마커(소인체) 건물 낙인(공성 낙인 — modifiers.buildingBrands, 06-missions 패턴 17). markerFire 와 동일 리듬, 표적만 건물 id. */
  private markerFireBuilding(enemy: CoreEnemy, from: THREE.Vector3, targetPos: THREE.Vector3, buildingId: string, dt: number): void {
    const tomb = this.spec.archetypes.marker.tomb;
    if (enemy.markerAimLeft > 0) {
      if (enemy.isZenoFrozen || enemy.isStaggered || enemy.isPhased) { enemy.markerAimLeft = 0; return; }
      enemy.markerAimLeft -= dt;
      if ((this.frame & 3) === 0) this.drain.spawn(from, targetPos, enemy.color);
      if (enemy.markerAimLeft <= 0 &&
        this.world.segmentHitsBuilding(from.x, from.y, from.z, targetPos.x, targetPos.y, targetPos.z) > 1) {
        this.brand.launchBuilding(from, buildingId, enemy, tomb);
      }
      return;
    }
    if (this.world.segmentHitsBuilding(from.x, from.y, from.z, targetPos.x, targetPos.y, targetPos.z) <= 1) return;
    if (!enemy.tryAttack(targetPos, tomb.fireRange, tomb.fireInterval)) return;
    enemy.markerAimLeft = MARKER_TELEGRAPH_SEC;
  }

  /**
   * 역행체(§6.6) 시전 — 사거리 내 표적에 castSec 시전 후 역행(performRewind). 카운터 3종이 정본:
   * 시전 중 격파 / W1 동결·경직(인터럽트) / W2 계류(관측된 회로는 되감을 수 없다). 예지 HUD 는
   * onRewindCast 콜백으로 카운트다운을 받는다.
   */
  private rewinderCast(enemy: CoreEnemy, p: THREE.Vector3, targetPos: THREE.Vector3, dt: number): void {
    const rw = this.spec.archetypes.rewinder;
    if (!rw) return;
    const rb = rw.rollback;
    if (enemy.rewCastLeft > 0) {
      if (enemy.isZenoFrozen || enemy.isStaggered || enemy.isPinned || enemy.isPhased) {
        enemy.rewCastLeft = 0;
        enemy.rewCd = rb.castCd * 0.6; // 끊긴 시전 — 짧은 재정렬 후 재시도
        this.onRewindCast?.(null);
        return;
      }
      enemy.rewCastLeft -= dt;
      enemy.coreBright = 5.5; // 시전 발광 — 최우선 표적 텔레그래프
      if ((this.frame & 7) === 0) this.drain.spawn(p, targetPos, enemy.color); // 표적과 이어진 역행선
      if (enemy.rewCastLeft <= 0) {
        this.performRewind(p, rb);
        enemy.rewCd = rb.castCd;
        this.onRewindCast?.(null);
      } else {
        this.onRewindCast?.(enemy.rewCastLeft);
      }
      return;
    }
    enemy.rewCd -= dt;
    if (enemy.rewCd <= 0 && p.distanceToSquared(targetPos) <= rb.castRange * rb.castRange) {
      enemy.rewCastLeft = rb.castSec;
    }
  }

  /** 역행 발동 — 반경 내 최근 격파 부활(계류 확정분 제외) + 처치 집계 되감기 + 플레이어 위치 역행. */
  private performRewind(center: THREE.Vector3, rb: NonNullable<PlasmoidSpec["archetypes"]["rewinder"]>["rollback"]): void {
    const rsq = rb.radius * rb.radius;
    let revived = 0;
    for (const k of this.killLog) {
      if (this.timeSec - k.t > rb.rewindSec || k.pinned) continue;
      if ((k.x - center.x) ** 2 + (k.z - center.z) ** 2 > rsq) continue;
      if (revived >= REWIND_REVIVE_CAP) break;
      this.pendingRevive.push({ x: k.x, z: k.z, maxHp: k.maxHp, role: k.role, deployRole: k.deployRole });
      k.t = -Infinity; // 소모 — 중복 부활 방지
      revived++;
      if (this.roleKills[k.deployRole] > 0) this.roleKills[k.deployRole]--;
    }
    if (revived > 0) this.killCount = Math.max(0, this.killCount - revived); // 전과가 되감긴다
    for (const pl of this.players) {
      if (!pl.isDead && pl.worldPosition.distanceToSquared(center) <= rsq) pl.rewindPosition(rb.rewindSec);
    }
    this.onRewound?.(revived);
  }

  /** 최근접 생존 표적 인덱스(진형 행동의 기회 공격용). 없으면 -1. */
  private nearestAliveTargetIdx(p: THREE.Vector3): number {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.targets.length; i++) {
      if (!this.targets[i].alive) continue;
      const d = this.targets[i].pos.distanceToSquared(p);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * 진형 행동 1스텝 — hold: 배치 지점 고수 · patrol: 유닛 중심 순회 · escort: 앵커 개체 추종
   * (앵커 전멸 시 재앵커, 유닛 전멸 시 hunt 폴백). 이동은 진형을 따르되 **사거리 내 기회 공격은
   * 수행**(낙인탄/드레인/접촉 — 진형이 위협으로 성립). 피격 시 provoked 래치가 이 분기를 해제한다.
   */
  private formationStep(enemy: CoreEnemy, p: THREE.Vector3, dt: number, boids: Boid[], grid: ReturnType<typeof buildBoidGrid> | undefined, myIdx: number) {
    if (enemy.behavior === "escort") {
      const g = enemy.escortGroup;
      const anchor = g?.find((a) => a.state === "alive") ?? null;
      if (!anchor) {
        enemy.behavior = "hunt"; // 호위 대상 전멸 — 진형 해제(다음 프레임부터 어그로)
        return;
      }
      _ftarget.copy(anchor.group.position);
    } else if (enemy.behavior === "patrol" && enemy.station) {
      const a = this.timeSec * PATROL_RATE + enemy.patrolPhase;
      _ftarget.set(enemy.station.x + Math.cos(a) * PATROL_R, p.y, enemy.station.z + Math.sin(a) * PATROL_R);
    } else if (enemy.station) {
      _ftarget.set(enemy.station.x, p.y, enemy.station.z); // hold — 배치 지점(고도는 현재 유지)
    } else {
      enemy.behavior = "hunt"; // 기준점 없음 — 폴백
      return;
    }
    const recompute = recomputeSteer(p.distanceToSquared(_ftarget), NEAR_DIST_SQ, this.frame, myIdx, STEER_STRIDE);
    enemy.update(dt, _ftarget, 1, { vel: ZERO_VEL, boids, index: myIdx, grid, recompute });
    if (enemy.isKiter) this.clampKiterAltitude(p);
    // 기회 공격 — 최근접 생존 표적에 사거리 게이트로 시도(attack/markerFire 내부에서 사거리·쿨다운·시야 판정)
    const idx = this.nearestAliveTargetIdx(p);
    if (idx >= 0) {
      const t = this.targets[idx];
      if (enemy.role === "marker") this.markerFire(enemy, p, t.pos, idx, dt);
      else if (enemy.role === "rewinder") this.rewinderCast(enemy, p, t.pos, dt); // hold 진형의 후방 시전자
      else this.attack(enemy, t.pos, p, t.player, null);
    }
  }

  /** 사망 지점 최근접 플레이어(처치 환수 대상 근사 — MP 무기 소유자 미배선 단계). */
  private nearestPlayer(pos: THREE.Vector3): PlayerController | undefined {
    let best: PlayerController | undefined, bestD = Infinity;
    for (const pl of this.players) {
      if (pl.isDead) continue;
      const d = pl.worldPosition.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = pl; }
    }
    return best;
  }

  /** 매 프레임 플레이어 스냅샷(위치·EMA 속도·생존) 갱신 — 멀티타깃 조향/공격 입력. */
  private buildTargets(dt: number) {
    const n = this.players.length;
    while (this.prevPos.length < n) this.prevPos.push(new THREE.Vector3());
    while (this.vels.length < n) this.vels.push({ x: 0, y: 0, z: 0 });
    this.targets.length = n;
    const a = Math.min(1, dt * 8); // 변위 → 속도 EMA 평활
    for (let i = 0; i < n; i++) {
      const pl = this.players[i];
      const cur = pl.worldPosition; // 라이브 참조(같은 프레임 사용)
      const v = this.vels[i];
      if (this.hasPrev && dt > 1e-4) {
        v.x += ((cur.x - this.prevPos[i].x) / dt - v.x) * a;
        v.y += ((cur.y - this.prevPos[i].y) / dt - v.y) * a;
        v.z += ((cur.z - this.prevPos[i].z) / dt - v.z) * a;
      }
      this.prevPos[i].copy(cur);
      this.playerIsFlyer[i] = pl.spec.move.mode === "fly"; // 상성 타깃팅용
      this.targets[i] = { pos: cur, vel: v, player: pl, alive: !pl.isDead };
    }
    this.playerIsFlyer.length = n;
    this.hasPrev = true;
  }

  /**
   * 개체의 표적 선택 — 거리 + 어그로 부하 + **상성 가중** 점수의 최소(현 표적은 히스테리시스로 유지). 없으면 -1.
   * 적은 자기 상성 드론(카이터→플라이어 / 러셔→워커)을 우선 — MP 혼합팀에서 각자 자기 레인을 맡게 한다.
   */
  private pickTarget(pos: THREE.Vector3, currentIdx: number, isKiter: boolean): number {
    const { targets, dists, matchMul } = this;
    dists.length = targets.length;
    matchMul.length = targets.length;
    for (let i = 0; i < targets.length; i++) {
      matchMul[i] = matchupMul(isKiter, this.playerIsFlyer[i], MISMATCH_PENALTY);
      dists[i] = targets[i].alive ? Math.sqrt(targets[i].pos.distanceToSquared(pos)) : Infinity;
    }
    return chooseTarget(dists, this.load, currentIdx, AGGRO_PENALTY, TARGET_HYSTERESIS, this.scores, matchMul);
  }

  /** 점진적 스폰 — 세 아키타입 예산을 잔여 비율로 섞어 SPAWN_INTERVAL 마다 1마리씩 투입. */
  private tickSpawns(dt: number) {
    if (this.pendingRusher + this.pendingKiter + this.pendingMarker <= 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const type = pickSpawnType(this.pendingRusher, this.pendingKiter, this.pendingMarker, Math.random);
    if (!type) return;
    this.spawnOne(type);
    if (type === "rusher") this.pendingRusher -= 1;
    else if (type === "kiter") this.pendingKiter -= 1;
    else this.pendingMarker -= 1;
    this.spawnTimer = SPAWN_INTERVAL;
  }

  update(dt: number) {
    this.frame++;
    this.timeSec += dt; // patrol 등 시간 기반 진형 행동
    advanceGlobalPulse(dt); // 박동 동기화 — 전 개체 공유 위상(프레임당 1회)
    this.world.buildings?.update(dt); // 건물 피격 틴트/붕괴 연출 진행
    this.tickSpawns(dt);
    this.tickReinforce(dt); // 미션 점진 투입(균열 증원) — 웨이브 모드에선 무동작
    // 역행 부활(§6.6) — 지난 프레임 시전 완료분을 순회 밖에서 스폰(인덱스 정합 보전)
    if (this.pendingRevive.length) {
      for (const k of this.pendingRevive) {
        const e = this.spawnOne(k.role, k.x, k.z, this.wave, k.maxHp);
        e.deployRole = k.deployRole;
      }
      this.pendingRevive.length = 0;
    }
    this.buildTargets(dt);
    const targets = this.targets;

    // 살아있는 적 스냅샷(분리용) — enemies 의 alive 부분과 같은 순서 → 아래 루프의 bi 와 인덱스 정합.
    const boids = this.boids;
    boids.length = 0;
    for (const e of this.enemies) {
      if (e.state === "alive") {
        const p = e.group.position;
        boids.push({ x: p.x, y: p.y, z: p.z, r: e.group.scale.x });
      }
    }
    const grid = boids.length ? buildBoidGrid(boids) : undefined; // 분리 O(n²)→O(n) 공간 해시

    // 어그로 부하 초기화(이번 프레임 표적별 피추적 수)
    const load = this.load;
    load.length = targets.length;
    load.fill(0);

    let bi = 0; // boids 인덱스(alive 순회 동기)
    for (const enemy of this.enemies) {
      const p = enemy.group.position;
      if (enemy.state === "alive") {
        // 다중 투영 동기 — 풀 소진 시 동반 소산, 생존 중엔 표시 HP 를 풀로 미러(브래킷·수축 동기)
        if (enemy.sharedPool) {
          if (enemy.sharedPool.hp <= 0) enemy.forceDissolve();
          else enemy.hp = enemy.sharedPool.hp;
        }
        // 관측 고정 집계 — 동결 진입 1회만(래치). 결과 화면 "관측 고정 n" 채점.
        if (enemy.isZenoFrozen) {
          if (!enemy.zenoLatch) { enemy.zenoLatch = true; this.stats.zenoFreezes++; }
        } else enemy.zenoLatch = false;
        // 준위 강등(P3 §2.3) — HP 경계 하향 통과: 색 강등(적색 쪽) + 짧은 경직 + 전이 방출 펄스
        if (enemy.kkColors) {
          const lv = kkLevelOf(enemy.hp, enemy.maxHp);
          if (lv < enemy.kkCur) {
            enemy.kkCur = lv;
            enemy.color = enemy.kkColors[lv - 1];
            enemy.stagger(KK_DEMOTE_STAGGER);
            enemy.coreBright = 7; // 준위 전이 복사 — 잡음 위로 올라오는 선 스펙트럼(§overview 그래픽 규칙)
          }
        }
      }
      if (enemy.state !== "alive") {
        // 커터 격추 — 납치 중이던 건물 재안착(하강 전환). 모든 사망 경로(격파·동반 소산)를 커버.
        if (enemy.cutterRide) {
          this.world.buildings?.releaseAbduct(enemy.cutterRide);
          enemy.cutterRide = null;
        }
        // 디졸브 시작 → 개별 메시(디졸브 셰이더)로 렌더하도록 씬에 추가(살아있을 땐 인스턴스드라 씬 밖).
        if (enemy.state === "dissolving" && enemy.group.parent === null) this.scene.add(enemy.group);
        enemy.update(dt, p, 1); // 디졸브 비주얼만 진행(이동/공격 없음)
        continue;
      }
      const myIdx = bi++;
      // 커터(절단체 — §6.3) — 플레이어 무시, 건물 부착→절단→납치 전용(방어 미션의 주적)
      if (enemy.role === "cutter") {
        this.cutterStep(enemy, p, dt);
        continue;
      }
      // 진형 행동(hold/patrol/escort) — 피격(provoked) 전까지 어그로 대신 진형 유지 + 기회 공격
      if (enemy.behavior !== "hunt" && !enemy.provoked) {
        this.formationStep(enemy, p, dt, boids, grid, myIdx);
        continue;
      }
      const idx = this.pickTarget(p, enemy.targetIndex, enemy.isKiter); // 상성 가중 포함
      // 기본 = 건물 공격. 플레이어가 인식 범위(AWARENESS_RADIUS) 안에 들면 플레이어로 전환하고,
      // 한번 인식하면 AWARENESS_LOSE_RADIUS 까지 계속 추격(히스테리시스). 벗어나면 다시 건물.
      // provoked(피격 유발)면 거리 게이트를 무시하고 살아있는 플레이어를 계속 추격.
      const distSq = idx >= 0 ? targets[idx].pos.distanceToSquared(p) : Infinity;
      // 어그로 변조(훅 ④): building/landmark 성향은 인식 반경 0 — 때려서 provoked 될 때만 플레이어 교전
      const acquireSq = this.aggro === "player" ? AWARENESS_RADIUS_SQ : 0;
      if (!engagesPlayer(idx >= 0, enemy.targetIndex >= 0, distSq, enemy.provoked, acquireSq, AWARENESS_LOSE_SQ)) {
        enemy.targetIndex = -1;
        this.buildingStep(enemy, p, dt, boids, grid, myIdx);
        continue;
      }
      enemy.targetIndex = idx;
      enemy.buildingId = null;
      load[idx]++;
      const t = targets[idx];
      // 상성 폴백 — 카이터가 비상성(워커=지상) 표적을 노릴 땐 keepDist 를 좁혀 사거리 안으로(처치 가능하게)
      if (enemy.isKiter) enemy.setEngageKeepDist(engageKeepDist(enemy.kiterBaseKeepDist, this.playerIsFlyer[idx], KITER_CLOSE_MUL));
      const recompute = recomputeSteer(p.distanceToSquared(t.pos), NEAR_DIST_SQ, this.frame, myIdx, STEER_STRIDE);
      const steer = { vel: t.vel, boids, index: myIdx, grid, recompute };
      // 도주형 = 예측 회피·원거리 드레인 / 추격형 = 예측 요격·접촉. 공격은 공통 attack()(흡수=성장).
      enemy.update(dt, t.pos, 1, steer);
      if (enemy.isKiter) this.clampKiterAltitude(p); // 지면 아래로 가라앉지 않게
      // 러셔 짧은 돌진(P3 §6.7) — 접근 밴드에서 순간 가속으로 카이팅 파훼(내부 쿨다운이 빈도 제한)
      if (enemy.role === "rusher" && t.player) {
        const dd = p.distanceTo(t.pos);
        if (dd > RUSHER_DASH_MIN && dd < RUSHER_DASH_MAX) enemy.startDash();
      }
      if (enemy.role === "marker") this.markerFire(enemy, p, t.pos, idx, dt);
      else if (enemy.role === "rewinder") this.rewinderCast(enemy, p, t.pos, dt);
      else this.attack(enemy, t.pos, p, t.player, null);
    }

    // 작전구역 경계 — 살아있는 플라즈모이드를 원 안으로 클램프(밖으로 못 나감). 수직(고도)은 별도 처리.
    if (this.zoneR > 0) {
      for (const e of this.enemies) {
        if (e.state !== "alive") continue;
        const gp = e.group.position;
        clampToDisk(gp.x, gp.z, this.zoneCx, this.zoneCz, this.zoneR, this._clampOut);
        gp.x = this._clampOut.x;
        gp.z = this._clampOut.z;
      }
    }

    // 다중 투영 피격 필라멘트 — 한 구가 맞는 순간 같은 그룹 형제 투영으로 빛이 스침("이어져 있다", §1.10 복선)
    if (this.bossFilamentCd > 0) this.bossFilamentCd -= dt;
    if (this.bossGroups.length && this.bossFilamentCd <= 0) {
      for (const group of this.bossGroups) {
        const hit = group.find((e) => e.state === "alive" && e.flash > 0.7);
        if (!hit) continue;
        for (const s of group) {
          if (s !== hit && s.state === "alive") this.drain.spawn(hit.group.position, s.group.position, hit.color);
        }
        this.bossFilamentCd = BOSS_FILAMENT_CD;
        break; // 프레임당 한 그룹만(스로틀 공유)
      }
    }

    this.updateBossBehaviors(dt); // 훅 ⑤ — 호위 방패 해제·잡몹 분출·회복 링크

    this.drain.update(dt);

    // 낙인 유도탄 + 심판 파문 — 전투 중에만(탐방은 전장 이벤트 없음).
    // 앵커 = 균열(리프트 앵커), 보스 소유 파문(ownSweep)이면 살아있는 보스 위치.
    if (!this.peaceful) {
      const anchor = this.sweepAnchor();
      this.brand.update(dt, anchor, this.world.heightAt(anchor.x, anchor.z));
    }

    // 죽은 적 정리
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].state === "dead") {
        this.scene.remove(this.enemies[i].group);
        this.enemies[i].dispose();
        this.enemies.splice(i, 1);
      }
    }

    this.updateInstances(); // 살아있는 셸 + 코어 일괄 렌더(InstancedMesh)

    // 웨이브 종료 판정 — 탐방/일괄 스폰 모드면 자동 재시작 안 함(일괄은 미션 인스턴스가 종료 판정)
    if (!this.peaceful && !this.burstMode
      && this.pendingRusher + this.pendingKiter + this.pendingMarker === 0 && this.enemies.length === 0) {
      this.startNextWave();
    }
  }

  /** 파문 예고 잔여(s) — HUD 폴링용. 탐방/비활성은 null. */
  get sweepWarnLeft(): number | null {
    return this.peaceful ? null : this.brand.warnLeft;
  }

  /** 파문 주기 배수(미션 변조 sweepPeriodMul) — 투입 후 지정. */
  setSweepPeriodMul(mul: number): void {
    this.brand.setPeriodMul(mul);
  }

  /** 전장이 비었는가(생존 0 + 증원/웨이브 예산 0) — 페이즈 전환 트리거(훅 ⑥). */
  /** 계시 연출(§9 5장) — 전장 전 개체 동시 소산("전 투영 회수"). 처치 크레딧·증원 없음. */
  recallAll(): void {
    this.reinforceQueue.length = 0;
    this.pendingRusher = this.pendingKiter = this.pendingMarker = 0;
    for (const e of this.enemies) e.forceDissolve();
  }

  /** 지금 "조사 중"(최근 피격 창 내)인 생존 개체 수 — 동시 조사 실험(§9 5장)의 판정 입력. */
  get observedCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.isObserved) n++;
    return n;
  }

  get fieldCleared(): boolean {
    if (this.reinforceQueue.length > 0 || this.pendingRusher + this.pendingKiter + this.pendingMarker > 0) return false;
    for (const e of this.enemies) if (e.state === "alive") return false;
    return true;
  }

  /** 첫 살아있는 보스 투영(분출·소유 파문 호스트). 없으면 null. */
  private firstAliveBoss(): CoreEnemy | null {
    for (const g of this.bossGroups) for (const e of g) if (e.state === "alive") return e;
    return null;
  }

  /** 파문 원점 — 보스 소유 파문이면 살아있는 보스 위치(전부 소산 시 균열 폴백). */
  private sweepAnchor(): Vec3 {
    if (this.bossOwnSweep) {
      const host = this.firstAliveBoss();
      if (host) {
        const p = host.group.position;
        _sweepAnchor.x = p.x; _sweepAnchor.y = p.y; _sweepAnchor.z = p.z;
        return _sweepAnchor;
      }
    }
    return this.riftAnchor;
  }

  /** 보스 행동(훅 ⑤) — 호위 방패 해제 · 잡몹 분출 · 회복 링크(+연출 필라멘트). */
  private updateBossBehaviors(dt: number) {
    // 호위 방패 — 호위 전멸 시 감쇄 해제("호위 붕괴")
    for (let i = this.shieldGroups.length - 1; i >= 0; i--) {
      const g = this.shieldGroups[i];
      if (g.escorts.every((e) => e.state !== "alive")) {
        for (const e of g.shielded) e.damageMul = 1;
        this.shieldGroups.splice(i, 1);
      }
    }
    // 잡몹 분출(성숙체) — 살아있는 보스 주변 링에서 주기 분출(전장 생존 상한 게이트)
    if (this.bossEmit) {
      this.bossEmitTimer -= dt;
      if (this.bossEmitTimer <= 0) {
        const host = this.firstAliveBoss();
        let alive = 0;
        for (const e of this.enemies) if (e.state === "alive") alive++;
        if (host && alive < BOSS_EMIT_ALIVE_CAP) {
          const hp = host.group.position;
          for (let i = 0; i < this.bossEmit.count; i++) {
            const ang = Math.random() * Math.PI * 2;
            const rr = BOSS_EMIT_R_MIN + Math.random() * (BOSS_EMIT_R_MAX - BOSS_EMIT_R_MIN);
            const e = this.spawnOne(this.bossEmit.role, hp.x + Math.cos(ang) * rr, hp.z + Math.sin(ang) * rr, BURST_ROLL_WAVE, this.bossEmit.hp);
            e.deployRole = this.bossEmit.role;
          }
        }
        this.bossEmitTimer = this.bossEmit.interval;
      }
    }
    // 회복 링크(쌍생) — 서로 range 안인 그룹 쌍의 풀이 함께 회복(연출: 그룹 대표 간 필라멘트)
    if (this.bossHealLink && this.bossGroups.length >= 2) {
      if (this.healFxCd > 0) this.healFxCd -= dt;
      const reps: { pool: NonNullable<CoreEnemy["sharedPool"]>; e: CoreEnemy }[] = [];
      for (const g of this.bossGroups) {
        const live = g.find((e) => e.state === "alive");
        if (live?.sharedPool && live.sharedPool.hp > 0) reps.push({ pool: live.sharedPool, e: live });
      }
      const r2 = this.bossHealLink.range * this.bossHealLink.range;
      for (let i = 0; i < reps.length; i++) {
        for (let j = i + 1; j < reps.length; j++) {
          if (reps[i].pool === reps[j].pool) continue;
          const a = reps[i].e.group.position, b = reps[j].e.group.position;
          if (a.distanceToSquared(b) > r2) continue;
          const heal = this.bossHealLink.rate * dt;
          reps[i].pool.hp = Math.min(reps[i].pool.maxHp, reps[i].pool.hp + heal);
          reps[j].pool.hp = Math.min(reps[j].pool.maxHp, reps[j].pool.hp + heal);
          if (this.healFxCd <= 0) {
            this.drain.spawn(a, b, reps[i].e.color); // 회복 실 가시화 — "떼어놓거나 함께 태워라"
            this.healFxCd = HEAL_FX_CD;
          }
        }
      }
    }
  }

  /** 플레이어의 현재 낙인 수(HUD 폴링용). */
  brandCount(playerIdx = 0): number {
    return this.brand.brandCount(playerIdx);
  }

  /** 피격 유발 인식 — 플레이어가 때린 플라즈모이드 반경 PROVOKE_RADIUS 안의 살아있는 개체를 provoked 로 전환. */
  provokeNear(hit: CoreEnemy) {
    const c = hit.group.position;
    for (const e of this.enemies) {
      if (e.state !== "alive" || e.provoked) continue;
      if (e.group.position.distanceToSquared(c) <= PROVOKE_RADIUS_SQ) e.provoked = true;
    }
  }

  registerKill(enemy?: CoreEnemy) {
    this.killCount += 1;
    // 처치 = 흡수당한 물질 회수(HP 환수). 사망 지점 최근접 플레이어에게(근사).
    if (enemy) this.nearestPlayer(enemy.group.position)?.heal(enemy.killRefund);
    // 역행 후보 기록(§6.6) — 계류(W2) 중 격파는 확정으로 표기(되감기지 않는다). 상한 64.
    if (enemy) {
      this.killLog.push({
        t: this.timeSec, x: enemy.group.position.x, z: enemy.group.position.z,
        maxHp: enemy.maxHp, role: enemy.role, deployRole: enemy.deployRole, pinned: enemy.isPinned,
      });
      if (this.killLog.length > 64) this.killLog.shift();
    }
    // 마커 격파 — 그 개체의 유도탄·낙인 소산("마커 우선 격파" 카운터, §6.1) + 채점·직무별 집계
    if (enemy) {
      this.brand.notifyDead(enemy);
      if (enemy.role === "marker") this.stats.markerKills++;
      this.roleKills[enemy.deployRole]++; // purge-role(훅 ③) — 보스는 그룹당 1회(크레딧 계약)
    }
    // 동시 경직 — 전장의 모든 개체가 같은 순간 움찔(이동·공격 잠깐 정지 + 일제 수축).
    // 플레이어에게는 "처치 직후 안전창" 테크닉으로 읽힌다.
    for (const e of this.enemies) if (e !== enemy) e.stagger(KILL_STAGGER_SEC);
    this.onKill?.(enemy);
  }

  /** 잔여 증원 수(큐) — 감독 스냅샷(§10)·전장 소진 판단용. */
  get reinforceQueuedCount(): number {
    return this.reinforceQueue.length;
  }

  /** 개체의 강함 s(0..1) — XP(§7.4)·연출 등 외부 후처리용(스펙 은닉 유지). */
  strengthOf(e: CoreEnemy): number {
    return strength(this.spec, e.maxHp);
  }

  clear() {
    for (const e of this.enemies) {
      this.scene.remove(e.group);
      e.dispose();
    }
    this.enemies = [];
    this.drain.clear();
    this.brand.clear(); // 유도탄·낙인·파면 정리 + 파문 주기 재무장
    this.killLog.length = 0; // 역행 후보 기록 초기화
    this.pendingRevive.length = 0;
    for (const list of this.instanceEnemiesBy.values()) list.length = 0; // 인스턴스 비우기(재입장 시 잔상 방지)
    this.coreInst.count = 0;
    this.coreInst.instanceMatrix.needsUpdate = true;
    for (const mesh of Object.values(this.shellInsts)) {
      mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.pendingRusher = 0;
    this.pendingKiter = 0;
    this.pendingMarker = 0;
    this.reinforceQueue = [];
    this.reinforceTimer = 0;
    this.concurrentCap = 0;
    this.bossGroups = [];
    this.bossFilamentCd = 0;
    this.timeSec = 0;
    this.bossEmit = null;
    this.bossEmitTimer = 0;
    this.bossOwnSweep = false;
    this.bossHealLink = null;
    this.healFxCd = 0;
    this.shieldGroups = [];
    this.stats.markerKills = 0;
    this.stats.zenoFreezes = 0;
    this.stats.sweepHits = 0;
    this.stats.sweepCleanPasses = 0;
    for (const k of Object.keys(this.roleKills) as (keyof typeof this.roleKills)[]) this.roleKills[k] = 0;
    this.aggro = "player"; // 어그로 변조 리셋 — 미션이 투입 후 setAggro 로 재지정
    this.buildingBrandsEnabled = false; // 공성 낙인 변조 리셋 — 미션이 투입 후 setBuildingBrands 로 재지정
    this.burstMode = false;
    this.hasPrev = false; // 재입장 시 순간이동 변위로 인한 가짜 속도 스파이크 방지
    for (const v of this.vels) { v.x = v.y = v.z = 0; }
  }

  /**
   * 락온 대상 선택 — 카메라 시선 방향(aimDir) 기준 조준 콘(coneDeg°) 안에서 가장 정렬된 살아있는 적.
   * 락온 키를 눌렀을 때 Game 이 호출한다. 없으면 null.
   */
  bestTargetInView(origin: THREE.Vector3, aimDir: THREE.Vector3, coneDeg = 30, maxDist = LOCK_ACQUIRE_RANGE): CoreEnemy | null {
    const alive = this.enemies.filter((e) => e.state === "alive");
    const positions = alive.map((e) => {
      const p = e.group.position;
      return { x: p.x, y: p.y, z: p.z };
    });
    const idx = bestAlignedInCone(origin, aimDir, positions, coneDeg, maxDist);
    return idx >= 0 ? alive[idx] : null;
  }
}
