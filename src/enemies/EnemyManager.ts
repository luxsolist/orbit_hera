import * as THREE from "three";
import { SeedEnemy, type Boid } from "./SeedEnemy";
import type { World } from "../world/World";
import type { PlayerController } from "../player/PlayerController";
import { TERRAIN_HALF } from "../world/World";
import { DEFAULT_PLASMOID, rollAppearance, altitudeSpeedMult, contactDamage, type PlasmoidSpec } from "./PlasmoidSpec";
import type { Vec3 } from "../core/math";

const ATTACK_RANGE = 3.2; // 접촉 교전 거리(피해는 PlasmoidSpec.contact 로 산출)
// 일반 플라즈모이드 전투 밴드 상한 = 비행드론 천장과 동일(300m). 이 위 고도는 향후 항공모함·보스급 전용.
export const SPAWN_CEILING = 300; // 적 공중 스폰 최대 고도(지면 대비, m)
export const SPAWN_BIAS = 2.5; // 스폰 고도 지수 가중(>1 일수록 지상 편향 강함)

/**
 * 균등난수 u∈[0,1) → 지면 대비 스폰 고도(m). u^SPAWN_BIAS 가중으로 지상에 가까울수록 빈도↑.
 * 경계: u=0 → 0, u→1 → SPAWN_CEILING. 단조 증가.
 */
export function spawnAltitude(u: number): number {
  return Math.pow(u, SPAWN_BIAS) * SPAWN_CEILING;
}

/**
 * 적 스폰/웨이브/처치 집계 관리.
 * 웨이브가 비워지면 다음 웨이브를 더 큰 규모로 스폰(스펙 5장: 무한 증식).
 */
export class EnemyManager {
  private enemies: SeedEnemy[] = [];
  private scene: THREE.Scene;
  private world: World;
  private player: PlayerController;
  private spec: PlasmoidSpec;

  wave = 0;
  killCount = 0;
  private spawnTimer = 0;
  private pendingSpawns = 0;
  // 군집 조향용 — 플레이어 속도 추정(예측 요격) + 살아있는 적 스냅샷(분리)
  private prevPlayer = new THREE.Vector3();
  private hasPrevPlayer = false;
  private playerVel: Vec3 = { x: 0, y: 0, z: 0 };
  private boids: Boid[] = [];

  onKill?: () => void;
  onPlayerHit?: (damage: number) => void;
  onWaveChange?: (wave: number) => void;

