import * as THREE from "three";
import { sampleHeightmap, type NormalizedMap, type TerrainSpec } from "./MapData";

/**
 * 전장의 연속 공간 필드 — 지형 높이(heightAt)와 도심/경계 마스크를 맵 데이터로부터 질의.
 * 메시 생성(World)과 분리된 순수 질의 계층: 같은 (x,z) 입력엔 항상 같은 값(부수효과 없음 → 테스트 가능).
 *
 * heightAt 우선순위:
 *  1) terrain.heightmap + 로드된 DEM(heights) → 바이리니어 샘플(− seaLevel)
 *  2) 없으면 절차적 폴백(가우시안 봉우리 + 완만 기복 + 도심 평탄화)
 */
export class TerrainField {
  private cx0 = 0;
  private cx1 = 0;
  private cz0 = 0;
  private cz1 = 0;
  private terrain: TerrainSpec;
  private buildings: NormalizedMap["objects"]["buildings"];
  private boundary?: number[];

  constructor(map: NormalizedMap, private heights: Float32Array | null = null) {
    this.terrain = map.terrain;
    this.buildings = map.objects.buildings;
    this.boundary = map.objects.boundary;
    this.computeCityExtent();
  }

  /** 건물 분포 bbox 계산(도심 평탄 마스크/배경산 경계용) */
  private computeCityExtent() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of this.buildings) {
      for (let i = 0; i < b.p.length; i += 2) {
        const x = b.p[i], z = b.p[i + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
    if (!isFinite(x0)) { x0 = -100; x1 = 100; z0 = -100; z1 = 100; }
    this.cx0 = x0; this.cx1 = x1; this.cz0 = z0; this.cz1 = z1;
  }

  private peak(x: number, z: number, cx: number, cz: number, height: number, radius: number): number {
    const dx = x - cx, dz = z - cz;
    return height * Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
  }

  /** 도심 평탄 영역 마스크(건물 분포 bbox 안=1 → 가장자리 산지=0) */
  cityMask(x: number, z: number): number {
    const mx = (this.cx0 + this.cx1) / 2, mz = (this.cz0 + this.cz1) / 2;
    const hx = (this.cx1 - this.cx0) / 2, hz = (this.cz1 - this.cz0) / 2;
    const dx = Math.max(0, Math.abs(x - mx) - hx);
    const dz = Math.max(0, Math.abs(z - mz) - hz);
    const d = Math.sqrt(dx * dx + dz * dz);
    return 1 - THREE.MathUtils.smoothstep(d, 0, 220);
  }

  /** 맵 경계 폴리곤(있으면) 내부 판정 — 레이캐스팅. 없으면 false. */
  inPalace(x: number, z: number): boolean {
    const b = this.boundary;
    if (!b || b.length < 6) return false;
    const n = b.length / 2;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = b[i * 2], zi = b[i * 2 + 1];
      const xj = b[j * 2], zj = b[j * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /** 지형 높이(m) — DEM 하이트맵 우선, 없으면 절차적 폴백. */
  heightAt(x: number, z: number): number {
    const hm = this.terrain.heightmap;
    if (hm && this.heights) {
      const ox = hm.originX ?? -hm.meters / 2;
      const oz = hm.originZ ?? -hm.meters / 2;
      return sampleHeightmap(this.heights, hm.size, hm.meters, ox, oz, x, z) - (this.terrain.seaLevel ?? 0);
    }
    // 절차적 폴백 — 배경 산세 + 완만한 기복, 도심 평탄화.
    const proc = this.terrain.procedural;
    let h = 0;
    for (const m of proc?.mountains ?? []) h += this.peak(x, z, m.x, m.z, m.h, m.r);
    h += Math.sin(x * 0.012 + 1) * Math.cos(z * 0.011 - 2) * (proc?.ripple ?? 3);
    return proc?.flattenCity === false ? h : h * (1 - this.cityMask(x, z));
  }
}
