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
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { MAPS as MAP_DEFS } from "./maps.config.mjs";
import { bbox, polyArea, clipRect, clipPolylineToRect, dedupeFlat } from "./clip.mjs";
import { elevationMosaic, cellLattice, sampleLattice, DEM_HALO, DEM_PER_CHUNK } from "./geodem.mjs";
import { cellOwner } from "./worldValidate.mjs";

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
const mapDef = MAP_DEFS.find((m) => m.id === id); // 카탈로그 항목(name/subtitle/stream)·heightmap 권위
const cellDir = `${MAPS}/${cellLat}/${cellLon}`;
const chunkPath = (dir, cx, cz) => `${dir}/${Math.floor(cx / BLOCK)}_${Math.floor(cz / BLOCK)}/${cx}_${cz}.json`;
const readTiles = (dir) => { try { return JSON.parse(readFileSync(`${dir}/tiles.json`, "utf8")); } catch { return null; } };

// ── 셀 공유 — 한 셀에 두 도시 ──
// 1° 셀은 ~111km 인데 전장은 40km 사방이라 **공간은 충분하다**. 겹치는 건 좌표가 아니라
// 파일 경로와 인덱스였다: ① rmSync 가 셀을 통째로 날려 상대 도시 청크까지 지웠고
// ② tiles.json 이 셀당 하나라 덮어쓰였다. 실제 해당 도시는 2쌍(오사카↔나라 34/135 ·
// 홍콩↔선전 22/114 — 100도시 전수 확인).
//
// 그래서 청크마다 **소유자(m = 스트림 id)** 를 적고, 지울 때도 쓸 때도 자기 것만 건드린다.
// 범위 산술 대신 소유자 표기를 쓰는 이유: 도시 범위가 빌드마다 바뀌어도(bbox 조정·데이터 변동)
// 스테일 청크가 정확히 회수된다. 범위로 지우면 이전 범위 밖에 남은 것을 놓친다.
const selfStream = mapDef?.stream?.id ?? `${id}-stream`;
const prevTiles = readTiles(cellDir);
const prevChunks = prevTiles?.chunks ?? [];

// ── m 표기가 없는 레거시 항목의 주인 가리기 ──
// 병합 지원 이전에 구운 셀은 표기가 없다. "표기 없음 = 내 것"으로 두면 **나중에 들어오는 도시가
// 기존 도시를 통째로 지운다**(오사카 1,600청크에 표기가 0개였다 — 실제로 밟을 함정이었다).
// 레거시 셀은 단일 소유였으므로, 내가 이 셀에 처음 들어오는데 카탈로그에 동거 도시가 있다면
// 레거시는 **그 도시 것**이다. 보존할 때 m 을 채워 넣어 다음부터는 모호함이 사라진다(마이그레이션).
let catalog = [];
try { catalog = JSON.parse(readFileSync(`${MAPS}/index.json`, "utf8")); } catch { /* 최초 빌드 */ }
const coTenant = cellOwner(Array.isArray(catalog) ? catalog : [], cellLat, cellLon, selfStream);
const iAmStamped = prevChunks.some((c) => c.m === selfStream);
const legacyIsForeign = !!coTenant && !iAmStamped;
const isForeign = (c) => (c.m ? c.m !== selfStream : legacyIsForeign);
const foreign = prevChunks.filter(isForeign).map((c) => (c.m ? c : { ...c, m: coTenant.id }));
{
  const mineKeys = new Set(prevChunks.filter((c) => !isForeign(c)).map((c) => `${c.cx}_${c.cz}`));
  // 내 소유 청크 파일만 회수 — 셀 통째 삭제를 대체한다.
  for (const k of mineKeys) {
    const [cx, cz] = k.split("_").map(Number);
    rmSync(chunkPath(cellDir, cx, cz), { force: true });
  }
  if (foreign.length) {
    const tag = legacyIsForeign && prevChunks.some((c) => !c.m) ? " (레거시 → m 표기 부여)" : "";
    console.error(`  셀 공유: '${foreign[0].m}' 청크 ${foreign.length}개 보존${tag}`);
  }
}
mkdirSync(cellDir, { recursive: true });

