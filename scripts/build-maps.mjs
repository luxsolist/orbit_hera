// 전지구 명소 전장 데이터 빌드: OSM(Overpass) 실측 수집 → 로컬 미터 투영 → public/maps/<id>.json
// + 카탈로그 public/maps/index.json. 일부 환경에서 Node fetch 가 IPv6 로만 시도해 막히므로
// 수집은 curl(IPv4)을 자식 프로세스로 호출한다.
//
// 실행: node scripts/build-maps.mjs            (모든 맵)
//       node scripts/build-maps.mjs manhattan  (특정 맵만)
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { MAPS } from "./maps.config.mjs";
import { RECIPES } from "./landmarks.mjs";
import { projFns, buildingHeight, roadWidth, ringArea, wallSpec, areaKind, relationRings, sanitizeRing, sanitizePolyline, smoothPolyline, overpassQuery, isVehicularHighway, mergeStrokes, isUndergroundWaterway, surfaceWaterways, bboxTiles, mergeOSM } from "./osm.mjs";

// 레시피가 있는 랜드마크는 부품 목록(structure)으로 베이킹, 나머지는 그대로(타입별 빌더).
function bakeLandmarks(landmarks) {
  return (landmarks ?? []).map((lm) => {
    const recipe = RECIPES[lm.type];
    if (!recipe) return lm;
    const r = recipe();
    return {
      type: "structure",
      id: lm.type,
      x: lm.x,
      z: lm.z,
      ...(lm.rot ? { rot: lm.rot } : {}),
      mats: r.mats,
      parts: r.parts,
      colliders: r.colliders,
      ...(r.excludeR != null ? { excludeR: r.excludeR } : {}),
    };
  });
}

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const only = process.argv[2];
const OUT_DIR = "public/maps";   // 런타임 자산(카탈로그 index.json)만
const BUILD_DIR = "build";        // 빌드 중간물(가공 OSM monolithic <id>.json) — 런타임 비사용, git 비추적
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(BUILD_DIR, { recursive: true });

/**
 * 단일 bbox Overpass 수집(엔드포인트 폴백). **데이터 있는 응답을 우선** — 과부하 시 빈 200 을
 * 반환하는 엔드포인트가 있어, 빈 응답이면 다른 엔드포인트도 시도하고 모두 빈일 때만 빈으로 확정.
 * 선택한 결과를 cacheFile 에 기록 후 반환. 모두 실패면 throw.
 */
function fetchOverpass(bbox, qf, cacheFile) {
  writeFileSync(qf, overpassQuery(bbox, { date: process.env.OSM_DATE }));
  const tmp = `${cacheFile}.tmp`;
  let lastErr, emptyResult = null;
  for (const ep of ENDPOINTS) {
    try {
      execFileSync(
        "curl",
        ["-sS", "-m", "70", "-A", "SeedGame/0.4 (map builder; contact luxsolist@gmail.com)",
          "-G", ep, "--data-urlencode", `data@${qf}`, "-o", tmp],
        { stdio: ["ignore", "ignore", "inherit"] }
      );
      const txt = readFileSync(tmp, "utf8");
      if (!txt.trim().startsWith("{")) throw new Error("non-JSON(XML 에러/타임아웃?)");
      const j = JSON.parse(txt);
      if (!Array.isArray(j.elements)) throw new Error("elements 누락");
      if (j.elements.length) { writeFileSync(cacheFile, txt); try { rmSync(tmp); } catch {} return j; } // 데이터 있음 → 채택
      emptyResult = txt; // 빈 응답 — 다른 엔드포인트도 확인(과부하 빈 200 회피)
    } catch (e) { lastErr = e; }
  }
  try { rmSync(tmp); } catch {}
  if (emptyResult != null) { writeFileSync(cacheFile, emptyResult); return JSON.parse(emptyResult); } // 모든 엔드포인트가 빈 → 진짜 빈으로 확정
  throw lastErr || new Error("fetch failed");
}

/**
 * OSM 수집 — bbox 가 크면(>~0.06°) 타일 격자로 분할해 타일별 수집·캐시·병합(단일 쿼리 타임아웃 회피·재개 가능).
 * 작은 bbox 는 단일 쿼리. 타일 캐시 /tmp/osm-<id>-t<r>_<c>.json 로 중단 후 재실행 시 이어받음.
 */
