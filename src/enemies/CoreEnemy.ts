import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createDissolveMaterial, type DissolveMaterial } from "../fx/dissolve";
import type { Vec3 } from "../core/math";
import type { ZenoSpec } from "../weapons/WeaponSpec";
import type { PlasmoidArchetype } from "./PlasmoidSpec";

export const SHELL_GEO = new THREE.IcosahedronGeometry(1, 2); // 기본 셸(구) — 실루엣 미지정 폴백
export const CORE_GEO = new THREE.IcosahedronGeometry(0.42, 1); // 발광 코어 — EnemyManager 가 InstancedMesh 로 일괄 렌더

// 역할 실루엣(P3 — §6.7 형태 언어): 색=강함 · **형태=직무** 채널 분리. 직무마다 다른 지오메트리로
// 인스턴싱(EnemyManager 가 역할별 InstancedMesh 운용). 디졸브 개별 메시도 같은 형태(applySilhouette).
//
// 형태 축 = **실루엣 종횡비**(2026-08-25 개편). 코어가 강하게 발광(coreBright × CORE_BLOOM)해서 면·각은
// 원거리에서 뭉개진다 — 정이십면체(20면)든 정팔면체(8면)든 같은 빛덩어리다. 빠른 화면에서 살아남는
// 채널은 **총 비례**와 **구멍** 둘뿐이라, 다섯 직무를 종횡비 축에 넓게 흩어 놓는다.
// 시선 ±35°(플레이어 실사용 범위) 중앙값: 모기 0.16 · 절단체 0.51 · 역행체 0.94 · 소인체 1.22 · 거머리 2.45.
// 개편 전에는 다섯이 0.29~1.15 에 몰려 있었고 거머리(1.04)와 소인체(0.98)는 사실상 같은 실루엣이었다.
// 읽는 규칙: **세로로 길수록 빠르고 원거리, 가로로 넓을수록 느리고 접촉. 구멍이 있으면 역행체.**
const _kiterGeo = new THREE.OctahedronGeometry(1, 0);
_kiterGeo.scale(0.42, 2.6, 0.42); // 가늘고 긴 방추 — 빠른 원거리 흡혈의 바늘(종횡비 0.16)
const _cutterGeo = new THREE.ConeGeometry(0.72, 2.6, 4);
_cutterGeo.rotateX(Math.PI); // 날끝이 아래로 — 건물에 꽂히는 절단 쐐기(0.51). 방향이 곧 정체
const _markerGeo = new THREE.OctahedronGeometry(1, 0);
_markerGeo.scale(1.25, 1.0, 1.25); // 가로로 넓은 마름모 결정 — 낙인탄 글리프와 같은 형태 언어(1.22)
// 역행체는 고리가 정체인데 단일 토러스는 옆에서 보면 막대라 종횡비가 0.29~1.14 로 요동친다
// (= 회전만으로 정체가 무너진다). 직교로 하나 더 겹쳐 어느 각도에서도 링이 남게 한다(0.79~1.01).
const _ringA = new THREE.TorusGeometry(1.15, 0.2, 6, 12);
const _ringB = _ringA.clone();
_ringB.rotateY(Math.PI / 2);
const _rewinderGeo = mergeGeometries([_ringA.clone(), _ringB])!;
export const SHELL_GEOS: Record<PlasmoidArchetype, THREE.BufferGeometry> = {
  rusher: new THREE.CylinderGeometry(1.5, 1.5, 0.42, 8), // 납작한 팔각 원반 — 들러붙는 접촉체(2.45)
  kiter: _kiterGeo,
  marker: _markerGeo,
  cutter: _cutterGeo,
  rewinder: _rewinderGeo, // 시간 고리 — 역행 시전자(미니보스 슬롯)
};

