import * as THREE from "three";
import { createDissolveMaterial, type DissolveMaterial } from "../fx/dissolve";
import type { Vec3 } from "../core/math";

const SHELL_GEO = new THREE.IcosahedronGeometry(1, 2); // 부드러운 유기적 곡면(스펙 1장)
const CORE_GEO = new THREE.IcosahedronGeometry(0.42, 1);

const PULSE_RATE = 4; // 박동 위상 속도(rad/s)
const BOB_RATE = 2; // 자유 부유 위상 속도(rad/s)
const BOB_AMPLITUDE = 0.4; // 자유 부유 상하 진폭(m)
const STOP_DIST = 2.2; // 이 거리 이내면 추적 정지(접촉 교전 거리)
const LEAD_MAX = 1.0; // 예측 요격 최대 리드 시간(s) — 너무 멀리 조준하지 않도록 상한
const SEP_MARGIN = 2.0; // 분리 여유 간격(m) — 자기+상대 반경에 더한 밀어내기 반경
const SEP_GAIN = 0.7; // 분리 가중(추격 대비) — 겹치면 강하게 밀어내 링 형태로 퍼짐

export type EnemyState = "alive" | "dissolving" | "dead";

/** 군집 조향 입력(EnemyManager 제공) — 플레이어 속도(예측 요격) + 동료 스냅샷·자기 인덱스(분리). */
export interface SteerInput {
  vel: Vec3; // 표적(플레이어) 속도
  boids: readonly Boid[]; // 살아있는 적 위치+반경
  index: number; // boids 내 자기 인덱스
}

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

/** 군집 분리용 개체 — 위치 + 시각 반경. */
export interface Boid extends Vec3 {
  r: number;
}

/**
 * 예측 요격 조준점 — 표적의 현재 위치가 아니라 **예상 미래 위치**(현위치 + 속도·리드)로 향하게 한다.
 * 리드 시간 = min(maxLead, 거리/속도)(가까울수록 짧게). 플레이어가 원을 그려도 안쪽을 가로질러 끊고 들어옴.
 */
export function interceptPoint(target: Vec3, targetVel: Vec3, from: Vec3, speed: number, maxLead: number): Vec3 {
  const dist = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z);
  const lead = Math.min(maxLead, dist / Math.max(speed, 1e-3));
  return { x: target.x + targetVel.x * lead, y: target.y + targetVel.y * lead, z: target.z + targetVel.z * lead };
}

/**
 * 분리(separation) 조향 — boids[i] 를 반경(자기+상대 반경+margin) 안의 동료들로부터 밀어내는 단위성 벡터의 합.
 * 가까울수록(겹칠수록) 강하게 민다. 모두가 한 점(플레이어)으로 호밍해 쌓이는 현상을 막아 무리를 퍼뜨린다.
 */
export function separationVector(boids: readonly Boid[], i: number, margin: number): Vec3 {
  const self = boids[i];
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < boids.length; k++) {
    if (k === i) continue;
    const nb = boids[k];
    const dx = self.x - nb.x, dy = self.y - nb.y, dz = self.z - nb.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const reach = self.r + nb.r + margin;
    if (d2 > reach * reach) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-4) { x += margin; continue; } // 완전 중첩 — 결정적 +x 분리(0除算 방지)
    const w = (reach - d) / reach / d; // 가까울수록↑, 방향 단위화(÷d)
    x += dx * w; y += dy * w; z += dz * w;
  }
  return { x, y, z };
}

/**
 * 추격 + 분리 합성 속도(부수효과 없는 순수). 추격: aim(요격점) 으로 speed, stopDist 이내면 0(접촉 교전).
 * 분리: 동료 밀어냄(stopDist 이내에서도 적용 → 접촉점에 겹쳐 쌓이지 않고 링 형태로 퍼짐). 합은 speed 로 클램프.
 */
export function steerVelocity(
  pos: Vec3, aim: Vec3, speed: number, stopDist: number,
  boids: readonly Boid[], index: number, sepMargin: number, sepGain: number
): Vec3 {
  const dx = aim.x - pos.x, dy = aim.y - pos.y, dz = aim.z - pos.z;
  const dist = Math.hypot(dx, dy, dz);
  let vx = 0, vy = 0, vz = 0;
  if (dist > stopDist) { const k = speed / dist; vx = dx * k; vy = dy * k; vz = dz * k; }
  const sep = separationVector(boids, index, sepMargin);
  vx += sep.x * speed * sepGain; vy += sep.y * speed * sepGain; vz += sep.z * speed * sepGain;
  const m = Math.hypot(vx, vy, vz);
  if (m > speed) { const s = speed / m; vx *= s; vy *= s; vz *= s; }
  return { x: vx, y: vy, z: vz };
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

  update(dt: number, target: THREE.Vector3, speedScale = 1, steer?: SteerInput) {
    this.pulsePhase += dt * PULSE_RATE;
    this.bobPhase += dt * BOB_RATE;
    if (this.updateVisual(dt)) this.updateMotion(dt, target, speedScale, steer); // 소멸 중이 아니면 이동
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

  /**
   * 추적 AI — 플레이어를 향해 3D 이동(상하 포함) + 자유 부유. speedScale=고도 가중.
   * steer 제공 시 **예측 요격**(원돌기 가로채기) + **분리**(동료 밀어내기, 한 점에 뭉침 방지). 없으면 단순 호밍.
   */
  private updateMotion(dt: number, target: THREE.Vector3, speedScale: number, steer?: SteerInput) {
    const pos = this.group.position;
    const speed = this.speed * speedScale;
    if (steer) {
      const aim = interceptPoint(target, steer.vel, pos, speed, LEAD_MAX);
      const v = steerVelocity(pos, aim, speed, STOP_DIST, steer.boids, steer.index, SEP_MARGIN, SEP_GAIN);
      pos.x += v.x * dt; pos.y += v.y * dt; pos.z += v.z * dt;
    } else {
      const next = pursueStep(pos, target, speed, dt, STOP_DIST);
      pos.set(next.x, next.y, next.z);
    }
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
