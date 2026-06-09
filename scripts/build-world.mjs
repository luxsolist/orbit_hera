// 전지구 타일 월드 빌드 — 섹션형 맵(OSM 오브젝트) + 하이트맵(.bin, DEM 지형)을 합쳐
// 위경도 정수도 셀 디렉터리 안에 1024m 청크 파일로 분할 저장. 한 청크 파일 = 지형+오브젝트(+추후 지하).
//
// 출력(public/maps/):
//   <latCell>/<lonCell>/<bx>_<bz>/<cx>_<cz>.json  # 1024m 청크. 블록 디렉터리 <bx>_<bz>(=floor(cx/16)_floor(cz/16))로 분산(디렉터리당 ≤256 파일).
//   <latCell>/<lonCell>/tiles.json                # 셀 청크 인덱스: { cell, originLat/Lon, chunkSize, terrainSize, mLon, block, chunks:[{cx,cz}] }
//   landmarks.json                       # 전역 랜드마크 → 위치(merge)
//
// 셀 좌표계: 원점 = 셀 NW 모서리(lat=cell+1, lon=cell). x=동(+), z=남(+). cx=floor(x/C), cz=floor(z/C) ≥ 0.
// 기존 maps/<id>.json(모놀리식)은 보존(레거시). 실 NASA DEM/글로벌 OSM 취득은 별도(현재는 맵별 데이터로 시연).
//
// 실행: node scripts/build-world.mjs <id> [chunkSize=1024] [terrainSize=33]
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { MAPS as MAP_DEFS } from "./maps.config.mjs";
import { bbox, polyArea, clipRect, clipPolylineToRect } from "./clip.mjs";

const BLOCK = 16; // 블록 디렉터리 한 변(청크) — 셀 내 <bx>_<bz>/<cx>_<cz>.json. 디렉터리당 ≤ BLOCK²(256) 파일.
const id = process.argv[2];
const C = Number(process.argv[3]) || 1024;
const TSZ = Number(process.argv[4]) || 33; // 청크당 지형 샘플 한 변(33 → ~32m 간격)
if (!id) { console.error("usage: node scripts/build-world.mjs <id> [chunkSize=1024] [terrainSize=33]"); process.exit(1); }

const MAPS = "public/maps";  // 런타임 셀 청크 출력
const BUILD_DIR = "build";   // 빌드 중간물 입력(가공 OSM + DEM .bin) — 런타임 비사용
const raw = JSON.parse(readFileSync(`${BUILD_DIR}/${id}.json`, "utf8"));
const objects = raw.objects ?? { buildings: raw.buildings ?? [], roads: raw.roads ?? [], walls: raw.walls, areas: raw.areas, landmarks: raw.landmarks, water: undefined };
const terrain = raw.terrain ?? { seaLevel: 0, water: raw.water ?? [], heightmap: undefined };
const lat0 = raw.meta.lat0, lon0 = raw.meta.lon0;

const M_LAT = 111320;
const rad = (d) => (d * Math.PI) / 180;
const M_LON0 = M_LAT * Math.cos(rad(lat0)); // 맵 원점 위도 기준(맵 로컬 좌표가 빌드된 기준)
const cellLat = Math.floor(lat0), cellLon = Math.floor(lon0);
const M_LONc = M_LAT * Math.cos(rad(cellLat + 0.5)); // 셀 중앙 위도 기준(셀 격자 일관)
const cellDir = `${MAPS}/${cellLat}/${cellLon}`;
rmSync(cellDir, { recursive: true, force: true }); // 스테일 청크/블록 정리 후 재생성(범위 변경·구조 변경 대응)
mkdirSync(cellDir, { recursive: true });

// 맵-로컬(x,z) → 위경도 → 셀-로컬(NW 원점, x동/z남 ≥0)
const toLL = (x, z) => [lat0 - z / M_LAT, lon0 + x / M_LON0];
const toCell = (la, lo) => [(lo - cellLon) * M_LONc, (cellLat + 1 - la) * M_LAT];
const mapToCell = (x, z) => { const [la, lo] = toLL(x, z); return toCell(la, lo); };
const reproj = (p) => { const o = []; for (let i = 0; i < p.length; i += 2) { const [cx, cz] = mapToCell(p[i], p[i + 1]); o.push(Math.round(cx * 100) / 100, Math.round(cz * 100) / 100); } return o; };
const centroid = (p) => { let x = 0, z = 0, n = p.length / 2; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [x / n, z / n]; };
const ci = (v) => Math.floor(v / C);

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
  const buf = readFileSync(`${BUILD_DIR}/${hm.src.split("/").pop()}`);
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

