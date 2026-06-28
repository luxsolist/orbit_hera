import * as THREE from "three";
import { SpatialGrid } from "./SpatialGrid";

type Circle = { x: number; z: number; radius: number; top: number };
/** 방향성 바운딩 박스(OBB): center + 단위 u축 + 반폭(hu:u, hv:⊥) + br(외접반경) + top(옥상=디딤면, 그 위면 통과). */
type OBB = { cx: number; cz: number; ux: number; uz: number; hu: number; hv: number; br: number; top: number };
type Tri = { ax: number; az: number; bx: number; bz: number; cx: number; cz: number; mx: number; mz: number; br: number; top: number };
type Wall = { x0: number; x1: number; z0: number; z1: number; top: number };

/**
 * 충돌 세계 — 원기둥(바위/전각)·건물 OBB·오목 건물 삼각형·궁장 박스를 모아 두고,
 * 플레이어 원(circle) 충돌을 해소한다. 대형 맵(수천 건물)을 위해 OBB/삼각형은
 * 균일 격자(SpatialGrid)로 브로드페이즈 → 플레이어 주변 후보만 검사.
 * 미니맵 등 외부 표현은 forEach*Near 로 (내부 배열을 노출하지 않고) 근처 형상만 방문.
 */
export class CollisionWorld {
  private readonly circles: Circle[] = [];
  private readonly boxes: OBB[] = [];
  private readonly tris: Tri[] = [];
  private readonly walls: Wall[] = [];
  private boxGrid = new SpatialGrid<OBB>([], () => [0, 0, 0, 0]);
  private triGrid = new SpatialGrid<Tri>([], () => [0, 0, 0, 0]);
  private readonly cornerBuf = new Array<number>(8); // forEachBuildingNear 재사용(할당 회피)

  // ─────────────── 등록 ───────────────

  /** 원기둥 콜라이더(바위/전각/동상) — 윗면(top) 이상이면 디딘 것으로 통과. */
  addCircle(x: number, z: number, radius: number, top: number): void {
    this.circles.push({ x, z, radius, top });
  }

