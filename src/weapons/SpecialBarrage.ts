import * as THREE from "three";
import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { SeedEnemy } from "../enemies/SeedEnemy";
import type { Sfx } from "../core/Sfx";
import { DamageNumbers } from "../fx/damageNumbers";
import type { BarrageSpec } from "./WeaponSpec";
import { makeGlowTexture, spawnBeam } from "./beamFx";

// 전투 수치(타깃 수·사거리·쿨다운·살포·데미지·색)는 모두 BarrageSpec(JSON)에서 주입.

interface ActiveBeam {
  line: THREE.Mesh;
  glow: THREE.Sprite;
  life: number;
}

/**
 * 특수 무기 — 다중 빔 살포.
 * 우클릭 1회 발동 → 전방 콘 안의 적(최대 10) 에게 빔을 동시에 연속 살포.
 * 발동 후 freq 게이지가 0 이 될 때까지 자동 유지되고, 발동 순간부터 60s 쿨다운.
 * 자연 회복은 발동 동안 억제(PlayerController.freqRegenSuppressed).
 */
export class SpecialBarrage {
  private raycaster = new THREE.Raycaster();
  private beams: ActiveBeam[] = [];
  private damageNumbers: DamageNumbers;
  private glowTexture: THREE.Texture;

  private active = false;
  private salvoTimer = 0;
  private cooldown = 0; // 0 이하 = 발동 가능
  private readonly coneCos: number; // 전방 콘(스펙 각도 → cos)
  private readonly colorBeam: number;
  private readonly colorGlow: number;

  /** HUD 발광 트리거(크로스헤어 플래시 재사용) */
  onFired?: () => void;
  onKill?: (enemy: SeedEnemy) => void;

  constructor(
    private scene: THREE.Scene,
    private player: PlayerController,
    private enemies: EnemyManager,
    private spec: BarrageSpec,
    private sfx?: Sfx
  ) {
    this.raycaster.far = spec.range;
    this.coneCos = Math.cos(THREE.MathUtils.degToRad(spec.coneDeg));
    this.colorBeam = Number(spec.colorBeam);
    this.colorGlow = Number(spec.colorGlow);
    this.damageNumbers = new DamageNumbers(scene);
    this.glowTexture = makeGlowTexture("rgba(255,210,140,0.85)", "rgba(255,170,72,0)");
  }

  /** 0~1 쿨다운 진행률(1=준비완료). HUD 표시용. */
  get cooldownReady(): number {
    if (this.active) return 0;
    if (this.cooldown <= 0) return 1;
    return 1 - this.cooldown / this.spec.cooldown;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** 게임 재시작 시 호출 — 쿨다운/활성 상태 초기화. */
  reset() {
    this.active = false;
    this.cooldown = 0;
    this.salvoTimer = 0;
    this.player.freqRegenSuppressed = false;
  }

  update(dt: number, triggerPressed: boolean) {
    if (this.cooldown > 0) this.cooldown -= dt;

    // 발동: 비활성 + 쿨다운 완료 + freq 가 일정 이상일 때만(쥐꼬리만큼 남았을 때 트리거 방지)
    if (triggerPressed && !this.active && this.cooldown <= 0 && this.player.freq > 5) {
      this.active = true;
      this.cooldown = this.spec.cooldown;
      this.salvoTimer = 0; // 즉시 첫 살포
      this.player.freqRegenSuppressed = true;
    }

    if (this.active) {
      // 게이지 소진
      this.player.freq = Math.max(0, this.player.freq - this.spec.drainRate * dt);

      // 살포
      this.salvoTimer -= dt;
      if (this.salvoTimer <= 0) {
        this.fireSalvo();
        this.salvoTimer = this.spec.salvoInterval;
      }

      // 종료 조건: 게이지 0
      if (this.player.freq <= 0) {
        this.active = false;
        this.player.freqRegenSuppressed = false;
      }
    }

    this.damageNumbers.update(dt);
    this.updateBeams(dt);
  }

  /** 한 번의 살포: 전방 콘 안의 가장 가까운 적 최대 N 명에 동시 빔 사격. */
  private fireSalvo() {
    const origin = this.player.camera.position;
    const aimDir = this.player.getAimDirection().clone();

    const targets = this.acquireTargets(origin, aimDir, this.spec.maxBeams);
    if (targets.length === 0) {
      // 대상 없으면 빔만 안 쏘고 소진은 계속(특수 발동은 유지)
      return;
    }

    const muzzle = origin
      .clone()
      .add(aimDir.clone().multiplyScalar(1.2))
      .add(new THREE.Vector3(0, -0.5, 0));

    for (const t of targets) {
      const dir = t.dir;
      this.raycaster.set(origin, dir);
      const hits = this.raycaster.intersectObject(t.mesh, false);

      let endPoint: THREE.Vector3;
      if (hits.length > 0) {
        endPoint = hits[0].point.clone();
        const enemy = hits[0].object.userData.enemy as SeedEnemy | undefined;
        if (enemy) {
          this.damageNumbers.spawn(endPoint, this.spec.salvoDamage);
          const killed = enemy.applyFrequencyHit(this.spec.salvoDamage);
          if (killed) {
            this.enemies.registerKill();
            this.onKill?.(enemy);
          }
        }
      } else {
        endPoint = origin.clone().add(dir.clone().multiplyScalar(this.spec.range));
      }

      this.spawnBeamVisual(muzzle, endPoint);
    }

    this.sfx?.barrage(targets.length); // 동시 발사된 빔 수에 비례한 묵직한 일제사격음
    this.onFired?.();
  }

  /** 전방 콘 안의 살아있는 적을 거리 오름차순으로 max 개까지. */
  private acquireTargets(
    origin: THREE.Vector3,
    aimDir: THREE.Vector3,
    max: number
  ): { mesh: THREE.Object3D; dir: THREE.Vector3; dist: number }[] {
    const out: { mesh: THREE.Object3D; dir: THREE.Vector3; dist: number }[] = [];
    const enemyPos = new THREE.Vector3();
    const toEnemy = new THREE.Vector3();

    for (const mesh of this.enemies.hitMeshes) {
      mesh.getWorldPosition(enemyPos);
      toEnemy.subVectors(enemyPos, origin);
      const dist = toEnemy.length();
      if (dist < 0.001 || dist > this.spec.range) continue;
      const dir = toEnemy.clone().divideScalar(dist);
      if (dir.dot(aimDir) < this.coneCos) continue;
      out.push({ mesh, dir, dist });
    }

    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, max);
  }

  private updateBeams(dt: number) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      const t = Math.max(0, b.life / this.spec.beamLifetime);
      (b.line.material as THREE.MeshBasicMaterial).opacity = t;
      b.glow.material.opacity = t;
      b.glow.scale.setScalar(2 + (1 - t) * 5);
      if (b.life <= 0) {
        this.scene.remove(b.line, b.glow);
        b.line.geometry.dispose();
        (b.line.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
      }
    }
  }

  private spawnBeamVisual(from: THREE.Vector3, to: THREE.Vector3) {
    const { line, glow } = spawnBeam(this.scene, this.glowTexture, from, to, {
      beamColor: this.colorBeam,
      glowColor: this.colorGlow,
      radius: 0.07,
      glowScale: 2.8,
    });
    this.beams.push({ line, glow, life: this.spec.beamLifetime });
  }
}
