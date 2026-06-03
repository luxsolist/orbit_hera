import * as THREE from "three";
import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { SeedEnemy } from "../enemies/SeedEnemy";
import type { Sfx } from "../core/Sfx";
import { DamageNumbers } from "../fx/damageNumbers";
import type { BeamSpec } from "./WeaponSpec";
import { damageForDistance } from "./WeaponSpec";
import { makeGlowTexture, spawnBeam } from "./beamFx";
import { bestAlignedDir, type Vec3 } from "./targeting";

// 적중 임팩트 FX(프레젠테이션 — 무기 밸런스와 무관해 코드 고정. 데미지/사거리/연사 등 전투
// 수치는 모두 BeamSpec(JSON)에서 주입된다.)
const IMPACT_FLASH_LIFE = 0.14; // 적중 번쩍임 지속(짧고 강하게)
const SPARK_LIFE = 0.22; // 튀는 스파크 파편 지속
const SPARK_COUNT = 7; // 적중당 분출 스파크 수

interface ActiveBeam {
  line: THREE.Mesh;
  glow: THREE.Sprite;
  life: number;
}

interface ImpactFlash {
  sprite: THREE.Sprite;
  life: number;
}

interface Spark {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
}

/**
 * 에너지 주파수 빔 (히트스캔).
 * 화면 중앙으로 레이를 쏴 적을 타격하고,
 * 발광하는 빔 라인 + 임팩트 글로우를 잠깐 그렸다 페이드(Bloom과 결합).
 * - 사거리 내의 적은 거리에 상관없이 조준선 근처에 있으면 자동으로 빔을 보정(에임 어시스트).
 * - 위력은 적중 거리에 반비례(가까울수록 강하고 멀수록 약함).
 */
export class FrequencyBeam {
  private raycaster = new THREE.Raycaster();
  private beams: ActiveBeam[] = [];
  private flashes: ImpactFlash[] = [];
  private sparks: Spark[] = [];
  private cooldown = 0;
  private glowTexture: THREE.Texture;
  private sparkTexture: THREE.Texture;
  private damageNumbers: DamageNumbers;
  private readonly assistCos: number; // 에임 어시스트 콘(스펙 각도 → cos)
  private readonly autoCos: number; // 자동발사 콘
  private readonly beamColor: number; // 빔 색(스펙 "0x..." → number)

  /** 빔/임팩트가 발광해야 하므로 fired 상태를 HUD로 알림 */
  onFired?: () => void;
  /** 적 처치 콜백 */
  onKill?: (enemy: SeedEnemy) => void;

  constructor(
    private scene: THREE.Scene,
    private player: PlayerController,
    private enemies: EnemyManager,
    private spec: BeamSpec,
    private sfx?: Sfx
  ) {
    this.raycaster.far = spec.range;
    this.assistCos = Math.cos(THREE.MathUtils.degToRad(spec.manual.assistConeDeg));
    this.autoCos = Math.cos(THREE.MathUtils.degToRad(spec.auto.coneDeg));
    this.beamColor = Number(spec.color);
    this.glowTexture = makeGlowTexture("rgba(120,255,255,0.8)", "rgba(52,245,255,0)");
    this.sparkTexture = makeSparkTexture();
    this.damageNumbers = new DamageNumbers(scene);
  }

