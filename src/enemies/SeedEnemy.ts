import * as THREE from "three";
import { createDissolveMaterial, type DissolveMaterial } from "../fx/dissolve";
import type { Vec3 } from "../core/math";

export const SHELL_GEO = new THREE.IcosahedronGeometry(1, 2); // 셸(본체·레이캐스트) — 살아있는 적은 InstancedMesh 로 일괄 렌더
export const CORE_GEO = new THREE.IcosahedronGeometry(0.42, 1); // 발광 코어 — EnemyManager 가 InstancedMesh 로 일괄 렌더

const PULSE_RATE = 4; // 박동 위상 속도(rad/s)
const BOB_RATE = 2; // 자유 부유 위상 속도(rad/s)
const BOB_AMPLITUDE = 0.4; // 자유 부유 상하 진폭(m)
const STOP_DIST = 2.2; // 이 거리 이내면 추적 정지(접촉 교전 거리)
const LEAD_MAX = 1.0; // 예측 요격 최대 리드 시간(s) — 너무 멀리 조준하지 않도록 상한
export const SEP_MARGIN = 2.0; // 분리 여유 간격(m) — 자기+상대 반경에 더한 밀어내기 반경
const SEP_GAIN = 0.7; // 분리 가중(추격 대비) — 겹치면 강하게 밀어내 링 형태로 퍼짐
const KITER_FLEE_LEAD = 0.35; // 카이터가 플레이어 미래 위치를 예측해 회피하는 리드(s) — 원돌기 무력화
const HOME_WANDER = 2.0; // 카이터 방위(homeDir) 무작위 표류 속도 — 살아있는 동안 xyz 전 방향으로 자유 이동(구면 랜덤워크)
const _pred = { x: 0, y: 0, z: 0 }; // 예측 위치 임시(프레임당 동기 사용)

export type EnemyState = "alive" | "dissolving" | "dead";

/** 군집 조향 입력(EnemyManager 제공) — 플레이어 속도(예측 요격) + 동료 스냅샷·자기 인덱스(분리). */
export interface SteerInput {
  vel: Vec3; // 표적(플레이어) 속도
  boids: readonly Boid[]; // 살아있는 적 위치+반경
  index: number; // boids 내 자기 인덱스
  grid?: BoidGrid; // 분리 가속용 공간 해시(있으면 O(n))
  recompute?: boolean; // false 면 직전 조향속도(this.vel) 재사용(프레임 분산). 기본 true.
}

/**
 * 이번 프레임에 조향을 재계산할지 — 근접(교전) 개체는 항상(감각 불변), 원거리는 (frame+idx)%stride==0 일 때만.
 * 원거리 적은 직선 접근이라 k프레임 캐시해도 무체감. 순수.
 */