// 맵-로컬(x,z) → 위경도 → 셀-로컬(NW 원점, x동/z남 ≥0)
const toLL = (x, z) => [lat0 - z / M_LAT, lon0 + x / M_LON0];
const toCell = (la, lo) => [(lo - cellLon) * M_LONc, (cellLat + 1 - la) * M_LAT];
const toLLc = (cx, cz) => [cellLat + 1 - cz / M_LAT, cellLon + cx / M_LONc]; // 셀-로컬 → 위경도(toCell 의 역)
const mapToCell = (x, z) => { const [la, lo] = toLL(x, z); return toCell(la, lo); };
const reproj = (p) => { const o = []; for (let i = 0; i < p.length; i += 2) { const [cx, cz] = mapToCell(p[i], p[i + 1]); o.push(Math.round(cx), Math.round(cz)); } return dedupeFlat(o); }; // 1m 정수 + 연속중복 제거(용량↓·퇴화 방지)
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
// ── 지형 = **위치의 순수 함수** ──
// 예전에는 도시별 2048² .bin(맵 중심 격자)을 샘플했다. 청크 샘플 위치는 이미 셀-로컬이라 도시와
// 무관했는데 높이 조회만 도시에 묶여 있어, 한 셀의 두 도시가 경계에서 어긋났다(실측 최대 30m).
// 이제 셀 정렬 작업 격자(geodem.cellLattice)에서 뽑는다 — 누가 구워도 같은 값이다(실측 0.00m).
// 격자는 오브젝트 비닝 뒤에 만든다(평탄화에 셀-로컬 건물 폴리곤이 필요).
const seaLevel = terrain.seaLevel ?? 0;
const coverM = mapDef?.heightmap?.meters ?? terrain.heightmap?.meters ?? null; // 전장 한 변(m)
let LAT = null; // 작업 격자(cellLattice 결과)
const sampleAt = (cx, cz) => (LAT ? sampleLattice(LAT, cx, cz) - seaLevel : 0); // 셀-로컬 표고
// 셀-로컬 (x,z) → 맵-로컬 (하이트맵 샘플용 역변환)
const cellToMap = (cx, cz) => { const la = cellLat + 1 - cz / M_LAT, lo = cellLon + cx / M_LONc; return [(lo - lon0) * M_LON0, -(la - lat0) * M_LAT]; };

// ── 맵(DEM) 청크 범위 — 오브젝트/지형 모두 이 범위로 한정. 추출이 bbox 밖(긴 도로·거대 relation)까지 끌어와도 맵 밖은 폐기. ──
let cxMin = -Infinity, cxMax = Infinity, czMin = -Infinity, czMax = Infinity;
if (coverM) {
  const corners = [[-coverM / 2, -coverM / 2], [coverM / 2, -coverM / 2], [-coverM / 2, coverM / 2], [coverM / 2, coverM / 2]];
  const cxs = [], czs = [];
  for (const [mx, mz] of corners) { const [x, z] = mapToCell(mx, mz); cxs.push(ci(x)); czs.push(ci(z)); }
  cxMin = Math.min(...cxs); cxMax = Math.max(...cxs); czMin = Math.min(...czs); czMax = Math.max(...czs);
}
const inExt = (cx, cz) => cx >= cxMin && cx <= cxMax && cz >= czMin && cz <= czMax;
// 평탄화용 범위는 **한 칸 넓다** — 경계 청크의 평탄화가 바깥 이웃 건물을 봐야 값이 완전해진다.
// 이 여유가 없으면 같은 땅을 온전히 평탄화한 옆 도시와 경계에서 어긋난다(실측 이음새 33건).
const inFlat = (cx, cz) => cx >= cxMin - 1 && cx <= cxMax + 1 && cz >= czMin - 1 && cz <= czMax + 1;

// ── 청크 누적 ──
const chunks = new Map();
const chunk = (cx, cz) => { const k = `${cx}_${cz}`; let c = chunks.get(k); if (!c) { c = { cx, cz, buildings: [], roads: [], water: [], walls: [], areas: [], sites: [] }; chunks.set(k, c); } return c; };