  /** 축정렬 박스를 OBB(ang=0)로 등록(광화문 피어 등). top 위면 통과(기본 Infinity = 항상 솔리드). */
  addAabbBox(x0: number, x1: number, z0: number, z1: number, top = Infinity): void {
    const hu = (x1 - x0) / 2,
      hv = (z1 - z0) / 2;
    this.boxes.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, ux: 1, uz: 0, hu, hv, br: Math.hypot(hu, hv), top });
  }

  /** 궁장(담장) 박스 — top 보다 발이 높으면 통과(점프 넘기/위에 디딤). */
  addWallBox(x0: number, x1: number, z0: number, z1: number, top: number): void {
    this.walls.push({ x0, x1, z0, z1, top });
  }

  /**
   * footprint 다각형의 최소면적 회전 사각형(OBB)을 충돌 박스로 등록(rotating-calipers).
   * OBB 커버리지가 부족한 오목(ㄱ/ㄷ자) 건물은 삼각분할 콜라이더로 정확히 막는다.
   * inset 만큼 안으로 줄여 인접 건물 사이 통로 확보. top=옥상 높이(그 위면 통과 → 올라서기).
   */
  addFootprintBox(p: number[], inset: number, top: number): void {
    const n = p.length / 2;
    let polyA = 0;
    for (let i = 0, j = n - 1; i < n; j = i++)
      polyA += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
    polyA = Math.abs(polyA) / 2;

    let best = Infinity, bux = 1, buz = 0, bcu = 0, bcv = 0, bhu = 0, bhv = 0;
    for (let e = 0; e < n; e++) {
      const ex = p[((e + 1) % n) * 2] - p[e * 2];
      const ez = p[((e + 1) % n) * 2 + 1] - p[e * 2 + 1];
      const L = Math.hypot(ex, ez);
      if (L < 1e-6) continue;
      const ux = ex / L, uz = ez / L;
      let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
      for (let i = 0; i < n; i++) {
        const px = p[i * 2], pz = p[i * 2 + 1];
        const u = px * ux + pz * uz;
        const v = -px * uz + pz * ux;
        if (u < umin) umin = u;
        if (u > umax) umax = u;
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
      const area = (umax - umin) * (vmax - vmin);
      if (area < best) {
        best = area;
        bux = ux;
        buz = uz;
        bcu = (umin + umax) / 2;
        bcv = (vmin + vmax) / 2;
        bhu = (umax - umin) / 2;
        bhv = (vmax - vmin) / 2;
      }
    }
    if (!isFinite(best)) return;
    if (polyA / best < 0.7) {
      this.addTriColliders(p, top);
      return;
    }
    const hu = Math.max(0.1, bhu - inset),
      hv = Math.max(0.1, bhv - inset);
    this.boxes.push({
      cx: bcu * bux - bcv * buz,
      cz: bcu * buz + bcv * bux,
      ux: bux,
      uz: buz,
      hu,
      hv,
      br: Math.hypot(hu, hv),
      top,
    });
  }

  /** 오목 footprint 를 삼각분할(ear-clipping)해 삼각형 콜라이더로 등록. top=옥상 높이. */
  private addTriColliders(p: number[], top: number): void {
    let n = p.length / 2;
    if (n >= 2 && p[0] === p[(n - 1) * 2] && p[1] === p[(n - 1) * 2 + 1]) n -= 1;
    if (n < 3) return;
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      return;
    }
    for (const t of tris) {
      const a = contour[t[0]], b = contour[t[1]], c = contour[t[2]];
      const mx = (a.x + b.x + c.x) / 3,
        mz = (a.y + b.y + c.y) / 3;
      const br = Math.max(
        Math.hypot(a.x - mx, a.y - mz),
        Math.hypot(b.x - mx, b.y - mz),
        Math.hypot(c.x - mx, c.y - mz)
      );
      this.tris.push({ ax: a.x, az: a.y, bx: b.x, bz: b.y, cx: c.x, cz: c.y, mx, mz, br, top });
    }
  }

  /** 모든 등록 후 1회 호출 — 격자 공간 인덱스 구축. */
  finalize(): void {
    this.boxGrid = new SpatialGrid<OBB>(this.boxes, (b) => [b.cx - b.br, b.cz - b.br, b.cx + b.br, b.cz + b.br]);
    this.triGrid = new SpatialGrid<Tri>(this.tris, (t) => [t.mx - t.br, t.mz - t.br, t.mx + t.br, t.mz + t.br]);
  }

  // ─────────────── 질의(물리) ───────────────

  /** 원(반경 radius, 발높이 feetY)을 장애물 밖으로 밀어낸 위치 반환. */
  resolveCollision(x: number, z: number, radius: number, feetY: number): { x: number; z: number } {
    // 원기둥(바위/전각): 윗면 위면 디딘 것으로 통과(선형 — 개수 적음)
    for (const c of this.circles) {
      if (feetY >= c.top - 0.05) continue;
      const dx = x - c.x, dz = z - c.z;
      const min = c.radius + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        x += dx * push;
        z += dz * push;
      } else {
        x += min;
      }
    }
    const pad = radius + 1.5; // 격자 질의 여유(해소 중 작은 이동 커버)
    // 건물 OBB(원-사각형): 격자 브로드페이즈. 발이 옥상 이상이면 통과(올라서기).
    this.boxGrid.query(x - pad, z - pad, x + pad, z + pad, (b) => {
      if (feetY >= b.top - 0.05) return;
      const dx = x - b.cx, dz = z - b.cz;
      if (dx * dx + dz * dz > (b.br + radius) * (b.br + radius)) return;
      const lu = dx * b.ux + dz * b.uz;
      const lv = -dx * b.uz + dz * b.ux;
      const cu = lu < -b.hu ? -b.hu : lu > b.hu ? b.hu : lu;
      const cv = lv < -b.hv ? -b.hv : lv > b.hv ? b.hv : lv;
      let nu = lu, nv = lv;
      if (cu !== lu || cv !== lv) {
        const du = lu - cu, dv = lv - cv;
        const d2 = du * du + dv * dv;
        if (d2 >= radius * radius || d2 < 1e-9) return;
        const d = Math.sqrt(d2);
        const push = (radius - d) / d;
        nu = lu + du * push;
        nv = lv + dv * push;
      } else {
        const pul = lu + b.hu + radius;
        const pur = b.hu - lu + radius;
        const pvl = lv + b.hv + radius;
        const pvr = b.hv - lv + radius;
        const m = Math.min(pul, pur, pvl, pvr);
        if (m === pul) nu = -b.hu - radius;
        else if (m === pur) nu = b.hu + radius;
        else if (m === pvl) nv = -b.hv - radius;
        else nv = b.hv + radius;
      }
      x = b.cx + nu * b.ux - nv * b.uz;
      z = b.cz + nu * b.uz + nv * b.ux;
    });
    // 오목 건물 삼각형(원-삼각형): 격자 브로드페이즈. 발이 옥상 이상이면 통과.
    this.triGrid.query(x - pad, z - pad, x + pad, z + pad, (t) => {
      if (feetY >= t.top - 0.05) return;
      const dmx = x - t.mx, dmz = z - t.mz;
      if (dmx * dmx + dmz * dmz > (t.br + radius) * (t.br + radius)) return;
      const ex = [t.ax, t.bx, t.cx], ez = [t.az, t.bz, t.cz];
      let bd2 = Infinity, qx = 0, qz = 0, ne = 0;
      for (let k = 0; k < 3; k++) {
        const ax = ex[k], az = ez[k];
        const sx = ex[(k + 1) % 3] - ax, sz = ez[(k + 1) % 3] - az;
        const tt = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / (sx * sx + sz * sz || 1)));
        const cxp = ax + sx * tt, czp = az + sz * tt;
        const d2 = (x - cxp) ** 2 + (z - czp) ** 2;
        if (d2 < bd2) {
          bd2 = d2;
          qx = cxp;
          qz = czp;
          ne = k;
        }
      }
      const s1 = (x - t.bx) * (t.az - t.bz) - (t.ax - t.bx) * (z - t.bz);
      const s2 = (x - t.cx) * (t.bz - t.cz) - (t.bx - t.cx) * (z - t.cz);
      const s3 = (x - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (z - t.az);
      const inside = !((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0));
      if (inside) {
        const ax = ex[ne], az = ez[ne];
        let nx = -(ez[(ne + 1) % 3] - az), nz = ex[(ne + 1) % 3] - ax;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl;
        nz /= nl;
        if (nx * (t.mx - ax) + nz * (t.mz - az) > 0) {
          nx = -nx;
          nz = -nz;
        }
        x = qx + nx * radius;
        z = qz + nz * radius;
      } else if (bd2 < radius * radius) {
        const d = Math.sqrt(bd2) || 1e-6;
        const push = (radius - d) / d;
        x += (x - qx) * push;
        z += (z - qz) * push;
      }
    });
    // 궁장 박스(원-AABB, 선형): 발이 윗면 이상이면 통과
    for (const b of this.walls) {
      if (feetY >= b.top - 0.05) continue;
      if (x <= b.x0 - radius || x >= b.x1 + radius || z <= b.z0 - radius || z >= b.z1 + radius) continue;
      const cxp = x < b.x0 ? b.x0 : x > b.x1 ? b.x1 : x;
      const czp = z < b.z0 ? b.z0 : z > b.z1 ? b.z1 : z;
      if (cxp !== x || czp !== z) {
        const dx = x - cxp, dz = z - czp;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const push = (radius - d) / d;
        x += dx * push;
        z += dz * push;
      } else {
        const pxl = x - b.x0 + radius;
        const pxr = b.x1 - x + radius;
        const pzl = z - b.z0 + radius;
        const pzr = b.z1 - z + radius;
        const m = Math.min(pxl, pxr, pzl, pzr);
        if (m === pxl) x = b.x0 - radius;
        else if (m === pxr) x = b.x1 + radius;
        else if (m === pzl) z = b.z0 - radius;
        else z = b.z1 + radius;
      }
    }
    return { x, z };
  }

  /** (x,z) 에서 디딜 수 있는 가장 높은 윗면(원기둥/담장/건물 옥상) — 없으면 -Infinity. */
  topAt(x: number, z: number): number {
    let best = -Infinity;
    for (const c of this.circles) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz <= c.radius * c.radius && c.top > best) best = c.top;
    }
    for (const b of this.walls) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.top > best) best = b.top;
    }
    // 건물 OBB 옥상(점-OBB 내부 판정)
    this.boxGrid.query(x, z, x, z, (b) => {
      if (!isFinite(b.top) || b.top <= best) return;
      const dx = x - b.cx, dz = z - b.cz;
      const lu = dx * b.ux + dz * b.uz;
      const lv = -dx * b.uz + dz * b.ux;
      if (Math.abs(lu) <= b.hu && Math.abs(lv) <= b.hv) best = b.top;
    });
    // 오목 건물 삼각형 옥상(점-삼각형 내부 판정)
    this.triGrid.query(x, z, x, z, (t) => {
      if (!isFinite(t.top) || t.top <= best) return;
      const s1 = (x - t.bx) * (t.az - t.bz) - (t.ax - t.bx) * (z - t.bz);
      const s2 = (x - t.cx) * (t.bz - t.cz) - (t.bx - t.cx) * (z - t.cz);
      const s3 = (x - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (z - t.az);
      if (!((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0))) best = t.top;
    });
    return best;
  }

  /**
   * 시야 차폐 — 3D 선분 (sx,sy,sz)→(ex,ey,ez) 이 솔리드(건물 OBB/오목 삼각형/담장/바위, 지면~옥상 top)에
   * 처음 막히는 지점의 매개변수 t∈[0,1] 을 반환(막힘 없으면 Infinity). 빔이 옥상(top) 위로 지나가면 통과,
   * 파괴되어 개방된(top=-Infinity) 건물은 무시. 빔/드레인의 건물 관통 차단에 사용.
   */
  segmentBlocked(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): number {
    const dx = ex - sx, dy = ey - sy, dz = ez - sz;
    let best = Infinity;
    // XZ 구간 [t0,t1](선분 내부 = footprint 내부)에서 y(t)<top 이 되는 첫 t 를 best 로 갱신.
    const consider = (t0: number, t1: number, top: number): void => {
      if (t0 < 0) t0 = 0;
      if (t1 > 1) t1 = 1;
      if (t1 < t0) return;
      const y0 = sy + dy * t0;
      let tHit: number;
      if (y0 < top) tHit = t0;             // 진입 시점에 이미 옥상 아래 → 즉시 차폐
      else if (dy >= 0) return;            // 상승 중 + 이미 옥상 위 → 계속 위 → 통과
      else {                               // 하강 중 → 옥상 아래로 내려가는 시점
        tHit = t0 + (top - y0) / dy;
        if (tHit > t1) return;
      }
      if (tHit < best) best = tHit;
    };
    // 건물 OBB(선분-OBB: 로컬 프레임 슬랩)
    this.boxGrid.querySegment(sx, sz, ex, ez, (b) => {
      const rx = sx - b.cx, rz = sz - b.cz;
      const lu = rx * b.ux + rz * b.uz, lv = -rx * b.uz + rz * b.ux;
      const du = dx * b.ux + dz * b.uz, dv = -dx * b.uz + dz * b.ux;
      let t0 = -Infinity, t1 = Infinity;
      if (Math.abs(du) < 1e-9) { if (lu < -b.hu || lu > b.hu) return; }
      else { let a = (-b.hu - lu) / du, c = (b.hu - lu) / du; if (a > c) { const s = a; a = c; c = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
      if (Math.abs(dv) < 1e-9) { if (lv < -b.hv || lv > b.hv) return; }
      else { let a = (-b.hv - lv) / dv, c = (b.hv - lv) / dv; if (a > c) { const s = a; a = c; c = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
      if (t0 <= t1) consider(t0, t1, b.top);
    });
    // 오목 건물 삼각형(선분-삼각형: 3변 반평면 클리핑)
    this.triGrid.querySegment(sx, sz, ex, ez, (t) => {
      let t0 = 0, t1 = 1;
      const vx = [t.ax, t.bx, t.cx], vz = [t.az, t.bz, t.cz];
      for (let k = 0; k < 3; k++) {
        const px = vx[k], pz = vz[k], qx = vx[(k + 1) % 3], qz = vz[(k + 1) % 3];
        let nx = -(qz - pz), nz = qx - px;                       // 변에 수직
        if (nx * (t.mx - px) + nz * (t.mz - pz) < 0) { nx = -nx; nz = -nz; } // 내부(무게중심) 향하게
        const c = nx * (sx - px) + nz * (sz - pz), s = nx * dx + nz * dz;    // f(t)=c+s·t ≥ 0 = 내부
        if (Math.abs(s) < 1e-12) { if (c < 0) { t0 = 1; t1 = 0; break; } }
        else { const tc = -c / s; if (s > 0) t0 = Math.max(t0, tc); else t1 = Math.min(t1, tc); }
        if (t0 > t1) break;
      }
      if (t0 <= t1) consider(t0, t1, t.top);
    });
    // 담장 박스(선분-AABB 슬랩) — 개수 적음
    for (const w of this.walls) {
      let t0 = -Infinity, t1 = Infinity;
      if (Math.abs(dx) < 1e-9) { if (sx < w.x0 || sx > w.x1) continue; }
      else { let a = (w.x0 - sx) / dx, c = (w.x1 - sx) / dx; if (a > c) { const s = a; a = c; c = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
      if (Math.abs(dz) < 1e-9) { if (sz < w.z0 || sz > w.z1) continue; }
      else { let a = (w.z0 - sz) / dz, c = (w.z1 - sz) / dz; if (a > c) { const s = a; a = c; c = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
      if (t0 <= t1) consider(t0, t1, w.top);
    }
    // 원기둥(바위/전각/동상)(선분-원: 2차방정식) — 개수 적음
    const A = dx * dx + dz * dz;
    if (A > 1e-9) {
      for (const cc of this.circles) {
        const fx = sx - cc.x, fz = sz - cc.z;
        const B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - cc.radius * cc.radius;
        const disc = B * B - 4 * A * C;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        consider((-B - sq) / (2 * A), (-B + sq) / (2 * A), cc.top);
      }
    }
    return best;
  }

  // ─────────────── 질의(표현: 미니맵 등, 할당 회피) ───────────────

  /** 영역 근처 건물 OBB 의 4모서리(월드 [x0,z0,x1,z1,x2,z2,x3,z3])를 방문. */
  forEachBuildingNear(
    minX: number, minZ: number, maxX: number, maxZ: number,
    cb: (corners: ReadonlyArray<number>) => void
  ): void {
    const c = this.cornerBuf;
    this.boxGrid.query(minX, minZ, maxX, maxZ, (b) => {
      const vx = -b.uz, vz = b.ux;
      c[0] = b.cx + b.ux * b.hu + vx * b.hv;
      c[1] = b.cz + b.uz * b.hu + vz * b.hv;
      c[2] = b.cx + b.ux * b.hu - vx * b.hv;
      c[3] = b.cz + b.uz * b.hu - vz * b.hv;
      c[4] = b.cx - b.ux * b.hu - vx * b.hv;
      c[5] = b.cz - b.uz * b.hu - vz * b.hv;
      c[6] = b.cx - b.ux * b.hu + vx * b.hv;
      c[7] = b.cz - b.uz * b.hu + vz * b.hv;
      cb(c);
    });
  }

  /** 영역 근처 오목 건물 삼각형 정점(월드)을 방문. */
  forEachTriNear(
    minX: number, minZ: number, maxX: number, maxZ: number,
    cb: (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => void
  ): void {
    this.triGrid.query(minX, minZ, maxX, maxZ, (t) => cb(t.ax, t.az, t.bx, t.bz, t.cx, t.cz));
  }

  /** (cx,cz) 반경 radius 안의 원기둥 콜라이더(전각/동상)를 방문(선형 — 개수 적음). */
  forEachCircleNear(cx: number, cz: number, radius: number, cb: (x: number, z: number, r: number) => void): void {
    for (const c of this.circles) {
      if (Math.hypot(c.x - cx, c.z - cz) - c.radius > radius) continue;
      cb(c.x, c.z, c.radius);
    }
  }

  /**
   * (cx,cz) 의 건물 콜라이더를 통과 가능하게 개방 — 파괴된 건물 잔해 위를 지나갈 수 있도록.
   * 중심을 품는 박스/삼각형/원기둥의 top 을 -Infinity 로(발이 항상 윗면 이상 = 통과). 디딤면(topAt)에서도 제외됨.
   */
  openBuildingAt(cx: number, cz: number): void {
    this.boxGrid.query(cx, cz, cx, cz, (b) => {
      const dx = cx - b.cx, dz = cz - b.cz;
      const lu = dx * b.ux + dz * b.uz, lv = -dx * b.uz + dz * b.ux;
      if (Math.abs(lu) <= b.hu && Math.abs(lv) <= b.hv) b.top = -Infinity;
    });
    this.triGrid.query(cx, cz, cx, cz, (t) => {
      const s1 = (cx - t.bx) * (t.az - t.bz) - (t.ax - t.bx) * (cz - t.bz);
      const s2 = (cx - t.cx) * (t.bz - t.cz) - (t.bx - t.cx) * (cz - t.cz);
      const s3 = (cx - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (cz - t.az);
      if (!((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0))) t.top = -Infinity;
    });
    for (const c of this.circles) {
      if ((c.x - cx) ** 2 + (c.z - cz) ** 2 <= c.radius * c.radius) c.top = -Infinity;
    }
  }
}