export function recomputeSteer(distSq: number, nearDistSq: number, frame: number, idx: number, stride: number): boolean {
  return distSq <= nearDistSq || ((frame + idx) % stride) === 0;
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
 * 군집 분리 가속용 공간 해시 — boids 를 cell 격자 버킷에 담는다(O(n) 분리 조회용).
 * cell = 2·maxR + SEP_MARGIN ≥ 최대 reach 라, 어떤 개체든 reach 내 동료는 모두 자기 셀의
 * 3×3×3 이웃 안에 있다 → 그 27셀만 보면 전수 계산과 **결과가 정확히 동일**하다(누락·중복 없음).
 */
export interface BoidGrid {
  cell: number;
  map: Map<number, number[]>; // 패킹 셀키 → boid 인덱스 목록
}

// 3축 셀 인덱스를 충돌 없이 단일 number 로 패킹(float64 정수 정밀도 내 — 축당 ±65536, 셀≥1m·맵 ±수km 안전).
const CELL_OFF = 1 << 16, CELL_M1 = 1 << 17, CELL_M2 = (1 << 17) * (1 << 17);
function cellKey(cx: number, cy: number, cz: number): number {
  return (cx + CELL_OFF) + (cy + CELL_OFF) * CELL_M1 + (cz + CELL_OFF) * CELL_M2;
}

/** boids 를 공간 해시 격자로 묶는다. cell 은 (2·최대반경 + SEP_MARGIN) 로 자동 산정(전수 동등 보장). 순수. */
export function buildBoidGrid(boids: readonly Boid[]): BoidGrid {
  let maxR = 0;
  for (const b of boids) if (b.r > maxR) maxR = b.r;
  const cell = Math.max(1, 2 * maxR + SEP_MARGIN);
  const inv = 1 / cell;
  const map = new Map<number, number[]>();
  for (let i = 0; i < boids.length; i++) {
    const b = boids[i];
    const key = cellKey(Math.floor(b.x * inv), Math.floor(b.y * inv), Math.floor(b.z * inv));
    const arr = map.get(key);
    if (arr) arr.push(i); else map.set(key, [i]);
  }
  return { cell, map };
}

/** 동료 nb 가 reach(자기+상대 반경+margin) 안이면 분리 기여를 out 에 누적(완전 중첩은 결정적 +x). */
function addSeparation(self: Boid, nb: Boid, margin: number, out: Vec3): void {
  const dx = self.x - nb.x, dy = self.y - nb.y, dz = self.z - nb.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  const reach = self.r + nb.r + margin;
  if (d2 > reach * reach) return;
  const d = Math.sqrt(d2);
  if (d < 1e-4) { out.x += margin; return; } // 완전 중첩 — 결정적 +x 분리(0除算 방지)
  const w = (reach - d) / reach / d; // 가까울수록↑, 방향 단위화(÷d)
  out.x += dx * w; out.y += dy * w; out.z += dz * w;
}

/**
 * 분리(separation) 조향 — boids[i] 를 reach 안의 동료들로부터 밀어내는 단위성 벡터의 합.
 * 모두가 한 점(플레이어)으로 호밍해 쌓이는 현상을 막아 무리를 퍼뜨린다.
 * grid 제공 시 3×3×3 이웃 셀만 순회(O(n) 총합) — 전수(O(n²))와 **결과 동일**. 없으면 전수.
 */
export function separationVector(boids: readonly Boid[], i: number, margin: number, grid?: BoidGrid): Vec3 {
  const self = boids[i];
  const out = { x: 0, y: 0, z: 0 };
  if (grid) {
    const inv = 1 / grid.cell;
    const cx = Math.floor(self.x * inv), cy = Math.floor(self.y * inv), cz = Math.floor(self.z * inv);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.map.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!arr) continue;
          for (const k of arr) if (k !== i) addSeparation(self, boids[k], margin, out);
        }
  } else {
    for (let k = 0; k < boids.length; k++) if (k !== i) addSeparation(self, boids[k], margin, out);
  }
  return out;
}

/**
 * 추격 + 분리 합성 속도(부수효과 없는 순수). 추격: aim(요격점) 으로 speed, stopDist 이내면 0(접촉 교전).
 * 분리: 동료 밀어냄(stopDist 이내에서도 적용 → 접촉점에 겹쳐 쌓이지 않고 링 형태로 퍼짐). 합은 speed 로 클램프.
 */