// ── 맵(DEM) 청크 범위 — 오브젝트/지형 모두 이 범위로 한정. 추출이 bbox 밖(긴 도로·거대 relation)까지 끌어와도 맵 밖은 폐기. ──
let cxMin = -Infinity, cxMax = Infinity, czMin = -Infinity, czMax = Infinity;
if (H) {
  const corners = [[-hm.meters / 2, -hm.meters / 2], [hm.meters / 2, -hm.meters / 2], [-hm.meters / 2, hm.meters / 2], [hm.meters / 2, hm.meters / 2]];
  const cxs = [], czs = [];
  for (const [mx, mz] of corners) { const [x, z] = mapToCell(mx, mz); cxs.push(ci(x)); czs.push(ci(z)); }
  cxMin = Math.min(...cxs); cxMax = Math.max(...cxs); czMin = Math.min(...czs); czMax = Math.max(...czs);
}
const inExt = (cx, cz) => cx >= cxMin && cx <= cxMax && cz >= czMin && cz <= czMax;

// ── 청크 누적 ──
const chunks = new Map();
const chunk = (cx, cz) => { const k = `${cx}_${cz}`; let c = chunks.get(k); if (!c) { c = { cx, cz, buildings: [], roads: [], water: [], walls: [], areas: [] }; chunks.set(k, c); } return c; };

for (const b of objects.buildings ?? []) { const [mx, mz] = centroid(b.p); const [x, z] = mapToCell(mx, mz); const cx = ci(x), cz = ci(z); if (inExt(cx, cz)) chunk(cx, cz).buildings.push({ p: reproj(b.p), ...(b.h != null ? { h: b.h } : {}) }); }
// 도로: 폴리라인을 청크 경계로 클립해 **연속 조각**으로 저장(2점 분할 폐기) → 연속 리본·중앙선, 끊김 방지.
for (const r of objects.roads ?? []) binPolyline(reproj(r.p), (cx, cz, piece) => { if (inExt(cx, cz)) chunk(cx, cz).roads.push({ p: piece, ...(r.w != null ? { w: r.w } : {}) }); });
// 담장/울타리: 동일하게 폴리라인 클립으로 연속 조각 저장.
for (const wl of objects.walls ?? []) binPolyline(reproj(wl.p), (cx, cz, piece) => { if (inExt(cx, cz)) chunk(cx, cz).walls.push({ p: piece, ...(wl.h != null ? { h: wl.h } : {}), ...(wl.w != null ? { w: wl.w } : {}) }); });
// 수역: 면(polygon)은 청크별 클립(드레이프 정확), 선형 하천(w 보유)은 도로처럼 폴리라인 클립(맵 밖·거대 relation 좌표 방지).
for (const w of terrain.water ?? []) {
  if (w.w != null) binPolyline(reproj(w.p), (cx, cz, piece) => { if (inExt(cx, cz)) chunk(cx, cz).water.push({ p: piece, w: w.w }); });
  else binClipped(reproj(w.p), (cx, cz, c) => { if (inExt(cx, cz)) chunk(cx, cz).water.push({ p: c }); });
}
// 지표 면(공원/잔디/숲 등): 청크별로 클립해 분배 — 각 조각이 자기 청크 격자 안에서 지형에 드레이프.
for (const a of objects.areas ?? []) binClipped(reproj(a.p), (cx, cz, c) => { if (inExt(cx, cz)) chunk(cx, cz).areas.push({ p: c, k: a.k }); });

// ── 지형: 하이트맵 커버(맵 ±meters/2) 범위의 청크에 표고 채움 ──
if (H) {
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

// ── 청크 파일(블록 디렉터리 분산) + tiles.json ──
const entries = [];
const madeBlocks = new Set();
for (const c of chunks.values()) {
  const hasObj = c.buildings.length || c.roads.length || c.water.length || c.walls.length || c.areas.length;
  if (!hasObj && !c.terrain) continue;
  const bdir = `${cellDir}/${Math.floor(c.cx / BLOCK)}_${Math.floor(c.cz / BLOCK)}`;
  if (!madeBlocks.has(bdir)) { mkdirSync(bdir, { recursive: true }); madeBlocks.add(bdir); }
  writeFileSync(`${bdir}/${c.cx}_${c.cz}.json`, JSON.stringify({
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
  cell: [cellLat, cellLon], originLat: cellLat + 1, originLon: cellLon, chunkSize: C, terrainSize: TSZ, mLon: M_LONc, block: BLOCK, chunks: entries,
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
