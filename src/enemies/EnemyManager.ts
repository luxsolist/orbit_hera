import * as THREE from "three";
import { SeedEnemy } from "./SeedEnemy";
import type { World } from "../world/World";
import type { PlayerController } from "../player/PlayerController";
import { TERRAIN_HALF } from "../world/World";

const ATTACK_RANGE = 3.2;
const ATTACK_DAMAGE = 9;

/**
 * 적 스폰/웨이브/처치 집계 관리.
 * 웨이브가 비워지면 다음 웨이브를 더 큰 규모로 스폰(스펙 5장: 무한 증식).
 */
export class EnemyManager {
  private enemies: SeedEnemy[] = [];
  private scene: THREE.Scene;
  private world: World;
  private player: PlayerController;

  wave = 0;
  killCount = 0;
  private spawnTimer = 0;
  private pendingSpawns = 0;

  onKill?: () => void;
  onPlayerHit?: (damage: number) => void;
  onWaveChange?: (wave: number) => void;

  constructor(scene: THREE.Scene, world: World, player: PlayerController) {
    this.scene = scene;
    this.world = world;
    this.player = player;
  }

  /** 레이캐스트 대상 메쉬 목록(살아있는 적) */
  get hitMeshes(): THREE.Object3D[] {
    return this.enemies.filter((e) => e.state === "alive").map((e) => e.hitMesh);
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
    // 플레이어로부터 충분히 떨어진 가장자리에서 스폰
    const angle = Math.random() * Math.PI * 2;
    const radius = 45 + Math.random() * (TERRAIN_HALF - 55);
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
    const y = this.world.heightAt(x, z) + 2;

    const scale = 1.2 + Math.random() * 0.8;
    const speed = 3.5 + this.wave * 0.35 + Math.random();
    const enemy = new SeedEnemy(new THREE.Vector3(x, y, z), scale, speed);
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
        this.spawnTimer = 0.45;
      }
    }

    const playerPos = this.player.worldPosition;
    const terrainY = (x: number, z: number) => this.world.heightAt(x, z);

    for (const enemy of this.enemies) {
      enemy.update(dt, playerPos, terrainY);

      if (enemy.tryAttack(playerPos, ATTACK_RANGE)) {
        this.player.takeDamage(ATTACK_DAMAGE);
        this.onPlayerHit?.(ATTACK_DAMAGE);
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
  }
}
