/**
 * 키보드 + Pointer Lock 마우스룩 입력 상태를 한 곳에서 관리.
 * - 키 상태는 프레임 간 누적(폴링), 마우스 이동량은 프레임마다 소비(consume).
 */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>(); // 이번 프레임에 새로 눌린 키(엣지)
  private mouseDX = 0;
  private mouseDY = 0;

  /** 이번 프레임에 좌클릭이 새로 눌렸는가 (엣지 트리거) */
  firePressed = false;
  /** 좌클릭을 누르고 있는가 (연속 사격용) */
  fireHeld = false;
  /** 포인터 락(조준 모드) 활성 여부 */
  locked = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code); // OS 키 반복 제외
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.pressed.clear();
        this.fireHeld = false;
      }
    });

    this.canvas.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0 && this.locked) {
        this.firePressed = true;
        this.fireHeld = true;
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.fireHeld = false;
    });
  }

  requestLock() {
    this.canvas.requestPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** 이번 프레임에 새로 눌렸는가 (엣지 트리거, 키 반복 제외) */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** 누적된 마우스 이동량을 읽고 0으로 초기화 */
  consumeMouse(): { dx: number; dy: number } {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  /** 프레임 끝에서 호출: 엣지 트리거 플래그 리셋 */
  endFrame() {
    this.firePressed = false;
    this.pressed.clear();
  }
}