const PULSE_RATE = 4; // 박동 위상 속도(rad/s)
export const KILL_STAGGER_SEC = 0.35; // 동시 경직 — 한 기 처치 시 전 개체가 같은 순간 움찔(처치 직후 안전창)
const STAGGER_SHRINK = 0.93; // 경직 중 수축 배율(전장 전체가 함께 움찔하는 시각 신호)
const DISSOLVE_DRIFT_SPEED = 4.0; // 소산 표류 최고 속도(m/s) — 디졸브 입자가 균열 앵커 방향으로 흐름(진행도 비례)
const BOB_RATE = 2; // 자유 부유 위상 속도(rad/s)
const BOB_AMPLITUDE = 0.4; // 자유 부유 상하 진폭(m)
const STOP_DIST = 2.2; // 이 거리 이내면 추적 정지(접촉 교전 거리)
const LEAD_MAX = 1.0; // 예측 요격 최대 리드 시간(s) — 너무 멀리 조준하지 않도록 상한
export const SEP_MARGIN = 2.0; // 분리 여유 간격(m) — 자기+상대 반경에 더한 밀어내기 반경
const SEP_GAIN = 0.7; // 분리 가중(추격 대비) — 겹치면 강하게 밀어내 링 형태로 퍼짐
const KITER_FLEE_LEAD = 0.35; // 카이터가 플레이어 미래 위치를 예측해 회피하는 리드(s) — 원돌기 무력화
const HOME_WANDER = 2.0; // 카이터 방위(homeDir) 무작위 표류 속도 — 살아있는 동안 xyz 전 방향으로 자유 이동(구면 랜덤워크)
const _pred = { x: 0, y: 0, z: 0 }; // 예측 위치 임시(프레임당 동기 사용)

// 박동 동기화 — 전장의 모든 개체가 **정확히 같은 위상**으로 맥동한다(개체별 무작위 위상 폐기).
// EnemyManager.update 가 프레임당 1회 전진시키고 모든 개체가 공유 위상을 읽는다.
let globalPulse = Math.random() * Math.PI * 2;
/** 공유 박동 위상 전진 — 매 프레임 1회(EnemyManager). */
export function advanceGlobalPulse(dt: number): void {
  globalPulse += dt * PULSE_RATE;
}
/** 현재 공유 박동 위상(rad). */
export function globalPulsePhase(): number {
  return globalPulse;
}

/**
 * 소산 표류 1스텝(순수) — 디졸브 중 입자가 앵커(균열) 방향으로 흐르는 수평 변위.
 * 진행도(progress 0..1)에 비례해 가속, 앵커에 거의 닿았으면 0. y 는 불변(수평 표류).
 */
export function dissolveDriftStep(pos: Vec3, anchor: Vec3, progress: number, dt: number, speed = DISSOLVE_DRIFT_SPEED): Vec3 {
  const dx = anchor.x - pos.x, dz = anchor.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3 || progress <= 0) return { x: 0, y: 0, z: 0 };
  const k = (speed * progress * dt) / d;
  return { x: dx * k, y: 0, z: dz * k };
}

export type EnemyState = "alive" | "dissolving" | "dead";

// ─────────────────────── 관측 고정(내부 id: zeno — 서사편 §7.2 W1) ───────────────────────
// 같은 대상 지속 조사 시 행동 감속→동결. "노출" = 연속 피관측 시간(히트 간격이 grace 이내면 연속).
// 관측이 끊기면 노출이 빠르게 감쇠한다. 표면 어휘는 "관측 고정"(§8.2) — zeno 는 코드 전용.
export const ZENO_GRACE = 0.5; // 히트 간 이 간격(s) 이내 = 지속 조사(무기 graceSec 미지정 시)
// 피격 후 이 시간(s)은 "조사 중" — 동시 조사 실험(§9 5장) 판정 창.
// 0.6 → 1.2 상향(2026-08 e2e): 평균 조작 속도(오토 단발 교차 + 특수 볼리)로는 0.6s 창에서
// "동시 N기"가 성립하지 않음 — 축소판(2기/2s)조차 유지 0.3s 상한. 창을 넓혀 무기 교차를 흡수.
export const OBSERVE_WINDOW = 1.2;
export const DASH_SEC = 0.45; //  러셔 돌진 지속(P3 §6.7 안티카이팅)
export const DASH_CD = 4.5; //    돌진 쿨다운
export const DASH_MUL = 2.6; //   돌진 중 속도 배수
export const MARKER_TELEGRAPH_SEC = 0.7; // 낙인탄 장전 조준선(발사 전 텔레그래프)
const ZENO_DECAY = 2.0; // 관측 끊김 시 노출 감쇠 배속(1초 노출이 0.5초 만에 풀림)
const ZENO_MIN_MUL = 0.3; // 동결 전 감속 하한(완전 정지는 동결에서만)

