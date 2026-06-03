import type { Input } from "./Input";

// 룩 감도(픽셀당 입력 누적). PlayerController 의 MOUSE_SENSITIVITY=0.0022 와 곱해
// 라디안/픽셀 ≒ 0.0035 가 되도록 1.6 배.
const LOOK_SCALE = 1.6;
const KNOB_MAX_DIST = 56; // 조이스틱 중심에서 노브가 갈 수 있는 최대 거리(px)
const DEADZONE = 0.2;

interface MoveTouch {
  id: number;
  startX: number;
  startY: number;
}
interface LookTouch {
  id: number;
  lastX: number;
  lastY: number;
}

/**
 * 모바일/터치 디바이스용 컨트롤.
 * - 좌하단 플로팅 조이스틱(좌반쪽 영역 어디에서 시작해도 그 자리에 생성) → WASD 합성
 * - 우반쪽 빈 공간 스와이프 → 룩(시야) 회전
 * - 우하단 점프/대시/특수 3 버튼
 *
 * 자동발사가 근거리 조준선 안의 적을 알아서 처리하므로 별도 발사 버튼은 두지 않는다.
 */
export class MobileControls {
  /** 터치 가능 디바이스 여부 — Game/Input 쪽에서 포인터락 우회 결정에 사용. */
  static isTouchDevice(): boolean {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(pointer: coarse)").matches ||
      "ontouchstart" in window ||
      (navigator.maxTouchPoints ?? 0) > 0
    );
  }

  readonly enabled: boolean;

  private root!: HTMLElement;
  private joystickEl!: HTMLElement;
  private knobEl!: HTMLElement;
  private btnJump!: HTMLElement;
  private btnDash!: HTMLElement;
  private btnSpecial!: HTMLElement;
  private specialRingFill!: SVGCircleElement;
  private specialLabel!: HTMLElement;
  private readonly specialCirc = 2 * Math.PI * 26; // r=26 (CSS와 동기화)

  private moveTouch: MoveTouch | null = null;
  private lookTouch: LookTouch | null = null;
  private activeMoveKeys = new Set<string>();
  private isPortrait = false;

  constructor(private input: Input) {
    this.enabled = MobileControls.isTouchDevice();
    if (!this.enabled) return;
    document.body.classList.add("is-touch");
    this.buildDom();
    this.buildRotateOverlay();
    this.bindBody();
    this.bindButtons();
    this.bindOrientationWatch();
    this.checkOrientation();
  }

  /** 세로 모드 등으로 입력을 받지 말아야 할 때 true. Game.frame 게이팅용. */
  get isBlocked(): boolean {
    return this.enabled && this.isPortrait;
  }

  /**
   * 가능한 환경(주로 Android Chrome)에서 풀스크린 진입 후 가로 모드 잠금 시도.
   * iOS Safari 처럼 지원하지 않는 환경에서는 조용히 실패하고 세로 안내 오버레이가 폴백.
   * 반드시 사용자 제스처(시작 버튼 탭) 컨텍스트에서 호출되어야 한다.
   */
  async attemptLandscapeLock(): Promise<void> {
    if (!this.enabled) return;
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch {
      /* 풀스크린 거부 — 폴백 오버레이가 대신 안내 */
    }
    try {
      const so = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
      if (so?.lock) await so.lock("landscape");
    } catch {
      /* lock API 미지원/거부(iOS Safari 등) — 폴백 안내로 처리 */
    }
  }

  /** 매 프레임 Game 에서 특수 무기 상태를 미러링. */
  setSpecialState(ready: number, active: boolean, remainingSec: number) {
    if (!this.enabled) return;
    const r = Math.max(0, Math.min(1, ready));
    this.specialRingFill.style.strokeDashoffset = String(this.specialCirc * (1 - r));
    this.btnSpecial.classList.toggle("is-ready", r >= 1 && !active);
    this.btnSpecial.classList.toggle("is-active", active);
    this.btnSpecial.classList.toggle("is-cooling", !active && r < 1);
    if (active) this.specialLabel.textContent = "FIRE";
    else if (r >= 1) this.specialLabel.textContent = "SP";
    else this.specialLabel.textContent = String(Math.ceil(remainingSec));
  }

  private buildDom() {
    const root = document.createElement("div");
    root.id = "touchControls";
    root.className = "tc";

    // 조이스틱 (플로팅 — 첫 터치 위치에 등장)
    this.joystickEl = document.createElement("div");
    this.joystickEl.className = "tc__joy";
    this.knobEl = document.createElement("div");
    this.knobEl.className = "tc__joy-knob";
    this.joystickEl.appendChild(this.knobEl);
    root.appendChild(this.joystickEl);

    // 버튼 클러스터 (우하단)
    const buttons = document.createElement("div");
    buttons.className = "tc__buttons";
    this.btnJump = this.makeButton("tc__btn tc__btn--jump", "JUMP");
    this.btnDash = this.makeButton("tc__btn tc__btn--dash", "DASH");
    this.btnSpecial = this.makeButton("tc__btn tc__btn--special", "SP");
    // 특수 버튼: 가장자리 진행링(SVG)
    this.btnSpecial.innerHTML = "";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 60 60");
    svg.setAttribute("class", "tc__btn-ring");
    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("cx", "30");
    track.setAttribute("cy", "30");
    track.setAttribute("r", "26");
    track.setAttribute("class", "tc__btn-ring-track");
    const fill = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    fill.setAttribute("cx", "30");
    fill.setAttribute("cy", "30");
    fill.setAttribute("r", "26");
    fill.setAttribute("class", "tc__btn-ring-fill");
    fill.style.strokeDasharray = String(this.specialCirc);
    fill.style.strokeDashoffset = String(this.specialCirc); // 시작: 비어있음
    svg.appendChild(track);
    svg.appendChild(fill);
    this.specialRingFill = fill;
    this.btnSpecial.appendChild(svg);
    const label = document.createElement("span");
    label.className = "tc__btn-label";
    label.textContent = "SP";
    this.specialLabel = label;
    this.btnSpecial.appendChild(label);

    buttons.appendChild(this.btnDash);
    buttons.appendChild(this.btnJump);
    buttons.appendChild(this.btnSpecial);
    root.appendChild(buttons);

    this.root = root;
    document.body.appendChild(root);
  }

  /** 플레이 중일 때만 가상 컨트롤(조이스틱·버튼)을 표시. 메뉴/인트로/일시정지에선 숨김. */
  setActive(active: boolean): void {
    if (!this.enabled) return;
    this.root.classList.toggle("is-active", active);
    if (!active) {
      this.hideJoystick();
      this.moveTouch = null;
      this.lookTouch = null;
    }
  }

  private makeButton(className: string, label: string): HTMLElement {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = label;
    return el;
  }

  private buildRotateOverlay() {
    const el = document.createElement("div");
    el.className = "mc-rotate";
    el.innerHTML = `
      <div class="mc-rotate__inner">
        <div class="mc-rotate__icon">⟳</div>
        <div class="mc-rotate__msg">가로 모드로 돌려주세요</div>
        <div class="mc-rotate__sub">ROTATE TO LANDSCAPE</div>
      </div>
    `;
    document.body.appendChild(el);
  }

  private bindOrientationWatch() {
    const mq = window.matchMedia("(orientation: portrait)");
    const handler = () => this.checkOrientation();
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else (mq as MediaQueryList & { addListener?: (h: () => void) => void }).addListener?.(handler);
  }

  private checkOrientation() {
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    if (portrait === this.isPortrait) return;
    this.isPortrait = portrait;
    document.body.classList.toggle("is-portrait", portrait);
    if (portrait) {
      // 입력 잔재 정리 — 손가락이 떨어진 효과
      this.releaseMoveKeys();
      this.moveTouch = null;
      this.lookTouch = null;
      this.hideJoystick();
    }
  }

  private bindBody() {
    const body = document.body;
    body.addEventListener("touchstart", (e) => this.onTouchStart(e), { passive: false });
    body.addEventListener("touchmove", (e) => this.onTouchMove(e), { passive: false });
    body.addEventListener("touchend", (e) => this.onTouchEnd(e));
    body.addEventListener("touchcancel", (e) => this.onTouchEnd(e));
  }

  private bindButtons() {
    this.bindButton(this.btnJump,
      () => this.input.syntheticKeyDown("Space"),
      () => this.input.syntheticKeyUp("Space"));
    this.bindButton(this.btnDash,
      () => this.input.syntheticKeyDown("ShiftLeft"),
      () => this.input.syntheticKeyUp("ShiftLeft"));
    this.bindButton(this.btnSpecial,
      () => { this.input.specialPressed = true; },
      () => { /* 엣지 — 별도 처리 없음 */ });
  }

  private bindButton(el: HTMLElement, down: () => void, up: () => void) {
    el.addEventListener("touchstart", (e) => {
      e.stopPropagation();
      e.preventDefault();
      el.classList.add("is-pressed");
      down();
    }, { passive: false });
    const release = () => { el.classList.remove("is-pressed"); up(); };
    el.addEventListener("touchend", (e) => { e.stopPropagation(); release(); });
    el.addEventListener("touchcancel", (e) => { e.stopPropagation(); release(); });
  }

  private isOverlayVisible(): boolean {
    const overlay = document.getElementById("overlay");
    return !!overlay && !overlay.classList.contains("is-hidden");
  }

  private onTouchStart(e: TouchEvent) {
    // 세로 모드일 때는 입력 무시 — 회전 안내가 우선.
    if (this.isPortrait) return;
    // 시작/일시정지 오버레이가 떠있을 때는 기본 동작(버튼 탭) 허용 — 가로채지 않는다.
    if (this.isOverlayVisible()) return;

    let handled = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const target = t.target as HTMLElement | null;
      if (target?.closest(".tc__btn")) continue; // 버튼은 자체 처리
      if (target?.closest(".overlay")) continue;

      const mid = window.innerWidth * 0.5;
      if (t.clientX < mid && this.moveTouch == null) {
        this.moveTouch = { id: t.identifier, startX: t.clientX, startY: t.clientY };
        this.showJoystickAt(t.clientX, t.clientY);
        handled = true;
      } else if (t.clientX >= mid && this.lookTouch == null) {
        this.lookTouch = { id: t.identifier, lastX: t.clientX, lastY: t.clientY };
        handled = true;
      }
    }
    if (handled) e.preventDefault();
  }

  private onTouchMove(e: TouchEvent) {
    if (this.isPortrait) return;
    let handled = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (this.moveTouch && t.identifier === this.moveTouch.id) {
        const dx = t.clientX - this.moveTouch.startX;
        const dy = t.clientY - this.moveTouch.startY;
        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(dist, KNOB_MAX_DIST);
        const inv = dist > 1e-3 ? 1 / dist : 0;
        const knobX = dx * inv * clamped;
        const knobY = dy * inv * clamped;
        this.knobEl.style.transform = `translate(${knobX}px, ${knobY}px)`;

        const nx = knobX / KNOB_MAX_DIST;
        const ny = knobY / KNOB_MAX_DIST;
        this.updateMoveKeys(nx, ny);
        handled = true;
      } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
        const ddx = t.clientX - this.lookTouch.lastX;
        const ddy = t.clientY - this.lookTouch.lastY;
        this.lookTouch.lastX = t.clientX;
        this.lookTouch.lastY = t.clientY;
        this.input.addLookDelta(ddx * LOOK_SCALE, ddy * LOOK_SCALE);
        handled = true;
      }
    }
    if (handled) e.preventDefault();
  }

  private onTouchEnd(e: TouchEvent) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (this.moveTouch && t.identifier === this.moveTouch.id) {
        this.moveTouch = null;
        this.hideJoystick();
        this.releaseMoveKeys();
      }
      if (this.lookTouch && t.identifier === this.lookTouch.id) {
        this.lookTouch = null;
      }
    }
  }

  private updateMoveKeys(nx: number, ny: number) {
    const want = new Set<string>();
    if (nx > DEADZONE) want.add("KeyD");
    if (nx < -DEADZONE) want.add("KeyA");
    if (ny > DEADZONE) want.add("KeyS"); // 아래로 끌면 후진
    if (ny < -DEADZONE) want.add("KeyW");

    for (const k of this.activeMoveKeys) {
      if (!want.has(k)) this.input.syntheticKeyUp(k);
    }
    for (const k of want) {
      if (!this.activeMoveKeys.has(k)) this.input.syntheticKeyDown(k);
    }
    this.activeMoveKeys = want;
  }

  private releaseMoveKeys() {
    for (const k of this.activeMoveKeys) this.input.syntheticKeyUp(k);
    this.activeMoveKeys.clear();
  }

  private showJoystickAt(x: number, y: number) {
    this.joystickEl.style.left = `${x}px`;
    this.joystickEl.style.top = `${y}px`;
    this.joystickEl.classList.add("is-active");
    this.knobEl.style.transform = "translate(0, 0)";
  }

  private hideJoystick() {
    this.joystickEl.classList.remove("is-active");
    this.knobEl.style.transform = "translate(0, 0)";
  }
}