const flatPolys = []; // 평탄화용 셀-로컬 건물 폴리곤 — 비닝에서 만든 rp 를 재사용(2.1M 재투영 회피)
const seenBld = new Set(); // 정수 반올림 후 동일 footprint 가 된 건물 중복 제거(z-fighting·용량↓). 검증기 findDuplicateBuildings 키와 동치.
for (const b of objects.buildings ?? []) {
  const [mx, mz] = centroid(b.p); const [x, z] = mapToCell(mx, mz); const cx = ci(x), cz = ci(z);
  if (!inFlat(cx, cz)) continue; // 평탄화 여유 범위 밖 — 완전히 무관
  const rp = reproj(b.p); if (rp.length < 6) continue; // <3 정점 = 퇴화
  const [bcx, bcz] = centroid(rp);
  const sig = `${Math.round(bcx * 10)}_${Math.round(bcz * 10)}_${Math.round(polyArea(rp))}_${rp.length / 2}`;
  if (seenBld.has(sig)) continue;
  seenBld.add(sig);
  flatPolys.push({ p: rp }); //  평탄화는 여유 범위 전체를 본다
  if (!inExt(cx, cz)) continue; // 청크로는 커버리지 안만 기록
  // lm(얽힘 택소노미)·n(표시명)은 랜드마크로 승격된 건물만 보유 — 런타임 StreamingWorld 가
  // 이 필드를 보고 registerBuilding 대신 랜드마크로 등록한다(일반 건물엔 없어서 용량 영향 없음).
  chunk(cx, cz).buildings.push({ p: rp, ...(b.h != null ? { h: b.h } : {}), ...(b.lm ? { lm: b.lm } : {}), ...(b.lm && b.n ? { n: b.n } : {}) });
}
// 도로: 폴리라인을 청크 경계로 클립해 **연속 조각**으로 저장(2점 분할 폐기) → 연속 리본·중앙선, 끊김 방지.
for (const r of objects.roads ?? []) binPolyline(reproj(r.p), (cx, cz, piece) => { if (inExt(cx, cz)) chunk(cx, cz).roads.push({ p: piece, ...(r.w != null ? { w: r.w } : {}) }); });
// 담장/울타리: 동일하게 폴리라인 클립으로 연속 조각 저장.
for (const wl of objects.walls ?? []) binPolyline(reproj(wl.p), (cx, cz, piece) => { if (inExt(cx, cz)) chunk(cx, cz).walls.push({ p: piece, ...(wl.h != null ? { h: wl.h } : {}), ...(wl.w != null ? { w: wl.w } : {}) }); });
// 수역: 면(polygon)은 청크별 클립(드레이프 정확) + 멀티폴리곤 구멍(holes)도 같은 청크 rect 로 클립해 보존(섬·제방 도려냄),
// 선형 하천(w 보유)은 도로처럼 폴리라인 클립(맵 밖·거대 relation 좌표 방지).
for (const w of terrain.water ?? []) {
  if (w.w != null) { binPolyline(reproj(w.p), (cx, cz, piece) => { if (inExt(cx, cz)) chunk(cx, cz).water.push({ p: piece, w: w.w }); }); continue; }
  const outer = reproj(w.p);
  const holes = (w.holes ?? []).map(reproj).filter((h) => h.length >= 6);
  const [x0, z0, x1, z1] = bbox(outer);
  for (let cz = ci(z0); cz <= ci(z1); cz++) for (let cx = ci(x0); cx <= ci(x1); cx++) {
    if (!inExt(cx, cz)) continue;
    const oc = clipRect(outer, cx * C, cz * C, (cx + 1) * C, (cz + 1) * C);
    if (oc.length < 6 || polyArea(oc) < 1) continue;
    const hc = [];
    for (const h of holes) { const c = clipRect(h, cx * C, cz * C, (cx + 1) * C, (cz + 1) * C); if (c.length >= 6 && polyArea(c) >= 1) hc.push(c); }
    chunk(cx, cz).water.push(hc.length ? { p: oc, holes: hc } : { p: oc });
  }
}
// 지표 면(공원/잔디/숲 등): 청크별로 클립해 분배 — 각 조각이 자기 청크 격자 안에서 지형에 드레이프.
for (const a of objects.areas ?? []) binClipped(reproj(a.p), (cx, cz, c) => { if (inExt(cx, cz)) chunk(cx, cz).areas.push({ p: c, k: a.k }); });

