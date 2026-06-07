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
const KITER_FLEE_LEAD = 0.35; // 카이터가 플레이어 미래 위치를 예측해 회피하는 리드(s) — 원돌기 무력화
const _pred = { x: 0, y: 0, z: 0 }; // 예측 위치 임시(프레임당 동기 사용)

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
 * 점수(거리·어그로 부하 가중) 배열에서 최소 인덱스 — 단, 현재 대상이 최소의 hysteresis 배 이내면 유지(깜빡임 방지).
 * MP 멀티타깃 선택용. 빈 배열은 -1. 순수.
 */
export function stickyMinIndex(scores: readonly number[], currentIdx: number, hysteresis: number): number {
  if (scores.length === 0) return -1;
  let mi = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] < scores[mi]) mi = i;
  if (currentIdx >= 0 && currentIdx < scores.length && scores[currentIdx] <= scores[mi] * hysteresis) return currentIdx;
  return mi;
}

/**
 * 멀티타깃 표적 선택 — 점수 = 거리 × (1 + aggroPenalty·부하). 최소 점수(현 표적은 히스테리시스로 유지).
 * dist=Infinity(사망/부재)는 제외, 유효 표적 없으면 -1. scores 는 재사용 스크래치(할당 회피). 순수.
 */
export function chooseTarget(
  dists: readonly number[], load: readonly number[], currentIdx: number,
  aggroPenalty: number, hysteresis: number, scores: number[]
): number {
  scores.length = dists.length;
  for (let i = 0; i < dists.length; i++) {
    scores[i] = dists[i] === Infinity ? Infinity : dists[i] * (1 + aggroPenalty * load[i]);
  }
  const idx = stickyMinIndex(scores, currentIdx, hysteresis);
  return idx >= 0 && scores[idx] !== Infinity ? idx : -1;
}

/** 도주형(카이터) 조향 파라미터 — turnRate 는 rad/s. */
export interface KiterParams {
  speed: number;
  turnRate: number; // 선회 상한(rad/s)
  keepDist: number;
  keepBand: number;
  strafeMix?: number; // 적정거리 밴드 내 거동: 1=접선 선회(제자리 공전, 워커), 0=도주(거리 벌림, 플라이어). 기본 1. (멀면 양쪽 다 접근)
  orbitRef?: number; // 이 접선속도(m/s)에서 회피가 최대(플레이어 선회 감지 기준). 기본 35.
  evadeGain?: number; // 선회 감지 시 궤도면 이탈(주로 상승) 강도(0=없음, ~1=강함). 기본 0.
}

/**
 * 속도벡터를 cur 방향에서 desired 방향으로 maxRad 만큼만 회전(구면보간). 크기는 desired 크기를 따른다.
 * cur 이 0(정지)이면 즉시 desired 방향. 급반전을 막아 "빠르되 읽히는" 선회를 만든다.
 */
export function turnToward(cur: Vec3, desired: Vec3, maxRad: number): Vec3 {
  const dl = Math.hypot(desired.x, desired.y, desired.z);
  if (dl < 1e-6) return { x: 0, y: 0, z: 0 };
  const dnx = desired.x / dl, dny = desired.y / dl, dnz = desired.z / dl;
  const cl = Math.hypot(cur.x, cur.y, cur.z);
  if (cl < 1e-6) return { x: dnx * dl, y: dny * dl, z: dnz * dl };
  const cnx = cur.x / cl, cny = cur.y / cl, cnz = cur.z / cl;
  const dot = Math.max(-1, Math.min(1, cnx * dnx + cny * dny + cnz * dnz));
  const ang = Math.acos(dot);
  const sinA = Math.sin(ang);
  // 같은 방향(ang≈0, maxRad 안) 또는 정반대(ang≈π, sinA≈0 → 보간 불가)면 목표 방향으로 스냅.
  if (ang <= maxRad || ang < 1e-6 || sinA < 1e-6) return { x: dnx * dl, y: dny * dl, z: dnz * dl };
  const t = maxRad / ang;
  const w1 = Math.sin((1 - t) * ang) / sinA, w2 = Math.sin(t * ang) / sinA;
  let nx = cnx * w1 + dnx * w2, ny = cny * w1 + dny * w2, nz = cnz * w1 + dnz * w2;
  const nl = Math.hypot(nx, ny, nz) || 1e-3;
  return { x: (nx / nl) * dl, y: (ny / nl) * dl, z: (nz / nl) * dl };
}