function fetchOSM(id, bbox) {
  const cache = `/tmp/osm-${id}.json`;
  if (existsSync(cache) && statSync(cache).size > 1000) {
    console.error(`  using cached ${cache}`);
    return JSON.parse(readFileSync(cache, "utf8"));
  }
  // 대면적은 ~1km(0.0095°≈1024m) 타일로 순차 수집 — 도심 밀집 타일도 타임아웃 없이 처리(작은 쿼리).
  const tiles = (bbox[2] - bbox[0] > 0.06 || bbox[3] - bbox[1] > 0.06) ? bboxTiles(bbox, 0.0095) : [bbox];
  if (tiles.length === 1) {
    const j = fetchOverpass(bbox, `/tmp/q-${id}.overpassql`, cache);
    if (!j.elements.length) throw new Error("empty response");
    return j;
  }
  // 중심(스폰 일대)에서 가까운 타일부터 — 부분 수집이어도 플레이 영역이 먼저 채워짐. 캐시 키=타일 좌표(순서 무관 재개).
  const ctrLat = (bbox[0] + bbox[2]) / 2, ctrLon = (bbox[1] + bbox[3]) / 2;
  tiles.sort((a, b) => Math.hypot((a[0] + a[2]) / 2 - ctrLat, (a[1] + a[3]) / 2 - ctrLon) - Math.hypot((b[0] + b[2]) / 2 - ctrLat, (b[1] + b[3]) / 2 - ctrLon));
  const partial = process.env.OSM_PARTIAL === "1"; // 중간 빌드 — 캐시된 타일만 병합, 네트워크 수집 생략(수집 프로세스와 병행).
  console.error(`  tiled ${partial ? "PARTIAL(캐시만)" : "fetch"}: ${tiles.length} tiles (≈1km each, 중심→외곽 순차·재개)`);
  const parts = [];
  const failed = [];
  const tkey = (t) => `${Math.round(t[0] * 1e4)}_${Math.round(t[1] * 1e4)}`;
  for (let i = 0; i < tiles.length; i++) {
    const tf = `/tmp/osm-${id}-t${tkey(tiles[i])}.json`;
    if (existsSync(tf) && statSync(tf).size > 100) {
      try { const j = JSON.parse(readFileSync(tf, "utf8")); if (Array.isArray(j.elements)) { parts.push(j); continue; } } catch {}
      if (!partial) try { rmSync(tf); } catch {} // 손상 캐시 제거 후 재수집(부분 모드는 수집 프로세스 캐시 건드리지 않음)
    }
    if (partial) { failed.push(i); continue; } // 미수집 타일은 건너뜀(네트워크 X)
    if (i % 25 === 0) console.error(`  [${i + 1}/${tiles.length}] ${tiles[i].map((v) => v.toFixed(3)).join(",")}`);
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try { parts.push(fetchOverpass(tiles[i], `/tmp/q-${id}-tmp.overpassql`, tf)); ok = true; }
      catch (e) { if (attempt) console.error(`   tile ${tkey(tiles[i])} 실패: ${e.message}`); }
    }
    if (!ok) failed.push(i); // 캐시 미기록 → 재실행 시 재시도(중단 없이 계속)
  }
  if (failed.length) console.error(`  ${partial ? "미수집" : "⚠ 실패"} ${failed.length}/${tiles.length} 타일${partial ? "(수집 진행 중)" : "(재실행 시 재시도)"}`);
  if (partial && !parts.length) throw new Error("캐시된 타일 없음 — 수집이 먼저 진행돼야 함");
  const merged = mergeOSM(parts);
  if (failed.length === 0) writeFileSync(cache, JSON.stringify(merged)); // 전 타일 성공 시에만 병합 캐시(부분 수집은 캐시 안 함 → 다음 실행서 누락분 채움)
  console.error(`  merged ${merged.elements.length} elements from ${tiles.length - failed.length}/${tiles.length} tiles`);
  return merged;
}

