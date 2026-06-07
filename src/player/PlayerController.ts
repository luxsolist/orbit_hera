import * as THREE from "three";
import type { Input } from "../core/Input";
import type { World } from "../world/World";
import { TERRAIN_HALF } from "../world/World";
import type { DroneSpec, DroneMove, JumpSpec, FlyMove } from "./DroneSpec";

const PITCH_LIMIT = Math.PI / 2 - 0.05;
const MOVE_MAX_STEP = 0.8; // 수평 이동 1스텝 최대 거리 — 고속(대시) 터널링 방지 서브스테핑
const ROLL_RATE = 6; // 비행 롤(뱅킹) 보간 응답속도
const CEIL_FALL_RATE = 2.5; // 지표면 상대 천장이 낮아질 때(고지대→저지대) 부드럽게 하강하는 응답속도
export const HARD_CEILING = 5000; // 절대 최고 고도(m) — 지표 무관, 어떤 기체/콘텐츠(항공모함 포함)도 이 위로 못 올라감
// 방향별 이동속도 배수(시선 기준) — 전진 1.0 / 옆 0.85 / 후진 0.6. 무한 백페달 카이팅 억제.
const STRAFE_MULT = 0.85, BACK_MULT = 0.6;

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

export const MERCY_INVULN = 0.6; // 피격 후 무적 시간(s) — 연속 흡수 데미지 완화

/**
 * 피해 적용 순수 전이 — 머시 무적(invuln>0) 또는 사망(hp<=0) 중이면 무시(applied:false, 상태 불변).
 * 적용 시 hp 를 0 하한으로 차감하고 무적을 MERCY_INVULN 으로 충전. applied 는 적 회복·HUD 게이트.
 */
export function applyDamage(hp: number, invuln: number, amount: number): { hp: number; invuln: number; applied: boolean } {
  if (invuln > 0 || hp <= 0) return { hp, invuln, applied: false };
  return { hp: Math.max(0, hp - amount), invuln: MERCY_INVULN, applied: true };
}

/**
 * 회복 적용 순수 전이 — 사망(hp<=0) 또는 비양수 회복이면 불변. 그 외엔 maxHp 한도로 가산.
 * (카이터 처치 환수 등 — 부활은 불가, 살아있을 때만 회복)
 */
export function applyHeal(hp: number, maxHp: number, amount: number): number {
  if (hp <= 0 || amount <= 0) return hp;
  return Math.min(maxHp, hp + amount);
}

/**
 * 최고 상승 고도(눈높이 기준) — 보행 점프·비행 천장 공통. 발밑 지표면(standY) + 기체별 상승
 * 한도(rise) + 눈높이(eye)를 더하고 절대 하드리밋(HARD_CEILING 5km)으로 클램프. standY 가
 * 위치마다 바뀌므로(고지대/저지대) 캡도 동적으로 조정된다.
 */
export function maxRiseAltitude(standY: number, rise: number, eye: number): number {
  return Math.min(HARD_CEILING, standY + rise + eye);
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

  private invuln = 0;

  constructor(
    private input: Input,
    private world: World,
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

  /** 시점 yaw(라디안). 미니맵 회전·후방 카메라 방향 산출에 사용 */
  get viewYaw(): number {
    return this.yaw;
  }

  /** 카메라가 바라보는 정규화 방향 */
  getAimDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(target);
  }

  /** 피해 적용. 머시 무적/사망 중엔 무시. 반환: 실제 적용 여부(접촉 시 적 회복·HUD 연출 게이트). */
  takeDamage(amount: number): boolean {
    const r = applyDamage(this.hp, this.invuln, amount);
    this.hp = r.hp;
    this.invuln = r.invuln;
    return r.applied;
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  /** 체력 회복(최대치 한도). 사망 시 무시 — 카이터 처치 환수 등. */
  heal(amount: number): void {
    this.hp = applyHeal(this.hp, this.maxHp, amount);
  }

  /** 빔 발사 시 주파수 소모. 충분치 않으면 false */
  spendFrequency(amount: number): boolean {
    if (this.freq < amount) return false;
    this.freq -= amount;
    return true;
  }

  update(dt: number) {
    if (this.invuln > 0) this.invuln -= dt;
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
    if (wishH.lengthSq() > 0) wishH.normalize();

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
      const f3x = -Math.sin(this.yaw) * cp, f3y = sp, f3z = -Math.cos(this.yaw) * cp;
      const fb = (this.input.isDown("KeyW") ? 1 : 0) - (this.input.isDown("KeyS") ? 1 : 0);
      const lr = (this.input.isDown("KeyD") ? 1 : 0) - (this.input.isDown("KeyA") ? 1 : 0);
      let mvx = f3x * fb + rightH.x * lr, mvy = f3y * fb, mvz = f3z * fb + rightH.z * lr;
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
    this.position.y = Math.min(this.position.y, HARD_CEILING); // 절대 하드리밋(5km) — 모든 기체 공통

    // --- 주파수 재충전 --- (특수 무기 발동 중에는 외부에서 억제)
    if (!this.freqRegenSuppressed) {
      this.freq = Math.min(this.maxFreq, this.freq + this.spec.vitals.freqRegen * dt);
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
    const lim = TERRAIN_HALF - 4;
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
    const target = lookClimb + (up - down) * move.verticalSpeed;
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
    this._look.set(
      this.position.x - Math.sin(this.yaw) * Math.cos(this.pitch),
      this.position.y + Math.sin(this.pitch),
      this.position.z - Math.cos(this.yaw) * Math.cos(this.pitch)
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
}