/**
 * 도주형(카이터) 속도 — keepDist 유지: 가까우면 도주(플레이어 반대), 멀면 접근, 밴드 내면 수평 선회 스트레이프.
 * 분리(동료 밀어냄) 합성 → speed 클램프 → 선회속도(turnRate) 캡. 고도 가중은 적용하지 않는다(예측 가능한 추격).
 */
export function kiterVelocity(
  pos: Vec3, target: Vec3, targetVel: Vec3, curVel: Vec3, p: KiterParams, dt: number,
  boids: readonly Boid[], index: number, sepMargin: number, sepGain: number
): Vec3 {
  const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
  const dist = Math.hypot(dx, dy, dz) || 1e-3;
  const ux = dx / dist, uy = dy / dist, uz = dz / dist; // 적→플레이어 단위(접근 방향)
  let desX: number, desY: number, desZ: number;
  if (dist < p.keepDist - p.keepBand) {
    desX = -ux; desY = -uy; desZ = -uz; // 너무 가까움 → 도주
  } else if (dist > p.keepDist + p.keepBand) {
    desX = ux; desY = uy; desZ = uz; // 너무 멀음 → 다가와서 사거리 진입(공격)
  } else {
    // 밴드 내 → 접선 선회(strafeMix=1: 제자리 공전)와 도주(strafeMix=0: 계속 멀어져 플레이어 전진 유도)를 블렌딩.
    const sgn = (index & 1) ? 1 : -1;
    let tx = -uz * sgn, tz = ux * sgn;
    const tl = Math.hypot(tx, tz) || 1e-3;
    tx /= tl; tz /= tl;
    const mix = p.strafeMix ?? 1;
    desX = tx * mix - ux * (1 - mix);
    desY = -uy * (1 - mix); // 도주 성분은 3D(수직 포함)
    desZ = tz * mix - uz * (1 - mix);
    const dl = Math.hypot(desX, desY, desZ) || 1e-3;
    desX /= dl; desY /= dl; desZ /= dl;
  }
  let vx = desX * p.speed, vy = desY * p.speed, vz = desZ * p.speed;
  const sep = separationVector(boids, index, sepMargin);
  vx += sep.x * p.speed * sepGain; vy += sep.y * p.speed * sepGain; vz += sep.z * p.speed * sepGain;

  // 원돌기 대응 — 플레이어의 접선(궤도) 속도가 크면 그 궤도 평면을 벗어나는 방향(수평 선회 → 주로 수직)으로 탈출.
  const evadeGain = p.evadeGain ?? 0;
  if (evadeGain > 0) {
    const vr = targetVel.x * ux + targetVel.y * uy + targetVel.z * uz; // 시선 방향 성분(접근/이탈)
    const tvx = targetVel.x - vr * ux, tvy = targetVel.y - vr * uy, tvz = targetVel.z - vr * uz; // 접선(선회) 성분
    const tvLen = Math.hypot(tvx, tvy, tvz);
    if (tvLen > 1e-3) {
      const orbit = Math.min(1, tvLen / (p.orbitRef ?? 35));
      // 궤도 평면 법선 = u × 접선(수평 궤도면이면 ≈ 수직). 위로 빠지도록 부호 보정.
      let nx = uy * tvz - uz * tvy, ny = uz * tvx - ux * tvz, nz = ux * tvy - uy * tvx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const e = orbit * evadeGain * p.speed;
      vx += nx * e; vy += ny * e; vz += nz * e;
    }
  }

  const m = Math.hypot(vx, vy, vz);
  if (m > p.speed) { const s = p.speed / m; vx *= s; vy *= s; vz *= s; }
  return turnToward(curVel, { x: vx, y: vy, z: vz }, p.turnRate * dt);
}