export function steerVelocity(
  pos: Vec3, aim: Vec3, speed: number, stopDist: number,
  boids: readonly Boid[], index: number, sepMargin: number, sepGain: number, grid?: BoidGrid
): Vec3 {
  const dx = aim.x - pos.x, dy = aim.y - pos.y, dz = aim.z - pos.z;
  const dist = Math.hypot(dx, dy, dz);
  let vx = 0, vy = 0, vz = 0;
  if (dist > stopDist) { const k = speed / dist; vx = dx * k; vy = dy * k; vz = dz * k; }
  const sep = separationVector(boids, index, sepMargin, grid);
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
  strafeMix?: number; // (homeDir 없을 때 폴백) 밴드 내 거동: 1=접선 선회, 0=도주. 기본 1.
  orbitRef?: number; // 이 접선속도(m/s)에서 회피가 최대(플레이어 선회 감지 기준). 기본 35.
  evadeGain?: number; // 선회 감지 시 궤도면 이탈 강도(0=없음, ~1=강함). 기본 0.
  homeDir?: Vec3; // 개체 고유 방위(단위벡터) — keepDist 구 위 이 방향을 향함 → 3D 고른 분산(z 무작위 위/아래). 없으면 폴백(반경 도주/선회).
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
  boids: readonly Boid[], index: number, sepMargin: number, sepGain: number, grid?: BoidGrid
): Vec3 {
  const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
  const dist = Math.hypot(dx, dy, dz) || 1e-3;
  const ux = dx / dist, uy = dy / dist, uz = dz / dist; // 적→플레이어 단위(접근 방향)
  let desX: number, desY: number, desZ: number;
  if (dist < p.keepDist - p.keepBand) {
    desX = -ux; desY = -uy; desZ = -uz; // 너무 가까움 → 도주(플레이어 반대)
  } else if (p.homeDir) {
    // keepDist 구 위 자기 고유 방위(homeDir)로 향함 → 무리가 xy·z 모두 고르게 분산(z 무작위 위/아래).
    const tx = target.x + p.homeDir.x * p.keepDist - pos.x;
    const ty = target.y + p.homeDir.y * p.keepDist - pos.y;
    const tz = target.z + p.homeDir.z * p.keepDist - pos.z;
    const tl = Math.hypot(tx, ty, tz) || 1e-3;
    desX = tx / tl; desY = ty / tl; desZ = tz / tl;
  } else if (dist > p.keepDist + p.keepBand) {
    desX = ux; desY = uy; desZ = uz; // (폴백) 다가와서 사거리 진입
  } else {
    // (폴백) 밴드 내 접선 선회(strafeMix=1)와 도주(strafeMix=0) 블렌딩.
    const sgn = (index & 1) ? 1 : -1;
    let tx = -uz * sgn, tz = ux * sgn;
    const tl = Math.hypot(tx, tz) || 1e-3;
    tx /= tl; tz /= tl;
    const mix = p.strafeMix ?? 1;
    desX = tx * mix - ux * (1 - mix);
    desY = -uy * (1 - mix);
    desZ = tz * mix - uz * (1 - mix);
    const dl = Math.hypot(desX, desY, desZ) || 1e-3;
    desX /= dl; desY /= dl; desZ /= dl;
  }
  let vx = desX * p.speed, vy = desY * p.speed, vz = desZ * p.speed;
  const sep = separationVector(boids, index, sepMargin, grid);
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
      // 개체 고유 수직 부호(homeDir 의 위/아래)로 회피 → 모기마다 위 또는 아래로 무작위 이탈. homeDir 없으면 위로.
      const vsign = p.homeDir && p.homeDir.y < 0 ? -1 : 1;
      if (ny * vsign < 0) { nx = -nx; ny = -ny; nz = -nz; }
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
  readonly hitMesh: THREE.Mesh; // 레이캐스트 대상(셸)
  private shellMat: DissolveMaterial;
  // 발광 코어는 메시를 갖지 않고 시각 상태만 보유 — EnemyManager 가 InstancedMesh 로 일괄 렌더(드로우콜 절감).
  coreScale = 1; // 코어 상대 크기(1=정상, 디졸브 시 0으로 수축)
  coreBright = 2.2; // 코어 발광 세기(박동/피격/디졸브로 변동)
  glow = 1; // 강함 비례 발광 배수(강체=청백일수록 ↑) — 셸·코어 인스턴스 색 가산(스폰 시 주입)

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

    this.group.scale.setScalar(this.baseScale);
    this.group.position.copy(position);
  }

  /** 주파수 빔 적중 처리. 반환값: 이번 타격으로 처치되었는가 */
  applyFrequencyHit(damage: number): boolean {
    if (this.state !== "alive") return false;
    this.hp -= damage;

    // 박동 발광 강화 + 피격 순간 표면 전체가 흰색으로 번쩍(타격감)
    this.coreBright = 6.5;
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

  /** 피격 번쩍임(0..1, 제곱) — 셸 인스턴스 색 모듈레이션용(매니저). */
  get flash(): number {
    return this.hitFlash * this.hitFlash;
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
      this.coreScale = Math.max(0, 1 - this.dissolveProgress * 1.2); // 코어 수축(인스턴스로 렌더)
      this.coreBright = 4.5 * (1 - this.dissolveProgress);
      if (this.dissolveProgress >= 1) this.state = "dead";
      return false;
    }

    // 체력 비율에 따라 쪼그라들기(스펙: 쪼그라뜨려 소멸)
    const hpRatio = this.hp / this.maxHp;
    const shrink = 0.55 + 0.45 * hpRatio;
    const pulse = 1 + Math.sin(this.pulsePhase) * 0.06;
    this.group.scale.setScalar(this.baseScale * shrink * pulse);
    this.shellMat.setPulse((Math.sin(this.pulsePhase) + 1) * 0.5);
    this.coreScale = 1;
    this.coreBright = THREE.MathUtils.lerp(this.coreBright, 1.8 + Math.sin(this.pulsePhase) * 0.8, 0.1);
    return true;
  }

  /**
   * 추적 AI — 플레이어를 향해 3D 이동(상하 포함) + 자유 부유. speedScale=고도 가중.
   * steer 제공 시 **예측 요격**(원돌기 가로채기) + **분리**(동료 밀어내기, 한 점에 뭉침 방지). 없으면 단순 호밍.
   */
  private updateMotion(dt: number, target: THREE.Vector3, speedScale: number, steer?: SteerInput) {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const pos = this.group.position;
    if (steer) {
      const recompute = steer.recompute !== false; // 프레임 분산: false 면 this.vel 재사용
      if (this.kiter) {
        // 도주형 — keepDist 유지 + 선회 캡 + 분리. 미래 위치(속도·리드) 기준 회피로 원돌기를 가로질러 빠져나감.
        if (recompute) {
          // 방위(homeDir) 무작위 표류 — 한 개체도 죽기 전까지 xyz 전 방향으로 자유롭게 떠돈다(구면 랜덤워크).
          const h = this.kiter.homeDir;
          if (h) {
            const w = HOME_WANDER * dt;
            h.x += (Math.random() - 0.5) * w; h.y += (Math.random() - 0.5) * w; h.z += (Math.random() - 0.5) * w;
            const hl = Math.hypot(h.x, h.y, h.z) || 1e-3;
            h.x /= hl; h.y /= hl; h.z /= hl;
          }
          _pred.x = target.x + steer.vel.x * KITER_FLEE_LEAD;
          _pred.y = target.y + steer.vel.y * KITER_FLEE_LEAD;
          _pred.z = target.z + steer.vel.z * KITER_FLEE_LEAD;
          this.vel = kiterVelocity(pos, _pred, steer.vel, this.vel, this.kiter, dt, steer.boids, steer.index, SEP_MARGIN, SEP_GAIN, steer.grid);
        }
      } else if (recompute) {
        // 추격형 — 예측 요격 + 분리 조향.
        const speed = this.speed * speedScale;
        const aim = interceptPoint(target, steer.vel, pos, speed, LEAD_MAX);
        this.vel = steerVelocity(pos, aim, speed, STOP_DIST, steer.boids, steer.index, SEP_MARGIN, SEP_GAIN, steer.grid);
      }
      const v = this.vel; // 재계산했으면 새 값, 아니면 캐시
      pos.x += v.x * dt; pos.y += v.y * dt; pos.z += v.z * dt;
    } else {
      const next = pursueStep(pos, target, this.speed * speedScale, dt, STOP_DIST); // 표적 없음/디졸브 — 단순 호밍
      pos.set(next.x, next.y, next.z);
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
