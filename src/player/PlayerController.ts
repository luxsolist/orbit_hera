import * as THREE from "three";
import type { Input } from "../core/Input";
import type { GameWorld } from "../world/GameWorld";
import type { DroneSpec, DroneMove, JumpSpec, FlyMove } from "./DroneSpec";
import type { CoreEnemy } from "../enemies/CoreEnemy";
import { regenStep } from "./progression";

const PITCH_LIMIT = Math.PI / 2 - 0.05;
// 손맛 — 발사 반동 킥/피격 셰이크(시각 전용 카메라 오프셋, 실제 조준각 pitch/yaw 는 불변)
const RECOIL_DECAY = 14; // 반동 복귀 응답속도(클수록 빨리 제자리)
const SHAKE_DECAY = 9; // 셰이크 감쇠 응답속도
const RECOIL_MAX = 0.045; // 반동 상한(rad) — 연사 누적 폭주 방지
const SHAKE_MAX = 0.035; // 셰이크 상한(rad)
const MOVE_MAX_STEP = 0.8; // 수평 이동 1스텝 최대 거리 — 고속(대시) 터널링 방지 서브스테핑
const ROLL_RATE = 6; // 비행 롤(뱅킹) 보간 응답속도
const CEIL_FALL_RATE = 2.5; // 지표면 상대 천장이 낮아질 때(고지대→저지대) 부드럽게 하강하는 응답속도
// 락온 자동 추적 파라미터
export const LOCK_FOLLOW_DIST = 50;  // 유지할 목표 거리(m)
export const LOCK_BAND = 8;          // 히스테리시스 밴드 반폭(m) — 이 안에선 수평 이동 없음(호버)
export const LOCK_VERTICAL_DEAD = 5; // 수직 추적 데드밴드(m) — 이 안에선 수직 이동 없음
export const HARD_CEILING = 5000; // 발밑 지면 위 최대 고도(m) — 어떤 기체도 지면 +5km 위로 못 올라감(지면 상대라 고지대 지형 8km↑ 에서도 작동, 절대 Y 아님)
// 방향별 이동속도 배수(시선 기준) — 전진 1.0 / 옆 0.85 / 후진 0.6. 무한 백페달 카이팅 억제.
const STRAFE_MULT = 0.85, BACK_MULT = 0.6;

/**
 * 락온 자동 추적 수평 wish 방향 계산 — 순수 함수.
 * 플레이어(px,pz)에서 대상(tx,tz)까지 수평 거리 기반으로 접근/정지/후퇴 방향 반환.
 * - dist > followDist + band → 접근(+방향 단위벡터)
 * - dist < followDist - band → 후퇴(−방향 단위벡터)
 * - 밴드 안 → 영벡터(정지, hVel 관성 감속)
 * @returns {x, z} 단위벡터 또는 영벡터(정지)
 */
export function lockOnWishH(
  px: number, pz: number,
  tx: number, tz: number,
  followDist = LOCK_FOLLOW_DIST,
  band = LOCK_BAND,
): { x: number; z: number } {
  const dx = tx - px, dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return { x: 0, z: 0 };
  if (dist > followDist + band) return { x: dx / dist, z: dz / dist };       // 접근
  if (dist < followDist - band) return { x: -dx / dist, z: -dz / dist };     // 후퇴
  return { x: 0, z: 0 };                                                       // 밴드 내 정지
}

/**
 * 락온 수직 추적 목표 속도 계산 — 순수 함수.
 * 대상 y와 플레이어 y 차(dy)가 데드밴드 밖이면 비례 추력을 반환(최대 maxSpeed의 60%).
 * 데드밴드 안이면 0(호버).
 */
export function lockOnVerticalTarget(
  playerY: number, targetY: number,
  maxSpeed: number,
  dead = LOCK_VERTICAL_DEAD,
): number {
  const dy = targetY - playerY;
  if (Math.abs(dy) <= dead) return 0;
  return Math.sign(dy) * Math.min(maxSpeed * 0.6, Math.abs(dy) * 1.5);
}

/**
 * 시선 방향 기준 조준 콘 안에서 가장 정렬된 후보 인덱스를 반환 — 순수 함수.
 * EnemyManager.bestTargetInView 의 기하 코어. THREE 비의존({x,y,z}).
 * @returns 후보 배열 인덱스, 없으면 -1
 */
