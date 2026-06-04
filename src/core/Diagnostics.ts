import type * as THREE from "three";

// 온디바이스 진단(특히 iPad: 원격 디버깅이 어려움) — WebGL 컨텍스트 손실/전역 에러/렌더러 자원
// 스냅샷을 화면 오버레이로 표시한다. URL 에 ?diag 가 있을 때만 오버레이 표시(프로덕션 무영향).
// 컨텍스트/에러 리스너는 항상 부착되어 console 에도 남으므로 원격 인스펙터로도 확인 가능.

const ENABLED = /[?&]diag\b/.test(location.search);
const MAX_LINES = 14;

export class Diagnostics {
  readonly enabled = ENABLED;
  private hbEl: HTMLDivElement | null = null; // 하트비트(프레임#/fps) 전용 줄
  private logEl: HTMLDivElement | null = null;
  private lines: string[] = [];
  private seen = new Set<string>(); // 동일 에러 1회만(스팸 방지)
  private t0 = 0;
  private frames = 0;
  private hbFrames = 0;
  private hbLast = 0;

  constructor() {
    if (!this.enabled) return;
    const el = document.createElement("div");
    el.id = "diag";
    el.style.cssText =
      "position:fixed;top:0;left:0;right:0;max-height:45%;overflow:hidden;z-index:99999;" +
      "font:11px/1.35 ui-monospace,monospace;color:#9ffbe0;background:rgba(0,0,0,.62);" +
      "padding:4px 6px;pointer-events:none;white-space:pre-wrap;word-break:break-word";
    this.hbEl = document.createElement("div");
    this.hbEl.style.cssText = "color:#ffd86b";
    this.logEl = document.createElement("div");
    el.appendChild(this.hbEl);
    el.appendChild(this.logEl);
    document.body.appendChild(el);
    this.log("diag on — WebGL/에러/메모리/하트비트 추적");
  }

  /** 매 프레임 호출 — 프레임#·fps 갱신. 멈춤 시 이 값이 멈추면 RAF 루프 정지/행, 계속 오르면 로직/상태 정지. */
  tick(): void {
    if (!this.hbEl) return;
    this.frames++;
    this.hbFrames++;
    const now = performance.now();
    if (!this.hbLast) this.hbLast = now;
    const span = now - this.hbLast;
    if (span >= 400) {
      const fps = Math.round((this.hbFrames * 1000) / span);
      this.hbEl.textContent = `❤ f=${this.frames} fps=${fps}`;
      this.hbFrames = 0;
      this.hbLast = now;
    }
  }

  private stamp(): string {
    if (!this.t0) this.t0 = performance.now();
    return ((performance.now() - this.t0) / 1000).toFixed(1) + "s";
  }

  log(msg: string): void {
    const line = `[${this.stamp()}] ${msg}`;
    console.log("[diag]", msg);
    this.push(line);
  }

  /** 같은 메시지는 1회만 표시(반복 프레임 예외 스팸 방지). */
  error(msg: string): void {
    console.error("[diag]", msg);
    if (this.seen.has(msg)) return;
    this.seen.add(msg);
    this.push(`⚠ [${this.stamp()}] ${msg}`);
  }

  private push(line: string): void {
    if (!this.logEl) return;
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    this.logEl.textContent = this.lines.join("\n");
  }

  /** 전역 JS 에러 / 미처리 프라미스 거부 표면화(RAF 외 예외 포함). */
  watchGlobalErrors(): void {
    window.addEventListener("error", (e) => this.error(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
    window.addEventListener("unhandledrejection", (e) => this.error(`PROMISE: ${String((e as PromiseRejectionEvent).reason)}`));
  }

  /** WebGL 컨텍스트 손실/복구/생성실패 감시 — '멈춤=컨텍스트 손실' 여부 즉시 판별. */
  watchContext(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.error("WEBGL CONTEXT LOST (GPU 자원/컨텍스트 한도 의심)"); }, false);
    canvas.addEventListener("webglcontextrestored", () => this.log("WEBGL CONTEXT RESTORED"), false);
    canvas.addEventListener(
      "webglcontextcreationerror",
      (e) => this.error(`WEBGL CREATE FAIL: ${(e as WebGLContextEvent).statusMessage || "?"}`),
      false
    );
  }

  /** renderer.info 스냅샷 — 상태 전환마다 호출. 반복 실행 시 수치가 계속 커지면 누수 확정. */
  snapshot(renderer: THREE.WebGLRenderer, label: string): void {
    const i = renderer.info;
    this.log(`[${label}] geo=${i.memory.geometries} tex=${i.memory.textures} prog=${i.programs?.length ?? 0} calls=${i.render.calls}`);
  }

  /** RAF 본문 보호 — 프레임 내 예외를 표면화(첫 발생만). 예외로 인한 조용한 멈춤 판별. */
  guard(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.error(`FRAME: ${(e as Error)?.stack || (e as Error)?.message || String(e)}`);
    }
  }
}
