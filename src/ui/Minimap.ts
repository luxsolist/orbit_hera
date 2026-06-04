import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { World, MinimapSink } from "../world/World";
import { hudSizesFor } from "./hudLayout";

const WORLD_RADIUS = 70; // 미니맵 가장자리가 표현하는 월드 반경(유닛)

// 희미한 지형/건물 레이어 색(배경 위, 마커 아래)
const C_WATER = "rgba(46, 116, 150, 0.22)";
const C_ROAD = "rgba(150, 162, 172, 0.16)";
const C_BLD = "rgba(132, 156, 170, 0.20)";
const C_ROCK = "rgba(180, 195, 200, 0.45)";

/**
 * 우측 상단 레이더 미니맵. 플레이어 중심·시점 정렬(위=시선).
 * 지형/건물은 World.queryMinimap 으로 근처 형상만 받아(격자 브로드페이즈) 희미하게 그린다
 * — 충돌 내부 표현(OBB 등)에 직접 의존하지 않도록 MinimapSink 로 분리.
 */
export class Minimap implements MinimapSink {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private player: PlayerController;
  private enemies: EnemyManager;
  private world: World;
  private scale!: number; // 픽셀/월드유닛 (configureCanvas 에서 설정)
  private size!: number; // 캔버스 한 변(px, 화면 비례)
  private half!: number;

  // 현재 프레임 투영 상태(싱크 콜백에서 사용)
  private px = 0;
  private pz = 0;
  private sin = 0;
  private cos = 1;
  private bx = 0; // project() 결과(할당 회피)
  private by = 0;

  constructor(player: PlayerController, enemies: EnemyManager, world: World) {
    this.canvas = document.getElementById("minimap") as HTMLCanvasElement;
    if (!this.canvas) throw new Error("#minimap canvas not found");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;

    this.player = player;
    this.enemies = enemies;
    this.world = world;
    this.configureCanvas(hudSizesFor(window.innerWidth, window.innerHeight).minimap);
  }

  /** 화면 크기 변화 시 캔버스/스케일 갱신(Game.onResize 에서 호출). */
  resize(size: number): void {
    this.configureCanvas(size);
  }

  /** 캔버스 백킹 해상도(DPR)·CSS 크기·월드 스케일을 size(px)에 맞춰 설정. */
  private configureCanvas(size: number): void {
    this.size = size;
    this.half = size / 2;
    this.scale = this.half / WORLD_RADIUS; // 픽셀/월드유닛
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 리사이즈로 변환 초기화 후 DPR 재적용
  }

  /** 월드(wx,wz) → 미니맵 픽셀(bx,by). 시점 정렬(위=시선). 할당 없이 필드에 기록. */
  private project(wx: number, wz: number): void {
    const dx = wx - this.px;
    const dz = wz - this.pz;
    this.bx = this.half + (dx * this.cos - dz * this.sin) * this.scale;
    this.by = this.half + (dx * this.sin + dz * this.cos) * this.scale;
  }

