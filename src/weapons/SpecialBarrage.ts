import * as THREE from "three";
import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { SeedEnemy } from "../enemies/SeedEnemy";
import { DamageNumbers } from "../fx/damageNumbers";

// --- 특수 무기 파라미터 ---
const MAX_BEAMS = 10; // 동시 추적 가능한 최대 타깃 수
const CONE_COS = Math.cos(THREE.MathUtils.degToRad(55)); // 전방 시야 콘(반각 55°)
const RANGE = 220; // 자동 락온 사거리
const COOLDOWN = 60; // 1분 쿨다운
const DRAIN_RATE = 60; // 초당 freq 소진(회복 22/s 보다 충분히 커서 게이지가 줄어듦)
const SALVO_INTERVAL = 0.12; // 살포 간격(초) — 타깃당 ~8.3발/s
const SALVO_DAMAGE = 16; // 발당 위력(거리 보정 미적용, 균질)
const BEAM_LIFETIME = 0.13;
const COLOR_BEAM = 0xffb648; // 호박색 — 기본 무기(시안)과 구분
const COLOR_GLOW = 0xffd58a;

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

  /** HUD 발광 트리거(크로스헤어 플래시 재사용) */
  onFired?: () => void;
  onKill?: (enemy: SeedEnemy) => void;

  constructor(
    private scene: THREE.Scene,
    private player: PlayerController,
    private enemies: EnemyManager
  ) {
    this.raycaster.far = RANGE;
    this.damageNumbers = new DamageNumbers(scene);
    this.glowTexture = makeGlowTexture();
  }

  /** 0~1 쿨다운 진행률(1=준비완료). HUD 표시용. */
  get cooldownReady(): number {
    if (this.active) return 0;
    if (this.cooldown <= 0) return 1;
    return 1 - this.cooldown / COOLDOWN;
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
      this.cooldown = COOLDOWN;
      this.salvoTimer = 0; // 즉시 첫 살포
      this.player.freqRegenSuppressed = true;
    }

    if (this.active) {
      // 게이지 소진
      this.player.freq = Math.max(0, this.player.freq - DRAIN_RATE * dt);

      // 살포
      this.salvoTimer -= dt;
      if (this.salvoTimer <= 0) {
        this.fireSalvo();
        this.salvoTimer = SALVO_INTERVAL;
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

    const targets = this.acquireTargets(origin, aimDir, MAX_BEAMS);
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
          this.damageNumbers.spawn(endPoint, SALVO_DAMAGE);
          const killed = enemy.applyFrequencyHit(SALVO_DAMAGE);
          if (killed) {
            this.enemies.registerKill();
            this.onKill?.(enemy);
          }
        }
      } else {
        endPoint = origin.clone().add(dir.clone().multiplyScalar(RANGE));
      }

      this.spawnBeamVisual(muzzle, endPoint);
    }

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
      if (dist < 0.001 || dist > RANGE) continue;
      const dir = toEnemy.clone().divideScalar(dist);
      if (dir.dot(aimDir) < CONE_COS) continue;
      out.push({ mesh, dir, dist });
    }

    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, max);
  }

  private updateBeams(dt: number) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      const t = Math.max(0, b.life / BEAM_LIFETIME);
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
    const axis = new THREE.Vector3().subVectors(to, from);
    const length = axis.length();
    const geo = new THREE.CylinderGeometry(0.07, 0.07, length, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR_BEAM,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Mesh(geo, mat);
    line.position.copy(from).add(to).multiplyScalar(0.5);
    line.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      axis.clone().normalize()
    );
    this.scene.add(line);

    const glowMat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: COLOR_GLOW,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.position.copy(to);
    glow.scale.setScalar(2.8);
    this.scene.add(glow);

    this.beams.push({ line, glow, life: BEAM_LIFETIME });
  }
}

function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,210,140,0.85)");
  grad.addColorStop(1, "rgba(255,170,72,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