/**
 * 외계 씨앗 적 유닛.
 * - 박동(pulse)하며 플레이어를 추적(또는 카이터: 도주+원거리 드레인).
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
  readonly color: number; // 발광/표면 색(드레인 빔 연출 등에서 참조)
  killRefund = 0; // 처치 시 플레이어 HP 환수(아키타입에서 주입)
  archetypeName = ""; // 아키타입 표시명(모기/거머리 …) — HUD/로그용
  targetIndex = -1; // 현재 추적 대상 플레이어 인덱스(MP 멀티타깃 — 매니저가 관리, 히스테리시스)

  private dissolveProgress = 0;
  private hitFlash = 0; // 피격 순간 1 → 빠르게 감쇠하며 흰색 번쩍임
  private pulsePhase = Math.random() * Math.PI * 2;
  private bobPhase = Math.random() * Math.PI * 2;
  private speed: number;
  private attackCooldown = 0;
  private baseScale: number;
  private maxScale: number; // 흡수 성장 시각 상한(초기 baseScale 의 1.5배)
  private vel: Vec3 = { x: 0, y: 0, z: 0 }; // 카이터 속도 상태(선회 캡용)
  private kiter?: KiterParams; // 설정 시 도주형 행동

  constructor(position: THREE.Vector3, appearance: SeedAppearance, speed = 4.5) {
    this.baseScale = appearance.diameter / 2; // 지오메트리 지름 2(반지름 1) → 실제 지름 = scale·2
    this.maxScale = this.baseScale * 1.5;
    this.speed = speed;
    this.maxHp = appearance.maxHp;
    this.hp = appearance.maxHp;
    this.color = appearance.color;

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

  /** 도주형(카이터) 행동 활성화 — 도주+선회+원거리 드레인. */
  setKiter(params: KiterParams): void {
    this.kiter = params;
  }

  /** 카이터 여부(매니저가 드레인/접촉 경로를 분기). */
  get isKiter(): boolean {
    return !!this.kiter;
  }

  /**
   * 흡수=성장 — 빨아들인 에너지로 최대체력↑·현재체력↑, 시각 크기도 상한(maxScale)까지 점증.
   * 방치하면 더 크고 탱키해져(잡기 어려워져) 쫓아갈 동기를 만든다. 살아있을 때만.
   */
  grow(amount: number): void {
    if (this.state !== "alive" || amount <= 0) return;
    this.maxHp += amount;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.baseScale = Math.min(this.maxScale, this.baseScale * (1 + amount / Math.max(1, this.maxHp)));
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
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const pos = this.group.position;
    if (this.kiter && steer) {
      // 도주형 — keepDist 유지 + 선회 캡 + 분리. 고도 가중 미적용(kiter.speed 그대로).
      // 플레이어 미래 위치(현위치 + 속도·리드)를 기준으로 회피 → 제자리 원돌기를 가로질러 빠져나감.
      _pred.x = target.x + steer.vel.x * KITER_FLEE_LEAD;
      _pred.y = target.y + steer.vel.y * KITER_FLEE_LEAD;
      _pred.z = target.z + steer.vel.z * KITER_FLEE_LEAD;
      const v = kiterVelocity(pos, _pred, steer.vel, this.vel, this.kiter, dt, steer.boids, steer.index, SEP_MARGIN, SEP_GAIN);
      this.vel = v;
      pos.x += v.x * dt; pos.y += v.y * dt; pos.z += v.z * dt;
    } else {
      const speed = this.speed * speedScale;
      if (steer) {
        const aim = interceptPoint(target, steer.vel, pos, speed, LEAD_MAX);
        const v = steerVelocity(pos, aim, speed, STOP_DIST, steer.boids, steer.index, SEP_MARGIN, SEP_GAIN);
        pos.x += v.x * dt; pos.y += v.y * dt; pos.z += v.z * dt;
      } else {
        const next = pursueStep(pos, target, speed, dt, STOP_DIST);
        pos.set(next.x, next.y, next.z);
      }
    }
    pos.y += BOB_AMPLITUDE * BOB_RATE * Math.cos(this.bobPhase) * dt; // 누적 X 미세 흔들림
  }

  /** 공격 가능 여부 (사거리 + 쿨다운 게이트). cooldown 으로 접촉(1s)/카이터 드레인 간격을 분기. */
  tryAttack(playerPos: THREE.Vector3, range: number, cooldown = 1.0): boolean {
    if (this.state !== "alive" || this.attackCooldown > 0) return false;
    const d = this.group.position.distanceTo(playerPos);
    if (d <= range) {
      this.attackCooldown = cooldown;
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
