import * as THREE from "three";
import type { Vec3 } from "../core/math";
import { turnToward, type CoreEnemy } from "./CoreEnemy";
import type { TombSpec, SweepSpec } from "./PlasmoidSpec";

// 낙인 + 심판 파문(서사편 §6.1 ① MARK — 전투의 새 박자).
//  - 마커(소인체)가 쏜 느린 유도탄이 드론에 닿으면 **낙인**(무피해 상태)이 붙고,
//  - 균열(리프트 앵커)에서 주기적으로 확장되는 **심판 파문**이 낙인 붙은 대상만 때린다.
//  - 카운터: 유도탄 회피 / 낙인의 근원 마커 격파(그 마커의 낙인·유도탄 소산 — "마커 우선 격파").
//    (빔 조사로 낙인 소각은 W4 복구 사격 단계에서 도입 — 건물 낙인도 커터 단계에서.)
// 표면 어휘: 낙인·소인체·심판 파문(§8.2). tomb/marker/sweep 는 코드 전용 내부 id.

export const DEFAULT_SWEEP: SweepSpec = { period: 30, speed: 250, warnSec: 5, maxRadius: 1600 };
const SHOT_HIT_RADIUS = 2.4; // 유도탄 명중 판정 반경(m) — 드론 몸통 + 여유
const BRAND_CAP = 5; // 표적당 낙인 상한 — 마커 다수 전장에서 파문 피해 폭주 방지(5×30=150, 방치 시 치명은 유지)
const GLYPH_BASE_SCALE = 1.0; // 유도탄 글리프 기본 크기(팔면체 결정)
const GLYPH_PULSE = 0.25; // 글리프 맥동 진폭
const GLYPH_PULSE_RATE = 9; // 글리프 맥동 속도(rad/s)
const GLYPH_SPIN = 3.5; // 글리프 자전 속도(rad/s)
// 낙인 글리프 — "붉은 글리프 결정화"(§6.1). 캔버스 텍스처 대신 발광 팔면체 결정(헤드리스 안전).
const GLYPH_GEO = new THREE.OctahedronGeometry(0.8, 0);
const RING_HEIGHT = 500; // 파면 실린더 높이(m)
const RING_OPACITY = 0.22; // 파면 최대 불투명도 — 플레이테스트: 통과 중 전 화면 적색 워시가 과하지 않게
const SWEEP_COLOR = 0xff2418; // 파면/글리프 — 낙인 계열 적색(소거 낙인의 붉은 글리프)

/** 유도탄 호밍 1스텝(순수) — 표적 방향으로 선회 캡(turnRad) 내 회전 후 등속 전진. */
export function homingStep(
  pos: Vec3, vel: Vec3, target: Vec3, speed: number, turnRad: number, dt: number
): { pos: Vec3; vel: Vec3 } {
  const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
  const d = Math.hypot(dx, dy, dz) || 1e-6;
  const desired = { x: (dx / d) * speed, y: (dy / d) * speed, z: (dz / d) * speed };
  const v = turnToward(vel, desired, turnRad * dt);
  return { pos: { x: pos.x + v.x * dt, y: pos.y + v.y * dt, z: pos.z + v.z * dt }, vel: v };
}

/**
 * 파면이 이번 프레임에 dist 지점을 통과했는가(순수) — 반개구간 [prevR, curR) 교차.
 * 하한 포함이라 **진앙(dist=0, 파문 개시 프레임 prevR=0)도 쓸린다** — 균열 중심에 서 있어도 면제 없음.
 * 상한 제외라 경계에 있던 표적은 다음 프레임(새 prevR=지난 curR)에 잡힌다(중복 명중 없음).
 */
export function sweepCrossed(prevR: number, curR: number, dist: number): boolean {
  return dist >= prevR && dist < curR;
}

/** 낙인 목록의 파문 피해 합(순수) — 낙인 1개당 그 근원 마커의 sweepDamage. */
export function brandDamage(brands: readonly { damage: number }[]): number {
  let sum = 0;
  for (const b of brands) sum += b.damage;
  return sum;
}

/** 낙인/파문이 참조하는 표적 최소 계약 — PlayerController 가 구조적으로 만족(테스트 스텁 용이). */
export interface BrandTarget {
  worldPosition: THREE.Vector3;
  isDead: boolean;
}

interface Shot {
  mesh: THREE.Mesh;
  pos: Vec3;
  vel: Vec3;
  ttl: number;
  age: number;
  targetIdx: number;
  source: CoreEnemy;
  tomb: TombSpec;
}

