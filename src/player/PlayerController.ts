import * as THREE from "three";
import type { Input } from "../core/Input";
import type { World } from "../world/World";
import { TERRAIN_HALF } from "../world/World";

const EYE_HEIGHT = 2.2;
const WALK_SPEED = 26; // 목표 수평 속도(상향)
const GROUND_RATE = 18; // 지상 가감속 응답속도(클수록 즉각적 → 경쾌)
const AIR_RATE = 4.5; // 공중 응답속도(낮게 두어 관성 유지)

const GRAVITY = 46; // 중력(상향: 빠릿한 점프 아크)
const LOW_JUMP_MULT = 2.2; // 상승 중 스페이스를 떼면 적용되는 추가 중력(가변 점프 높이)
const JUMP_VELOCITY = 21.5; // 점프 정점 ≈ v²/(2·GRAVITY) = 5.0m (실제 높이 4m 궁장을 넘을 수 있게)
const AIR_JUMP_VELOCITY = 19; // 2단(공중) 점프 — 1단 상향에 맞춰 함께 상향
const MAX_AIR_JUMPS = 1; // 지상 점프 + 공중 점프 1회 = 총 2단
const COYOTE_TIME = 0.1; // 발판 이탈 직후에도 점프 허용되는 유예

// 회피 대시(버스트): 탭 시 이동 방향으로 순간 가속, 쿨다운 동안 재사용 불가
const DASH_SPEED = 64;
const DASH_DURATION = 0.16;
const DASH_COOLDOWN = 0.55;

const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

const PLAYER_RADIUS = 1.2; // 바위 충돌 판정용 수평 반경

/**
 * FPS 컨트롤러: Pointer Lock 마우스룩 + WASD + 점프/중력 + 대시.
 * 카메라가 곧 플레이어(현재 링크된 무인 병기)의 시점.
 * 핵앤슬래시 기동감을 위해 운동량 기반 가감속 + 2단 점프(가변 높이) +
 * 코요테 타임 + 방향 회피 대시(공중 포함)를 갖춤.
 */
export class PlayerController {
  readonly camera: THREE.PerspectiveCamera;

  private yaw = 0;
  private pitch = 0;
  private velocityY = 0;
  private grounded = true;
  private position = new THREE.Vector3();

  // 수평 운동량 / 점프·대시 상태
  private hVel = new THREE.Vector3(); // x,z 수평 속도(운동량)
  private airJumpsLeft = MAX_AIR_JUMPS;
  private coyote = 0; // 코요테 타임 잔여
  private dashTime = 0; // 대시 진행 잔여
  private dashCooldown = 0;
  private dashDir = new THREE.Vector3();
  // 매 프레임 재사용 임시 벡터(할당/ GC 회피)
  private _fwd = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _wish = new THREE.Vector3();
  private _look = new THREE.Vector3();

  // 상태값(HUD 연동)
  maxHp = 100;
  hp = 100;
  maxFreq = 100;
  freq = 100;
  /** 특수 무기 등에서 자연 회복을 잠시 막아야 할 때 true */
  freqRegenSuppressed = false;

  private invuln = 0; // 피격 무적 타이머

  constructor(
    private input: Input,
    private world: World,
    aspect: number
  ) {
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.1, 8000);
    const sp = this.world.spawn;
    this.position.set(sp.x, this.world.heightAt(sp.x, sp.z) + EYE_HEIGHT, sp.z);
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