  // ── MinimapSink: World.queryMinimap 이 근처 형상마다 호출 ──
  water(q: ReadonlyArray<number>): void {
    const ctx = this.ctx;
    ctx.fillStyle = C_WATER;
    ctx.beginPath();
    for (let i = 0; i < q.length / 2; i++) {
      this.project(q[i * 2], q[i * 2 + 1]);
      if (i === 0) ctx.moveTo(this.bx, this.by);
      else ctx.lineTo(this.bx, this.by);
    }
    ctx.closePath();
    ctx.fill();
  }
  road(ax: number, az: number, bx: number, bz: number, width: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = C_ROAD;
    ctx.lineWidth = Math.max(1, width * this.scale * 0.5);
    ctx.beginPath();
    this.project(ax, az);
    ctx.moveTo(this.bx, this.by);
    this.project(bx, bz);
    ctx.lineTo(this.bx, this.by);
    ctx.stroke();
  }
  building(c: ReadonlyArray<number>): void {
    const ctx = this.ctx;
    ctx.fillStyle = C_BLD;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      this.project(c[k * 2], c[k * 2 + 1]);
      if (k === 0) ctx.moveTo(this.bx, this.by);
      else ctx.lineTo(this.bx, this.by);
    }
    ctx.closePath();
    ctx.fill();
  }
  triangle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = C_BLD;
    ctx.beginPath();
    this.project(ax, az);
    ctx.moveTo(this.bx, this.by);
    this.project(bx, bz);
    ctx.lineTo(this.bx, this.by);
    this.project(cx, cz);
    ctx.lineTo(this.bx, this.by);
    ctx.closePath();
    ctx.fill();
  }
  rock(x: number, z: number, radius: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = C_ROCK;
    this.project(x, z);
    ctx.beginPath();
    ctx.arc(this.bx, this.by, Math.max(1.5, radius * this.scale * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }

  render() {
    const ctx = this.ctx;
    const half = this.half;
    const size = this.size;
    const cx = half;
    const cy = half;

    // ---- 배경: 원형 클리핑 + 어두운 청록 ----
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, half - 1, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = "rgba(5, 12, 18, 0.78)";
    ctx.fillRect(0, 0, size, size);

    const yaw = this.player.viewYaw;
    this.px = this.player.worldPosition.x;
    this.pz = this.player.worldPosition.z;
    this.sin = Math.sin(yaw);
    this.cos = Math.cos(yaw);

    // ---- 지형/건물/콜라이더(희미) — World 가 근처 형상만 싱크로 방문(격자 브로드페이즈) ----
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    this.world.queryMinimap(this.px, this.pz, WORLD_RADIUS, this);

    // 동심 거리 링(20/40/60 월드 유닛)
    ctx.strokeStyle = "rgba(52, 245, 255, 0.12)";
    ctx.lineWidth = 1;
    for (const r of [20, 40, 60]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * this.scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ---- 시야 콘(위쪽 부채꼴) ----
    const fovHalf = (72 * Math.PI) / 180 / 2; // 메인 카메라 FOV 의 절반
    const coneR = half - 4;
    ctx.fillStyle = "rgba(52, 245, 255, 0.10)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, coneR, -Math.PI / 2 - fovHalf, -Math.PI / 2 + fovHalf);
    ctx.closePath();
    ctx.fill();

    // ---- 적 ----
    const px = this.px;
    const pz = this.pz;
    for (const e of this.enemies.aliveSnapshot) {
      const lp = this.worldToLocal(e.x - px, e.z - pz, yaw);
      const dist = Math.hypot(lp.x, lp.y);
      if (dist > WORLD_RADIUS) {
        const a = Math.atan2(lp.y, lp.x);
        const ex = cx + Math.cos(a) * (half - 8);
        const ey = cy + Math.sin(a) * (half - 8);
        ctx.fillStyle = "rgba(255, 59, 78, 0.55)";
        ctx.beginPath();
        ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const ex = cx + lp.x;
      const ey = cy + lp.y;
      const grad = ctx.createRadialGradient(ex, ey, 0, ex, ey, 8);
      grad.addColorStop(0, "rgba(255, 59, 78, 0.95)");
      grad.addColorStop(1, "rgba(255, 59, 78, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex, ey, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff3b4e";
      ctx.beginPath();
      ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- 플레이어(중앙 삼각형, 위쪽 = 시점 방향) ----
    ctx.fillStyle = "#34f5ff";
    ctx.strokeStyle = "rgba(5, 12, 18, 0.9)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // ---- 외곽 링 ----
    ctx.strokeStyle = "rgba(52, 245, 255, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, half - 1, 0, Math.PI * 2);
    ctx.stroke();
    // 십자선
    ctx.strokeStyle = "rgba(52, 245, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, size);
    ctx.moveTo(0, cy);
    ctx.lineTo(size, cy);
    ctx.stroke();
  }

  /** 월드 (dx,dz) 오프셋 → 미니맵 로컬 (x,y) 픽셀(적 마커용). */
  private worldToLocal(dx: number, dz: number, yaw: number): { x: number; y: number } {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const lx = (dx * cos - dz * sin) * this.scale;
    const ly = (dx * sin + dz * cos) * this.scale;
    return { x: lx, y: ly };
  }
}
