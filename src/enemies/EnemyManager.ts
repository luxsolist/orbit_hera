import * as THREE from "three";
import { CoreEnemy, chooseTarget, matchupMul, engageKeepDist, buildBoidGrid, recomputeSteer, CORE_GEO, SHELL_GEO, type Boid } from "./CoreEnemy";
import type { GameWorld } from "../world/GameWorld";
import type { PlayerController } from "../player/PlayerController";
import { DrainBeams } from "../fx/DrainBeams";
import {
  DEFAULT_PLASMOID, rollAppearance, contactDamage, archetypeCount, pickSpawnType, pickBurstType, colorStrength01,
  distributeHp, appearanceForHp,
  type PlasmoidSpec, type PlasmoidKiterArchetype, type PlasmoidArchetype,
} from "./PlasmoidSpec";
import { clampToDisk, type Vec3 } from "../core/math";

const ATTACK_RANGE = 3.2; // 접촉 교전 거리(피해는 PlasmoidSpec.contact 로 산출)
const SPAWN_INTERVAL = 0.35; // 개체 점진 스폰 간격(s)
const BURST_ROLL_WAVE = 12; // 일괄 스폰 외형 롤의 가상 웨이브 — 전 온도(색) 스펙트럼 해금(크기 다양성은 개체 rand 유지)
const KITER_GROUND_CLEARANCE = 1.5; // 도주형이 가라앉지 않는 지면 위 최소 높이(m)
const KITER_CEILING = 1020; // 도주형 상승 상한(지면 대비, m) — 비행 천장(1000) 근처까지 추격 가능(고고도 이탈 방지)
const TARGET_HYSTERESIS = 1.2; // 표적 교체 문턱 — 현재 표적이 최근접의 1.2배 이내면 유지(깜빡임 방지)
// 플레이어 인식 범위(awareness) — 기본은 건물 공격, 플레이어가 이 안에 들면 플레이어 공격으로 전환.
// 한번 인식하면 LOSE 거리까지 계속 추격(히스테리시스: 들어오면 계속, 벗어나면 다시 건물). 플레이테스트로 조정.
const AWARENESS_RADIUS = 200; // 인식(전환) 반경(m)
const AWARENESS_RADIUS_SQ = AWARENESS_RADIUS * AWARENESS_RADIUS;
const AWARENESS_LOSE_RADIUS = 360; // 인식 해제 반경(m) — 이보다 멀어지면 건물 공격 복귀
const AWARENESS_LOSE_SQ = AWARENESS_LOSE_RADIUS * AWARENESS_LOSE_RADIUS;
const BUILDING_SEEK_R = 700; // 플레이어가 멀 때 공격할 주변 건물 탐색 반경(m)
const STEER_STRIDE = 3; // 원거리 적 조향 재계산 주기(프레임) — 라운드로빈 분산
const NEAR_DIST = 250; // 이 거리(m) 이내는 매 프레임 재계산(교전 감각 — 스폰 반경 전체 커버, 끊김 방지)
const NEAR_DIST_SQ = NEAR_DIST * NEAR_DIST;
const INST_CAP = 2048; // 셸/코어 InstancedMesh 최대 인스턴스 수
const CORE_BLOOM = 0.55; // 코어 발광 세기 → instanceColor 배수(코어 단독 인스턴싱 때 승인된 값 유지)
const SHELL_BASE = 0.5; // 셸 본체 기조(개체색 배수, 자체발광)
const SHELL_FLASH = 2.6; // 피격 번쩍임 시 셸 색 가산(색조 유지)
const GLOW_STRENGTH = 2.0; // 색 강도 비례 발광 가산 — glow = 1 + 2·g01 (청백일수록 밝게 빛남/블룸)