interface Brand {
  source: CoreEnemy; // 근원 마커 — 격파 시 이 낙인 소산
  damage: number; // 파문 통과 시 피해(tomb.sweepDamage)
}

/**
 * 낙인 유도탄 + 심판 파문 관리. EnemyManager 가 소유하고 매 프레임 update 를 호출한다.
 * 파문은 전투 중 상시 주기 이벤트(낙인이 없으면 무해한 전장 박자) — 예고는 warnLeft 로 HUD 에.
 */
export class BrandSystem {
  /** 파문이 낙인 붙은 표적을 통과 — 호출부(EnemyManager)가 피해 적용·연출. */
  onSweepHit?: (targetIdx: number, damage: number) => void;
  /** 파면이 표적 위치를 통과(낙인 유무 불문, branded = 낙인이 있었는가) — 화면 펄스·저음·집계 훅. */
  onSweepPass?: (targetIdx: number, branded: boolean) => void;
  /** 낙인 수 변화(부착/소산/소모) — HUD 갱신 게이트. */
  onBrandsChanged?: (targetIdx: number, count: number) => void;

  private shots: Shot[] = [];
  private brands: Brand[][] = [];
  private countdown: number;
  private radius = -1; // 파면 반경(m). <0 = 비활성(대기)
  private periodMul = 1; // 파문 주기 배수(미션 변조 sweepPeriodMul — <1 = 잦게)
  private glyphMat: THREE.MeshBasicMaterial; // 글리프 공유 재질(색 고정 — 개체별 상태 없음)
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;

  constructor(
    private scene: THREE.Scene,
    private targets: readonly BrandTarget[],
    private sweep: SweepSpec = DEFAULT_SWEEP
  ) {
    this.countdown = sweep.period;
    this.glyphMat = new THREE.MeshBasicMaterial({
      color: SWEEP_COLOR, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    // 파면 — 균열 중심에서 확장되는 얇은 원통 벽(개구, 가산 발광). scale.x/z = 반경.
    this.ringMat = new THREE.MeshBasicMaterial({
      color: SWEEP_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, RING_HEIGHT, 64, 1, true), this.ringMat);
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    scene.add(this.ring);
  }

  /** 낙인 유도탄 발사(마커 → 표적 드론). 색은 개체색이 아닌 낙인 적색 고정(위협 종류 가독성). */
  launch(from: THREE.Vector3, targetIdx: number, source: CoreEnemy, tomb: TombSpec): void {
    const mesh = new THREE.Mesh(GLYPH_GEO, this.glyphMat);
    mesh.position.copy(from);
    mesh.scale.setScalar(GLYPH_BASE_SCALE);
    this.scene.add(mesh);
    // 초기 속도 — 표적 방향(호밍이 이어받음)
    const t = this.targets[targetIdx]?.worldPosition;
    const dx = (t?.x ?? from.x) - from.x, dy = (t?.y ?? from.y) - from.y, dz = (t?.z ?? from.z) - from.z;
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    this.shots.push({
      mesh,
      pos: { x: from.x, y: from.y, z: from.z },
      vel: { x: (dx / d) * tomb.projSpeed, y: (dy / d) * tomb.projSpeed, z: (dz / d) * tomb.projSpeed },
      ttl: tomb.projTtl,
      age: 0,
      targetIdx,
      source,
      tomb,
    });
  }

  /** 표적의 현재 낙인 수(HUD). */
  brandCount(targetIdx = 0): number {
    return this.brands[targetIdx]?.length ?? 0;
  }

  /** 파문 주기 배수(미션 변조) — 대기 중이면 현재 카운트다운도 새 주기로 클램프. clear 가 1 로 복원. */
  setPeriodMul(mul: number): void {
    this.periodMul = mul > 0 ? mul : 1;
    if (this.radius < 0) this.countdown = Math.min(this.countdown, this.sweep.period * this.periodMul);
  }

  /** 파문 예고 잔여(s) — warnSec 이내면 잔여 초, 파면 확장 중이면 0, 그 외 null(HUD 숨김). */
  get warnLeft(): number | null {
    if (this.radius >= 0) return 0;
    return this.countdown <= this.sweep.warnSec ? this.countdown : null;
  }

  /** 마커 격파/소멸 — 그 개체가 쏜 유도탄·부착한 낙인이 함께 소산("마커 우선 격파" 카운터). */
  notifyDead(enemy: CoreEnemy): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      if (this.shots[i].source === enemy) this.removeShot(i);
    }
    for (let ti = 0; ti < this.brands.length; ti++) {
      const list = this.brands[ti];
      if (!list?.length) continue;
      const before = list.length;
      this.brands[ti] = list.filter((b) => b.source !== enemy);
      if (this.brands[ti].length !== before) this.onBrandsChanged?.(ti, this.brands[ti].length);
    }
  }