// ── 작업 격자 구성(실측 표고 → bare-earth → 건물 아래 평탄화) ──
// 순서가 중요하다: 오브젝트 비닝이 끝난 뒤여야 셀-로컬 건물 폴리곤(flatPolys)이 준비된다.
// 격자·모자이크 모두 셀-로컬/위경도 기준이라 도시 중심에 의존하지 않는다.
if (coverM) {
  const range = { cxMin, cxMax, czMin, czMax };
  const halo = DEM_HALO * (C / DEM_PER_CHUNK);
  const [laN, loW] = toLLc(cxMin * C - halo, czMin * C - halo);
  const [laS, loE] = toLLc((cxMax + 1) * C + halo, (czMax + 1) * C + halo);
  const mosaic = elevationMosaic(Math.min(laN, laS), Math.max(laN, laS), Math.min(loW, loE), Math.max(loW, loE), 13);
  LAT = cellLattice(range, C, [cellLat, cellLon], M_LONc, mosaic, {
    bareEarthOn: mapDef?.bareEarth !== false, buildings: flatPolys,
  });
  // 검증용 산출물 — validate-world 가 같은 격자로 청크 표고를 교차검증한다.
  writeFileSync(`${BUILD_DIR}/${id}.lattice.bin`, Buffer.from(LAT.grid.buffer));
  writeFileSync(`${BUILD_DIR}/${id}.lattice.json`, JSON.stringify({ size: LAT.size, orig: LAT.orig, step: LAT.step, cell: [cellLat, cellLon], seaLevel }, null, 1));
  console.error(`  작업 격자 ${LAT.size}×${LAT.size} (${LAT.step.toFixed(2)} m/샘플, halo ${DEM_HALO}) · 평탄화 건물 ${flatPolys.length}`);
}

// 비건물 랜드마크(site — 해변·교량·공원 등): 폴리곤이 아니라 점+반경이라 **중심이 드는 청크 하나**에만 넣는다.
// 면처럼 청크마다 조각내면 해운대 하나가 랜드마크 여러 개로 세어져 미션 집계가 무너진다.
// 지표 높이(y)는 여기서 DEM 을 샘플해 구워둔다 — 런타임 청크에는 이 좌표 주변 지형만 있고 전역 DEM 은 없다.
const siteOut = [];
for (const st of objects.sites ?? []) {
  const [cxm, czm] = mapToCell(st.x, st.z);
  const x = Math.round(cxm), z = Math.round(czm);
  const cx = ci(x), cz = ci(z);
  if (!inExt(cx, cz)) continue; // 맵(DEM) 범위 밖 — 폐기
  const y = Math.round(sampleAt(cxm, czm));
  const entry = { x, z, y, r: st.r, lm: st.lm, ...(st.n ? { n: st.n } : {}) };
  chunk(cx, cz).sites.push(entry);
  siteOut.push({ ...entry, cx, cz });
}

// ── 지형: 하이트맵 커버(맵 ±meters/2) 범위의 청크에 표고 채움 ──
if (LAT) {
  const step = C / (TSZ - 1);
  for (let cz = czMin; cz <= czMax; cz++) for (let cx = cxMin; cx <= cxMax; cx++) {
    const heights = new Array(TSZ * TSZ);
    let mn = Infinity, mx2 = -Infinity;
    for (let j = 0; j < TSZ; j++) for (let i = 0; i < TSZ; i++) {
      // 샘플 위치가 셀-로컬이라 인접 청크가 공유 모서리에서 **같은 좌표**를 쓴다 → 값도 같다.
      const h = Math.round(sampleAt(cx * C + i * step, cz * C + j * step));
      heights[j * TSZ + i] = h; // 1m 정수(보간 표면은 매끄러움 유지)
      if (h < mn) mn = h; if (h > mx2) mx2 = h;
    }
    // 평탄 청크도 생성 — 해안 맵의 바다(평탄 0m)가 빈 공간이 아니라 파란 수면으로 렌더되도록(내륙 맵은 0m 청크 없음).
    chunk(cx, cz).terrain = { size: TSZ, seaLevel, heights };
  }
}

// ── 겹침은 무해하다 ──
// 청크 내용이 **위치의 순수 함수**가 된 뒤(geodem 공유 격자 + 평탄화 여유 범위) 같은 청크를 두 도시가
// 구워도 결과가 같다. 실측: 오사카↔나라 12.2km 겹침에서 소유자 다른 인접 쌍 52개·표본 1,716점
// 모서리 차이 **전부 0m**. 그래서 양보·차단이 필요 없고, 나중 빌드가 그냥 다시 쓰면 된다.
//
// 소유 표기(m)는 남긴다 — 스폰을 자기 영역으로 한정하는 데 여전히 쓰인다(남의 도심에서 시작 방지).

