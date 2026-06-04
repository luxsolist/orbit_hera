import * as THREE from "three";
import { createDissolveMaterial, type DissolveMaterial } from "../fx/dissolve";
import type { Vec3 } from "../core/math";

const SHELL_GEO = new THREE.IcosahedronGeometry(1, 2); // 부드러운 유기적 곡면(스펙 1장)
const CORE_GEO = new THREE.IcosahedronGeometry(0.42, 1);

const PULSE_RATE = 4; // 박동 위상 속도(rad/s)
const BOB_RATE = 2; // 자유 부유 위상 속도(rad/s)
const BOB_AMPLITUDE = 0.4; // 자유 부유 상하 진폭(m)
const STOP_DIST = 2.2; // 이 거리 이내면 추적 정지(접촉 교전 거리)

export type EnemyState = "alive" | "dissolving" | "dead";

/** 플라즈모이드 외형/체력 — PlasmoidSpec 시스템(온도·크기)에서 산출해 주입한다. */
export interface SeedAppearance {
  maxHp: number; // 체력(= plasmoidHp)
  diameter: number; // 렌더 지름 m(= visualDiameter) — 지오메트리 지름 2 기준 baseScale = d/2
  color: number; // 발광/표면 색(= colorAt) 0xRRGGBB
}

/**
 * 3D 추적 1스텝 — from 에서 to 를 향해 speed·dt 만큼 이동한 새 좌표를 반환.
 * 거리가 stopDist 이내면 정지(그대로). 지형/물체 무시(자유 부유). 부수효과 없는 순수 함수.
 */
export function pursueStep(from: Vec3, to: Vec3, speed: number, dt: number, stopDist: number): Vec3 {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= stopDist) return { x: from.x, y: from.y, z: from.z };
  const k = (speed * dt) / dist;
  return { x: from.x + dx * k, y: from.y + dy * k, z: from.z + dz * k };
}

/**
 * 외계 씨앗 적 유닛.
 * - 박동(pulse)하며 플레이어를 추적.
 * - 주파수 빔에 맞으면 쪼그라들고(shrink), 체력 소진 시 디졸브 소멸(스펙 5/6장).
 */
export class SeedEnemy {
  readonly group = new THREE.Group();
  readonly hitMesh: THREE.Mesh; // 레이캐스트 대상
  private core: THREE.Mesh;
  private shellMat: DissolveMaterial;
  private coreMat: THREE.MeshStandardMaterial;

  state: EnemyState = "alive";
  maxHp: number;
  hp: number;

  private dissolveProgress = 0;
  private hitFlash = 0; // 피격 순간 1 → 빠르게 감쇠하며 흰색 번쩍임
  private pulsePhase = Math.random() * Math.PI * 2;
  private bobPhase = Math.random() * Math.PI * 2;
  private speed: number;
  private attackCooldown = 0;
  private baseScale: number;

  constructor(position: THREE.Vector3, appearance: SeedAppearance, speed = 4.5) {
    this.baseScale = appearance.diameter / 2; // 지오메트리 지름 2(반지름 1) → 실제 지름 = scale·2
    this.speed = speed;
    this.maxHp = appearance.maxHp;
    this.hp = appearance.maxHp;

    // 표면/코어 색을 온도색(colorAt)에서 파생 — 적색 약체 → 청백 강체로 통일
    const col = new THREE.Color(appearance.color);
    const base = col.clone().multiplyScalar(0.42); // 어두운 본체
    const edge = col.clone().lerp(new THREE.Color(0xffffff), 0.25); // 밝은 디졸브 가장자리
    this.shellMat = createDissolveMaterial(base, edge);
    this.hitMesh = new THREE.Mesh(SHELL_GEO, this.shellMat);
    this.hitMesh.castShadow = true;
    tagEnemy(this.hitMesh, this); // 레이캐스트 → 적 역참조
    this.group.add(this.hitMesh);

    this.coreMat = new THREE.MeshStandardMaterial({
      color: col.clone().multiplyScalar(0.12),
      emissive: appearance.color,
      emissiveIntensity: 2.2,
    });
    this.core = new THREE.Mesh(CORE_GEO, this.coreMat);
    this.group.add(this.core);

    this.group.scale.setScalar(this.baseScale);
    this.group.position.copy(position);
  }