  update(dt: number, firing: boolean) {
    if (this.cooldown > 0) this.cooldown -= dt;

    if (this.cooldown <= 0) {
      // 근거리 자동발사 우선: 콘 + AUTO_FIRE_RANGE 안의 적이 있으면 자동 사격(저비용·연사)
      const origin = this.player.camera.position;
      const aimDir = this.player.getAimDirection().clone();
      const autoDir = this.acquireAutoFireTarget(origin, aimDir);
      if (autoDir) {
        this.fireAt(autoDir, this.spec.auto.freqCost, this.spec.auto.damage, false);
        this.cooldown = this.spec.auto.fireInterval;
      } else if (firing) {
        // 원거리/콘 밖 — 수동 발사(좌클릭). 풀파워, 더 빠른 연사.
        // 기존 자동조준(에임 어시스트) 보정은 fireManual 안에서 처리.
        this.fireManual();
        this.cooldown = this.spec.manual.fireInterval;
      }
    }

    this.damageNumbers.update(dt);

    // 빔 페이드아웃
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      const t = Math.max(0, b.life / this.spec.beamLifetime);
      (b.line.material as THREE.MeshBasicMaterial).opacity = t;
      b.glow.material.opacity = t;
      b.glow.scale.setScalar(2 + (1 - t) * 4);
      if (b.life <= 0) {
        this.scene.remove(b.line, b.glow);
        b.line.geometry.dispose();
        (b.line.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
      }
    }

    // 적중 번쩍임: 큰 섬광이 순식간에 더 부풀며 꺼짐(샤프한 펀치)
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const t = Math.max(0, f.life / IMPACT_FLASH_LIFE); // 1 → 0
      f.sprite.material.opacity = t * t; // 빠르게 사그라듦
      f.sprite.scale.setScalar(6 + (1 - t) * 10); // 터지듯 확장
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
      }
    }

    // 스파크 파편: 사방으로 튀며 중력에 끌려 떨어지고 빠르게 페이드
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      const t = Math.max(0, s.life / SPARK_LIFE);
      s.velocity.y -= 22 * dt; // 중력
      s.velocity.multiplyScalar(1 - Math.min(1, dt * 3)); // 공기 저항
      s.sprite.position.addScaledVector(s.velocity, dt);
      s.sprite.material.opacity = t;
      s.sprite.scale.setScalar(0.25 + t * 0.85); // 줄어들며 사라짐
      if (s.life <= 0) {
        this.scene.remove(s.sprite);
        s.sprite.material.dispose();
        this.sparks.splice(i, 1);
      }
    }
  }

  /**
   * 적중 임팩트 FX: 적중 지점에서 흰색 섬광이 '팍' 번쩍이고
   * 표면 법선(없으면 빔 반대 방향)을 중심으로 스파크 파편이 사방으로 튄다.
   */
  private spawnImpact(point: THREE.Vector3, normal: THREE.Vector3 | undefined, beamDir: THREE.Vector3) {
    // --- 섬광 ---
    const flashMat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const flash = new THREE.Sprite(flashMat);
    flash.position.copy(point);
    flash.scale.setScalar(6);
    flash.renderOrder = 998;
    this.scene.add(flash);
    this.flashes.push({ sprite: flash, life: IMPACT_FLASH_LIFE });

    // --- 스파크 파편 ---
    // 튀어나갈 기준 방향: 표면 법선(빔이 들어온 면 바깥쪽), 없으면 빔 반대 방향
    const base = (normal ? normal.clone() : beamDir.clone().multiplyScalar(-1)).normalize();
    const tangentA = new THREE.Vector3(0, 1, 0).cross(base);
    if (tangentA.lengthSq() < 1e-4) tangentA.set(1, 0, 0);
    tangentA.normalize();
    const tangentB = base.clone().cross(tangentA).normalize();

    for (let i = 0; i < SPARK_COUNT; i++) {
      const sparkMat = new THREE.SpriteMaterial({
        map: this.sparkTexture,
        color: 0xbafcff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(sparkMat);
      sprite.position.copy(point);
      sprite.renderOrder = 998;

      // 법선 반구 안에서 콘 형태로 분출(좌우로 흩뿌리며)
      const ang = Math.random() * Math.PI * 2;
      const spread = 0.5 + Math.random() * 0.7;
      const dir = base
        .clone()
        .addScaledVector(tangentA, Math.cos(ang) * spread)
        .addScaledVector(tangentB, Math.sin(ang) * spread)
        .normalize();
      const speed = 7 + Math.random() * 7;

      this.scene.add(sprite);
      this.sparks.push({
        sprite,
        velocity: dir.multiplyScalar(speed),
        life: SPARK_LIFE * (0.7 + Math.random() * 0.6),
      });
    }
  }

  /** 좌클릭 수동 발사 — 풀 비용/데미지 + 에임 어시스트(콘 안 적이면 빔 보정). */
  private fireManual() {
    const origin = this.player.camera.position;
    const aimDir = this.player.getAimDirection().clone();
    const assistDir = this.acquireAssistTarget(origin, aimDir);
    this.fireAt(assistDir ?? aimDir, this.spec.manual.freqCost, this.spec.manual.damage, true);
  }

  /** 공통 발사 경로 — 지정 방향으로 레이캐스트, 비용 차감, 시각·데미지 처리. */
  private fireAt(dir: THREE.Vector3, cost: number, baseDamage: number, manual: boolean) {
    if (!this.player.spendFrequency(cost)) return; // 주파수 부족
    this.sfx?.beam(manual); // 발사음(수동=묵직/자동=가벼움) — 실제 발사된 경우에만

    const origin = this.player.camera.position;
    this.raycaster.set(origin, dir);

    const hits = this.raycaster.intersectObjects(this.enemies.hitMeshes, false);

    let endPoint: THREE.Vector3;
    if (hits.length > 0) {
      endPoint = hits[0].point.clone();
      const enemy = hits[0].object.userData.enemy as SeedEnemy | undefined;
      if (enemy) {
        const damage = damageForDistance(hits[0].distance, baseDamage, this.spec.falloff);
        this.damageNumbers.spawn(endPoint, damage);
        this.spawnImpact(endPoint, hits[0].face?.normal, dir);
        const killed = enemy.applyFrequencyHit(damage);
        if (killed) {
          this.enemies.registerKill();
          this.onKill?.(enemy);
        }
      }
    } else {
      endPoint = origin.clone().add(dir.clone().multiplyScalar(this.spec.range));
    }

    const muzzle = origin
      .clone()
      .add(dir.clone().multiplyScalar(1.2))
      .add(new THREE.Vector3(0, -0.5, 0));

    this.spawnBeamVisual(muzzle, endPoint);
    this.onFired?.();
  }

  /**
   * 자동 조준 대상 탐색.
   * 거리에 상관없이 사거리(RANGE) 내의 살아있는 적 중, 조준선과 이루는 각이
   * 허용 콘(ASSIST_COS) 안에 들어오는 가장 정렬된(각도가 작은) 적을 골라
   * 그 방향을 반환. 없으면 null(원래 조준 유지).
   */
  /** 현재 살아있는 적의 월드 좌표 목록(콘 조준 입력). */
  private enemyPositions(): Vec3[] {
    const ps: Vec3[] = [];
    const tmp = new THREE.Vector3();
    for (const mesh of this.enemies.hitMeshes) {
      mesh.getWorldPosition(tmp);
      ps.push({ x: tmp.x, y: tmp.y, z: tmp.z });
    }
    return ps;
  }

  /** 에임 어시스트 — 조준 콘(assist) 안에서 가장 정렬된 적 방향. 없으면 null. */
  private acquireAssistTarget(origin: THREE.Vector3, aimDir: THREE.Vector3): THREE.Vector3 | null {
    const dir = bestAlignedDir(origin, aimDir, this.enemyPositions(), this.spec.range, this.assistCos);
    return dir ? new THREE.Vector3(dir.x, dir.y, dir.z) : null;
  }

  /** 근거리 자동발사 조준 — 콘+사거리(spec.auto) 안에서 가장 정렬된 적 방향. 없으면 null(자동발사 생략). */
  private acquireAutoFireTarget(origin: THREE.Vector3, aimDir: THREE.Vector3): THREE.Vector3 | null {
    const dir = bestAlignedDir(origin, aimDir, this.enemyPositions(), this.spec.auto.range, this.autoCos);
    return dir ? new THREE.Vector3(dir.x, dir.y, dir.z) : null;
  }

  private spawnBeamVisual(from: THREE.Vector3, to: THREE.Vector3) {
    const { line, glow } = spawnBeam(this.scene, this.glowTexture, from, to, {
      beamColor: this.beamColor,
      glowColor: 0x9bffff,
      radius: 0.05,
      glowScale: 2.5,
    });
    this.beams.push({ line, glow, life: this.spec.beamLifetime });
  }
}

/** 스파크 파편용: 중심이 날카롭게 밝은 작은 점 텍스처 */
function makeSparkTexture(): THREE.Texture {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(180,252,255,0.9)");
  grad.addColorStop(1, "rgba(120,240,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
