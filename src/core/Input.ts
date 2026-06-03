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
  /** 이번 프레임에 우클릭(특수 무기 발동)이 새로 눌렸는가 (엣지 트리거) */
  specialPressed = false;
  /** 포인터 락(조준 모드) 활성 여부 */
  locked = false;
  /** 이동 속도 배율(0..1) — 모바일 조이스틱 조절량에 비례. 키보드는 항상 1(전속). */
  moveScale = 1;
  /** 락 획득 직후 첫 mousemove(엔게이지 점프 델타)를 버리기 위한 플래그 */
  private freshLock = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code); // OS 키 반복 제외
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    document.addEventListener("pointerlockchange", () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked && !wasLocked) {
        // 락 획득 — 누적 델타를 비우고 첫 엔게이지 mousemove(큰 점프)는 버린다
        this.mouseDX = 0;
        this.mouseDY = 0;
        this.freshLock = true;
      }
      if (!this.locked) {
        this.keys.clear();
        this.pressed.clear();
        this.fireHeld = false;
      }
    });

    this.canvas.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      if (this.freshLock) {
        this.freshLock = false;
        return; // 락 직후 엔게이지 점프 델타 무시
      }
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    this.canvas.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.firePressed = true;
        this.fireHeld = true;
      } else if (e.button === 2) {
        this.specialPressed = true;
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.fireHeld = false;
    });
    // 우클릭이 컨텍스트 메뉴를 열지 않도록 차단(잠금 여부와 무관하게 캔버스 위에서는 차단)
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
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

  /**
   * 외부(예: MobileControls)에서 키 입력을 합성하기 위한 API.
   * 키보드 이벤트와 동일하게 keys/pressed 셋을 관리해
   * isDown/wasPressed 가 변경 없이 동작하도록 한다.
   */
  syntheticKeyDown(code: string) {
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
  }
  syntheticKeyUp(code: string) {
    this.keys.delete(code);
  }

  /** 룩(시야 회전) 델타를 누적. 픽셀 ≒ 마우스 movement 와 동일 단위. */
  addLookDelta(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** 프레임 끝에서 호출: 엣지 트리거 플래그 리셋 */
  endFrame() {
    this.firePressed = false;
    this.specialPressed = false;
    this.pressed.clear();
  }
}