const _m4 = new THREE.Matrix4(); // 인스턴스 행렬 임시
const _col = new THREE.Color(); // 인스턴스 색 임시
const AGGRO_PENALTY = 0.4; // 어그로 분산 — 이미 표적이 된 플레이어당 거리 점수 가산(한 명에게 몰빵 방지)
const MISMATCH_PENALTY = 3.0; // 상성 불일치 표적 점수 배수(>1) — 적이 자기 상성 드론을 우선(MP 혼합팀). 절대 배제 아닌 가중
const KITER_CLOSE_MUL = 0.45; // 카이터가 비상성(워커) 표적을 노릴 때 keepDist 축소 배수(60→27 ≈ 워커 자동조준 내)

const _centroid = new THREE.Vector3(); // 스폰 무게중심 임시(프레임당 동기 사용)
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
  private shellInst: THREE.InstancedMesh; // 살아있는 셸 일괄 렌더 + 레이캐스트(드로우콜 1개)
  private instanceEnemies: CoreEnemy[] = []; // 셸 인스턴스 슬롯 → 적(레이캐스트 instanceId 역참조)

  wave = 0;
  killCount = 0;
  private frame = 0; // 프레임 분산 라운드로빈 위상
  private spawnTimer = 0;
  private peaceful = false; // 탐방 모드 — 웨이브 미시작 + 클리어 시 자동 재시작 억제
  private burstMode = false; // 일괄 스폰 모드 — 웨이브 미사용(미션: 구역 내 N마리 한번에) + 클리어 시 자동 재시작 억제
  // 작전구역(존) — 플라즈모이드도 이 원(중심·반경) 밖으로 못 나간다. radius 0 = 무제한.
  private zoneCx = 0;
  private zoneCz = 0;
  private zoneR = 0;
  private _clampOut = { x: 0, z: 0 }; // clampToDisk 결과 재사용
  private pendingRusher = 0; // 아키타입별 잔여 스폰 예산(거머리 떼 / 모기 소수정예 독립 조절)
  private pendingKiter = 0;
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

  onKill?: () => void;
  onPlayerHit?: (damage: number) => void;
  onWaveChange?: (wave: number) => void;

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

    // 코어 InstancedMesh — 살아있는/디졸브 개체 코어 일괄 렌더(MeshBasic + instanceColor = 발광).
    this.coreInst = new THREE.InstancedMesh(CORE_GEO, new THREE.MeshBasicMaterial(), INST_CAP);
    this.coreInst.frustumCulled = false;
    this.coreInst.count = 0;
    scene.add(this.coreInst);

    // 셸 InstancedMesh — 살아있는 적 본체 일괄 렌더 + 레이캐스트 대상. 자체발광(MeshBasic — 조명에 탁해지지 않게)
    // + DoubleSide(코앞 적 내부 적중) + 그림자.
    const shellMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.shellInst = new THREE.InstancedMesh(SHELL_GEO, shellMat, INST_CAP);
    this.shellInst.frustumCulled = false;
    this.shellInst.castShadow = true;
    this.shellInst.count = 0;
    scene.add(this.shellInst);
  }

  /**
   * 인스턴스 버퍼 일괄 기록(매 프레임 마지막):
   *  - 셸: 살아있는 적만(레이캐스트 대상) → instanceEnemies 로 instanceId 역참조. 색 = 개체색·SHELL_BASE(+피격 가산).
   *  - 코어: 살아있는+디졸브 개체 → 발광색(coreBright). 디졸브 중 셸은 개별 메시(디졸브 셰이더).
   */
  private updateInstances() {
    const inst = this.instanceEnemies;
    inst.length = 0;
    let si = 0, ci = 0;
    for (const e of this.enemies) {
      if (e.state === "dead") continue;
      const p = e.group.position, scale = e.group.scale.x;
      // 코어(살아있는 + 디졸브 — 디졸브 시 coreScale 수축)
      if (ci < INST_CAP) {
        const cs = scale * e.coreScale;
        _m4.makeScale(cs, cs, cs).setPosition(p.x, p.y, p.z);
        this.coreInst.setMatrixAt(ci, _m4);
        _col.set(e.color).multiplyScalar(Math.max(0, e.coreBright) * CORE_BLOOM * e.glow); // 강체일수록 밝게(블룸)
        this.coreInst.setColorAt(ci, _col);
        ci++;
      }
      // 셸은 살아있는 적만 인스턴스(디졸브 중은 개별 메시가 그림)
      if (e.state === "alive" && si < INST_CAP) {
        _m4.makeScale(scale, scale, scale).setPosition(p.x, p.y, p.z);
        this.shellInst.setMatrixAt(si, _m4);
        _col.set(e.color).multiplyScalar(SHELL_BASE * e.glow + SHELL_FLASH * e.flash); // 강체 발광 + 피격 가산
        this.shellInst.setColorAt(si, _col);
        inst[si] = e;
        si++;
      }
    }
    this.shellInst.count = si;
    this.shellInst.instanceMatrix.needsUpdate = true;
    if (this.shellInst.instanceColor) this.shellInst.instanceColor.needsUpdate = true;
    this.shellInst.boundingSphere = null; // 적이 매 프레임 이동 → 레이캐스트 광역검사용 경계구 재계산(데미지 적중)
    this.coreInst.count = ci;
    this.coreInst.instanceMatrix.needsUpdate = true;
    if (this.coreInst.instanceColor) this.coreInst.instanceColor.needsUpdate = true;
  }

  /** 레이캐스트 적중 → 적(셸 InstancedMesh 의 instanceId 역참조). 없으면 undefined. */
  enemyFromHit(hit: THREE.Intersection): CoreEnemy | undefined {
    return hit.instanceId !== undefined ? this.instanceEnemies[hit.instanceId] : undefined;
  }

  /** 살아있는 적 목록(aliveWorldPositions 와 동일 순서) — 콘 조준 index 역참조용. */
  get aliveEnemies(): readonly CoreEnemy[] {
    return this.enemies.filter((e) => e.state === "alive");
  }

  /** 레이캐스트 대상 — 살아있는 적은 셸 InstancedMesh 1개(instanceId 로 역참조). */
  get hitMeshes(): THREE.Object3D[] {
    return [this.shellInst];
  }

  /** 무기 콘 조준 입력용 — 살아있는 적의 월드 좌표(평문). aliveEnemies 와 동일 순서(인덱스 정합). */
  get aliveWorldPositions(): Vec3[] {
    const out: Vec3[] = [];
    for (const e of this.enemies) {
      if (e.state === "alive") {
        const p = e.group.position; // 살아있는 그룹은 씬 밖(인스턴스 렌더) — position 이 곧 월드좌표(부모 없음)
        out.push({ x: p.x, y: p.y, z: p.z });
      }
    }
    return out;
  }

  /** 코너 브래킷·체력표시용 — 살아있는 적의 월드 위치 + 시각 반경(= group.scale) + 현재 체력. */
  get aliveMarkers(): readonly { pos: THREE.Vector3; radius: number; hp: number }[] {
    const out: { pos: THREE.Vector3; radius: number; hp: number }[] = [];
    for (const e of this.enemies) {
      if (e.state === "alive") out.push({ pos: e.group.position, radius: e.group.scale.x, hp: e.hp });
    }
    return out;
  }

  /** 미니맵용 살아있는 적 위치 스냅샷(읽기 전용) */
  get aliveSnapshot(): readonly { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const e of this.enemies) {
      if (e.state === "alive") {
        out.push({ x: e.group.position.x, z: e.group.position.z });
      }
    }
    return out;
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
    if (spawn) this.startNextWave();
    else this.onWaveChange?.(0); // 탐방 모드 — HUD 웨이브 0
  }

  /**
   * 일괄 스폰 — 웨이브 대신 구역(반경 radius) 안에 `count` 마리를 **한 번에** 투입.
   * **체력 총합 = totalHp**(예산 배분): index 0 = 중간보스(bossHp), 나머지는 총합을 무작위로 나눠 가진다.
   * HP가 클수록 색은 고온(청백)·크기 대형(`appearanceForHp`). 아키타입은 전장 구성 비례(자기정렬).
   * **MP 1인당 스케일**: count·totalHp 를 살아있는 플레이어 수 N 배(보스는 팀당 1기 유지) → 1인당 체감 일정.
   * 클리어 후 자동 재시작하지 않는다(미션 종료는 인스턴스가 판정).
   */
  startBurst(count: number, radius: number, totalHp: number, bossHp: number) {
    this.clear();
    this.wave = 1;
    this.killCount = 0;
    this.peaceful = false;
    this.burstMode = true;

    let walkers = 0, flyers = 0;
    for (const pl of this.players) {
      if (pl.spec.move.mode === "fly") flyers++;
      else walkers++;
    }
    // MP 1인당 스케일 — 인원 N 만큼 물량·체력 총합을 키운다(보스 1기는 팀 공유). 아키타입 비율은 pickBurstType 이 구성대로.
    const n = Math.max(1, walkers + flyers);
    count = Math.round(count * n);
    totalHp = totalHp * n;
    const hps = distributeHp(totalHp, bossHp, count, Math.random); // 체력 예산 배분(합=totalHp, [0]=보스)
    const c = this.playersCentroid(_centroid);
    const cx = c.x, cz = c.z; // 구역 중심 = 스폰 무게중심(스냅샷 — 루프 중 갱신되는 임시 벡터 회피)
    const lim = Math.min(radius > 0 ? radius : 1500, this.world.bounds - 6);
    for (let i = 0; i < count; i++) {
      const type = pickBurstType(walkers, flyers, Math.random);
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * lim; // 원판 균등 분포(√ 보정)
      this.spawnOne(type, cx + Math.cos(ang) * rr, cz + Math.sin(ang) * rr, BURST_ROLL_WAVE, hps[i]);
    }
    this.onWaveChange?.(1);
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
    this.pendingKiter = archetypeCount(a.kiter, this.wave, flyers);
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
    const arche = type === "kiter" ? a.kiter : a.rusher;

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
    } else {
      // 러셔 — 추격+접촉(setKiter 미호출 → isKiter false).
      enemy = new CoreEnemy(new THREE.Vector3(x, y, z), app, spd);
    }
    enemy.glow = 1 + GLOW_STRENGTH * g01; // 청백(강)일수록 밝게 빛남(블룸)
    enemy.killRefund = arche.killRefund;
    enemy.archetypeName = arche.name;
    this.enemies.push(enemy);
    // 살아있는 동안은 셸 InstancedMesh 로 렌더 — 그룹(개별 메시)은 디졸브 시작 시에만 씬에 추가.
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
    const drain = enemy.isKiter;
    const k = this.kiterArche;
    const range = drain ? k.attackRange : ATTACK_RANGE;
    const cooldown = drain ? k.drainInterval : 1.0;
    const amount = drain ? k.drainDamage : contactDamage(this.spec, enemy.maxHp);
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
      if (player) this.onPlayerHit?.(amount);
    }
    return destroyed;
  }

  /**
   * 2순위 표적 — 플레이어가 사거리 밖일 때 주변 건물을 자동 공격(흡수=성장).
   * 건물 표적을 확보/유지하고 접근·접촉(러셔)/원거리 드레인(카이터)으로 피해를 준다.
   */
  private buildingStep(enemy: CoreEnemy, p: THREE.Vector3, dt: number, boids: Boid[], grid: ReturnType<typeof buildBoidGrid> | undefined, myIdx: number) {
    const bc = this.world.buildings;
    if (!bc) { enemy.update(dt, p, 1); return; } // 건물 없는 전장 → 정지(부유)
    // 현 표적이 없거나(또는 파괴/언로드됨) → 최근접 건물 재탐색
    if (enemy.buildingId == null || !bc.targetPos(enemy.buildingId, _btarget)) {
      const found = bc.nearestTarget(p.x, p.z, BUILDING_SEEK_R);
      enemy.buildingId = found ? found.id : null;
      if (!found) { enemy.update(dt, p, 1); return; } // 주변 건물 없음 → 정지
      _btarget.set(found.x, found.y, found.z);
    }
    const recompute = recomputeSteer(p.distanceToSquared(_btarget), NEAR_DIST_SQ, this.frame, myIdx, STEER_STRIDE);
    const steer = { vel: ZERO_VEL, boids, index: myIdx, grid, recompute };
    enemy.update(dt, _btarget, 1, steer);
    if (enemy.isKiter) this.clampKiterAltitude(p); // 도주형은 지면 아래로 가라앉지 않게
    if (this.attack(enemy, _btarget, p, null, enemy.buildingId)) enemy.buildingId = null; // 파괴 시 표적 해제
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

  /** 점진적 스폰 — 두 아키타입 예산을 잔여 비율로 섞어 SPAWN_INTERVAL 마다 1마리씩 투입. */
  private tickSpawns(dt: number) {
    if (this.pendingRusher + this.pendingKiter <= 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const type = pickSpawnType(this.pendingRusher, this.pendingKiter, Math.random);
    if (!type) return;
    this.spawnOne(type);
    if (type === "rusher") this.pendingRusher -= 1;
    else this.pendingKiter -= 1;
    this.spawnTimer = SPAWN_INTERVAL;
  }

  update(dt: number) {
    this.frame++;
    this.world.buildings?.update(dt); // 건물 피격 틴트/붕괴 연출 진행
    this.tickSpawns(dt);
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
      if (enemy.state !== "alive") {
        // 디졸브 시작 → 개별 메시(디졸브 셰이더)로 렌더하도록 씬에 추가(살아있을 땐 인스턴스드라 씬 밖).
        if (enemy.state === "dissolving" && enemy.group.parent === null) this.scene.add(enemy.group);
        enemy.update(dt, p, 1); // 디졸브 비주얼만 진행(이동/공격 없음)
        continue;
      }
      const myIdx = bi++;
      const idx = this.pickTarget(p, enemy.targetIndex, enemy.isKiter); // 상성 가중 포함
      // 기본 = 건물 공격. 플레이어가 인식 범위(AWARENESS_RADIUS) 안에 들면 플레이어로 전환하고,
      // 한번 인식하면 AWARENESS_LOSE_RADIUS 까지 계속 추격(히스테리시스). 벗어나면 다시 건물.
      const detectSq = enemy.targetIndex >= 0 ? AWARENESS_LOSE_SQ : AWARENESS_RADIUS_SQ;
      if (idx < 0 || targets[idx].pos.distanceToSquared(p) > detectSq) {
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
      this.attack(enemy, t.pos, p, t.player, null);
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

    this.drain.update(dt);

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
    if (!this.peaceful && !this.burstMode && this.pendingRusher + this.pendingKiter === 0 && this.enemies.length === 0) {
      this.startNextWave();
    }
  }

  registerKill(enemy?: CoreEnemy) {
    this.killCount += 1;
    // 처치 = 흡수당한 물질 회수(HP 환수). 사망 지점 최근접 플레이어에게(근사).
    if (enemy) this.nearestPlayer(enemy.group.position)?.heal(enemy.killRefund);
    this.onKill?.();
  }

  clear() {
    for (const e of this.enemies) {
      this.scene.remove(e.group);
      e.dispose();
    }
    this.enemies = [];
    this.drain.clear();
    this.instanceEnemies.length = 0; // 인스턴스 비우기(재입장 시 잔상 방지)
    this.coreInst.count = 0;
    this.coreInst.instanceMatrix.needsUpdate = true;
    this.shellInst.count = 0;
    this.shellInst.instanceMatrix.needsUpdate = true;
    this.pendingRusher = 0;
    this.pendingKiter = 0;
    this.burstMode = false;
    this.hasPrev = false; // 재입장 시 순간이동 변위로 인한 가짜 속도 스파이크 방지
    for (const v of this.vels) { v.x = v.y = v.z = 0; }
  }
}