function processOSM(osm, proj) {
  const buildings = [];
  const roads = [];
  const water = [];
  const walls = [];
  const areas = [];
  const waterways = []; // 강/하천 중심선(지표 노출 판정 후 water 로)

  const wayFlat = (el) => {
    const flat = [];
    for (const g of el.geometry) { const [x, z] = proj(g.lat, g.lon); flat.push(x, z); }
    return flat;
  };
  // 건물 footprint: 정리(연속중복 제거 + 자기교차는 볼록껍질 복구) + 면적 필터 + 동일 footprint 중복 제거(z-fighting 방지).
  const seenB = new Set();
  const addBuilding = (t, flat) => {
    const cp = sanitizeRing(flat, true);
    if (!cp || ringArea(cp) < 12) return;
    const n = cp.length / 2; let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += cp[i * 2]; cz += cp[i * 2 + 1]; }
    const sig = `${Math.round(cx / n * 10)}_${Math.round(cz / n * 10)}_${Math.round(ringArea(cp))}_${n}`;
    if (seenB.has(sig)) return; // OSM 중복 way
    seenB.add(sig);
    buildings.push({ p: cp, h: buildingHeight(t) });
  };
  // 면(폴리곤) 분류 — 수역/녹지·자연 면. 닫힌 면만(선형 제외). 자기교차면 드롭(복구 안 함 — 큰 concave 왜곡 방지).
  const classifyArea = (t, flat) => {
    if (flat.length < 6) return;
    const cp = sanitizeRing(flat, false);
    if (!cp) return;
    if (t.natural === "water" || t.water || t.waterway === "riverbank") { water.push({ p: cp }); return; }
    const k = areaKind(t);
    if (k) areas.push({ p: cp, k });
  };

  for (const el of osm.elements) {
    const t = el.tags || {};
    if (el.type === "relation") {
      // 멀티폴리곤 outer 들을 개별 면으로(건물 관계 = 건물).
      const isBld = !!t.building;
      for (const flat of relationRings(el, proj)) {
        if (isBld) addBuilding(t, flat);
        else classifyArea(t, flat);
      }
      continue;
    }
    if (el.type !== "way" || !el.geometry) continue;
    const flat = wayFlat(el);
    if (flat.length < 4) continue;
    if (t.building) {
      addBuilding(t, flat);
    } else if (t.barrier) {
      const w = wallSpec(t);
      const wp = w && sanitizePolyline(flat);
      if (wp) walls.push({ p: wp, h: w.h, w: w.w });
    } else if (t.highway) {
      // 차도만 수집(보도/오솔길/계단 등 보행로 제외). 스무딩은 stroke 병합 후 일괄(연속 곡선).
      if (!isVehicularHighway(t.highway)) continue;
      const rp = sanitizePolyline(flat);
      if (rp) roads.push({ p: rp, w: roadWidth(t.highway) });
    } else if (t.waterway === "river" || t.waterway === "stream" || t.waterway === "canal") {
      // 강/하천 중심선(선형) — 지표 노출 판정(수계 연결성)은 수집 후 surfaceWaterways 로 일괄.
      const wl = sanitizePolyline(flat);
      if (wl && wl.length >= 4) waterways.push({ p: wl, culverted: isUndergroundWaterway(t), stream: t.waterway === "stream", w: t.waterway === "river" ? 24 : 6 });
    } else {
      classifyArea(t, flat);
    }
  }
  // 연결된 같은-폭 도로를 stroke 로 병합(교차로 관통 연속화) 후 곡선 스무딩 → 중앙선·표면 끊김 최소화.
  const mergedRoads = mergeStrokes(roads).map((s) => ({ p: smoothPolyline(s.p, 2), w: s.w }));
  // 지표 노출 하천만 water 로(복개 수계의 태그 누락 지표 구간까지 숨김).
  for (const s of surfaceWaterways(waterways)) water.push({ p: s.p, w: s.w });
  return { buildings, roads: mergedRoads, water, walls, areas };
}