  constructor(scene: THREE.Scene, world: World, player: PlayerController, spec: PlasmoidSpec = DEFAULT_PLASMOID) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.spec = spec;
  }

  /** 레이캐스트 대상 메쉬 목록(살아있는 적) */
  get hitMeshes(): THREE.Object3D[] {
    return this.enemies.filter((e) => e.state === "alive").map((e) => e.hitMesh);
  }

  /** 무기 콘 조준 입력용 — 살아있는 적의 월드 좌표(평문). hitMeshes 와 동일 순서(인덱스 정합). */
  get aliveWorldPositions(): Vec3[] {
    const out: Vec3[] = [];
    const tmp = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.state === "alive") {
        e.hitMesh.getWorldPosition(tmp);
        out.push({ x: tmp.x, y: tmp.y, z: tmp.z });
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
    this.pendingSpawns = 4 + this.wave * 2; // 점증
    this.spawnTimer = 0;
    this.onWaveChange?.(this.wave);
  }

  private spawnOne() {
    // 대형 도심 월드 — 플레이어 주변 근거리 밴드에서 스폰(교전 유지)
    const angle = Math.random() * Math.PI * 2;
    const radius = 55 + Math.random() * 150;
    const x = THREE.MathUtils.clamp(
      this.player.worldPosition.x + Math.cos(angle) * radius,
      -TERRAIN_HALF + 6,
      TERRAIN_HALF - 6
    );
    const z = THREE.MathUtils.clamp(
      this.player.worldPosition.z + Math.sin(angle) * radius,
      -TERRAIN_HALF + 6,
      TERRAIN_HALF - 6
    );
    // 공중 투입 — 지면 대비 0~300m 랜덤 고도(지상에 가까울수록 빈도 ↑). spawnAltitude 참조.
    const y = this.world.heightAt(x, z) + spawnAltitude(Math.random());

    // 외형/속도 — 온도(웨이브별·저온편향) → 체력·렌더크기·색·속도(강함 반비례). 분리형 시스템.
    const { maxHp, diameter, color, speed } = rollAppearance(this.spec, this.wave, Math.random);
    const enemy = new SeedEnemy(new THREE.Vector3(x, y, z), { maxHp, diameter, color }, speed);
    this.enemies.push(enemy);
    this.scene.add(enemy.group);
  }

  update(dt: number) {
    // 점진적 스폰
    if (this.pendingSpawns > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnOne();
        this.pendingSpawns -= 1;
        this.spawnTimer = 0.35;
      }
    }

    const playerPos = this.player.worldPosition;

    // 플레이어 속도 추정(예측 요격용) — 프레임 변위 EMA 평활
    if (this.hasPrevPlayer && dt > 1e-4) {
      const a = Math.min(1, dt * 8);
      this.playerVel.x += ((playerPos.x - this.prevPlayer.x) / dt - this.playerVel.x) * a;
      this.playerVel.y += ((playerPos.y - this.prevPlayer.y) / dt - this.playerVel.y) * a;
      this.playerVel.z += ((playerPos.z - this.prevPlayer.z) / dt - this.playerVel.z) * a;
    }
    this.prevPlayer.copy(playerPos);
    this.hasPrevPlayer = true;

    // 살아있는 적 스냅샷(분리용) — enemies 의 alive 부분과 같은 순서 → 아래 루프의 bi 와 인덱스 정합.
    const boids = this.boids;
    boids.length = 0;
    for (const e of this.enemies) {
      if (e.state === "alive") {
        const p = e.group.position;
        boids.push({ x: p.x, y: p.y, z: p.z, r: e.group.scale.x });
      }
    }

    let bi = 0; // boids 인덱스(alive 순회 동기)
    for (const enemy of this.enemies) {
      // 고도 가중 — 지면 대비 높이로 속도 배수(공중↑/수중·지하↓). 영역별 드론 추격 균형.
      const p = enemy.group.position;
      const altitude = p.y - this.world.heightAt(p.x, p.z);
      if (enemy.state !== "alive") {
        enemy.update(dt, playerPos, 1); // 디졸브 비주얼만 진행(이동/공격 없음)
        continue;
      }
      // 예측 요격 + 분리 조향(원돌기·뭉침 방지)
      enemy.update(dt, playerPos, altitudeSpeedMult(this.spec, altitude), { vel: this.playerVel, boids, index: bi });
      bi++;

      if (enemy.tryAttack(playerPos, ATTACK_RANGE)) {
        // 접촉(에너지 흡수) — 강함 비례·고도 약화. 흡수량만큼 플레이어 HP 피해 + 적 자가 회복.
        const absorb = contactDamage(this.spec, enemy.maxHp, altitude);
        if (this.player.takeDamage(absorb)) {
          enemy.absorbEnergy(absorb); // 빨아들인 에너지로 체력 회복
          this.onPlayerHit?.(absorb);
        }
      }
    }

    // 죽은 적 정리
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].state === "dead") {
        this.scene.remove(this.enemies[i].group);
        this.enemies[i].dispose();
        this.enemies.splice(i, 1);
      }
    }

    // 웨이브 종료 판정
    if (this.pendingSpawns === 0 && this.enemies.length === 0) {
      this.startNextWave();
    }
  }

  registerKill() {
    this.killCount += 1;
    this.onKill?.();
  }

  clear() {
    for (const e of this.enemies) {
      this.scene.remove(e.group);
      e.dispose();
    }
    this.enemies = [];
    this.pendingSpawns = 0;
    this.hasPrevPlayer = false; // 재입장 시 순간이동 변위로 인한 가짜 속도 스파이크 방지
    this.playerVel.x = this.playerVel.y = this.playerVel.z = 0;
  }
}
