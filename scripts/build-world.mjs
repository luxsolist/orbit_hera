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

const id = process.argv[2];
const C = Number(process.argv[3]) || 1024;
const TSZ = Number(process.argv[4]) || 33; // 청크당 지형 샘플 한 변(33 → ~32m 간격)
if (!id) { console.error("usage: node scripts/build-world.mjs <id> [chunkSize=1024] [terrainSize=33]"); process.exit(1); }

const MAPS = "public/maps";
const raw = JSON.parse(readFileSync(`${MAPS}/${id}.json`, "utf8"));
const objects = raw.objects ?? { buildings: raw.buildings ?? [], roads: raw.roads ?? [], landmarks: raw.landmarks, water: undefined };
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

// 하이트맵(맵-로컬 좌표계) 바이리니어 샘플(− seaLevel). 없거나 범위 밖이면 0.
let H = null, hm = null, gOrig = 0, gStep = 1;
if (terrain.heightmap) {
  hm = terrain.heightmap;
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
const chunk = (cx, cz) => { const k = `${cx}_${cz}`; let c = chunks.get(k); if (!c) { c = { cx, cz, buildings: [], roads: [], water: [] }; chunks.set(k, c); } return c; };

for (const b of objects.buildings ?? []) { const [mx, mz] = centroid(b.p); const [x, z] = mapToCell(mx, mz); chunk(ci(x), ci(z)).buildings.push({ p: reproj(b.p), ...(b.h != null ? { h: b.h } : {}) }); }
for (const r of objects.roads ?? []) { const p = r.p; for (let i = 0; i + 3 < p.length; i += 2) { const [x, z] = mapToCell((p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2); chunk(ci(x), ci(z)).roads.push({ p: reproj([p[i], p[i + 1], p[i + 2], p[i + 3]]), ...(r.w != null ? { w: r.w } : {}) }); } }
for (const w of terrain.water ?? []) { const [mx, mz] = centroid(w.p); const [x, z] = mapToCell(mx, mz); chunk(ci(x), ci(z)).water.push({ p: reproj(w.p) }); }

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
  const hasObj = c.buildings.length || c.roads.length || c.water.length;
  if (!hasObj && !c.terrain) continue;
  writeFileSync(`${cellDir}/${c.cx}_${c.cz}.json`, JSON.stringify({
    cx: c.cx, cz: c.cz,
    terrain: c.terrain ?? { size: 0, seaLevel, heights: [] },
    objects: { buildings: c.buildings, roads: c.roads, water: c.water },
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
