// 전지구 타일 월드 빌드 — 섹션형 맵(OSM 오브젝트) + 하이트맵(.bin, DEM 지형)을 합쳐
// 위경도 정수도 셀 디렉터리 안에 1024m 청크 파일로 분할 저장. 한 청크 파일 = 지형+오브젝트(+추후 지하).
//
// 출력(public/maps/):
//   <latCell>/<lonCell>/<cx>_<cz>.json   # 1024m 청크: { cx,cz, terrain{size,seaLevel,heights[]}, objects{buildings,roads,water}, underground }
//   <latCell>/<lonCell>/tiles.json       # 셀 청크 인덱스: { cell, originLat/Lon, chunkSize, terrainSize, mLon, chunks:[{cx,cz}] }
//   landmarks.json                       # 전역 랜드마크 → 위치(merge)
//
// 셀 좌표계: 원점 = 셀 NW 모서리(lat=cell+1, lon=cell). x=동(+), z=남(+). cx=floor(x/C), cz=floor(z/C) ≥ 0.
// 기존 maps/<id>.json(모놀리식)은 보존(레거시). 실 NASA DEM/글로벌 OSM 취득은 별도(현재는 맵별 데이터로 시연).
//
// 실행: node scripts/build-world.mjs <id> [chunkSize=1024] [terrainSize=33]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { MAPS as MAP_DEFS } from "./maps.config.mjs";

const id = process.argv[2];
const C = Number(process.argv[3]) || 1024;
const TSZ = Number(process.argv[4]) || 33; // 청크당 지형 샘플 한 변(33 → ~32m 간격)
if (!id) { console.error("usage: node scripts/build-world.mjs <id> [chunkSize=1024] [terrainSize=33]"); process.exit(1); }

const MAPS = "public/maps";
const raw = JSON.parse(readFileSync(`${MAPS}/${id}.json`, "utf8"));
const objects = raw.objects ?? { buildings: raw.buildings ?? [], roads: raw.roads ?? [], walls: raw.walls, areas: raw.areas, landmarks: raw.landmarks, water: undefined };
const terrain = raw.terrain ?? { seaLevel: 0, water: raw.water ?? [], heightmap: undefined };
const lat0 = raw.meta.lat0, lon0 = raw.meta.lon0;

const M_LAT = 111320;
const rad = (d) => (d * Math.PI) / 180;
const M_LON0 = M_LAT * Math.cos(rad(lat0)); // 맵 원점 위도 기준(맵 로컬 좌표가 빌드된 기준)
const cellLat = Math.floor(lat0), cellLon = Math.floor(lon0);
const M_LONc = M_LAT * Math.cos(rad(cellLat + 0.5)); // 셀 중앙 위도 기준(셀 격자 일관)
const cellDir = `${MAPS}/${cellLat}/${cellLon}`;
mkdirSync(cellDir, { recursive: true });

// 맵-로컬(x,z) → 위경도 → 셀-로컬(NW 원점, x동/z남 ≥0)
const toLL = (x, z) => [lat0 - z / M_LAT, lon0 + x / M_LON0];
const toCell = (la, lo) => [(lo - cellLon) * M_LONc, (cellLat + 1 - la) * M_LAT];
const mapToCell = (x, z) => { const [la, lo] = toLL(x, z); return toCell(la, lo); };
const reproj = (p) => { const o = []; for (let i = 0; i < p.length; i += 2) { const [cx, cz] = mapToCell(p[i], p[i + 1]); o.push(Math.round(cx * 100) / 100, Math.round(cz * 100) / 100); } return o; };
const centroid = (p) => { let x = 0, z = 0, n = p.length / 2; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [x / n, z / n]; };
const ci = (v) => Math.floor(v / C);
const bbox = (p) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < z0) z0 = p[i + 1]; if (p[i + 1] > z1) z1 = p[i + 1]; } return [x0, z0, x1, z1]; };

// Sutherland-Hodgman — 폴리곤 p([x,z,...])를 축정렬 사각형으로 클립. 결과 평면 좌표(빈 배열 가능).
function clipRect(p, minX, minZ, maxX, maxZ) {
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
  const out = []; for (const pt of poly) out.push(Math.round(pt[0] * 100) / 100, Math.round(pt[1] * 100) / 100); return out;
}

const polyArea = (p) => { let a = 0; const n = p.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1]; return Math.abs(a) / 2; };