    // --- 시점 회전 ---
    const { dx, dy } = this.input.consumeMouse();
    this.yaw -= dx * MOUSE_SENSITIVITY;
    this.pitch -= dy * MOUSE_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);

    // --- 이동 입력(수평) — 재사용 임시 벡터 ---
    const forward = this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wish = this._wish.set(0, 0, 0);
    if (this.input.isDown("KeyW")) wish.add(forward);
    if (this.input.isDown("KeyS")) wish.sub(forward);
    if (this.input.isDown("KeyD")) wish.add(right);
    if (this.input.isDown("KeyA")) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    // --- 회피 대시(버스트) ---
    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    const dashKey =
      this.input.wasPressed("ShiftLeft") || this.input.wasPressed("ShiftRight");
    if (dashKey && this.dashCooldown <= 0) {
      // 입력 방향 우선, 없으면 바라보는 정면으로 대시
      this.dashDir.copy(wish.lengthSq() > 0 ? wish : forward).normalize();
      this.dashTime = DASH_DURATION;
      this.dashCooldown = DASH_COOLDOWN;
    }

    if (this.dashTime > 0) {
      // 대시 중에는 운동량을 버스트 속도로 덮어씀
      this.dashTime -= dt;
      this.hVel.copy(this.dashDir).multiplyScalar(DASH_SPEED);
    } else {
      // 목표 속도로 가/감속(지상=즉각적, 공중=관성). 지수 접근으로 부드럽고 빠릿하게.
      const rate = this.grounded ? GROUND_RATE : AIR_RATE;
      const t = 1 - Math.exp(-rate * dt);
      const targetX = wish.x * WALK_SPEED;
      const targetZ = wish.z * WALK_SPEED;
      this.hVel.x += (targetX - this.hVel.x) * t;
      this.hVel.z += (targetZ - this.hVel.z) * t;
    }

    this.position.x += this.hVel.x * dt;
    this.position.z += this.hVel.z * dt;

    // 맵 경계 클램프
    const lim = TERRAIN_HALF - 4;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -lim, lim);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -lim, lim);

    // 바위(오브젝트) 통과 불가: 겹치면 바깥으로 밀어내고, 바위를 파고드는
    // 운동량 성분은 제거해 벽에 미끄러지듯 멈추게 한다.
    // feetY 가 바위 윗면 이상이면 디딘 상태로 보고 수평 차단을 무시 → 위에 올라설 수 있음.
    const before = { x: this.position.x, z: this.position.z };
    const feetY = this.position.y - EYE_HEIGHT;
    const resolved = this.world.resolveCollision(before.x, before.z, PLAYER_RADIUS, feetY);
    if (resolved.x !== before.x || resolved.z !== before.z) {
      const nx = resolved.x - before.x;
      const nz = resolved.z - before.z;
      const nLen = Math.hypot(nx, nz);
      if (nLen > 1e-6) {
        // 분리 법선 방향(바위→플레이어)으로 들어가는 속도만 깎아냄(접선 이동은 유지)
        const ux = nx / nLen;
        const uz = nz / nLen;
        const into = this.hVel.x * ux + this.hVel.z * uz;
        if (into < 0) {
          this.hVel.x -= into * ux;
          this.hVel.z -= into * uz;
        }
      }
      this.position.x = resolved.x;
      this.position.z = resolved.z;
    }

    // --- 점프 / 중력 ---
    // 지상에 있을 때 점프 예산/코요테 갱신
    if (this.grounded) {
      this.coyote = COYOTE_TIME;
      this.airJumpsLeft = MAX_AIR_JUMPS;
    } else if (this.coyote > 0) {
      this.coyote -= dt;
    }

    if (this.input.wasPressed("Space")) {
      if (this.grounded || this.coyote > 0) {
        this.velocityY = JUMP_VELOCITY; // 지상(또는 코요테) 점프
        this.grounded = false;
        this.coyote = 0;
      } else if (this.airJumpsLeft > 0) {
        this.velocityY = AIR_JUMP_VELOCITY; // 2단 점프
        this.airJumpsLeft -= 1;
      }
    }

    // 가변 점프 높이: 상승 중 스페이스를 떼면 더 강한 중력
    const rising = this.velocityY > 0;
    const holdingJump = this.input.isDown("Space");
    const g = rising && !holdingJump ? GRAVITY * LOW_JUMP_MULT : GRAVITY;

    // 바위 위 착지를 위해 이번 프레임 중력 적용 전 발 위치를 기억해 둔다.
    const prevFeetY = this.position.y - EYE_HEIGHT;
    this.velocityY -= g * dt;
    this.position.y += this.velocityY * dt;

    // 지면(또는 바위 윗면) 높이 계산: 발이 윗면보다 위에 있던 경우에만 디딤판으로 인정
    // → 아래에서 바위 안으로 텔레포트되는 일을 막는다.
    const terrainY = this.world.heightAt(this.position.x, this.position.z);
    const rockTopY = this.world.topAt(this.position.x, this.position.z);
    let standY = terrainY;
    if (rockTopY > standY && prevFeetY >= rockTopY - 0.05) {
      standY = rockTopY;
    }
    const groundY = standY + EYE_HEIGHT;

    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.velocityY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // --- 주파수 재충전 --- (특수 무기 발동 중에는 외부에서 억제)
    if (!this.freqRegenSuppressed) {
      this.freq = Math.min(this.maxFreq, this.freq + 22 * dt);
    }

    this.syncCamera();
  }

  private syncCamera() {
    this.camera.position.copy(this.position);
    // 시선 타깃 = 위치 + 시선 방향(재사용 임시 벡터)
    this._look.set(
      this.position.x - Math.sin(this.yaw) * Math.cos(this.pitch),
      this.position.y + Math.sin(this.pitch),
      this.position.z - Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    this.camera.lookAt(this._look);
  }

  reset() {
    this.hp = this.maxHp;
    this.freq = this.maxFreq;
    this.velocityY = 0;
    this.invuln = 0;
    this.hVel.set(0, 0, 0);
    this.grounded = true;
    this.airJumpsLeft = MAX_AIR_JUMPS;
    this.coyote = 0;
    this.dashTime = 0;
    this.dashCooldown = 0;
    const sp = this.world.spawn;
    this.position.set(sp.x, this.world.heightAt(sp.x, sp.z) + EYE_HEIGHT, sp.z);
    this.yaw = sp.yaw;
    this.pitch = 0;
    this.syncCamera();
  }
}
