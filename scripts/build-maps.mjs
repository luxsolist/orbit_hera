// 전지구 명소 전장 데이터 빌드: OSM(Overpass) 실측 수집 → 로컬 미터 투영 → public/maps/<id>.json
// + 카탈로그 public/maps/index.json. 일부 환경에서 Node fetch 가 IPv6 로만 시도해 막히므로
// 수집은 curl(IPv4)을 자식 프로세스로 호출한다.
//
// 실행: node scripts/build-maps.mjs            (모든 맵)
//       node scripts/build-maps.mjs manhattan  (특정 맵만)
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { MAPS } from "./maps.config.mjs";
import { RECIPES } from "./landmarks.mjs";
import { projFns, buildingHeightInfo, interpolateBuildingHeights, roadWidth, ringArea, wallSpec, areaKind, relationPolys, sanitizeRing, sanitizePolyline, smoothPolyline, overpassQuery, isVehicularHighway, mergeStrokes, isUndergroundWaterway, surfaceWaterways, bboxTiles, mergeOSM, landmarkFrom, matchCuratedBuilding, CURATED_SNAP_M, siteRadius, buildNameIndex, matchCuratedByName } from "./osm.mjs";

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
      ...(lm.cls ? { cls: lm.cls } : {}), // 얽힘 유형(택소노미) 통과 — 06-missions §8
      mats: r.mats,
      parts: r.parts,
      colliders: r.colliders,
      ...(r.excludeR != null ? { excludeR: r.excludeR } : {}),
    };
  });
}