  /**
   * 매 프레임 — 유도탄 호밍/명중(낙인 부착), 파문 주기/파면 확장/낙인 판정.
   * anchor = 균열(리프트 앵커) 수평 중심, groundY = 그 지점 지면 높이(파면 배치).
   */
  update(dt: number, anchor: Vec3, groundY: number): void {
    // ── 유도탄 ──
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.ttl -= dt;
      s.age += dt;
      const target = this.targets[s.targetIdx];
      if (s.ttl <= 0 || !target || target.isDead) { this.removeShot(i); continue; }
      const tp = target.worldPosition;
      const step = homingStep(s.pos, s.vel, { x: tp.x, y: tp.y, z: tp.z }, s.tomb.projSpeed,
        THREE.MathUtils.degToRad(s.tomb.projTurnRateDeg), dt);
      s.pos = step.pos;
      s.vel = step.vel;
      s.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      s.mesh.scale.setScalar(GLYPH_BASE_SCALE + Math.sin(s.age * GLYPH_PULSE_RATE) * GLYPH_PULSE);
      s.mesh.rotation.y = s.age * GLYPH_SPIN; // 결정 자전 — 유도탄 시인성
      const dd = Math.hypot(tp.x - s.pos.x, tp.y - s.pos.y, tp.z - s.pos.z);
      if (dd <= SHOT_HIT_RADIUS) {
        // 명중 — 낙인 부착(무피해, 표적당 BRAND_CAP 상한). 파문이 오기 전까지가 카운터플레이 시간.
        const list = (this.brands[s.targetIdx] ??= []);
        if (list.length < BRAND_CAP) {
          list.push({ source: s.source, damage: s.tomb.sweepDamage });
          this.onBrandsChanged?.(s.targetIdx, list.length);
        }
        this.removeShot(i);
      }
    }

    // ── 심판 파문 ──
    if (this.radius < 0) {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.radius = 0; // 파면 개시(균열 중심)
        this.ring.visible = true;
      }
    } else {
      const prevR = this.radius;
      this.radius += this.sweep.speed * dt;
      // 파면 교차 판정 — 모든 표적에 통과 이벤트(펄스/저음), 낙인 붙은 표적만 피해 + 낙인 소모
      // (적용 여부 무관, 파문은 지나갔다).
      for (let ti = 0; ti < this.targets.length; ti++) {
        const tp = this.targets[ti].worldPosition;
        const dist = Math.hypot(tp.x - anchor.x, tp.z - anchor.z); // 수평 파면(원통)
        if (!sweepCrossed(prevR, this.radius, dist)) continue;
        const list = this.brands[ti];
        const branded = !!list?.length;
        if (branded) {
          const dmg = brandDamage(list);
          list.length = 0;
          this.onBrandsChanged?.(ti, 0);
          if (!this.targets[ti].isDead) this.onSweepHit?.(ti, dmg);
        }
        if (!this.targets[ti].isDead) this.onSweepPass?.(ti, branded);
      }
      if (this.radius >= this.sweep.maxRadius) {
        this.radius = -1; // 파면 소멸 → 다음 주기(변조 배수 적용)
        this.countdown = this.sweep.period * this.periodMul;
        this.ring.visible = false;
      } else {
        this.ring.position.set(anchor.x, groundY + RING_HEIGHT * 0.4, anchor.z);
        this.ring.scale.set(Math.max(this.radius, 0.01), 1, Math.max(this.radius, 0.01));
        this.ringMat.opacity = RING_OPACITY * (1 - this.radius / this.sweep.maxRadius); // 멀어질수록 옅게
      }
    }
  }

  /** 전투 종료/재입장 — 유도탄·낙인·파면 전부 정리, 주기 재무장. */
  clear(): void {
    for (let i = this.shots.length - 1; i >= 0; i--) this.removeShot(i);
    for (let ti = 0; ti < this.brands.length; ti++) {
      if (this.brands[ti]?.length) { this.brands[ti].length = 0; this.onBrandsChanged?.(ti, 0); }
    }
    this.radius = -1;
    this.periodMul = 1; // 변조 복원 — 미션이 투입 후 setPeriodMul 로 재지정
    this.countdown = this.sweep.period;
    this.ring.visible = false;
  }

  private removeShot(i: number): void {
    this.scene.remove(this.shots[i].mesh); // 지오메트리·재질은 공유 — 개별 dispose 없음
    this.shots.splice(i, 1);
  }
}
