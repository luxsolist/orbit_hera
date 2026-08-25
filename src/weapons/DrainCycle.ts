import { cooldownReadyFrac } from "./WeaponSpec";

// 게이지 소진형 특수무기 공통 상태기계(순수, THREE/DOM 비의존 → 단위 테스트 가능).
// 발동 → freq 가 0 이 될 때까지 유지하며 일정 간격 발사 → 종료 후부터 쿨다운 시작.
// 실제 freq 차감/억제/발사는 호출부가 step() 반환값으로 수행(클래스 간 중복 제거: SpecialBarrage·SpecialStream).

export interface DrainParams {
  cooldown: number; // 사용 종료 후 쿨다운(초)
  drainRate: number; // 발동 중 초당 freq 소진
  fireInterval: number; // 발사 간격(초)
  triggerFloor: number; // 발동 최소 freq(이하면 발동 불가)
}

/** step() 한 프레임 결과 — 호출부가 적용할 지시. */
export interface DrainStep {
  fire: boolean; // 이번 프레임 발사할 것인가
  drain: number; // 차감할 freq 양
  active: boolean; // 현재 활성(= freqRegen 억제 여부)
}

export class DrainCycle {
  private _active = false;
  private cooldown = 0;
  private timer = 0;

  constructor(private p: DrainParams) {}

  get isActive(): boolean {
    return this._active;
  }
  /** 0..1 진행률(활성 중엔 0). */
  get cooldownReady(): number {
    return this._active ? 0 : cooldownReadyFrac(this.cooldown, this.p.cooldown);
  }
  /** 남은 쿨다운(초) — 활성 중엔 full(아직 시작 전). */
  get cooldownRemainingSec(): number {
    return this._active ? this.p.cooldown : Math.max(0, this.cooldown);
  }

  reset(): void {
    this._active = false;
    this.cooldown = 0;
    this.timer = 0;
  }

  /**
   * 중단 — 활성만 끄고 **쿨다운은 정상 사용처럼 시작**한다(reset 과의 차이: reset 은 쿨다운도 0 으로
   * 환급). 발동 중 사망 같은 "쓰다 만" 종료에 쓴다. 사망이 쿨다운을 되돌려주면 죽는 편이 이득이 되어
   * "회복은 없고 리스폰만"(2026-08-25) 설계와 어긋난다. 비활성 상태에서 부르면 무해한 무동작.
   */
  abort(): void {
    if (!this._active) return;
    this._active = false;
    this.cooldown = this.p.cooldown;
    this.timer = 0;
  }

  /**
   * 한 프레임 진행. trigger=발동 입력, freq=현재 게이지.
   * 발동 즉시 첫 발사, 활성 중 drainRate 소진, freq 가 0 이 되는 프레임에 발사 후 종료+쿨다운 시작.
   */
  step(dt: number, trigger: boolean, freq: number): DrainStep {
    if (this.cooldown > 0) this.cooldown -= dt;

    if (trigger && !this._active && this.cooldown <= 0 && freq > this.p.triggerFloor) {
      this._active = true;
      this.timer = 0; // 즉시 첫 발사
    }

    let fire = false;
    let drain = 0;
    if (this._active) {
      drain = this.p.drainRate * dt;
      this.timer -= dt;
      if (this.timer <= 0) {
        fire = true;
        this.timer = this.p.fireInterval;
      }
      if (freq - drain <= 0) {
        // 게이지 소진 → 종료, 이때부터 쿨다운(= 사용 이후 쿨다운)
        this._active = false;
        this.cooldown = this.p.cooldown;
      }
    }
    return { fire, drain, active: this._active };
  }
}