// ── 청크 파일(블록 디렉터리 분산) + tiles.json ──
const entries = [];
const madeBlocks = new Set();
for (const c of chunks.values()) {
  const hasObj = c.buildings.length || c.roads.length || c.water.length || c.walls.length || c.areas.length || c.sites.length;
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
      ...(c.sites.length ? { sites: c.sites } : {}),
    },
    underground: null,
  }));
  entries.push({ cx: c.cx, cz: c.cz, objects: !!hasObj, terrain: !!c.terrain, buildings: c.buildings.length, m: selfStream });
}
// 내가 다시 쓴 청크는 상대 항목에서 뺀다(중복 = chunk-dup 오류). 내용은 동일하니 소유만 옮겨간다.
const mineKeys2 = new Set(entries.map((e) => `${e.cx}_${e.cz}`));
const keptForeign = foreign.filter((c) => !mineKeys2.has(`${c.cx}_${c.cz}`));
if (keptForeign.length !== foreign.length) console.error(`  겹침 ${foreign.length - keptForeign.length}청크 소유 이전(내용 동일)`);

// tiles.json 은 **셀당 하나**라 덮어쓰면 상대 도시가 사라진다 — 남의 항목을 보존해 병합한다.
// 격자 파라미터(chunkSize·terrainSize·mLon·block)는 셀 단위라 두 도시가 같은 값을 쓴다.
const merged = [...keptForeign, ...entries];
merged.sort((a, b) => a.cz - b.cz || a.cx - b.cx);
writeFileSync(`${cellDir}/tiles.json`, JSON.stringify({
  cell: [cellLat, cellLon], originLat: cellLat + 1, originLon: cellLon, chunkSize: C, terrainSize: TSZ, mLon: M_LONc, block: BLOCK, chunks: merged,
}, null, 1));

// 빈 블록 디렉터리 회수 — 셀 통째 삭제를 그만뒀으므로(공유 셀 보호) 여기서 치운다.
{
  const live = new Set(merged.map((e) => `${Math.floor(e.cx / BLOCK)}_${Math.floor(e.cz / BLOCK)}`));
  for (const d of readdirSync(cellDir, { withFileTypes: true })) {
    if (d.isDirectory() && !live.has(d.name)) rmSync(`${cellDir}/${d.name}`, { recursive: true, force: true });
  }
}

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

// ── 스트리밍 전장 카탈로그 항목(public/maps/index.json) 업서트 ──
// 이전에는 `<id>-stream` 항목을 손으로 index.json 에 적어야 했다(100개 도시 배치의 병목 + 누락 위험).
// 이제 청크를 구운 빌드가 자기 카탈로그 항목을 직접 갱신한다 — 건물/랜드마크 수는 방금 구운 실제 값.
const st = mapDef?.stream ?? {};
const streamId = st.id ?? `${id}-stream`;
const catPath = `${MAPS}/index.json`;
let cat = [];
if (existsSync(catPath)) { try { cat = JSON.parse(readFileSync(catPath, "utf8")); } catch {} }
if (!Array.isArray(cat)) cat = [];
const totalBuildings = entries.reduce((n, e) => n + (e.buildings ?? 0), 0);
const promotedBuildings = [...chunks.values()].reduce((n, c) => n + c.buildings.filter((b) => b.lm).length, 0);
const siteLandmarks = [...chunks.values()].reduce((n, c) => n + c.sites.length, 0);
const totalLandmarks = promotedBuildings + siteLandmarks;
const entry = {
  id: streamId,
  name: st.name ?? mapDef?.name ?? id,
  subtitle: st.subtitle ?? mapDef?.subtitle ?? "",
  buildings: totalBuildings,
  landmarks: totalLandmarks,
  sites: siteLandmarks, //  그중 비건물(해변·교량·공원 등)
  lat: lat0,
  lon: lon0,
  stream: true,
  spawnYaw: st.spawnYaw ?? mapDef?.spawn?.yaw ?? 0,
};
const at = cat.findIndex((e) => e?.id === streamId);
if (at >= 0) cat[at] = { ...cat[at], ...entry }; // 손으로 넣은 부가 필드는 보존
else cat.push(entry);
writeFileSync(catPath, JSON.stringify(cat, null, 1));
console.error(`  + ${catPath}: ${streamId} (건물 ${totalBuildings}, 랜드마크 ${totalLandmarks} = 승격건물 ${promotedBuildings} + site ${siteLandmarks})`);
if (totalLandmarks === 0) console.error(`  ⚠ 랜드마크 0 — guard/aggro:landmark 미션이 무의미해진다(태그 부실 또는 큐레이션 미매칭 확인)`);

console.error(`wrote ${cellDir}/: ${entries.length} chunks (${entries.filter((e) => e.objects).length} w/objects, ${entries.filter((e) => e.terrain).length} w/terrain), chunkSize=${C}m`);
console.error(`  + tiles.json, landmarks.json (${Object.keys(lmIdx).length} total)`);
