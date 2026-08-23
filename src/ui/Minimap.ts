import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { GameWorld, MinimapSink } from "../world/GameWorld";
import { hudSizesFor } from "./hudLayout";
import { minimapRadiusFor, approach, ringRadiiFor, pickEdgeMarkers, type EdgeMarker } from "./minimapView";

// 희미한 지형/건물 레이어 색(배경 위, 마커 아래)
const C_WATER = "rgba(46, 116, 150, 0.22)";
const C_ROAD = "rgba(150, 162, 172, 0.16)";
const C_BLD = "rgba(132, 156, 170, 0.20)";
const C_ROCK = "rgba(180, 195, 200, 0.45)";
// 랜드마크 — 호박색. 적(붉은 계열)·플레이어/HUD(시안)와 겹치지 않는 유일한 자리라 오독이 없다.
// 일반 건물(C_BLD, 알파 0.20) 위에 덧그려지므로 알파를 높게 잡아 확실히 떠 보이게 한다.
const C_LANDMARK = "rgba(255, 206, 122, 0.72)";
const C_LANDMARK_DOT = "#ffce7a"; //          살아있는 랜드마크 점/화살표
const C_LANDMARK_DEAD = "rgba(255, 206, 122, 0.30)"; // 파괴분(빈 원)
const INK = "rgba(5, 12, 18, 0.9)"; //        어두운 외곽선(배경 위 대비 확보)

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
  private world: GameWorld;
  private scale!: number; // 픽셀/월드유닛 (setWorldRadius 에서 설정)
  /** 미니맵 가장자리가 표현하는 월드 반경(m) — 고도에 따라 변한다. 초기값은 비행 스폰 부근. */
  private worldRadius = 80;
  private edgeBuf: EdgeMarker[] = []; //  화살표 후보(프레임 재사용)
  private edgePick: EdgeMarker[] = []; // 선별 결과(프레임 재사용)
  private size!: number; // 캔버스 한 변(px, 화면 비례)
  private half!: number;

  // 현재 프레임 투영 상태(싱크 콜백에서 사용)
  private px = 0;
  private pz = 0;
  private sin = 0;
  private cos = 1;
  private bx = 0; // project() 결과(할당 회피)
  private by = 0;

  constructor(player: PlayerController, enemies: EnemyManager, world: GameWorld) {
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
    this.scale = this.half / this.worldRadius; // 픽셀/월드유닛
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
  /** 랜드마크 footprint — 가변 길이 폴리곤을 그대로 채운다(일반 건물 위 덧그림). */
  landmark(poly: ReadonlyArray<number>): void {
    const n = poly.length / 2;
    if (n < 3) return;
    const ctx = this.ctx;
    ctx.fillStyle = C_LANDMARK;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      this.project(poly[k * 2], poly[k * 2 + 1]);
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

  /** @param dt 프레임 시간(초) — 고도 줌 추종에만 쓴다(0 이면 반경 고정). */
  render(dt = 0) {
    // ---- 고도 줌 — 지면 상대 고도로 반경을 정하고 부드럽게 따라간다 ----
    const pos = this.player.worldPosition;
    const agl = pos.y - this.world.heightAt(pos.x, pos.z);
    this.worldRadius = approach(this.worldRadius, minimapRadiusFor(agl), dt);
    this.scale = this.half / this.worldRadius;

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
    this.world.queryMinimap(this.px, this.pz, this.worldRadius, this);

    // 동심 거리 링 — 반경이 변하므로 눈금도 둥근 수로 다시 고른다(고정 20/40/60 은 척도를 잃는다)
    ctx.strokeStyle = "rgba(52, 245, 255, 0.12)";
    ctx.lineWidth = 1;
    for (const r of ringRadiiFor(this.worldRadius)) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * this.scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ---- 작전구역 경계 — 경계 근처(미니맵 반경 내)일 때 호박색 점선 호로 표시(이탈 불가 안내) ----
    const zone = this.player.zone;
    if (zone && Math.abs(Math.hypot(this.px - zone.cx, this.pz - zone.cz) - zone.radius) < this.worldRadius) {
      this.project(zone.cx, zone.cz);
      ctx.strokeStyle = "rgba(255, 170, 40, 0.75)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(this.bx, this.by, zone.radius * this.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
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

    // ---- 랜드마크(점 + 테두리 화살표) — 적보다 **아래**에 그린다(교전 정보가 항상 위) ----
    this.drawLandmarks(cx, cy);

    // ---- 적 ----
    const px = this.px;
    const pz = this.pz;
    for (const e of this.enemies.aliveSnapshot) {
      const lp = this.worldToLocal(e.x - px, e.z - pz, yaw);
      const dist = Math.hypot(lp.x, lp.y);
      if (dist > this.worldRadius) {
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
      if (e.phased) {
        // 위상 이탈(§2.1) — 빈 원(확률 구름): 위치는 알지만 붙잡을 수 없다
        ctx.strokeStyle = "rgba(255, 59, 78, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
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

    // ---- 축척 — 반경이 고도마다 달라지므로 숫자로 못박지 않으면 링이 의미를 잃는다.
    // 원 밖 좌하단 모서리(정사각 캔버스에 내접원이라 네 모서리는 비어 있다)에 둔다.
    this.drawScale();

    // ---- 방위(컴퍼스) — 헤딩업이라 북쪽이 회전. N/E/S/W 를 테두리 안쪽에 표시, N 강조 + 북쪽 작은 삼각형 ----
    this.drawCompass(cx, cy);
  }

  /**
   * 랜드마크 마커 — 반경 안은 **점**, 밖은 **테두리 화살표**(방향만).
   * 출처가 BuildingCombat 인 이유: footprint 싱크에는 site 랜드마크가 없고, 파괴 여부도 모른다.
   */
  private drawLandmarks(cx: number, cy: number): void {
    const bc = this.world.buildings;
    if (!bc) return;
    const ctx = this.ctx;
    const R = this.worldRadius;
    const dot = Math.max(2, this.size * 0.017);
    this.edgeBuf.length = 0;

    bc.forEachLandmark((wx, wz, intact) => {
      const dx = wx - this.px, dz = wz - this.pz;
      const lx = dx * this.cos - dz * this.sin; // 시점 정렬(project 와 동일 회전)
      const ly = dx * this.sin + dz * this.cos;
      const dist = Math.hypot(lx, ly);
      if (dist > R) {
        if (intact) this.edgeBuf.push({ a: Math.atan2(ly, lx), d: dist });
        return;
      }
      const sx = cx + lx * this.scale, sy = cy + ly * this.scale;
      ctx.beginPath();
      ctx.arc(sx, sy, dot, 0, Math.PI * 2);
      if (intact) {
        ctx.fillStyle = C_LANDMARK_DOT;
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.strokeStyle = C_LANDMARK_DEAD; // 무너진 랜드마크 — 빈 원(사수 미션의 피해 현황)
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    });

    // 테두리 화살표 — 가까운 순, 각도 겹침 제거(밀집 도시에서 테두리가 화살표로 둘러싸이지 않게)
    ctx.fillStyle = C_LANDMARK_DOT;
    for (const m of pickEdgeMarkers(this.edgeBuf, this.edgePick)) {
      const ox = Math.cos(m.a), oy = Math.sin(m.a); // 단위 외향
      const k = Math.min(1, (R * 2) / m.d); // 가까울수록 크게(거리 감각)
      const tipR = this.half - 1.5;
      const len = Math.max(4, this.size * 0.05) * Math.max(0.5, k);
      const hw = len * 0.42;
      ctx.beginPath();
      ctx.moveTo(cx + ox * tipR, cy + oy * tipR);
      ctx.lineTo(cx + ox * (tipR - len) - oy * hw, cy + oy * (tipR - len) + ox * hw);
      ctx.lineTo(cx + ox * (tipR - len) + oy * hw, cy + oy * (tipR - len) - ox * hw);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** 현재 반경(m)을 원 밖 좌하단에 표기. 어두운 외곽선을 먼저 그어 배경과 무관하게 읽히게 한다. */
  private drawScale(): void {
    const ctx = this.ctx;
    const fontPx = Math.max(7, Math.round(this.size * 0.072));
    ctx.font = `${fontPx}px ui-monospace, "SFMono-Regular", monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const t = `${Math.round(this.worldRadius)}m`;
    const x = 1, y = this.size - fontPx * 0.35;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeText(t, x, y);
    ctx.fillStyle = "rgba(52, 245, 255, 0.7)";
    ctx.fillText(t, x, y);
  }

  /** N/E/S/W 방위 라벨(시점 회전 반영) + 북쪽 마커 삼각형. 월드 북=-Z, 동=+X. */
  private drawCompass(cx: number, cy: number): void {
    const ctx = this.ctx;
    const fontPx = Math.max(8, Math.round(this.size * 0.11));
    const rimR = this.half - fontPx * 0.72; // 라벨 중심 반경(테두리 안쪽)
    const sin = this.sin, cos = this.cos;
    // 월드 방향 단위벡터 → 미니맵 화면 좌표(project 와 동일 회전)
    const dirs: Array<[string, number, number, boolean]> = [
      ["N", 0, -1, true], ["E", 1, 0, false], ["S", 0, 1, false], ["W", -1, 0, false],
    ];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [label, dx, dz, north] of dirs) {
      const sx = cx + (dx * cos - dz * sin) * rimR;
      const sy = cy + (dx * sin + dz * cos) * rimR;
      if (north) {
        // 북쪽 마커: 바깥쪽을 향하는 작은 삼각형(라벨 바로 바깥)
        const ox = (dx * cos - dz * sin), oy = (dx * sin + dz * cos); // 단위 외향
        const tipR = this.half - 2, baseR = this.half - fontPx * 0.4, hw = fontPx * 0.28;
        const tx = cx + ox * tipR, ty = cy + oy * tipR;
        const bx0 = cx + ox * baseR - oy * hw, by0 = cy + oy * baseR + ox * hw;
        const bx1 = cx + ox * baseR + oy * hw, by1 = cy + oy * baseR - ox * hw;
        ctx.fillStyle = "rgba(52, 245, 255, 0.95)";
        ctx.beginPath();
        ctx.moveTo(tx, ty); ctx.lineTo(bx0, by0); ctx.lineTo(bx1, by1); ctx.closePath();
        ctx.fill();
      }
      ctx.font = `${north ? "bold " : ""}${north ? fontPx + 1 : fontPx}px ui-monospace, "SFMono-Regular", monospace`;
      ctx.fillStyle = north ? "rgba(52, 245, 255, 0.95)" : "rgba(52, 245, 255, 0.45)";
      ctx.fillText(label, sx, sy);
    }
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
