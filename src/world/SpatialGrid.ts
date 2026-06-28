/**
 * 균일 격자 공간 인덱스 — 영역(또는 점 주변)과 겹치는 셀의 후보만 방문(브로드페이즈).
 * 충돌(플레이어 주변)·미니맵(시야 반경) 질의를 대형 맵(수천 건물)에서 전수 스캔 없이 처리.
 *
 * 한 아이템이 여러 셀에 걸쳐도 query 당 1회만 방문(epoch 스탬프로 중복 제거) →
 * 충돌 해소처럼 "후보당 1번" 처리가 필요한 경우에도 안전.
 */
export class SpatialGrid<T> {
  private readonly cell: number;
  private cols = 1;
  private rows = 1;
  private ox = 0;
  private oz = 0;
  private buckets: number[][] = [];
  private readonly items: T[];
  private readonly stamp: Int32Array;
  private epoch = 0;

  /** bound: 아이템의 월드 AABB [minX,minZ,maxX,maxZ] 반환. */
  constructor(items: T[], bound: (t: T) => [number, number, number, number], cell = 48) {
    this.items = items;
    this.cell = cell;
    this.stamp = new Int32Array(items.length).fill(-1);
    if (!items.length) return;

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    const bb: [number, number, number, number][] = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const b = bound(items[i]);
      bb[i] = b;
      if (b[0] < minX) minX = b[0];
      if (b[1] < minZ) minZ = b[1];
      if (b[2] > maxX) maxX = b[2];
      if (b[3] > maxZ) maxZ = b[3];
    }
    this.ox = minX;
    this.oz = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => [] as number[]);
    for (let i = 0; i < items.length; i++) {
      const [aX, aZ, bX, bZ] = bb[i];
      const c0 = this.colOf(aX), c1 = this.colOf(bX), r0 = this.rowOf(aZ), r1 = this.rowOf(bZ);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) this.buckets[r * this.cols + c].push(i);
    }
  }

  private colOf(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.ox) / this.cell)));
  }
  private rowOf(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.oz) / this.cell)));
  }

  /**
   * 선분 (ax,az)→(bx,az) 이 지나는 셀의 아이템만 (중복 없이) 방문 — Amanatides&Woo 격자 순회.
   * 긴 빔(시야 차폐)의 브로드페이즈: 선분 길이/셀 수만큼만 셀을 방문(영역 query 의 면적 폭발 회피).
   */
  querySegment(ax: number, az: number, bx: number, bz: number, visit: (t: T) => void): void {
    if (!this.buckets.length) return;
    const e = ++this.epoch;
    const visitCell = (c: number, r: number): void => {
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return;
      const bucket = this.buckets[r * this.cols + c];
      for (let k = 0; k < bucket.length; k++) {
        const idx = bucket[k];
        if (this.stamp[idx] === e) continue;
        this.stamp[idx] = e;
        visit(this.items[idx]);
      }
    };
    // 셀 단위 좌표
    const x0 = (ax - this.ox) / this.cell, z0 = (az - this.oz) / this.cell;
    const x1 = (bx - this.ox) / this.cell, z1 = (bz - this.oz) / this.cell;
    let c = Math.floor(x0), r = Math.floor(z0);
    const cEnd = Math.floor(x1), rEnd = Math.floor(z1);
    const dcx = x1 - x0, dcz = z1 - z0;
    const stepC = dcx > 0 ? 1 : dcx < 0 ? -1 : 0;
    const stepR = dcz > 0 ? 1 : dcz < 0 ? -1 : 0;
    const tDeltaC = stepC !== 0 ? Math.abs(1 / dcx) : Infinity;
    const tDeltaR = stepR !== 0 ? Math.abs(1 / dcz) : Infinity;
    let tMaxC = stepC > 0 ? (c + 1 - x0) * tDeltaC : stepC < 0 ? (x0 - c) * tDeltaC : Infinity;
    let tMaxR = stepR > 0 ? (r + 1 - z0) * tDeltaR : stepR < 0 ? (z0 - r) * tDeltaR : Infinity;
    visitCell(c, r);
    // 셀 수 상한 가드(무한루프 방지) — 격자 전체 둘레 정도면 충분
    let guard = this.cols + this.rows + 4;
    while ((c !== cEnd || r !== rEnd) && guard-- > 0) {
      if (tMaxC < tMaxR) { c += stepC; tMaxC += tDeltaC; }
      else { r += stepR; tMaxR += tDeltaR; }
      visitCell(c, r);
    }
  }

  /** 영역 [minX,minZ,maxX,maxZ] 과 겹치는 셀의 아이템을 (중복 없이) 방문. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, visit: (t: T) => void): void {
    if (!this.buckets.length) return;
    const e = ++this.epoch;
    const c0 = this.colOf(minX), c1 = this.colOf(maxX), r0 = this.rowOf(minZ), r1 = this.rowOf(maxZ);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const bucket = this.buckets[r * this.cols + c];
        for (let k = 0; k < bucket.length; k++) {
          const idx = bucket[k];
          if (this.stamp[idx] === e) continue;
          this.stamp[idx] = e;
          visit(this.items[idx]);
        }
      }
  }
}