/** 노출 1스텝(순수) — 마지막 히트 후 grace 이내면 dt 만큼 누적, 지나면 ZENO_DECAY 배속 감쇠. */
export function zenoExposureStep(exposure: number, sinceHit: number, grace: number, dt: number): number {
  return sinceHit <= grace ? exposure + dt : Math.max(0, exposure - dt * ZENO_DECAY);
}

/** 노출 → 속도 배수(순수). 동결(노출 ≥ freezeAfter)이면 0, 아니면 1−slowPerSec·노출(하한 클램프). */
export function zenoSlowMul(exposure: number, slowPerSec: number, freezeAfter: number): number {
  if (exposure >= freezeAfter) return 0;
  return Math.max(ZENO_MIN_MUL, 1 - slowPerSec * exposure);
}

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
export interface CoreAppearance {
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
  aggroPenalty: number, hysteresis: number, scores: number[],
  matchMul?: readonly number[] // 상성 가중(없으면 1) — MP: 적이 자기 상성 드론을 우선 표적
): number {
  scores.length = dists.length;
  for (let i = 0; i < dists.length; i++) {
    if (dists[i] === Infinity) { scores[i] = Infinity; continue; }
    scores[i] = dists[i] * (1 + aggroPenalty * load[i]) * (matchMul ? matchMul[i] : 1);
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
 * 코어 적 유닛 — 외계 코어(가장 작은 등급 = 플라즈모이드). 물질을 흡수해 성장하며, 방치 시 상위 등급으로 진화.
 * - 박동(pulse)하며 플레이어를 추적(또는 카이터: 도주+원거리 드레인).
 * - 주파수 빔에 맞으면 쪼그라들고(shrink), 체력 소진 시 디졸브 소멸(스펙 5/6장).
 */
export class CoreEnemy {
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
  color: number; // 발광/표면 색(드레인 빔 연출 등에서 참조) — 준위 강등(P3)이 적색 쪽으로 갱신
  // 피격 유발 인식 — 플레이어 공격에 노출되면 거리 무관 추격. **영구 래치가 아니라 감쇠 타이머**다.
  // 영구 래치였을 때: 주무기가 360° 자동사격이라 유발을 피할 수 없고, 유발이 반경 100m 로 전파되므로
  // 첫 교전 몇 초 뒤엔 전장 전체가 플레이어만 쫓았다 → aggro=landmark/building 변조와 진형 행동이
  // 도입부에만 존재하고 사라졌다("모든 미션이 사냥 하나로 느껴진다"의 직접 원인).
  // 감쇠하면 "지금 싸우는 적"만 나를 쫓고 나머지는 제 임무로 돌아간다 — 요격이냐 추격이냐의 선택이 생긴다.
  private provokeT = 0;
  get provoked(): boolean { return this.provokeT > 0; }
  /** 피격 유발 — sec 동안 거리 무관 추격. 재피격은 갱신(연장)이지 누적이 아니다. */
  provoke(sec: number): void { if (sec > this.provokeT) this.provokeT = sec; }
  /** 유발 감쇠 — 매 프레임 1회(EnemyManager 루프가 상태 분기 전에 호출). */
  decayProvoke(dt: number): void { if (this.provokeT > 0) this.provokeT = Math.max(0, this.provokeT - dt); }
  archetypeName = ""; // 아키타입 표시명(모기/거머리/소인체 …) — HUD/로그용
  role: PlasmoidArchetype = "rusher"; // 행동 직무(스폰 시 주입) — 공격 경로 분기(marker 는 낙인탄 전용)
  // 투입 직무(훅 ③ purge-role 집계용) — 행동은 role 이 결정하고, 이 태그는 미션 계약을 따른다:
  // elite(고체력 러셔)·boss(다중 투영)는 행동상 rusher 지만 별개 직무로 집계된다. 기본 = role.
  deployRole: PlasmoidArchetype | "elite" | "boss" = "rusher";
  targetIndex = -1; // 현재 추적 대상 플레이어 인덱스(MP 멀티타깃 — 매니저가 관리, 히스테리시스)
  buildingId: string | null = null; // 플레이어가 사거리 밖일 때 공격 중인 건물(2순위 표적)
  cutterSever = 0; //                커터 절단 채널 누적(s) — severSec 도달 시 납치 개시(매니저 구동)
  cutterRide: string | null = null; // 커터가 납치 동반 중인 건물 id(부양 상단에 얹힘)
  kkColors: number[] | null = null; // 준위 강등 색 계단(index=level-1) — 정예·보스급만(매니저 주입)
  kkCur = 4; //                      현재 준위(KK_LEVELS 시작) — 하향 통과 시 강등 연출(매니저 구동)
  markerAimLeft = 0; //              낙인탄 텔레그래프 잔여(s) — 장전 조준선(P3 §6.7, 매니저 구동)
  rewCastLeft = 0; //                역행체 시전 잔여(s) — 예지 HUD 카운트다운(매니저 구동)
  rewCd = 6; //                      역행 시전 쿨다운(s) — 스폰 직후 즉시 시전 방지 초기값
  // 차원도약(leap.ts) — 매니저가 구동. 착지점은 텔레그래프 동안 플레이어를 **따라가다가** 발동
  // lockSec 초 전에 확정된다. 예고선이 멈추는 순간이 곧 "여기로 온다"는 신호이고, 그때부터
  // lockSec 만큼이 플레이어의 회피 시간이다(회피 강제의 전제 = 읽을 수 있음).
  leapCastLeft = 0; //               도약 텔레그래프 잔여(s). >0 = 시전 중
  leapCd = 0; //                     도약 쿨다운(s) — 매니저가 스폰 시 스펙으로 초기화
  leapTarget: Vec3 | null = null; // 착지점(월드) — 텔레그래프 예고선의 끝점
  leapLocked = false; //             착지점 확정 여부. false 면 매 프레임 플레이어를 따라간다
  leapRecover = 0; //                착지 후 공격 불가 잔여(s) — 회피 창
  private dashLeft = 0; //           러셔 돌진 잔여(s) — 카이팅 파훼(안티카이팅)
  private dashCd = 0;
  driftAnchor: Vec3 | null = null; // 소산 표류 앵커(균열 위치) — 매니저가 주입(공유 참조)
  zenoLatch = false; // 관측 고정 집계 래치(매니저 — 동결 진입 1회만 카운트)
  // 다중 투영(§2.6 — 보스): 여러 투영이 하나의 체력을 공유. 어느 구를 때려도 같은 풀이 줄고,
  // 풀 소진 시 전 투영이 함께 소산(처치 크레딧은 killCredited 로 1회만).
  sharedPool: { hp: number; maxHp: number; killCredited: boolean } | null = null;
  // 받는 피해 배수(훅 ⑤ 호위 방패 — 호위 생존 중 <1, 전멸 시 매니저가 1 복원). 표시 데미지도 이 값 반영.
  damageMul = 1;
  // 진형 행동(조합 정립 — 로스터 유닛에서 주입). hunt 외 행동은 피격(provoked) 시 hunt 로 전환.
  behavior: "hunt" | "hold" | "patrol" | "escort" = "hunt";
  station: Vec3 | null = null; // hold(배치 지점)/patrol(유닛 중심) 기준점
  patrolPhase = 0; // patrol 궤도 위상(개체별 분산)
  escortGroup: CoreEnemy[] | null = null; // escort — 호위 대상 유닛의 개체 목록(공유 참조, 재앵커용)

  private dissolveProgress = 0;
  private hitFlash = 0; // 피격 순간 1 → 빠르게 감쇠하며 흰색 번쩍임
  private staggerLeft = 0; // 동시 경직 잔여(s) — 어디선가 동료가 처치되면 전 개체가 함께 움찔
  private bobPhase = Math.random() * Math.PI * 2;
  private speed: number;
  private attackCooldown = 0;
  private baseScale: number;
  private maxScale: number; // 흡수 성장 시각 상한(초기 baseScale 의 1.5배)
  private vel: Vec3 = { x: 0, y: 0, z: 0 }; // 카이터 속도 상태(선회 캡용)
  private kiter?: KiterParams; // 설정 시 도주형 행동
  // 관측 고정(zeno) — 지속 조사 노출 상태. 무기가 applyZeno 로 갱신, update 가 누적/감쇠.
  private zeno?: ZenoSpec;
  private zenoExposure = 0;
  private zenoSince = Infinity; // 마지막 피관측 히트 후 경과(s)
  private observedLeft = 0; //   "지금 조사받는 중" 창(s) — 모든 피격이 갱신. 동시 조사 실험(§9 5장) 집계용
  // 위상 이탈(§2.1) — 실체 cooldown ↔ 이탈 duration 주기. 이탈 중 일반 무기 무효·공격 불가·표적 제외.
  private phaseCfg: { cooldown: number; duration: number } | null = null;
  private phaseTimer = 0;
  private phasedOut = false;
  private pinLeft = 0; // W2 관측 계류 — 수동 명중의 참조 핀. 남아있는 동안 위상 이탈 불가

  constructor(position: THREE.Vector3, appearance: CoreAppearance, speed = 4.5) {
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

  /** 러셔 짧은 돌진(P3 §6.7 안티카이팅) — 쿨다운 도는 동안 무시. 동결/경직 중엔 이동 자체가 정지. */
  startDash(): void {
    if (this.dashCd > 0 || this.state !== "alive") return;
    this.dashLeft = DASH_SEC;
    this.dashCd = DASH_CD;
    this.coreBright = 5; // 도약 직전 발광 — 텔레그래프
  }

  get isDashing(): boolean {
    return this.dashLeft > 0;
  }

  /** 역할 실루엣 적용(P3 §6.7) — 디졸브 개별 메시의 형태를 직무 지오메트리로 교체(스폰 시 1회). */
  applySilhouette(geo: THREE.BufferGeometry): void {
    this.hitMesh.geometry = geo;
  }

  /** 위상 이탈 활성화 — 스폰 롤이 보유 판정 후 호출(u 로 최초 이탈 시점 분산). */
  enablePhase(cfg: { cooldown: number; duration: number }, u: number): void {
    this.phaseCfg = cfg;
    this.phaseTimer = cfg.cooldown * (0.3 + 0.7 * u); // 전장 전체가 동시에 꺼지지 않게 위상 분산
  }

  /** 위상 이탈 중인가 — 일반 무기 무효·공격 불가·자동발사/어시스트/브래킷 제외(§2.1). */
  get isPhased(): boolean {
    return this.phasedOut && this.state === "alive";
  }

  /** 강제 결어긋남(§2.2 관측 펄스) — 실체화 + 실체 쿨다운 재시작. */
  materialize(): void {
    if (!this.phaseCfg) return;
    this.phasedOut = false;
    this.phaseTimer = this.phaseCfg.cooldown;
  }

  /**
   * 주파수 빔 적중 처리. 반환값: 이번 타격으로 처치되었는가(공유 풀은 그룹 전체에서 1회만 true).
   * obs — 수동 관측 사격의 부가효과(W2): decohere=위상 이탈 강제 실체화, pinSec=관측 계류(재이탈 봉쇄).
   * 위상 이탈 중 + decohere 없음 = 무효(호출부 fireEmitters 가 걸러 여기 오지 않는 게 정상 경로).
   */
  applyFrequencyHit(damage: number, obs?: { decohere?: boolean; pinSec?: number }): boolean {
    if (this.state !== "alive") return false;
    if (this.phasedOut) {
      if (!obs?.decohere) return false; // 일반 무기 무효 — 벌크 밖(§2.1)
      this.materialize(); //               관측 펄스 — 관측된 것은 숨지 못한다(§2.2)
    }
    if (obs?.pinSec && obs.pinSec > this.pinLeft) this.pinLeft = obs.pinSec; // W2 참조 핀
    damage *= this.damageMul; // 호위 방패 감쇄(훅 ⑤) — 모든 무기 경로 공통
    this.observedLeft = OBSERVE_WINDOW; // 모든 무기 경로가 지나는 단일 지점 — 동시 조사 판정 갱신

    // 박동 발광 강화 + 피격 순간 표면 전체가 흰색으로 번쩍(타격감)
    this.coreBright = 6.5;
    this.hitFlash = 1;

    if (this.sharedPool) {
      // 다중 투영 — 어느 구를 때려도 같은 풀이 준다(같은 체력이니까). 소진 시 이 투영부터 소산,
      // 나머지 투영은 매니저가 forceDissolve 로 동반 소산. 처치 크레딧은 그룹당 1회.
      const pool = this.sharedPool;
      pool.hp -= damage;
      this.hp = Math.max(0, pool.hp);
      if (pool.hp <= 0) {
        this.state = "dissolving";
        if (!pool.killCredited) {
          pool.killCredited = true;
          return true;
        }
      }
      return false;
    }

    this.hp -= damage;
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = "dissolving";
      return true;
    }
    return false;
  }

  /** 공유 풀 소진 시 동반 소산(처치 크레딧 없음) — 매니저가 형제 투영에 호출. */
  forceDissolve(): void {
    if (this.state !== "alive") return;
    this.hp = 0;
    this.state = "dissolving";
  }

  /** 관측 고정(zeno) 노출 — 빔 적중마다 호출. 파라미터는 마지막으로 조사한 무기 것을 따른다. */
  applyZeno(z: ZenoSpec): void {
    if (this.state !== "alive") return;
    this.zeno = z;
    this.zenoSince = 0;
  }

  /**
   * 관측 노출 초기화 — 차원도약의 본체(§6.7). 붙들고 쌓아 둔 지속조사 누적이 도약으로 끊긴다.
   * "붙들면 멈춘다"(W1)에 대한 대항 수단: 고정 교전만으로 이기는 안정 상태를 깬다.
   */
  resetZenoExposure(): void {
    this.zenoExposure = 0;
    this.zenoSince = Infinity;
    this.zeno = undefined;
    this.zenoLatch = false;
  }

  /** 현재 관측 감속 배수(1=정상, 0=동결). 이동 적분에 곱한다. */
  get zenoMul(): number {
    return this.zeno ? zenoSlowMul(this.zenoExposure, this.zeno.slowPerSec, this.zeno.freezeAfter) : 1;
  }

  /** 동결 여부 — 이동·공격(낙인 장전 포함) 전면 정지. "붙들고 있는 것만으로 인터럽트"(W1). */
  get isZenoFrozen(): boolean {
    return !!this.zeno && this.zenoExposure >= this.zeno.freezeAfter;
  }

  /** 지금 조사받는 중인가 — 마지막 피격 후 짧은 창 이내(동시 조사 실험의 "동시" 판정). */
  get isObserved(): boolean {
    return this.state === "alive" && this.observedLeft > 0;
  }

  /** 관측 계류(W2) 중인가 — 계류로 잠근 대상에서 일어난 사건은 되감기지 않는다(§9.2). */
  get isPinned(): boolean {
    return this.pinLeft > 0;
  }

  /** 접촉으로 흡수한 에너지만큼 자가 회복(체력 ↑, 최대치 한도). 살아있을 때만. 공유 풀은 풀에 가산. */
  absorbEnergy(amount: number): void {
    if (this.state !== "alive") return;
    if (this.sharedPool) {
      this.sharedPool.hp = Math.min(this.sharedPool.maxHp, this.sharedPool.hp + amount);
      this.hp = this.sharedPool.hp;
      return;
    }
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
    if (this.sharedPool) {
      // 다중 투영 — 성장도 풀 공유(한 손의 회복). 시각 성장은 개체별 유지.
      this.sharedPool.maxHp += amount;
      this.sharedPool.hp = Math.min(this.sharedPool.maxHp, this.sharedPool.hp + amount);
      this.hp = this.sharedPool.hp;
      this.maxHp = this.sharedPool.maxHp;
    } else {
      this.maxHp += amount;
      this.hp = Math.min(this.maxHp, this.hp + amount);
    }
    this.baseScale = Math.min(this.maxScale, this.baseScale * (1 + amount / Math.max(1, this.maxHp)));
  }

  /** 동시 경직 — 다른 개체가 처치되는 순간 함께 움찔(이동·공격 정지 + 수축). 살아있을 때만. */
  stagger(sec = KILL_STAGGER_SEC): void {
    if (this.state !== "alive") return;
    this.staggerLeft = Math.max(this.staggerLeft, sec);
    this.coreBright = 5.5; // 같은 순간 전장 전체가 밝게 움찔 — 한 몸의 신호
  }

  get isStaggered(): boolean {
    return this.staggerLeft > 0;
  }

  update(dt: number, target: THREE.Vector3, speedScale = 1, steer?: SteerInput) {
    this.bobPhase += dt * BOB_RATE;
    const staggered = this.staggerLeft > 0;
    if (staggered) this.staggerLeft = Math.max(0, this.staggerLeft - dt);
    if (this.observedLeft > 0) this.observedLeft -= dt; // 동시 조사 창 감쇠
    if (this.pinLeft > 0) this.pinLeft -= dt; //           관측 계류(W2) 감쇠
    if (this.dashCd > 0) this.dashCd -= dt; //             러셔 돌진 쿨다운
    if (this.leapRecover > 0) this.leapRecover -= dt; //    차원도약 착지 경직(공격 불가) 감쇠
    if (this.dashLeft > 0) { this.dashLeft -= dt; speedScale *= DASH_MUL; } // 돌진 가속
    // 위상 이탈 주기(§2.1) — 계류(pin)·동결(zeno) 중엔 이탈 진입 불가(관측된 것은 숨지 못한다)
    if (this.phaseCfg && this.state === "alive") {
      this.phaseTimer -= dt;
      if (this.phasedOut) {
        if (this.phaseTimer <= 0) this.materialize();
      } else if (this.phaseTimer <= 0 && this.pinLeft <= 0 && !this.isZenoFrozen) {
        this.phasedOut = true;
        this.phaseTimer = this.phaseCfg.duration;
      }
    }
    // 관측 고정(zeno) 노출 누적/감쇠 — 노출 소진 + 관측 끊김이면 상태 해제
    if (this.zeno) {
      this.zenoSince += dt;
      const grace = this.zeno.graceSec ?? ZENO_GRACE;
      this.zenoExposure = zenoExposureStep(this.zenoExposure, this.zenoSince, grace, dt);
      if (this.zenoExposure <= 0 && this.zenoSince > grace) this.zeno = undefined;
    }
    // 소멸/경직/동결 중엔 이동 생략
    if (this.updateVisual(dt) && !staggered && !this.isZenoFrozen) this.updateMotion(dt, target, speedScale, steer);
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
      // 코어 수축(인스턴스로 렌더) — 시작 직후 짧게 부풀었다(POP) 가라앉는다. 곧장 수축만 하면
      // "타격"이 아니라 "쪼그라듦"으로만 읽힌다(타격감 ②). pop 은 progress 0→POP_END 구간에서
      // 0→최대→0 으로 되돌아와 기존 수축 곡선과 이어 붙는 지점에 불연속이 없다.
      const base = Math.max(0, 1 - this.dissolveProgress * 1.2);
      const POP_END = 0.15;
      const pop = this.dissolveProgress < POP_END ? 0.5 * Math.sin((this.dissolveProgress / POP_END) * Math.PI) : 0;
      this.coreScale = base + pop;
      this.coreBright = 4.5 * (1 - this.dissolveProgress);
      // 소산 표류 — 흩어지는 입자가 균열(앵커) 방향으로 흐른다. 모든 죽음이 한 곳을 가리킨다.
      if (this.driftAnchor) {
        const p = this.group.position;
        const s = dissolveDriftStep(p, this.driftAnchor, this.dissolveProgress, dt);
        p.x += s.x;
        p.z += s.z;
      }
      if (this.dissolveProgress >= 1) this.state = "dead";
      return false;
    }

    // 체력 비율에 따라 쪼그라들기(스펙: 쪼그라뜨려 소멸) — 박동은 전역 공유 위상(전 개체 동기)
    const hpRatio = this.hp / this.maxHp;
    const shrink = 0.55 + 0.45 * hpRatio;
    const pulse = 1 + Math.sin(globalPulse) * 0.06;
    const stag = this.staggerLeft > 0 ? STAGGER_SHRINK : 1; // 경직 중 일제 수축(움찔)
    this.group.scale.setScalar(this.baseScale * shrink * pulse * stag);
    this.shellMat.setPulse((Math.sin(globalPulse) + 1) * 0.5);
    this.coreScale = 1;
    this.coreBright = THREE.MathUtils.lerp(this.coreBright, 1.8 + Math.sin(globalPulse) * 0.8, 0.1);
    if (this.isZenoFrozen) this.coreBright = 5.0; // 동결 — 코어가 밝게 못 박힌 듯 고정(관측에 붙들림)
    return true;
  }

  /**
   * 추적 AI — 플레이어를 향해 3D 이동(상하 포함) + 자유 부유. speedScale=고도 가중.
   * steer 제공 시 **예측 요격**(원돌기 가로채기) + **분리**(동료 밀어내기, 한 점에 뭉침 방지). 없으면 단순 호밍.
   */
  private updateMotion(dt: number, target: THREE.Vector3, speedScale: number, steer?: SteerInput) {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const zm = this.zenoMul; // 관측 감속 — 조향은 그대로, 변위 적분만 늦춘다(캐시 속도와 일관)
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
      pos.x += v.x * dt * zm; pos.y += v.y * dt * zm; pos.z += v.z * dt * zm;
    } else {
      const next = pursueStep(pos, target, this.speed * speedScale * zm, dt, STOP_DIST); // 표적 없음/디졸브 — 단순 호밍
      pos.set(next.x, next.y, next.z);
    }
    pos.y += BOB_AMPLITUDE * BOB_RATE * Math.cos(this.bobPhase) * dt; // 누적 X 미세 흔들림
  }

  /** 공격 가능 여부 (사거리 + 쿨다운 + 경직/동결 게이트). cooldown 으로 접촉/드레인/낙인탄 간격을 분기. */
  tryAttack(playerPos: THREE.Vector3, range: number, cooldown = 1.0): boolean {
    if (this.state !== "alive" || this.attackCooldown > 0 || this.staggerLeft > 0 || this.isZenoFrozen || this.phasedOut) return false;
    if (this.leapRecover > 0) return false; // 착지 직후 — 회피 창(도약이 곧 피해가 되지 않게)
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
export function tagEnemy(mesh: THREE.Object3D, enemy: CoreEnemy): void {
  mesh.userData[ENEMY_KEY] = enemy;
}
/** 레이캐스트 적중 오브젝트 → 적(없으면 undefined). */
export function getEnemy(obj: THREE.Object3D): CoreEnemy | undefined {
  return obj.userData[ENEMY_KEY] as CoreEnemy | undefined;
}