// 순서 = 시도 우선순위. ⚠ 2026-08-22 진단: 이 개발 샌드박스에서 overpass-api.de/kumi.systems 는
// TCP 단에서 막혀있고(방화벽 REFUSED/DROP), overpass.osm.ch 는 더 나쁘게도 **요청 bbox 와 무관하게
// 항상 같은 스위스 지역 고정 응답을 돌려줌**(예: way 42230983, 47.49°N 6.88°E — 로마·경복궁 쿼리
// 양쪽 다 이 값 반환). fetchOverpass() 는 elements.length>0 이면 "데이터 있음"으로 채택하므로, osm.ch
// 를 앞순위에 두면 클린 실패보다 위험한 무음 오염(엉뚱한 지역 데이터 혼입)이 난다 — 절대 앞에 두지
// 말 것. 이 4개 미러 모두 현재 샌드박스에서 신뢰 불가(전체는 scripts/data/geocode-* 류 네트워크
// 진단 참고). 실사용 환경(방화벽 제약 없는 머신)에서는 정상 동작할 가능성이 높음 — 원래 순서 유지.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// 대상 맵 — **id 지정 필수**. maps.config 가 도시 100선을 자동 포함하게 된 뒤로 인자 없는 실행은
// 101개 도시를 통째로 수집하려 든다(공개 Overpass 폭격 + 수 시간). 전량 빌드는 --all 로만 허용.
const only = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
if (!only && !process.argv.includes("--all")) {
  console.error(`usage: node scripts/build-maps.mjs <id>   (전량은 --all — ${MAPS.length}개 맵 수집)`);
  console.error(`  등록된 맵: ${MAPS.length}개 (손 맵 + 도시 100선 자동 생성 — scripts/data/city-catalog.json)`);
  process.exit(2);
}
const OUT_DIR = "public/maps";   // 런타임 자산(카탈로그 index.json)만
const CURATED_PATH = "scripts/data/landmark-catalog.json"; // 사람이 검수한 랜드마크 정본(도시명 → 항목[])
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
async function fetchOSM(id, bbox) {
  // NDJSON 우선(import-extract 산출) — 단일 JSON 은 Node 문자열 한계(≈512MB)에 걸려 대도시가 못 읽힌다.
  const nd = `/tmp/osm-${id}.ndjson`;
  if (existsSync(nd) && statSync(nd).size > 1000) {
    console.error(`  using cached ${nd}`);
    const elements = [];
    await new Promise((resolve, reject) => {
      const rl = createInterface({ input: createReadStream(nd), crlfDelay: Infinity });
      rl.on("line", (l) => { if (l) elements.push(JSON.parse(l)); });
      rl.on("close", resolve);
      rl.on("error", reject);
    });
    return { elements };
  }
  // 레거시 단일 JSON(구 import-extract 산출 · Overpass 타일 병합 캐시).
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
  const bEst = []; // buildings 와 동일 정렬 — 높이 미상(일반 9m 폴백) 플래그(주변 보간 대상)
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
    const { h, estimated } = buildingHeightInfo(t);
    // 얽힘 택소노미 승격 — 분류·이름·면적 3조건 통과 건물만 랜드마크(osm.landmarkFrom). 나머지는 일반 건물.
    const lm = landmarkFrom(t, ringArea(cp));
    buildings.push({ p: cp, h, ...(lm ? { lm: lm.cls, n: lm.n } : {}) });
    bEst.push(estimated);
  };
  // 면(폴리곤) 분류 — 수역/녹지·자연 면. 닫힌 면만(선형 제외). 자기교차면 드롭(복구 안 함 — 큰 concave 왜곡 방지).
  // holes=멀티폴리곤 구멍(수역에만 적용 — 섬·제방·육지가 물에 잠기지 않도록 even-odd 도려냄).
  const classifyArea = (t, flat, holes = []) => {
    if (flat.length < 6) return;
    const cp = sanitizeRing(flat, false);
    if (!cp) return;
    if (t.natural === "water" || t.water || t.waterway === "riverbank") {
      const hs = [];
      for (const h of holes) { const hc = sanitizeRing(h, false); if (hc && ringArea(hc) >= 4) hs.push(hc); }
      water.push(hs.length ? { p: cp, holes: hs } : { p: cp });
      return;
    }
    const k = areaKind(t);
    if (k) areas.push({ p: cp, k });
  };

  for (const el of osm.elements) {
    const t = el.tags || {};
    if (el.type === "relation") {
      // 멀티폴리곤 outer 들을 개별 면으로(건물 관계 = 건물).
      const isBld = !!t.building;
      for (const poly of relationPolys(el, proj)) {
        if (isBld) addBuilding(t, poly.outer); // 건물은 압출이라 구멍 무시(outer 만)
        else classifyArea(t, poly.outer, poly.holes); // 수역 구멍 보존
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
  // 높이 미상 건물(일반 9m 폴백)을 주변 실측 건물 높이로 보간 — 도심 고층/주거 저층 자연스럽게.
  const nEst = bEst.filter(Boolean).length;
  interpolateBuildingHeights(buildings, bEst);
  console.error(`  건물 높이 보간: 미상 ${nEst}/${buildings.length} → 주변 중앙값 추정`);
  return { buildings, roads: mergedRoads, water, walls, areas };
}

/**
 * 큐레이션 랜드마크 카탈로그(scripts/data/landmark-catalog.json) 반영 — 도시명 키로 항목을 찾아
 * 실측 위경도를 맵-로컬로 투영하고, 가장 가까운 건물 footprint 를 그 항목의 택소노미/이름으로 **강제 승격**한다.
 *
 * 왜 필요한가: OSM 태그 자동분류(landmarkFrom)는 태그가 부실한 유적·현지어 고유명을 놓치고, 애매한 곳을
 * 엉뚱한 유형으로 분류한다. 큐레이션 카탈로그는 사람이 검수한 정본이므로 자동분류를 덮어쓴다.
 * 좌표 없는 항목(geocodeStatus:"unresolved")·반경 밖 항목은 조용히 건너뛴다(날조 금지 방침 유지).
 */
function applyCuratedLandmarks(core, cityKey, proj, nameIndex = null) {
  const buildings = core.buildings;
  if (!cityKey) return { matched: 0, sites: [], total: 0 };
  let cat;
  try { cat = JSON.parse(readFileSync(CURATED_PATH, "utf8")); }
  catch { console.error(`  ⚠ 큐레이션 카탈로그 읽기 실패(${CURATED_PATH}) — 자동분류만 사용`); return { matched: 0, sites: [], total: 0 }; }
  const list = cat.cities?.[cityKey];
  if (!Array.isArray(list)) { console.error(`  ⚠ 큐레이션 카탈로그에 '${cityKey}' 없음 — 자동분류만 사용`); return { matched: 0, sites: [], total: 0 }; }

  // site 반경 추정용 면 목록 — 공원·해변·숲(areas) + 수역(water 면). 큐레이션 좌표를 품은 면의 크기가 반경이 된다.
  const polys = [...(core.areas ?? []), ...(core.water ?? []).filter((w) => w.w == null)];

  const taken = new Set();
  const sites = [];
  let matched = 0, geo = 0, byName = 0, unresolved = 0;
  for (const lm of list) {
    let x, z;
    if (typeof lm.lat === "number" && typeof lm.lon === "number") {
      geo++;
      [x, z] = proj(lm.lat, lm.lon);
    } else {
      // 지오코딩 미해결 — **이 도시의 추출 안에서 이름으로** 찾는다(좌표 날조는 여전히 안 한다).
      // 외부 지오코더가 못 찾은 것들 상당수가 실은 추출에 이름째로 들어 있다(교토·바라나시 6개 중 5개).
      const hit = matchCuratedByName(nameIndex, lm);
      if (!hit) { unresolved++; continue; }
      x = hit.x; z = hit.z; byName++;
    }
    const i = matchCuratedBuilding(buildings, x, z, CURATED_SNAP_M, taken);
    if (i >= 0) {
      taken.add(i);
      buildings[i].lm = lm.cls;          // 큐레이션 택소노미가 자동분류를 덮어씀(사람 검수 우선)
      buildings[i].n = lm.nameEn || lm.name;
      matched++;
      continue;
    }
    // 건물이 아니다 — 해변·교량·공원·하천·곶. 지오메트리에 얹지 않는 독립 랜드마크(site)로 등록한다.
    // 이게 없으면 "부산을 지킨다"가 해운대·광안대교를 포함하지 못한다(실측 확인).
    sites.push({ x, z, r: siteRadius(x, z, polys), lm: lm.cls, n: lm.nameEn || lm.name });
  }
  const via = byName ? ` · 이름매칭 ${byName}` : "";
  const left = unresolved ? ` · 미해결 ${unresolved}` : "";
  console.error(`  큐레이션 랜드마크: 건물 ${matched} + site(비건물) ${sites.length} = ${matched + sites.length}/${list.length}` +
                ` (좌표 ${geo}${via}${left})`);
  return { matched, sites, total: list.length, byName, unresolved };
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
    const osm = await fetchOSM(m.id, m.bbox);
    core = processOSM(osm, proj);
    // 이름 색인은 **가공 전 원본 요소**에서 만든다 — processOSM 은 태그를 버리고 형상만 남긴다.
    const nameIndex = buildNameIndex(osm.elements, proj);
    core.sites = applyCuratedLandmarks(core, m.catalogCity, proj, nameIndex).sites; // 사람 검수 카탈로그: 건물은 승격, 비건물은 site
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
      ...(core.sites?.length ? { sites: core.sites } : {}), // 비건물 랜드마크(해변·교량·공원 등)
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
  console.error(`  wrote ${path}: ${core.buildings.length} buildings, ${core.roads.length} roads, ${core.water.length} water, ${core.walls?.length ?? 0} walls, ${core.areas?.length ?? 0} areas, ${core.sites?.length ?? 0} sites, ${(bytes / 1024).toFixed(0)}KB`);
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
