import * as THREE from "three";
import type { EnemyManager } from "../enemies/EnemyManager";
import { getEnemy } from "../enemies/SeedEnemy";
import type { DamageNumbers } from "../fx/damageNumbers";
import { damageForDistance, type DamageFalloff } from "./WeaponSpec";

// 무기 공용 발광 빔 FX — 글로우 텍스처 + 빔(실린더)·임팩트 글로우 스프라이트 + 발사관 일제 사격.
// FrequencyBeam(시안)·SpecialBarrage(호박색)가 색/반경만 달리해 공유한다.

/** 방사형 그라데이션 글로우 텍스처(중앙 흰색 → mid → outer 투명). */
export function makeGlowTexture(mid: string, outer: string): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, mid);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const _up = new THREE.Vector3(0, 1, 0);

/** 빔 시각 스타일 — 무기별 색/반경/글로우 크기. 무기 생성 시 1회 구성해 재사용한다. */
export interface BeamStyle {
  beamColor: number;
  glowColor: number;
  radius: number;
  glowScale: number;
}

/** 발광 빔(실린더) + 끝점 임팩트 글로우를 씬에 추가하고 {line, glow} 반환. */
export function spawnBeam(
  scene: THREE.Scene,
  glowTex: THREE.Texture,
  from: THREE.Vector3,
  to: THREE.Vector3,
  o: BeamStyle
): { line: THREE.Mesh; glow: THREE.Sprite } {
  const axis = new THREE.Vector3().subVectors(to, from);
  const length = axis.length();
  // 실린더 기본 축은 +Y. 길이만큼 만들고 중점에 배치한 뒤 방향으로 회전.
  const geo = new THREE.CylinderGeometry(o.radius, o.radius, length, 6, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color: o.beamColor,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Mesh(geo, mat);
  line.position.copy(from).add(to).multiplyScalar(0.5);
  line.quaternion.setFromUnitVectors(_up, axis.clone().normalize());
  scene.add(line);

  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: o.glowColor,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.position.copy(to);
  glow.scale.setScalar(o.glowScale);
  scene.add(glow);

  return { line, glow };
}

const _muzzleOff = new THREE.Vector3(0, -0.5, 0);
/** 발사 머즐 위치 — 시점에서 살짝 앞·아래(빔이 카메라 중앙이 아니라 기체에서 나가는 느낌). */
export function muzzleFrom(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
  return origin.clone().addScaledVector(dir, 1.2).add(_muzzleOff);
}

/** 적중 끝점 — 맞았으면 적중점, 아니면 사거리 끝(origin + dir·range). */
export function beamEnd(hit: THREE.Intersection | undefined, origin: THREE.Vector3, dir: THREE.Vector3, range: number): THREE.Vector3 {
  return hit ? hit.point.clone() : origin.clone().addScaledVector(dir, range);
}

const _UP = new THREE.Vector3(0, 1, 0);
const _side = new THREE.Vector3();
const _emitOrigin = new THREE.Vector3();

/** dir 에 수직인 측면 단위벡터(듀얼 발사관 좌우 오프셋용). dir 이 수직축과 평행하면 +x 폴백. */
export function sideVector(dir: THREE.Vector3, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  out.crossVectors(dir, _UP);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  return out.normalize();
}

/**
 * 발사관 일제 사격의 적중 데미지 — 거리 감쇠된 단발 데미지에 발사관 수를 곱한다(듀얼=2×).
 * 레이는 중앙 1회지만 발사관 수만큼 합산해 듀얼 무기의 DPS 계약을 유지한다.
 */
export function emitterDamage(distance: number, baseDamage: number, muzzleCount: number, falloff: DamageFalloff): number {
  return damageForDistance(distance, baseDamage * muzzleCount, falloff);
}

/** 발사관 일제 사격에 필요한 런타임 자원. */
export interface EmitterContext {
  raycaster: THREE.Raycaster;
  enemies: EnemyManager;
  damageNumbers: DamageNumbers;
  beamPool: BeamPool;
}

/** 한 번의 발사 명세 — 발사관 오프셋마다 레이캐스트·타격·빔. onHit 으로 무기별 추가 FX(임팩트 등) 주입. */
export interface EmitterShot {
  origin: THREE.Vector3; // 시점(카메라) 위치
  dir: THREE.Vector3;
  muzzleOffsets: number[];
  baseDamage: number;
  falloff: DamageFalloff;
  range: number;
  style: BeamStyle;
  onHit?: (endPoint: THREE.Vector3, hit: THREE.Intersection, dir: THREE.Vector3) => void;
}

/**
 * 발사관(muzzleOffsets) 일제 사격. 레이캐스트는 **시점 중앙에서 1회**(평행 듀얼빔 사이로 작은 적이
 * 빠지는 명중 누락 방지) → 데미지는 발사관 수만큼(듀얼=2×) → 빔 시각만 좌우 발사관에서 적중점으로 수렴.
 * FrequencyBeam·SpecialStream 공유(비용 차감·발사음은 호출부 책임). 단일 발사관[0]이면 일반 단발.
 */
export function fireEmitters(ctx: EmitterContext, shot: EmitterShot): void {
  const n = shot.muzzleOffsets.length;
  // (1) 명중 판정 — 중앙 단일 레이(반드시 조준 대상을 관통 → 작은/쪼그라든 적도 적중)
  ctx.raycaster.set(shot.origin, shot.dir);
  const hit = ctx.raycaster.intersectObjects(ctx.enemies.hitMeshes, false)[0];
  const endPoint = beamEnd(hit, shot.origin, shot.dir, shot.range);
  const enemy = hit && getEnemy(hit.object);
  if (enemy) {
    const dmg = emitterDamage(hit.distance, shot.baseDamage, n, shot.falloff); // 발사관 수만큼 합산
    ctx.damageNumbers.spawn(endPoint, dmg);
    shot.onHit?.(endPoint, hit, shot.dir);
    if (enemy.applyFrequencyHit(dmg)) ctx.enemies.registerKill(enemy);
  }
  // (2) 시각 — 발사관마다 좌우 오프셋에서 적중점으로 수렴하는 빔
  const side = sideVector(shot.dir, _side);
  for (const off of shot.muzzleOffsets) {
    const muzzle = muzzleFrom(_emitOrigin.copy(shot.origin).addScaledVector(side, off), shot.dir);
    ctx.beamPool.spawn(muzzle, endPoint, shot.style);
  }
}

/** 활성 빔(라인+글로우+잔여수명). */
export interface ActiveBeam {
  line: THREE.Mesh;
  glow: THREE.Sprite;
  life: number;
}

/**
 * 발광 빔 풀 — spawnBeam 으로 추가하고 매 프레임 페이드아웃·정리. FrequencyBeam·SpecialBarrage 공유.
 * lifetime=빔 지속, growth=꺼질수록 글로우가 부푸는 양.
 */
export class BeamPool {
  private beams: ActiveBeam[] = [];

  constructor(
    private scene: THREE.Scene,
    private glowTex: THREE.Texture,
    private lifetime: number,
    private growth: number
  ) {}

  spawn(from: THREE.Vector3, to: THREE.Vector3, o: BeamStyle): void {
    const { line, glow } = spawnBeam(this.scene, this.glowTex, from, to, o);
    this.beams.push({ line, glow, life: this.lifetime });
  }

  update(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      const t = Math.max(0, b.life / this.lifetime);
      (b.line.material as THREE.MeshBasicMaterial).opacity = t;
      b.glow.material.opacity = t;
      b.glow.scale.setScalar(2 + (1 - t) * this.growth);
      if (b.life <= 0) {
        this.scene.remove(b.line, b.glow);
        b.line.geometry.dispose();
        (b.line.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
      }
    }
  }
}