  /** 주파수 빔 적중 처리. 반환값: 이번 타격으로 처치되었는가 */
  applyFrequencyHit(damage: number): boolean {
    if (this.state !== "alive") return false;
    this.hp -= damage;

    // 박동 발광 강화 + 피격 순간 표면 전체가 흰색으로 번쩍(타격감)
    this.coreMat.emissiveIntensity = 6.5;
    this.hitFlash = 1;

    if (this.hp <= 0) {
      this.hp = 0;
      this.state = "dissolving";
      return true;
    }
    return false;
  }

  /** 접촉으로 흡수한 에너지만큼 자가 회복(체력 ↑, 최대치 한도). 살아있을 때만. */
  absorbEnergy(amount: number): void {
    if (this.state !== "alive") return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  update(dt: number, target: THREE.Vector3, speedScale = 1) {
    this.pulsePhase += dt * PULSE_RATE;
    this.bobPhase += dt * BOB_RATE;
    if (this.updateVisual(dt)) this.updateMotion(dt, target, speedScale); // 소멸 중이 아니면 이동
  }

  /** FX 갱신 — 피격 플래시·디졸브·박동/스케일. 살아있으면 true(이동 처리 진행). */
  private updateVisual(dt: number): boolean {
    // 피격 플래시 감쇠(빠르게 꺼져 '팍' 터지는 순간 강조)
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 9);
      this.shellMat.setFlash(this.hitFlash * this.hitFlash); // 제곱으로 더 날카롭게
    }

    if (this.state === "dissolving") {
      this.dissolveProgress += dt * 1.8;
      this.shellMat.setProgress(this.dissolveProgress);
      this.core.scale.setScalar(Math.max(0, 1 - this.dissolveProgress * 1.2));
      this.coreMat.emissiveIntensity = 4.5 * (1 - this.dissolveProgress);
      if (this.dissolveProgress >= 1) this.state = "dead";
      return false;
    }

    // 체력 비율에 따라 쪼그라들기(스펙: 쪼그라뜨려 소멸)
    const hpRatio = this.hp / this.maxHp;
    const shrink = 0.55 + 0.45 * hpRatio;
    const pulse = 1 + Math.sin(this.pulsePhase) * 0.06;
    this.group.scale.setScalar(this.baseScale * shrink * pulse);
    this.shellMat.setPulse((Math.sin(this.pulsePhase) + 1) * 0.5);
    this.coreMat.emissiveIntensity = THREE.MathUtils.lerp(
      this.coreMat.emissiveIntensity,
      1.8 + Math.sin(this.pulsePhase) * 0.8,
      0.1
    );
    return true;
  }

  /** 추적 AI — 플레이어를 향해 3D 이동(상하 포함) + 자유 부유. speedScale=고도 가중. */
  private updateMotion(dt: number, target: THREE.Vector3, speedScale: number) {
    const pos = this.group.position;
    const next = pursueStep(pos, target, this.speed * speedScale, dt, STOP_DIST);
    pos.set(next.x, next.y, next.z);
    pos.y += BOB_AMPLITUDE * BOB_RATE * Math.cos(this.bobPhase) * dt; // 누적 X 미세 흔들림

    if (this.attackCooldown > 0) this.attackCooldown -= dt;
  }

  /** 플레이어와 접촉 시 공격 가능 여부 (쿨다운 관리) */
  tryAttack(playerPos: THREE.Vector3, range: number): boolean {
    if (this.state !== "alive" || this.attackCooldown > 0) return false;
    const d = this.group.position.distanceTo(playerPos);
    if (d <= range) {
      this.attackCooldown = 1.0;
      return true;
    }
    return false;
  }

  dispose() {
    this.shellMat.dispose();
    this.coreMat.dispose();
  }
}

const ENEMY_KEY = "enemy";
/** 레이캐스트 역참조 태깅 — userData 접근을 한 곳으로(타입 안전). */
export function tagEnemy(mesh: THREE.Object3D, enemy: SeedEnemy): void {
  mesh.userData[ENEMY_KEY] = enemy;
}
/** 레이캐스트 적중 오브젝트 → 적(없으면 undefined). */
export function getEnemy(obj: THREE.Object3D): SeedEnemy | undefined {
  return obj.userData[ENEMY_KEY] as SeedEnemy | undefined;
}
