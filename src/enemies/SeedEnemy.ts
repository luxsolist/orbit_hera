import * as THREE from "three";
import { createDissolveMaterial, type DissolveMaterial } from "../fx/dissolve";

const SHELL_GEO = new THREE.IcosahedronGeometry(1, 2); // 부드러운 유기적 곡면(스펙 1장)
const CORE_GEO = new THREE.IcosahedronGeometry(0.42, 1);

export type EnemyState = "alive" | "dissolving" | "dead";

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
  maxHp = 100;
  hp = 100;

  private dissolveProgress = 0;
  private hitFlash = 0; // 피격 순간 1 → 빠르게 감쇠하며 흰색 번쩍임
  private pulsePhase = Math.random() * Math.PI * 2;
  private bobPhase = Math.random() * Math.PI * 2;
  private speed: number;
  private attackCooldown = 0;
  private baseScale: number;

  constructor(position: THREE.Vector3, scale = 1.4, speed = 4.5) {
    this.baseScale = scale;
    this.speed = speed;

    this.shellMat = createDissolveMaterial(0xb8324a, 0xff6a3b);
    this.hitMesh = new THREE.Mesh(SHELL_GEO, this.shellMat);
    this.hitMesh.castShadow = true;
    this.hitMesh.userData.enemy = this; // 레이캐스트 → 적 역참조
    this.group.add(this.hitMesh);

    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x2a0008,
      emissive: 0xff3b4e,
      emissiveIntensity: 2.2,
    });
    this.core = new THREE.Mesh(CORE_GEO, this.coreMat);
    this.group.add(this.core);

    this.group.scale.setScalar(scale);
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

  update(dt: number, target: THREE.Vector3, terrainY: (x: number, z: number) => number) {
    this.pulsePhase += dt * 4;
    this.bobPhase += dt * 2;

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
      return;
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

    // --- 추적 AI: 플레이어 향해 수평 이동 ---
    const pos = this.group.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 2.2) {
      pos.x += (dx / dist) * this.speed * dt;
      pos.z += (dz / dist) * this.speed * dt;
    }

    // 지표면 위에서 둥실 떠다님
    const ground = terrainY(pos.x, pos.z);
    const hover = this.baseScale * 1.1 + Math.sin(this.bobPhase) * 0.4;
    pos.y = ground + hover;

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