export function bestAlignedInCone(
  origin: { x: number; y: number; z: number },
  aimDir: { x: number; y: number; z: number },
  positions: ReadonlyArray<{ x: number; y: number; z: number }>,
  coneDeg: number,
  maxDist = Infinity,
): number {
  const coneCos = Math.cos(coneDeg * (Math.PI / 180));
  let bestIdx = -1, bestCos = -Infinity;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-3 || dist > maxDist) continue; // 거리 상한(락온 획득 사거리) 밖 제외
    const cos = (dx * aimDir.x + dy * aimDir.y + dz * aimDir.z) / dist;
    if (cos < coneCos) continue;
    if (cos > bestCos) { bestCos = cos; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * 이동 방향(mx,mz)과 시선 수평벡터(fwd)의 정렬도로 속도 배수 산출 — 순수 함수.
 * 전진(정렬 1)=1.0, 옆(0)=STRAFE_MULT, 후진(-1)=BACK_MULT. 입력 없으면 1.
 */
export function dirSpeedMult(mx: number, mz: number, fwd: { x: number; z: number }): number {
  const len = Math.hypot(mx, mz);
  if (len < 1e-6) return 1;
  const dot = (mx * fwd.x + mz * fwd.z) / len; // -1..1
  return dot >= 0 ? STRAFE_MULT + (1 - STRAFE_MULT) * dot : STRAFE_MULT + (STRAFE_MULT - BACK_MULT) * dot;
}

/**
 * 비행 이동 방향(3D, 정규화 전) 계산 — 순수 함수.
 * 수동 입력(fb 전후 / lr 좌우)이 있으면 시선 기준 3D 이동(f3=피치 포함 전방, rightH=수평 우측).
 * 수동 입력이 전혀 없고 락온 wish(lockWishH)가 주어지면 수평 자동 전진(접근/후퇴) — 수직은 별도 처리.
 * @returns 정규화 전 이동 벡터 {x,y,z}
 */
export function flyMoveDir(
  fb: number, lr: number,
  f3: { x: number; y: number; z: number },
  rightH: { x: number; z: number },
  lockWishH: { x: number; z: number } | null,
): { x: number; y: number; z: number } {
  let mvx = f3.x * fb + rightH.x * lr;
  const mvy = f3.y * fb;
  let mvz = f3.z * fb + rightH.z * lr;
  if (fb === 0 && lr === 0 && lockWishH) { mvx = lockWishH.x; mvz = lockWishH.z; } // 입력 없음 + 락온 → 수평 추적
  return { x: mvx, y: mvy, z: mvz };
}

/**
 * 수직 속도 1스텝 적분(보행 드론 점프/중력) — 상승: 정점까지 감속(riseGravity) /
 * 하강: 점점 빨라지다 종단속도(fallTerminal)로 일정 유지. 드론별 점프 스펙(j)을 받는다.
 */
export function stepVerticalVelocity(vy: number, dt: number, j: JumpSpec): number {
  if (vy > 0) return vy - j.riseGravity * dt; // 상승: 감속
  return Math.max(vy - j.fallGravity * dt, -j.fallTerminal); // 하강: 가속 후 종단 클램프
}

/**
 * 스폰 시 지면 대비 시작 높이(m). 비행: spawnHeight(공중 투입)를 비행 천장(ceiling) 내로 클램프 /
 * 보행: 시점 높이(eye)로 지면에 디딤. world spawn 의 x/z 위에 이 값을 더해 배치한다.
 */
export function spawnHeightAboveGround(move: DroneMove, eye: number): number {
  return move.mode === "fly" ? Math.min(move.spawnHeight, move.ceiling) : eye;
}

/**
 * 피해 적용 순수 전이 — 무적(invuln>0) 또는 사망(hp<=0) 중이면 무시(applied:false, 상태 불변).
 * 적용해도 **무적을 충전하지 않는다**. applied 는 적 성장·연출·HUD 게이트를 함께 연다.
 *
 * ⚠ 머시 무적(피격 후 0.6초) 폐지(2026-08-26). 그 창이 있으면 **개체 수가 난이도 레버로 작동하지
 * 않았다**: 초당 최대 1/0.6 = 1.67 대만 맞으므로 들어오는 피해가 `한 대 / 0.6` 으로 고정된다.
 * 실측 — 모기를 2기에서 32기로 16배 늘려도 3.31 → 4.94 dps(흡수율 45%→92%). 게다가 작은 피해가
 * 큰 피해를 막아 줬다(드레인 3 을 맞으면 직후의 파문 18 이 통째로 흡수). 흡수된 피격은 연출까지
 * 함께 사라져("공격을 안 하는 것 같다"의 직접 원인) 무슨 일이 일어나는지도 읽히지 않았다.
 *
 * invuln 자체는 남는다 — **리스폰 보호**(respawn(protectSec))가 같은 필드를 쓴다. 부활 직후
 * 적에 둘러싸여 즉사하는 것만은 막아야 한다.
 */
export function applyDamage(hp: number, invuln: number, amount: number): { hp: number; invuln: number; applied: boolean } {
  if (invuln > 0 || hp <= 0) return { hp, invuln, applied: false };
  return { hp: Math.max(0, hp - amount), invuln, applied: true };
}

/**
 * 회복 적용 순수 전이 — 사망(hp<=0) 또는 비양수 회복이면 불변. 그 외엔 maxHp 한도로 가산.
 * (카이터 처치 환수 등 — 부활은 불가, 살아있을 때만 회복)
 */
export function applyHeal(hp: number, maxHp: number, amount: number): number {
  if (hp <= 0 || amount <= 0) return hp;
  return Math.min(maxHp, hp + amount);
}

/** 위치·HP 이력 1표본 — 링크 리와인드(자가 §2.8.3)의 링버퍼 표본. */
export interface PosHpSample { t: number; x: number; y: number; z: number; hp: number }

/**
 * 이력 조회 — posClock 기준 sec 초 전 이하의 가장 최근 표본(없으면 가장 오래된 표본, 이력이 아예
 * 없으면 null). 시간 역순 탐색 없이 오름차순 이력을 앞에서부터 훑다 넘어가는 지점에서 멈춘다. 순수.
 */
export function historyLookup(history: readonly PosHpSample[], posClock: number, sec: number): PosHpSample | null {
  const target = posClock - sec;
  let best: PosHpSample | null = null;
  for (const s of history) {
    if (s.t <= target) best = s;
    else break;
  }
  if (!best && history.length) best = history[0];
  return best;
}

/** 링크 리와인드(§2.8.3) 시전 가능 여부 — 사망/쿨다운/게이지 부족이면 false. 순수 게이트. */
export function canCastLinkRewind(hp: number, freq: number, cooldownLeft: number, freqCost: number): boolean {
  return hp > 0 && cooldownLeft <= 0 && freq >= freqCost;
}

/**
 * 최고 상승 고도(눈높이 기준) — 보행 점프·비행 천장 공통. 발밑 지표면(standY) + 기체별 상승
 * 한도(rise) + 눈높이(eye)를 더하고 절대 하드리밋(HARD_CEILING 5km)으로 클램프. standY 가
 * 위치마다 바뀌므로(고지대/저지대) 캡도 동적으로 조정된다.
 */
export function maxRiseAltitude(standY: number, rise: number, eye: number): number {
  return standY + Math.min(rise, HARD_CEILING) + eye; // 지면 상대(고지대 지형서도 지면 위로 상승 가능). 상승 마진은 +5km 로 제한.
}

/**
 * FPS 컨트롤러 — 데이터 구동 전투 드론. DroneSpec(JSON)으로 이동 형태(보행/비행)·기체 치수·
 * 바이탈·시야·대시를 설정한다. 보행: 지면/중력/점프, 비행: 무중력 호버 + 수직 추력 + 천장.
 * 카메라가 곧 현재 링크된 드론의 시점. 새 드론은 DroneSpec(JSON) 추가만으로 도입.
 */
export class PlayerController {
  readonly camera: THREE.PerspectiveCamera;
  readonly spec: DroneSpec;

  private yaw = 0;
  private pitch = 0;
  private velocityY = 0;
  private grounded = true;
  private roll = 0; // 비행 드론 좌우 이동 뱅킹(카메라 롤, rad)
  private position = new THREE.Vector3();
  private readonly eye: number; // 시점 높이(spec.body.eyeHeight)
  private readonly radius: number; // 충돌 반경(spec.body.radius)

  // 수평 운동량 / 대시 상태
  private hVel = new THREE.Vector3();
  private coyote = 0;
  private dashTime = 0;
  private dashCooldown = 0;
  private dashDir = new THREE.Vector3();
  // 매 프레임 재사용 임시 벡터
  private _fwd = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _wish = new THREE.Vector3();
  private _look = new THREE.Vector3();

  // 상태값(HUD 연동) — 스펙에서 초기화
  maxHp: number;
  hp: number;
  maxFreq: number;
  freq: number;
  /** 특수 무기 등에서 자연 회복을 잠시 막아야 할 때 true */
  freqRegenSuppressed = false;
  /** 게이지 회복 배수(미션 변조 freqRegenMul — "옅은 장", 06-missions 훅 ⑥). Game 이 출격마다 지정. */
  freqRegenMul = 1;
  /** HP 재생(§7.4 진행 성장 — 출격 시점 스냅샷). 피격 후 REGEN_DELAY 지나야 회복. */
  hpRegen = 0;
  private sinceHit = Infinity;
  // 위치·HP 이력 링(적측 §6.6 역행체 + 자가 §2.8.3 링크 리와인드가 공유) — 시전 시 수 초 전으로 되돌린다.
  private posHistory: PosHpSample[] = [];
  private posClock = 0;
  private posSampleCd = 0;
  private linkRewindCd = 0; // 링크 리와인드 쿨다운 잔여(s)
  /** 링크 리와인드 시전 통지 — revivedBuildings = 함께 되돌아온 건물/랜드마크 수(HUD 연출 게이트). */
  onLinkRewind?: (revivedBuildings: number) => void;

  private invuln = 0;
  private recoil = 0; // 발사 반동(시각 피치 오프셋, rad) — kick() 충전, 지수 복귀
  private shakeAmp = 0; // 피격/파문 셰이크 진폭(rad) — shake() 충전, 지수 감쇠

  // 교전 구역 — 미션 인스턴스가 설정. 이 원(중심 zoneCx/zoneCz, 반경 zoneRadius) 밖으로 못 나간다.
  private zoneCx = 0;
  private zoneCz = 0;
  private zoneRadius = 0; // 0 = 구역 제한 없음

  // 락온 자동 추적
  private _lockOnTarget: CoreEnemy | null = null;

  constructor(
    private input: Input,
    private world: GameWorld,
    aspect: number,
    spec: DroneSpec
  ) {
    this.spec = spec;
    this.eye = spec.body.eyeHeight;
    this.radius = spec.body.radius;
    this.maxHp = spec.vitals.maxHp;
    this.hp = spec.vitals.maxHp;
    this.maxFreq = spec.vitals.maxFreq;
    this.freq = spec.vitals.maxFreq;

    this.camera = new THREE.PerspectiveCamera(spec.view.fov, aspect, 0.1, 8000);
    this.placeAtSpawn();
    this.syncCamera();
  }

  /**
   * 맵 고유 스폰(x/z/yaw)에 배치. 비행 드론은 지면 대비 spawnHeight(m) 상공에 투입,
   * 보행 드론은 지면(eye) 높이에 디딘다. 시작 고도는 디딘 지면 위로 비행 천장(ceiling) 내로 제한.
   */
  private placeAtSpawn() {
    const sp = this.world.spawn;
    const ground = this.world.heightAt(sp.x, sp.z);
    this.position.set(sp.x, ground + spawnHeightAboveGround(this.spec.move, this.eye), sp.z);
    this.yaw = sp.yaw;
  }

  get worldPosition(): THREE.Vector3 {
    return this.position;
  }

  /** 연결된 전장(충돌/건물 질의). 빔 시야 차폐(건물 통과 차단)에서 사용. */
  get gameWorld(): GameWorld {
    return this.world;
  }

  /** 시점 yaw(라디안). 미니맵 회전·후방 카메라 방향 산출에 사용 */
  get viewYaw(): number {
    return this.yaw;
  }

  /** 카메라가 바라보는 정규화 방향 */
  getAimDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(target);
  }

  /** 성장 적용(§7.4) — 출격 시작 시 1회(Game). 최대 HP 가산(만충 유지) + 재생률 지정. */
  applyGrowth(g: { hpBonus: number; hpRegen: number }): void {
    this.maxHp += g.hpBonus;
    this.hp = this.maxHp;
    this.hpRegen = g.hpRegen;
  }

  /** 피해 적용. 머시 무적/사망 중엔 무시. 반환: 실제 적용 여부(접촉 시 적 회복·HUD 연출 게이트). */
  takeDamage(amount: number): boolean {
    const r = applyDamage(this.hp, this.invuln, amount);
    this.hp = r.hp;
    this.invuln = r.invuln;
    if (r.applied) this.sinceHit = 0; // 재생 정지 리셋 — 교전 중엔 회복 안 됨(§7.4)
    return r.applied;
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  /** 체력 회복(최대치 한도). 사망 시 무시 — 카이터 처치 환수 등. */
  heal(amount: number): void {
    this.hp = applyHeal(this.hp, this.maxHp, amount);
  }

  /** 발사 반동 킥 — 카메라가 위로 살짝 튕겼다 복귀(시각 전용). 수동 사격·특수 발동감. */
  kick(rad: number): void {
    this.recoil = Math.min(RECOIL_MAX, this.recoil + rad);
  }

  /** 카메라 셰이크 — 피격·파문 통과 등 임팩트 순간의 미세 흔들림(시각 전용). */
  shake(amp: number): void {
    this.shakeAmp = Math.min(SHAKE_MAX, this.shakeAmp + amp);
  }

  /** 빔 발사 시 주파수 소모. 충분치 않으면 false */
  spendFrequency(amount: number): boolean {
    if (this.freq < amount) return false;
    this.freq -= amount;
    return true;
  }

  update(dt: number) {
    if (this.invuln > 0) this.invuln -= dt;
    // 반동/셰이크 지수 감쇠 — dt 0(히트스톱)이면 유지(정지 프레임 동안 시각도 정지)
    if (this.recoil > 1e-5) this.recoil *= Math.exp(-RECOIL_DECAY * dt);
    else this.recoil = 0;
    if (this.shakeAmp > 1e-5) this.shakeAmp *= Math.exp(-SHAKE_DECAY * dt);
    else this.shakeAmp = 0;
    const move = this.spec.move;

    // --- 시점 회전 ---
    const { dx, dy } = this.input.consumeMouse();
    this.yaw -= dx * this.spec.view.mouseSensitivity;
    this.pitch -= dy * this.spec.view.mouseSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);

    // --- 수평 의도(yaw 평면) — 대시 방향 + 보행 이동 ---
    const fwdH = this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rightH = this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wishH = this._wish.set(0, 0, 0);
    if (this.input.isDown("KeyW")) wishH.add(fwdH);
    if (this.input.isDown("KeyS")) wishH.sub(fwdH);
    if (this.input.isDown("KeyD")) wishH.add(rightH);
    if (this.input.isDown("KeyA")) wishH.sub(rightH);

    // 락온 대상이 죽었으면 자동 해제
    if (this._lockOnTarget && this._lockOnTarget.state !== "alive") {
      this._lockOnTarget = null;
    }

    if (wishH.lengthSq() > 0) {
      wishH.normalize(); // 수동 입력 우선 — 락온 추적 무시
    } else if (this._lockOnTarget) {
      // 수동 입력 없음 + 락온 중 → 드론 스펙 lockOn 파라미터 우선, 없으면 모듈 기본값
      const lo = this.spec.lockOn;
      const tp = this._lockOnTarget.group.position;
      const w = lockOnWishH(
        this.position.x, this.position.z, tp.x, tp.z,
        lo?.followDist ?? LOCK_FOLLOW_DIST,
        lo?.band ?? LOCK_BAND,
      );
      wishH.set(w.x, 0, w.z);
    }

    // --- 회피 대시(평면 버스트) — 스펙에 dash 가 있는 드론만(보행). 비행은 dash 없음 → Shift=하강 ---
    const dash = this.spec.dash;
    if (dash) {
      if (this.dashCooldown > 0) this.dashCooldown -= dt;
      const dashKey = this.input.wasPressed("ShiftLeft") || this.input.wasPressed("ShiftRight");
      if (dashKey && this.dashCooldown <= 0) {
        this.dashDir.copy(wishH.lengthSq() > 0 ? wishH : fwdH).normalize();
        this.dashTime = dash.duration;
        this.dashCooldown = dash.cooldown;
      }
    }

    // --- 수평 속도 결정 ---
    let lookClimb = 0; // 비행: 시선(피치) 방향 전후 이동에서 나오는 수직 성분
    if (dash && this.dashTime > 0) {
      this.dashTime -= dt;
      this.hVel.copy(this.dashDir).multiplyScalar(dash.speed); // 대시 중 운동량 덮어씀(평면)
    } else if (move.mode === "fly") {
      // 시선 방향(피치 포함) 전후 + 수평 스트레이프 → 위/아래를 보고 전진하면 자연스럽게 상승/하강.
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const f3 = { x: -Math.sin(this.yaw) * cp, y: sp, z: -Math.cos(this.yaw) * cp };
      const fb = (this.input.isDown("KeyW") ? 1 : 0) - (this.input.isDown("KeyS") ? 1 : 0);
      const lr = (this.input.isDown("KeyD") ? 1 : 0) - (this.input.isDown("KeyA") ? 1 : 0);
      // 수동 입력 없음 + 락온 중 → 락온 수평 wish(접근/후퇴)로 자동 전진. 수직은 updateFlyVertical 담당.
      const mv = flyMoveDir(fb, lr, f3, rightH, this._lockOnTarget ? wishH : null);
      let mvx = mv.x, mvy = mv.y, mvz = mv.z;
      const ml = Math.hypot(mvx, mvy, mvz);
      if (ml > 1e-6) { mvx /= ml; mvy /= ml; mvz /= ml; } // 3D 단위 → 방향 무관 동일 최고속
      const spd = move.speed * this.input.moveScale * dirSpeedMult(mvx, mvz, fwdH); // 방향별 속도(후진 페널티)
      const t = 1 - Math.exp(-move.accel * dt);
      this.hVel.x += (mvx * spd - this.hVel.x) * t;
      this.hVel.z += (mvz * spd - this.hVel.z) * t;
      lookClimb = mvy * spd;
    } else {
      // 보행: 지상/공중 응답 구분
      const spd = move.speed * this.input.moveScale * dirSpeedMult(wishH.x, wishH.z, fwdH); // 방향별 속도(후진 페널티)
      const rate = this.grounded ? move.groundAccel : move.airAccel;
      const t = 1 - Math.exp(-rate * dt);
      this.hVel.x += (wishH.x * spd - this.hVel.x) * t;
      this.hVel.z += (wishH.z * spd - this.hVel.z) * t;
    }

    this.moveHorizontal(dt); // 서브스테핑 충돌 해소(고속 터널링 방지)

    // --- 수직(이동 형태별) ---
    if (move.mode === "walk") this.updateWalkVertical(dt, move.jump);
    else this.updateFlyVertical(dt, move, lookClimb);
    // 하드리밋 — 발밑 지면 +5km(지면 상대, 고지대 지형 대응). 비행 천장(maxRiseAltitude)보다 위의 백스톱.
    this.position.y = Math.min(this.position.y, this.world.heightAt(this.position.x, this.position.z) + HARD_CEILING + this.eye);

    // --- 주파수 재충전 --- (특수 무기 발동 중에는 외부에서 억제, 옅은 장 변조는 배수)
    if (!this.freqRegenSuppressed) {
      this.freq = Math.min(this.maxFreq, this.freq + this.spec.vitals.freqRegen * this.freqRegenMul * dt);
      // HP 재생(§7.4) — 피격 후 REGEN_DELAY 경과 시에만(지속 교전 중엔 회복 불가)
      this.sinceHit += dt;
      this.hp = regenStep(this.hp, this.maxHp, this.hpRegen, this.sinceHit, dt);
      // 위치·HP 이력(역행체 대응 + 링크 리와인드) — 0.1s 간격 샘플, 8s 보존
      this.posClock += dt;
      this.posSampleCd -= dt;
      if (this.posSampleCd <= 0) {
        this.posSampleCd = 0.1;
        this.posHistory.push({ t: this.posClock, x: this.position.x, y: this.position.y, z: this.position.z, hp: this.hp });
        while (this.posHistory.length && this.posHistory[0].t < this.posClock - 8) this.posHistory.shift();
      }
    }

    // 링크 리와인드(§2.8.3) — 자가 시전. 드론 미보유/사망/쿨다운/게이지 부족이면 무시.
    if (this.linkRewindCd > 0) this.linkRewindCd -= dt;
    const lr = this.spec.linkRewind;
    if (lr && this.input.wasPressed("KeyR") && canCastLinkRewind(this.hp, this.freq, this.linkRewindCd, lr.freqCost)) {
      this.freq -= lr.freqCost;
      this.linkRewindCd = lr.cooldown;
      const at = historyLookup(this.posHistory, this.posClock, lr.rewindSec);
      if (at) {
        this.position.set(at.x, at.y, at.z);
        this.hp = Math.min(this.maxHp, at.hp);
      }
      const revived = this.world.buildings?.undoDestructionNear(this.position.x, this.position.z, lr.radius, lr.rewindSec) ?? 0;
      this.onLinkRewind?.(revived);
    }

    this.syncCamera();
  }

  /** 수평 이동 — hVel 을 MOVE_MAX_STEP 이하 스텝으로 나눠 각 스텝마다 충돌 해소(고속 터널링 방지). */
  private moveHorizontal(dt: number) {
    const dxTotal = this.hVel.x * dt;
    const dzTotal = this.hVel.z * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(dxTotal, dzTotal) / MOVE_MAX_STEP));
    const stepX = dxTotal / steps;
    const stepZ = dzTotal / steps;
    const lim = this.world.bounds - 4;
    const feetY = this.position.y - this.eye; // 수평 이동 동안 발 높이 불변(수직은 이후)
    for (let i = 0; i < steps; i++) {
      const bx = THREE.MathUtils.clamp(this.position.x + stepX, -lim, lim);
      const bz = THREE.MathUtils.clamp(this.position.z + stepZ, -lim, lim);
      this.position.x = bx;
      this.position.z = bz;

      // 장애물(바위/건물/담장) 통과 불가. feetY 가 윗면 이상이면 디딘 것으로 보고 통과(올라서기/넘기).
      const resolved = this.world.resolveCollision(bx, bz, this.radius, feetY);
      if (resolved.x !== bx || resolved.z !== bz) {
        const nx = resolved.x - bx;
        const nz = resolved.z - bz;
        const nLen = Math.hypot(nx, nz);
        if (nLen > 1e-6) {
          const ux = nx / nLen;
          const uz = nz / nLen;
          const into = this.hVel.x * ux + this.hVel.z * uz; // 파고드는 성분만 제거(접선 슬라이드 유지)
          if (into < 0) {
            this.hVel.x -= into * ux;
            this.hVel.z -= into * uz;
          }
        }
        this.position.x = resolved.x;
        this.position.z = resolved.z;
      }
    }
    this.clampToZone(); // 미션 교전 구역 경계(원) 안으로 제한
  }

  /** 보행: 점프(상한 게이트) + 중력(상승 감속/하강 종단) + 착지. */
  private updateWalkVertical(dt: number, jump: JumpSpec) {
    if (this.grounded) this.coyote = jump.coyoteTime;
    else if (this.coyote > 0) this.coyote -= dt;

    // 점프: 지상/코요테 점프 + 공중 재점프. 지표면 상대 상한(비행 천장과 공통 함수) 미만에서만 추가 점프 허용.
    if (this.input.wasPressed("Space")) {
      const curFeetY = this.position.y - this.eye;
      const groundBelow = this.standSurfaceY(this.position.x, this.position.z, curFeetY);
      if (this.grounded || this.coyote > 0 || this.position.y < maxRiseAltitude(groundBelow, jump.maxRiseHeight, this.eye)) {
        this.velocityY = jump.velocity;
        this.grounded = false;
        this.coyote = 0;
      }
    }

    const prevFeetY = this.position.y - this.eye; // 중력 적용 전 발 위치(착지 인정용)
    this.velocityY = stepVerticalVelocity(this.velocityY, dt, jump);
    this.position.y += this.velocityY * dt;

    const groundY = this.standSurfaceY(this.position.x, this.position.z, prevFeetY) + this.eye;
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.velocityY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }

  /**
   * 비행: 무중력 호버. 수직 속도 = 시선 방향 전진 성분(lookClimb) + 호버 추력 버튼(Space 상승 /
   * Shift 하강). 둘 다 없으면 0(호버). 바닥/천장은 모두 **발밑 지표면 상대**(standSurfaceY 기준):
   * 1km 절벽 위에선 천장 +ceiling(1.3km), 해수면 위에선 0.3km. 매 프레임 (x,z)에서 재계산 →
   * 수평 이동·동적 맵 로딩 시 고저차가 자동 반영. 고지대→저지대로 캡이 낮아질 땐 부드럽게 하강.
   */
  private updateFlyVertical(dt: number, move: FlyMove, lookClimb: number) {
    const up = this.input.isDown("Space") ? 1 : 0;
    // 하강: Shift(좌/우) + 대체키 C — Shift+WASD 키보드 고스팅(N-key rollover) 회피용
    const down = this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight") || this.input.isDown("KeyC") ? 1 : 0;
    let target = lookClimb + (up - down) * move.verticalSpeed;
    // 락온 + 수직 입력 없음 → 대상 수직 거리 유지(순수 함수 재사용)
    if (up === 0 && down === 0 && this._lockOnTarget && this._lockOnTarget.state === "alive") {
      target = lockOnVerticalTarget(this.position.y, this._lockOnTarget.group.position.y, move.verticalSpeed);
    }
    const t = 1 - Math.exp(-move.accel * dt);
    this.velocityY += (target - this.velocityY) * t; // 목표 수직 속도로 가/감속(입력 없으면 0=호버)
    this.position.y += this.velocityY * dt;

    const feetY = this.position.y - this.eye;
    const standY = this.standSurfaceY(this.position.x, this.position.z, feetY);
    const floorY = standY + this.eye + (move.minAltitude ?? 0); // 지면 + 비행 하한(지상 안전지대 차단)
    if (this.position.y < floorY) {
      this.position.y = floorY;
      if (this.velocityY < 0) this.velocityY = 0;
    }
    const ceilY = maxRiseAltitude(standY, move.ceiling, this.eye); // 지표면 상대 천장(+절대 5km 캡) — 보행 점프와 공통
    if (this.position.y > ceilY) {
      // 캡 초과(고지대→저지대 이동 등) — 즉시 스냅 대신 부드럽게 하강(다이나믹 고도 캡)
      const k = 1 - Math.exp(-CEIL_FALL_RATE * dt);
      this.position.y += (ceilY - this.position.y) * k;
      if (this.position.y - ceilY < 0.5) this.position.y = ceilY; // 근접 시 안착
      if (this.velocityY > 0) this.velocityY = 0;
    }
    this.grounded = this.position.y <= floorY + 0.02;

    // 좌우 이동 → 롤(뱅킹). 측면 속도(_right 성분)에 비례, 부드럽게 보간.
    const lateral = this.hVel.x * this._right.x + this.hVel.z * this._right.z;
    const maxRoll = THREE.MathUtils.degToRad(move.rollDeg);
    const rollTarget = -THREE.MathUtils.clamp(lateral / move.speed, -1, 1) * maxRoll;
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-ROLL_RATE * dt));
  }

  /**
   * (x,z)에서 발(feetY) 아래의 디딜 수 있는 가장 높은 면 — 지형(heightAt) 또는 발 아래의
   * 바위/건물 옥상(topAt). 점프 상한·착지·비행 바닥 기준에 공통 사용(일관성 보장).
   */
  private standSurfaceY(x: number, z: number, feetY: number): number {
    const terrain = this.world.heightAt(x, z);
    const top = this.world.topAt(x, z);
    return top > terrain && feetY >= top - 0.05 ? top : terrain;
  }

  private syncCamera() {
    this.camera.position.copy(this.position);
    // 시각 전용 오프셋 — 반동(위로 킥) + 셰이크(무작위 지터). 조준 상태(yaw/pitch)는 불변.
    const vp = THREE.MathUtils.clamp(
      this.pitch + this.recoil + (Math.random() - 0.5) * this.shakeAmp, -PITCH_LIMIT, PITCH_LIMIT);
    const vy = this.yaw + (Math.random() - 0.5) * this.shakeAmp;
    this._look.set(
      this.position.x - Math.sin(vy) * Math.cos(vp),
      this.position.y + Math.sin(vp),
      this.position.z - Math.cos(vy) * Math.cos(vp)
    );
    this.camera.lookAt(this._look);
    if (this.roll) this.camera.rotateZ(this.roll); // 비행 뱅킹(보행은 roll=0 → 무효과)
  }

  reset() {
    this.hp = this.maxHp;
    this.freq = this.maxFreq;
    this.velocityY = 0;
    this.invuln = 0;
    this.hVel.set(0, 0, 0);
    this.grounded = true;
    this.roll = 0;
    this.coyote = 0;
    this.dashTime = 0;
    this.dashCooldown = 0;
    this.placeAtSpawn();
    this.pitch = 0;
    this.syncCamera();
  }

  /** 인스턴스 리스폰 — 스폰 지점으로 복귀 + 짧은 무적(접촉 즉사 방지). 적/미션은 그대로 진행. */
  respawn(protectSec = 1.5) {
    this.reset();
    this.invuln = protectSec;
  }

  /** 교전 구역 설정(미션 인스턴스). radius≤0 이면 제한 해제. 중심 미지정 시 현재 위치(=스폰) 기준. */
  setZone(radius: number, cx = this.position.x, cz = this.position.z) {
    this.zoneRadius = radius > 0 ? radius : 0;
    this.zoneCx = cx;
    this.zoneCz = cz;
  }

  clearZone() {
    this.zoneRadius = 0;
  }

  /** 락온 대상 설정/해제. null 이면 자동 추적 비활성. */
  setLockOn(target: CoreEnemy | null): void {
    this._lockOnTarget = target;
  }

  /** 현재 락온 대상(없으면 null). */
  get lockOnTarget(): CoreEnemy | null {
    return this._lockOnTarget;
  }

  /** 작전구역(월드 중심·반경) — 미니맵 경계 표시용. 구역 없으면 null. */
  get zone(): { cx: number; cz: number; radius: number } | null {
    return this.zoneRadius > 0 ? { cx: this.zoneCx, cz: this.zoneCz, radius: this.zoneRadius } : null;
  }

  /** 구역 밖이면 경계 안으로 되돌리고, 밖으로 파고드는 수평 속도를 제거(경계를 벽처럼). */
  private clampToZone() {
    if (this.zoneRadius <= 0) return;
    const dx = this.position.x - this.zoneCx;
    const dz = this.position.z - this.zoneCz;
    const d = Math.hypot(dx, dz);
    if (d <= this.zoneRadius || d < 1e-6) return;
    const ux = dx / d, uz = dz / d; // 중심→밖 단위벡터
    this.position.x = this.zoneCx + ux * this.zoneRadius;
    this.position.z = this.zoneCz + uz * this.zoneRadius;
    const into = this.hVel.x * ux + this.hVel.z * uz; // 밖으로 향하는 성분만 제거(경계 슬라이드 유지)
    if (into > 0) {
      this.hVel.x -= into * ux;
      this.hVel.z -= into * uz;
    }
  }
}
