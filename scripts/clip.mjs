// 청크 분배용 순수 기하 클립 — build-world.mjs 와 테스트가 공유(부수효과 없음).
// 폴리곤=Sutherland-Hodgman, 폴리라인=Liang-Barsky. 좌표는 평면 m([x,z,...]). 결과는 cm 반올림.

/** 연속 중복 정점 제거([x,z,...], 정수 반올림 후 생기는 영길이 모서리 제거). 폴리곤 닫힘(마지막==처음)은 보존. */
export function dedupeFlat(p) {
  const o = [];
  for (let i = 0; i < p.length; i += 2) {
    const n = o.length;
    if (n >= 2 && o[n - 2] === p[i] && o[n - 1] === p[i + 1]) continue;
    o.push(p[i], p[i + 1]);
  }
  return o;
}

/** 폴리라인/폴리곤 평면 bbox [x0,z0,x1,z1]. */
export function bbox(p) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < z0) z0 = p[i + 1]; if (p[i + 1] > z1) z1 = p[i + 1]; }
  return [x0, z0, x1, z1];
}

/** 폴리곤 면적(shoelace, 절댓값). */
export function polyArea(p) {
  let a = 0; const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  return Math.abs(a) / 2;
}

/** Sutherland-Hodgman — 폴리곤 p([x,z,...])를 축정렬 사각형으로 클립. 결과 평면 좌표(빈 배열 가능, cm 반올림). */
export function clipRect(p, minX, minZ, maxX, maxZ) {
  let poly = []; for (let i = 0; i < p.length; i += 2) poly.push([p[i], p[i + 1]]);
  const edge = (pts, inside, ix) => {
    const out = []; const m = pts.length;
    for (let i = 0; i < m; i++) { const A = pts[(i + m - 1) % m], B = pts[i], ia = inside(A), ib = inside(B); if (ib) { if (!ia) out.push(ix(A, B)); out.push(B); } else if (ia) out.push(ix(A, B)); }
    return out;
  };
  poly = edge(poly, (P) => P[0] >= minX, (A, B) => { const t = (minX - A[0]) / (B[0] - A[0]); return [minX, A[1] + (B[1] - A[1]) * t]; });
  poly = edge(poly, (P) => P[0] <= maxX, (A, B) => { const t = (maxX - A[0]) / (B[0] - A[0]); return [maxX, A[1] + (B[1] - A[1]) * t]; });
  poly = edge(poly, (P) => P[1] >= minZ, (A, B) => { const t = (minZ - A[1]) / (B[1] - A[1]); return [A[0] + (B[0] - A[0]) * t, minZ]; });
  poly = edge(poly, (P) => P[1] <= maxZ, (A, B) => { const t = (maxZ - A[1]) / (B[1] - A[1]); return [A[0] + (B[0] - A[0]) * t, maxZ]; });
  const out = []; for (const pt of poly) out.push(Math.round(pt[0]), Math.round(pt[1])); // 1m 정수(용량↓, 게임 규모엔 충분)
  return dedupeFlat(out);
}

/** Liang-Barsky — 선분(a→b)의 사각형 내부 구간 산출. 밖이면 null. {C,D,cFromStart,dToEnd}. */
export function clipSeg(ax, az, bx, bz, xmin, zmin, xmax, zmax) {
  let u0 = 0, u1 = 1; const dx = bx - ax, dz = bz - az;
  const P = [-dx, dx, -dz, dz], Q = [ax - xmin, xmax - ax, az - zmin, zmax - az];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return null; }
    else { const t = Q[i] / P[i]; if (P[i] < 0) { if (t > u1) return null; if (t > u0) u0 = t; } else { if (t < u0) return null; if (t < u1) u1 = t; } }
  }
  if (u0 > u1) return null;
  return { C: [ax + u0 * dx, az + u0 * dz], D: [ax + u1 * dx, az + u1 * dz], cFromStart: u0 <= 1e-9, dToEnd: u1 >= 1 - 1e-9 };
}

/**
 * 폴리라인(도로/담장, [x,z,...])을 사각형으로 클립 → 연속 조각 폴리라인 배열(밖 구간에서 끊김).
 * 2점 세그먼트 분할 대신 폴리라인을 유지해 청크 안에서 연속 리본·중앙선이 그려지도록 한다. cm 반올림 + 2점 이상만.
 */
export function clipPolylineToRect(p, xmin, zmin, xmax, zmax) {
  const pieces = []; let cur = null; const eps = 1e-6;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const r = clipSeg(p[i], p[i + 1], p[i + 2], p[i + 3], xmin, zmin, xmax, zmax);
    if (!r) { cur = null; continue; }
    if (!cur || !r.cFromStart || Math.hypot(cur[cur.length - 2] - r.C[0], cur[cur.length - 1] - r.C[1]) > eps) {
      cur = [r.C[0], r.C[1]]; pieces.push(cur); // 새 진입(불연속)
    }
    cur.push(r.D[0], r.D[1]);
    if (!r.dToEnd) cur = null; // 사각형을 벗어남 → 조각 종료
  }
  return pieces.map((pc) => dedupeFlat(pc.map((v) => Math.round(v)))).filter((pc) => pc.length >= 4); // 1m 정수 + 연속중복 제거
}