// Liang-Barsky — 선분(a→b)의 사각형 내부 구간 [u0,u1] 산출. 밖이면 null. {C,D,cFromStart,dToEnd}.
function clipSeg(ax, az, bx, bz, xmin, zmin, xmax, zmax) {
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
 * 2점 세그먼트 분할 대신 폴리라인을 유지해 청크 안에서 연속 리본·중앙선이 그려지도록 한다.
 */
function clipPolylineToRect(p, xmin, zmin, xmax, zmax) {
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
  // cm 반올림 + 2점 이상만
  return pieces.filter((pc) => pc.length >= 4).map((pc) => pc.map((v) => Math.round(v * 100) / 100));
}

// 폴리라인을 겹치는 모든 청크에 클립해 분배(연속 조각 유지). push(cx,cz,piece). w 는 호출측에서 부착.
function binPolyline(rp, push) {
  const [x0, z0, x1, z1] = bbox(rp);
  for (let cz = ci(z0); cz <= ci(z1); cz++) for (let cx = ci(x0); cx <= ci(x1); cx++)
    for (const piece of clipPolylineToRect(rp, cx * C, cz * C, (cx + 1) * C, (cz + 1) * C)) push(cx, cz, piece);
}

// 폴리곤(셀-로컬)을 겹치는 모든 청크에 클립해 분배 — 청크 자기 격자 안에만 두어 지형 드레이프가 정확.
// 경계에서 생기는 미세 슬리버(면적<1m²)는 버려 퇴화 삼각형/렌더 노이즈를 방지.
function binClipped(rp, push) {
  const [x0, z0, x1, z1] = bbox(rp);
  for (let cz = ci(z0); cz <= ci(z1); cz++) for (let cx = ci(x0); cx <= ci(x1); cx++) {
    const c = clipRect(rp, cx * C, cz * C, (cx + 1) * C, (cz + 1) * C);
    if (c.length >= 6 && polyArea(c) >= 1) push(cx, cz, c);
  }
}

// 하이트맵(맵-로컬 좌표계) 바이리니어 샘플(− seaLevel). 없거나 범위 밖이면 0.
let H = null, hm = null, gOrig = 0, gStep = 1;
// heightmap 은 maps.config 가 권위(DEM 재생성이 OSM json 스냅샷과 분리되도록) — 없으면 json 스냅샷 사용.
const cfgHm = MAP_DEFS.find((m) => m.id === id)?.heightmap;
const heightmap = cfgHm ?? terrain.heightmap;
if (heightmap) {
  hm = heightmap;
  const buf = readFileSync(`${MAPS}/${hm.src.split("/").pop()}`);
  H = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  gOrig = hm.originX ?? -hm.meters / 2; gStep = hm.meters / (hm.size - 1);
}
const seaLevel = terrain.seaLevel ?? 0;
const sampleMap = (mx, mz) => { // 맵-로컬 (mx,mz) 표고
  if (!H) return 0;
  const gx = Math.min(hm.size - 1, Math.max(0, (mx - gOrig) / gStep));
  const gz = Math.min(hm.size - 1, Math.max(0, (mz - gOrig) / gStep));
  const x0 = Math.floor(gx), z0 = Math.floor(gz), x1 = Math.min(hm.size - 1, x0 + 1), z1 = Math.min(hm.size - 1, z0 + 1);
  const fx = gx - x0, fz = gz - z0;
  const a = H[z0 * hm.size + x0], b = H[z0 * hm.size + x1], c = H[z1 * hm.size + x0], d = H[z1 * hm.size + x1];
  const t = a + (b - a) * fx, bo = c + (d - c) * fx; return (t + (bo - t) * fz) - seaLevel;
};
// 셀-로컬 (x,z) → 맵-로컬 (하이트맵 샘플용 역변환)
const cellToMap = (cx, cz) => { const la = cellLat + 1 - cz / M_LAT, lo = cellLon + cx / M_LONc; return [(lo - lon0) * M_LON0, -(la - lat0) * M_LAT]; };

// ── 청크 누적 ──
const chunks = new Map();
const chunk = (cx, cz) => { const k = `${cx}_${cz}`; let c = chunks.get(k); if (!c) { c = { cx, cz, buildings: [], roads: [], water: [], walls: [], areas: [] }; chunks.set(k, c); } return c; };

for (const b of objects.buildings ?? []) { const [mx, mz] = centroid(b.p); const [x, z] = mapToCell(mx, mz); chunk(ci(x), ci(z)).buildings.push({ p: reproj(b.p), ...(b.h != null ? { h: b.h } : {}) }); }
// 도로: 폴리라인을 청크 경계로 클립해 **연속 조각**으로 저장(2점 분할 폐기) → 연속 리본·중앙선, 끊김 방지.
for (const r of objects.roads ?? []) binPolyline(reproj(r.p), (cx, cz, piece) => chunk(cx, cz).roads.push({ p: piece, ...(r.w != null ? { w: r.w } : {}) }));
// 담장/울타리: 동일하게 폴리라인 클립으로 연속 조각 저장.
for (const wl of objects.walls ?? []) binPolyline(reproj(wl.p), (cx, cz, piece) => chunk(cx, cz).walls.push({ p: piece, ...(wl.h != null ? { h: wl.h } : {}), ...(wl.w != null ? { w: wl.w } : {}) }));
// 수역: 면(polygon)은 청크별 클립(드레이프 정확), 선형 하천(w 보유)은 centroid 청크에 폴리라인 저장.
for (const w of terrain.water ?? []) {
  if (w.w != null) { const [mx, mz] = centroid(w.p); const [x, z] = mapToCell(mx, mz); chunk(ci(x), ci(z)).water.push({ p: reproj(w.p), w: w.w }); }
  else binClipped(reproj(w.p), (cx, cz, c) => chunk(cx, cz).water.push({ p: c }));
}
// 지표 면(공원/잔디/숲 등): 청크별로 클립해 분배 — 각 조각이 자기 청크 격자 안에서 지형에 드레이프.
for (const a of objects.areas ?? []) binClipped(reproj(a.p), (cx, cz, c) => chunk(cx, cz).areas.push({ p: c, k: a.k }));

// ── 지형: 하이트맵 커버(맵 ±meters/2) 범위의 청크에 표고 채움 ──
if (H) {
  const corners = [[-hm.meters / 2, -hm.meters / 2], [hm.meters / 2, -hm.meters / 2], [-hm.meters / 2, hm.meters / 2], [hm.meters / 2, hm.meters / 2]];
  let cxs = [], czs = [];
  for (const [mx, mz] of corners) { const [x, z] = mapToCell(mx, mz); cxs.push(ci(x)); czs.push(ci(z)); }
  const cxMin = Math.min(...cxs), cxMax = Math.max(...cxs), czMin = Math.min(...czs), czMax = Math.max(...czs);
  const step = C / (TSZ - 1);
  for (let cz = czMin; cz <= czMax; cz++) for (let cx = cxMin; cx <= cxMax; cx++) {
    const heights = new Array(TSZ * TSZ);
    let mn = Infinity, mx2 = -Infinity;
    for (let j = 0; j < TSZ; j++) for (let i = 0; i < TSZ; i++) {
      const [mxx, mzz] = cellToMap(cx * C + i * step, cz * C + j * step);
      const h = Math.round(sampleMap(mxx, mzz) * 10) / 10; heights[j * TSZ + i] = h;
      if (h < mn) mn = h; if (h > mx2) mx2 = h;
    }
    if (mx2 - mn < 0.5 && Math.abs(mx2) < 0.5) continue; // 평지 → 지형 생략(오브젝트가 있으면 아래서 빈 지형으로 기록)
    chunk(cx, cz).terrain = { size: TSZ, seaLevel, heights };
  }
}

// ── 청크 파일 + tiles.json ──
const entries = [];
for (const c of chunks.values()) {
  const hasObj = c.buildings.length || c.roads.length || c.water.length || c.walls.length || c.areas.length;
  if (!hasObj && !c.terrain) continue;
  writeFileSync(`${cellDir}/${c.cx}_${c.cz}.json`, JSON.stringify({
    cx: c.cx, cz: c.cz,
    terrain: c.terrain ?? { size: 0, seaLevel, heights: [] },
    objects: {
      buildings: c.buildings, roads: c.roads, water: c.water,
      ...(c.walls.length ? { walls: c.walls } : {}),
      ...(c.areas.length ? { areas: c.areas } : {}),
    },
    underground: null,
  }));
  entries.push({ cx: c.cx, cz: c.cz, objects: !!hasObj, terrain: !!c.terrain });
}
entries.sort((a, b) => a.cz - b.cz || a.cx - b.cx);
writeFileSync(`${cellDir}/tiles.json`, JSON.stringify({
  cell: [cellLat, cellLon], originLat: cellLat + 1, originLon: cellLon, chunkSize: C, terrainSize: TSZ, mLon: M_LONc, chunks: entries,
}, null, 1));

// ── 전역 랜드마크 인덱스(merge) — 셀-로컬 위치 + 위경도 ──
const lmPath = `${MAPS}/landmarks.json`;
let lmIdx = {};
if (existsSync(lmPath)) { try { lmIdx = JSON.parse(readFileSync(lmPath, "utf8")); } catch {} }
for (const k of Object.keys(lmIdx)) if (lmIdx[k]?.mapId === id) delete lmIdx[k];
let li = 0;
for (const lm of objects.landmarks ?? []) {
  const [la, lo] = toLL(lm.x, lm.z); const [x, z] = toCell(la, lo);
  let name = lm.id ?? lm.type ?? `landmark${li}`; if (lmIdx[name]) name = `${name}-${++li}`;
  lmIdx[name] = { mapId: id, lat: la, lon: lo, cell: [cellLat, cellLon], cx: ci(x), cz: ci(z) };
}
writeFileSync(lmPath, JSON.stringify(lmIdx, null, 1));

console.error(`wrote ${cellDir}/: ${entries.length} chunks (${entries.filter((e) => e.objects).length} w/objects, ${entries.filter((e) => e.terrain).length} w/terrain), chunkSize=${C}m`);
console.error(`  + tiles.json, landmarks.json (${Object.keys(lmIdx).length} total)`);
