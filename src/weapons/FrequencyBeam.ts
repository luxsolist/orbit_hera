import * as THREE from "three";
import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { Sfx } from "../core/Sfx";
import { DamageNumbers } from "../fx/damageNumbers";
import type { BeamSpec } from "./WeaponSpec";
import { makeGlowTexture, BeamPool, fireEmitters, type BeamStyle } from "./beamFx";
import { parseHexColor } from "../core/math";
import { bestAlignedDir, nearestInCone } from "./targeting";

// 적중 임팩트 FX(프레젠테이션 — 무기 밸런스와 무관해 코드 고정. 데미지/사거리/연사 등 전투
// 수치는 모두 BeamSpec(JSON)에서 주입된다.)
const IMPACT_FLASH_LIFE = 0.14; // 적중 번쩍임 지속(짧고 강하게)
const SPARK_LIFE = 0.22; // 튀는 스파크 파편 지속
const SPARK_COUNT = 7; // 적중당 분출 스파크 수
const NEUTRALIZE_CYAN = 0x9bffff; // 빔 글로우 = 중화 링 공통 시안색

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
  private beamPool: BeamPool;
  private flashes: ImpactFlash[] = [];
  private sparks: Spark[] = [];
  private cooldown = 0; // 수동(조준) 발사 쿨다운
  private autoCooldown = 0; // 오토파이어 쿨다운(수동과 독립 → 동시 발사 가능)
  private glowTexture: THREE.Texture;
  private sparkTexture: THREE.Texture;
  private ringTexture: THREE.Texture; // 중화 링(밝은 환형) — 검은 버스트 위에 가산 발광
  private damageNumbers: DamageNumbers;
  private readonly assistCos: number; // 에임 어시스트 콘(스펙 각도 → cos)
  private readonly style: BeamStyle; // 빔 시각(색/반경/글로우 — 발사 시 재사용)
  private readonly muzzleOffsets: number[]; // 발사관 측면 오프셋(단일[0] 또는 듀얼[-x,x])

  /** 빔/임팩트가 발광해야 하므로 fired 상태를 HUD로 알림 */
  onFired?: () => void;

  constructor(
    private scene: THREE.Scene,
    private player: PlayerController,
    private enemies: EnemyManager,
    private spec: BeamSpec,
    private sfx?: Sfx
  ) {
    this.raycaster.far = spec.range;
    this.assistCos = Math.cos(THREE.MathUtils.degToRad(spec.manual.assistConeDeg));
    this.style = { beamColor: parseHexColor(spec.color), glowColor: NEUTRALIZE_CYAN, radius: 0.05, glowScale: 2.5 };
    this.muzzleOffsets = spec.muzzleOffsets && spec.muzzleOffsets.length > 0 ? spec.muzzleOffsets : [0];
    this.glowTexture = makeGlowTexture("rgba(120,255,255,0.8)", "rgba(52,245,255,0)");
    this.sparkTexture = makeSparkTexture();
    this.ringTexture = makeRingTexture();
    this.damageNumbers = new DamageNumbers(scene);
    this.beamPool = new BeamPool(scene, this.glowTexture, spec.beamLifetime, 4);
  }

  update(dt: number, firing: boolean) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.autoCooldown > 0) this.autoCooldown -= dt;

    // 360° 근거리 오토파이어(소프트락) — 정면을 안 봐도 최근접 추격자를 자동 타격(이동·조준 분리 → 백페달 완화)
    if (this.autoCooldown <= 0) {
      const origin = this.player.camera.position;
      const autoDir = this.acquireAutoFireTarget(origin);
      if (autoDir) {
        this.fireAt(autoDir, this.spec.auto.freqCost, this.spec.auto.damage);
        this.autoCooldown = this.spec.auto.fireInterval;
      }
    }

    // 수동(조준) 발사 — 오토와 독립. 보유 시 풀파워(에임 어시스트는 fireManual 내부).
    if (this.cooldown <= 0 && firing) {
      this.fireManual();
      this.cooldown = this.spec.manual.fireInterval;
    }

    this.damageNumbers.update(dt);
    this.beamPool.update(dt); // 빔 페이드아웃

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
    // --- 중화 버스트 ---
    // 빔이 플라즈모이드 에너지를 '중화'시키는 설정 → 적중부가 검게 변하는 어두운 폭발(가산 X, 일반 블렌딩).
    const flashMat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0x05060a, // 거의 검정 — 에너지 소거
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false,
    });
    const flash = new THREE.Sprite(flashMat);
    flash.position.copy(point);
    flash.scale.setScalar(6);
    flash.renderOrder = 998;
    this.scene.add(flash);
    this.flashes.push({ sprite: flash, life: IMPACT_FLASH_LIFE });

    // --- 중화 링 ---
    // 검은 버스트 가장자리에 밝은 환형 충격파(가산 → 블룸). 어두운 배경에서도 적중이 보이게.
    const ringMat = new THREE.SpriteMaterial({
      map: this.ringTexture,
      color: NEUTRALIZE_CYAN,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const ring = new THREE.Sprite(ringMat);
    ring.position.copy(point);
    ring.scale.setScalar(6);
    ring.renderOrder = 999; // 검은 섬광 위
    this.scene.add(ring);
    this.flashes.push({ sprite: ring, life: IMPACT_FLASH_LIFE }); // 동일 확장·페이드 애니메이션 재사용

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
        color: 0x14161e, // 어두운 잔재 — 중화된 에너지 파편
        transparent: true,
        blending: THREE.NormalBlending,
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
    this.fireAt(assistDir ?? aimDir, this.spec.manual.freqCost, this.spec.manual.damage);
  }

  /** 공통 발사 경로 — 비용 차감(볼리당 1회)·발사음 후 발사관 일제 사격(공유 fireEmitters). */
  private fireAt(dir: THREE.Vector3, cost: number, baseDamage: number) {
    if (!this.player.spendFrequency(cost)) return; // 주파수 부족(볼리당 1회만 소모)
    this.sfx?.beam(); // 발사음(수동/자동 동일) — 실제 발사된 경우에만
    fireEmitters(
      { raycaster: this.raycaster, enemies: this.enemies, damageNumbers: this.damageNumbers, beamPool: this.beamPool, world: this.player.gameWorld },
      {
        origin: this.player.camera.position,
        dir,
        muzzleOffsets: this.muzzleOffsets,
        baseDamage,
        falloff: this.spec.falloff,
        range: this.spec.range,
        style: this.style,
        onHit: (endPoint, hit, d) => this.spawnImpact(endPoint, hit.face?.normal, d), // 임팩트/스파크는 기본빔만
      }
    );
    this.onFired?.();
  }

  /**
   * 자동 조준 대상 탐색.
   * 거리에 상관없이 사거리(RANGE) 내의 살아있는 적 중, 조준선과 이루는 각이
   * 허용 콘(ASSIST_COS) 안에 들어오는 가장 정렬된(각도가 작은) 적을 골라
   * 그 방향을 반환. 없으면 null(원래 조준 유지).
   */
  /** 에임 어시스트 — 조준 콘(assist) 안에서 가장 정렬된 적 방향. 없으면 null. */
  private acquireAssistTarget(origin: THREE.Vector3, aimDir: THREE.Vector3): THREE.Vector3 | null {
    const dir = bestAlignedDir(origin, aimDir, this.enemies.aliveWorldPositions, this.spec.range, this.assistCos);
    return dir ? new THREE.Vector3(dir.x, dir.y, dir.z) : null;
  }

  /** 오토파이어 조준 — 사거리(spec.auto.range) 안 360° 최근접 적 방향(콘 무시). 없으면 null. */
  private acquireAutoFireTarget(origin: THREE.Vector3): THREE.Vector3 | null {
    const aim = this.player.getAimDirection(); // 콘=360°(cos -1)이라 포함 판정엔 무관, 방향은 origin→적
    const t = nearestInCone(origin, aim, this.enemies.aliveWorldPositions, this.spec.auto.range, -1, 1)[0];
    return t ? new THREE.Vector3(t.dir.x, t.dir.y, t.dir.z) : null;
  }
}

/** 중화 링용: 가운데가 비고 가장자리 근처가 밝은 환형(annulus) 텍스처 */
function makeRingTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, "rgba(155,255,255,0)"); // 속은 투명
  grad.addColorStop(0.55, "rgba(155,255,255,0)");
  grad.addColorStop(0.74, "rgba(200,255,255,0.95)"); // 밝은 링
  grad.addColorStop(0.9, "rgba(140,245,255,0)");
  grad.addColorStop(1.0, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
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
