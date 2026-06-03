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
