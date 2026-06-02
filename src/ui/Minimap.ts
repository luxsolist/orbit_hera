import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { World } from "../world/World";

const SIZE = 180; // 캔버스 픽셀(정사각)
const WORLD_RADIUS = 70; // 미니맵 가장자리가 표현하는 월드 반경(유닛)

/**
 * 우측 상단 레이더 미니맵.
 * 플레이어 중심, 플레이어가 항상 위를 보는 회전형(자기 시점 정렬).
 * - 시야 콘: 위쪽 부채꼴
 * - 적: 빨간 점 + 옅은 글로우
 * - 바위: 흐린 회색 점
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private player: PlayerController;
  private enemies: EnemyManager;
  private world: World;
  private scale: number;

  constructor(player: PlayerController, enemies: EnemyManager, world: World) {
    this.canvas = document.getElementById("minimap") as HTMLCanvasElement;
    if (!this.canvas) throw new Error("#minimap canvas not found");
    // DPR 대응(선명한 점/선)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);

    this.player = player;
    this.enemies = enemies;
    this.world = world;
    this.scale = (SIZE / 2) / WORLD_RADIUS; // 픽셀/월드유닛
  }

  render() {
    const ctx = this.ctx;
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    // ---- 배경: 원형 클리핑 + 어두운 청록 ----
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    ctx.fillStyle = "rgba(5, 12, 18, 0.78)";
    ctx.fillRect(0, 0, SIZE, SIZE);

    const yaw = this.player.viewYaw;
    const px = this.player.worldPosition.x;
    const pz = this.player.worldPosition.z;

    // 월드점 → 미니맵 픽셀(플레이어 중심 + 시점 정렬)
    const toPix = (wx: number, wz: number): [number, number] => {
      const lp = this.worldToLocal(wx - px, wz - pz, yaw);
      return [cx + lp.x, cy + lp.y];
    };

    // ---- 지형/건물 희미하게(배경 위, 마커 아래) ----
    // 수역(옅은 청록 면)
    ctx.fillStyle = "rgba(46, 116, 150, 0.22)";
    for (const w of this.world.waterRings) {
      const q = w.p;
      const m = q.length / 2;
      if (m < 3) continue;
      let mx = 0,
        mz = 0;
      for (let i = 0; i < m; i++) {
        mx += q[i * 2];
        mz += q[i * 2 + 1];
      }
      if (Math.hypot(mx / m - px, mz / m - pz) > WORLD_RADIUS + 250) continue;
      ctx.beginPath();
      for (let i = 0; i < m; i++) {
        const [sx, sy] = toPix(q[i * 2], q[i * 2 + 1]);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
    }

    // 도로(옅은 회색 선)
    ctx.strokeStyle = "rgba(150, 162, 172, 0.16)";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const r of this.world.roadRings) {
      const q = r.p;
      const n = q.length / 2;
      if (n < 2) continue;
      ctx.lineWidth = Math.max(1, (r.w ?? 6) * this.scale * 0.5);
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < n - 1; i++) {
        const ax = q[i * 2],
          az = q[i * 2 + 1],
          bx = q[i * 2 + 2],
          bz = q[i * 2 + 3];
        if (Math.hypot((ax + bx) / 2 - px, (az + bz) / 2 - pz) > WORLD_RADIUS + 20) continue;
        const [s0x, s0y] = toPix(ax, az);
        const [s1x, s1y] = toPix(bx, bz);
        ctx.moveTo(s0x, s0y);
        ctx.lineTo(s1x, s1y);
        any = true;
      }
      if (any) ctx.stroke();
    }

    // 건물(옅은 회청색 면) — OBB + 오목 건물 삼각형
    ctx.fillStyle = "rgba(132, 156, 170, 0.20)";
    for (const b of this.world.buildingBoxes) {
      if (Math.hypot(b.cx - px, b.cz - pz) - b.br > WORLD_RADIUS) continue;
      const vx = -b.uz,
        vz = b.ux;
      ctx.beginPath();
      const S = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
      for (let k = 0; k < 4; k++) {
        const su = S[k][0],
          sv = S[k][1];
        const [sx, sy] = toPix(
          b.cx + b.ux * b.hu * su + vx * b.hv * sv,
          b.cz + b.uz * b.hu * su + vz * b.hv * sv
        );
        if (k === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
    }
    for (const t of this.world.triBoxes) {
      if (Math.hypot(t.mx - px, t.mz - pz) - t.br > WORLD_RADIUS) continue;
      const [ax, ay] = toPix(t.ax, t.az);
      const [bx2, by2] = toPix(t.bx, t.bz);
      const [c2x, c2y] = toPix(t.cx, t.cz);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx2, by2);
      ctx.lineTo(c2x, c2y);
      ctx.closePath();
      ctx.fill();
    }

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
    const coneR = SIZE / 2 - 4;
    ctx.fillStyle = "rgba(52, 245, 255, 0.10)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, coneR, -Math.PI / 2 - fovHalf, -Math.PI / 2 + fovHalf);
    ctx.closePath();
    ctx.fill();

    // ---- 바위(콜라이더) ----
    ctx.fillStyle = "rgba(180, 195, 200, 0.45)";
    for (const c of this.world.colliders) {
      const lp = this.worldToLocal(c.x - px, c.z - pz, yaw);
      if (Math.hypot(lp.x, lp.y) > WORLD_RADIUS) continue;
      const r = Math.max(1.5, c.radius * this.scale * 0.6);
      ctx.beginPath();
      ctx.arc(cx + lp.x, cy + lp.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- 적 ----
    const enemies = this.enemies.aliveSnapshot;
    for (const e of enemies) {
      const lp = this.worldToLocal(e.x - px, e.z - pz, yaw);
      const dist = Math.hypot(lp.x, lp.y);
      if (dist > WORLD_RADIUS) {
        // 사거리 밖이면 가장자리에 표시(방향 단서)
        const a = Math.atan2(lp.y, lp.x);
        const ex = cx + Math.cos(a) * (SIZE / 2 - 8);
        const ey = cy + Math.sin(a) * (SIZE / 2 - 8);
        ctx.fillStyle = "rgba(255, 59, 78, 0.55)";
        ctx.beginPath();
        ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // 글로우
      const ex = cx + lp.x;
      const ey = cy + lp.y;
      const grad = ctx.createRadialGradient(ex, ey, 0, ex, ey, 8);
      grad.addColorStop(0, "rgba(255, 59, 78, 0.95)");
      grad.addColorStop(1, "rgba(255, 59, 78, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex, ey, 8, 0, Math.PI * 2);
      ctx.fill();
      // 코어 점
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
    ctx.arc(cx, cy, SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    // 십자선
    ctx.strokeStyle = "rgba(52, 245, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, SIZE);
    ctx.moveTo(0, cy);
    ctx.lineTo(SIZE, cy);
    ctx.stroke();
  }

  /** 월드 (dx,dz) 오프셋 → 미니맵 로컬 (x,y) 픽셀. yaw 만큼 역회전해 플레이어 시점을 위쪽으로 정렬. */
  private worldToLocal(dx: number, dz: number, yaw: number): { x: number; y: number } {
    // 월드 forward = (-sin yaw, -cos yaw) 를 화면 "위쪽"(=-Y)로 정렬
    // 회전: 플레이어 시점 기준으로 변환
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // 화면 X(우): 월드 right = (cos yaw, -sin yaw)
    // 화면 Y(하): 월드 backward = (sin yaw, cos yaw)
    const lx = (dx * cos - dz * sin) * this.scale;
    const ly = (dx * sin + dz * cos) * this.scale;
    return { x: lx, y: ly };
  }
}
