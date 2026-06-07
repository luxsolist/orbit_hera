import * as THREE from "three";
import { CoreEnemy, chooseTarget, buildBoidGrid, recomputeSteer, CORE_GEO, SHELL_GEO, type Boid } from "./CoreEnemy";
import type { World } from "../world/World";
import type { PlayerController } from "../player/PlayerController";
import { TERRAIN_HALF } from "../world/World";
import { DrainBeams } from "../fx/DrainBeams";
import {
  DEFAULT_PLASMOID, rollAppearance, contactDamage, archetypeCount, pickSpawnType, colorStrength01,
  type PlasmoidSpec, type PlasmoidKiterArchetype, type PlasmoidArchetype,
} from "./PlasmoidSpec";
import type { Vec3 } from "../core/math";

const ATTACK_RANGE = 3.2; // 접촉 교전 거리(피해는 PlasmoidSpec.contact 로 산출)
const SPAWN_INTERVAL = 0.35; // 개체 점진 스폰 간격(s)
const KITER_GROUND_CLEARANCE = 1.5; // 도주형이 가라앉지 않는 지면 위 최소 높이(m)
const KITER_CEILING = 1020; // 도주형 상승 상한(지면 대비, m) — 비행 천장(1000) 근처까지 추격 가능(고고도 이탈 방지)
const TARGET_HYSTERESIS = 1.2; // 표적 교체 문턱 — 현재 표적이 최근접의 1.2배 이내면 유지(깜빡임 방지)
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

const _centroid = new THREE.Vector3(); // 스폰 무게중심 임시(프레임당 동기 사용)

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
  private world: World;
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

  onKill?: () => void;
  onPlayerHit?: (damage: number) => void;
  onWaveChange?: (wave: number) => void;

  constructor(
    scene: THREE.Scene, world: World, players: PlayerController[],
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

  start() {
    this.clear();
    this.wave = 0;
    this.killCount = 0;
    this.startNextWave();
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

  private spawnOne(type: PlasmoidArchetype) {
    const a = this.spec.archetypes;
    const arche = type === "kiter" ? a.kiter : a.rusher;

    // 플레이어 무게중심 주변 근거리 밴드 + 아키타입 고도 밴드(카이터=상공, 러셔=지표)
    const c = this.playersCentroid(_centroid);
    const angle = Math.random() * Math.PI * 2;
    const radius = 55 + Math.random() * 150;
    const x = THREE.MathUtils.clamp(c.x + Math.cos(angle) * radius, -TERRAIN_HALF + 6, TERRAIN_HALF - 6);
    const z = THREE.MathUtils.clamp(c.z + Math.sin(angle) * radius, -TERRAIN_HALF + 6, TERRAIN_HALF - 6);
    const alt = arche.spawnAltMin + Math.random() * (arche.spawnAltMax - arche.spawnAltMin);
    const y = this.world.heightAt(x, z) + alt;

    // 외형/체력/색 — 온도(웨이브별·저온편향) 시스템 유지(색·크기·흡수성장 다양성).
    const roll = rollAppearance(this.spec, this.wave, Math.random);
    const app = { maxHp: roll.maxHp, diameter: roll.diameter, color: roll.color };
    // 색 강도 g01(0=적색/약, 1=청백/강) — 속도 감속·발광을 한 노브로.
    const g01 = colorStrength01(this.spec.color.stops, roll.temp);
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

  /** 도주형 원거리 드레인 — 사거리·간격 게이트 통과 시 표적 HP 흡수 + 적 성장 + 빔 연출. */
  private kiterAttack(enemy: CoreEnemy, p: THREE.Vector3, t: Target) {
    const k = this.kiterArche;
    if (!enemy.tryAttack(t.pos, k.attackRange, k.drainInterval)) return;
    if (t.player.takeDamage(k.drainDamage)) {
      enemy.grow(k.drainDamage); // 흡수=성장(더 크고 탱키)
      this.drain.spawn(p, t.pos, enemy.color);
      this.onPlayerHit?.(k.drainDamage);
    }
  }

  /** 추격형 접촉 흡수 — 강함 비례. 흡수량 = 표적 HP 피해 = 적 자가 회복. */
  private contactAttack(enemy: CoreEnemy, t: Target) {
    if (!enemy.tryAttack(t.pos, ATTACK_RANGE)) return;
    const absorb = contactDamage(this.spec, enemy.maxHp);
    if (t.player.takeDamage(absorb)) {
      enemy.absorbEnergy(absorb);
      this.onPlayerHit?.(absorb);
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
      this.targets[i] = { pos: cur, vel: v, player: pl, alive: !pl.isDead };
    }
    this.hasPrev = true;
  }

  /** 개체의 표적 선택 — 거리 + 어그로 부하 점수의 최소(현 표적은 히스테리시스로 유지). 없으면 -1. */
  private pickTarget(pos: THREE.Vector3, currentIdx: number): number {
    const { targets, dists } = this;
    dists.length = targets.length;
    for (let i = 0; i < targets.length; i++) {
      dists[i] = targets[i].alive ? Math.sqrt(targets[i].pos.distanceToSquared(pos)) : Infinity;
    }
    return chooseTarget(dists, this.load, currentIdx, AGGRO_PENALTY, TARGET_HYSTERESIS, this.scores);
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
      const idx = this.pickTarget(p, enemy.targetIndex);
      if (idx < 0) { enemy.targetIndex = -1; enemy.update(dt, p, 1); continue; } // 표적 없음 → 정지
      load[idx]++;
      enemy.targetIndex = idx;
      const t = targets[idx];
      const recompute = recomputeSteer(p.distanceToSquared(t.pos), NEAR_DIST_SQ, this.frame, myIdx, STEER_STRIDE);
      const steer = { vel: t.vel, boids, index: myIdx, grid, recompute };
      if (enemy.isKiter) {
        // 도주형 — 지면 아래로 가라앉지 않게 고정 후 원거리 드레인.
        enemy.update(dt, t.pos, 1, steer);
        this.clampKiterAltitude(p);
        this.kiterAttack(enemy, p, t);
      } else {
        // 추격형 — 예측 요격 + 분리 조향(원돌기·뭉침 방지) + 접촉 흡수.
        enemy.update(dt, t.pos, 1, steer);
        this.contactAttack(enemy, t);
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

    // 웨이브 종료 판정
    if (this.pendingRusher + this.pendingKiter === 0 && this.enemies.length === 0) {
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
    this.hasPrev = false; // 재입장 시 순간이동 변위로 인한 가짜 속도 스파이크 방지
    for (const v of this.vels) { v.x = v.y = v.z = 0; }
  }
}