const catalog = [];
for (const m of MAPS) {
  if (only && m.id !== only) continue;
  console.error(`== ${m.id} (${m.name}) ==`);
  const proj = projFns(m.lat0, m.lon0);

  let core, boundary, precinct;
  if (m.local?.from) {
    // 이미 빌드된 맵 자신을 소스로(OSM 데이터 그대로 통과, 나머지는 config 로 재베이킹).
    // 소스가 평면(v1) 또는 섹션(v2) 둘 다 수용.
    const src = JSON.parse(readFileSync(m.local.from, "utf8"));
    if (src.objects) {
      core = { buildings: src.objects.buildings, roads: src.objects.roads, water: src.terrain?.water ?? [], walls: src.objects.walls ?? [], areas: src.objects.areas ?? [] };
      boundary = src.objects.boundary;
      precinct = src.objects.precinct;
    } else {
      core = { buildings: src.buildings, roads: src.roads, water: src.water, walls: src.walls ?? [], areas: src.areas ?? [] };
      boundary = src.boundary;
      precinct = src.precinct;
    }
  } else {
    core = processOSM(fetchOSM(m.id, m.bbox), proj);
  }
  precinct = m.precinct ?? precinct; // config 우선

  // 섹션형 스키마 v2 — terrain(지형/해수면/수역) · objects(건물/도로/랜드마크/경계) · (예약)underground.
  const data = {
    id: m.id,
    name: m.name,
    subtitle: m.subtitle,
    meta: { lat0: m.lat0, lon0: m.lon0, source: "OpenStreetMap ODbL", schema: 2 },
    terrain: {
      seaLevel: m.seaLevel ?? 0,
      ...(m.heightmap ? { heightmap: m.heightmap } : {}),
      procedural: { ...(m.mountains ? { mountains: m.mountains } : {}), flattenCity: true },
      water: core.water,
    },
    objects: {
      buildings: core.buildings,
      roads: core.roads,
      ...(core.walls?.length ? { walls: core.walls } : {}),
      ...(core.areas?.length ? { areas: core.areas } : {}),
      ...(boundary ? { boundary } : {}),
      ...(m.gates ? { gates: m.gates } : {}),
      ...(m.landmarks ? { landmarks: bakeLandmarks(m.landmarks) } : {}),
      ...(precinct ? { precinct } : {}),
    },
    ...(m.spawn ? { spawn: m.spawn } : {}),
  };

  const path = `${BUILD_DIR}/${m.id}.json`; // 중간물 — build-world 입력. 런타임은 셀 청크만 읽음.
  writeFileSync(path, JSON.stringify(data));
  const bytes = statSync(path).size;
  console.error(`  wrote ${path}: ${core.buildings.length} buildings, ${core.roads.length} roads, ${core.water.length} water, ${core.walls?.length ?? 0} walls, ${core.areas?.length ?? 0} areas, ${(bytes / 1024).toFixed(0)}KB`);
  // catalogHidden: 스트리밍 타일 월드의 소스 전용 맵(예: gyeongbokgung)은 메뉴 카탈로그에 노출하지 않음.
  if (!m.catalogHidden) catalog.push({ id: m.id, name: m.name, subtitle: m.subtitle, bytes, buildings: core.buildings.length, lat: m.lat0, lon: m.lon0 });
}

// 카탈로그는 빌드한 맵만 갱신하지 않고, 빌드 안 한 기존 항목도 보존
let existing = [];
if (existsSync(`${OUT_DIR}/index.json`)) {
  try {
    existing = JSON.parse(readFileSync(`${OUT_DIR}/index.json`, "utf8"));
  } catch {}
}
const byId = new Map(existing.map((e) => [e.id, e]));
for (const e of catalog) byId.set(e.id, e);
// MAPS 정의 순서대로 정렬 + MAPS 에 없는 기존 항목(스트리밍 전장 seoul-stream 등)도 보존.
const mapIds = new Set(MAPS.map((m) => m.id));
const ordered = [
  ...MAPS.map((m) => byId.get(m.id)).filter(Boolean),
  ...existing.filter((e) => !mapIds.has(e.id)),
];
writeFileSync(`${OUT_DIR}/index.json`, JSON.stringify(ordered, null, 1));
console.error(`wrote ${OUT_DIR}/index.json: ${ordered.length} maps`);
