import * as THREE from "three";
import type { Input } from "../core/Input";
import type { World } from "../world/World";
import { TERRAIN_HALF } from "../world/World";
import type { DroneSpec, JumpSpec, FlyMove } from "./DroneSpec";

const PITCH_LIMIT = Math.PI / 2 - 0.05;
const MOVE_MAX_STEP = 0.8; // 수평 이동 1스텝 최대 거리 — 고속(대시) 터널링 방지 서브스테핑
const ROLL_RATE = 6; // 비행 롤(뱅킹) 보간 응답속도

/**
 * 수직 속도 1스텝 적분(보행 드론 점프/중력) — 상승: 정점까지 감속(riseGravity) /
 * 하강: 점점 빨라지다 종단속도(fallTerminal)로 일정 유지. 드론별 점프 스펙(j)을 받는다.
 */
export function stepVerticalVelocity(vy: number, dt: number, j: JumpSpec): number {
  if (vy > 0) return vy - j.riseGravity * dt; // 상승: 감속
  return Math.max(vy - j.fallGravity * dt, -j.fallTerminal); // 하강: 가속 후 종단 클램프
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
    const sp = this.world.spawn;
    this.position.set(sp.x, this.world.heightAt(sp.x, sp.z) + this.eye, sp.z);
    this.yaw = sp.yaw;
    this.syncCamera();
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

  takeDamage(amount: number) {
    if (this.invuln > 0 || this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = 0.6;
  }

  get isDead(): boolean {
    return this.hp <= 0;
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
      const spd = move.speed * this.input.moveScale; // 조이스틱 변위 비례 속도
      const t = 1 - Math.exp(-move.accel * dt);
      this.hVel.x += (mvx * spd - this.hVel.x) * t;
      this.hVel.z += (mvz * spd - this.hVel.z) * t;
      lookClimb = mvy * spd;
    } else {
      // 보행: 지상/공중 응답 구분
      const spd = move.speed * this.input.moveScale; // 조이스틱 변위 비례 속도
      const rate = this.grounded ? move.groundAccel : move.airAccel;
      const t = 1 - Math.exp(-rate * dt);
      this.hVel.x += (wishH.x * spd - this.hVel.x) * t;
      this.hVel.z += (wishH.z * spd - this.hVel.z) * t;
    }

    this.moveHorizontal(dt); // 서브스테핑 충돌 해소(고속 터널링 방지)

    // --- 수직(이동 형태별) ---
    if (move.mode === "walk") this.updateWalkVertical(dt, move.jump);
    else this.updateFlyVertical(dt, move, lookClimb);

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

    // 점프: 지상/코요테 점프 + 공중 재점프. 디딘 지면보다 maxRiseHeight 이상이면 추가 점프 금지.
    if (this.input.wasPressed("Space")) {
      const curFeetY = this.position.y - this.eye;
      const groundBelow = this.standSurfaceY(this.position.x, this.position.z, curFeetY);
      if (this.grounded || this.coyote > 0 || curFeetY - groundBelow < jump.maxRiseHeight) {
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
   * Shift 하강). 둘 다 없으면 0(호버). 지면(바닥)~천장(ceiling) 사이로 클램프.
   */
  private updateFlyVertical(dt: number, move: FlyMove, lookClimb: number) {
    const up = this.input.isDown("Space") ? 1 : 0;
    const down = this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight") ? 1 : 0;
    const target = lookClimb + (up - down) * move.verticalSpeed;
    const t = 1 - Math.exp(-move.accel * dt);
    this.velocityY += (target - this.velocityY) * t; // 목표 수직 속도로 가/감속(입력 없으면 0=호버)
    this.position.y += this.velocityY * dt;

    const feetY = this.position.y - this.eye;
    const standY = this.standSurfaceY(this.position.x, this.position.z, feetY);
    const floorY = standY + this.eye; // 지면 바로 위
    if (this.position.y < floorY) {
      this.position.y = floorY;
      if (this.velocityY < 0) this.velocityY = 0;
    }
    const ceilY = standY + move.ceiling + this.eye; // 지면 대비 최대 고도
    if (this.position.y > ceilY) {
      this.position.y = ceilY;
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
    const sp = this.world.spawn;
    this.position.set(sp.x, this.world.heightAt(sp.x, sp.z) + this.eye, sp.z);
    this.yaw = sp.yaw;
    this.pitch = 0;
    this.syncCamera();
  }
}
