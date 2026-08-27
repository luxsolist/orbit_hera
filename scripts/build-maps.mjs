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
import { projFns, buildingHeightInfo, interpolateBuildingHeights, roadWidth, ringArea, wallSpec, areaKind, relationPolys, sanitizeRing, sanitizePolyline, smoothPolyline, isVehicularHighway, mergeStrokes, isUndergroundWaterway, surfaceWaterways, landmarkFrom, matchCuratedBuilding, CURATED_SNAP_M, siteRadius, buildNameIndex, matchCuratedByName, applyBlocklist, BLOCK_MATCH_M } from "./osm.mjs";

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
 * OSM 수집 — **Geofabrik 추출 캐시를 읽기만 한다**(네트워크 수집 없음).
 *
 * Overpass 타일 폭격 경로를 제거했다(2026-08-27). 근거 넷:
 *   ① spec/03-maps.md 가 이미 "광역은 Geofabrik 추출 우선"을 **모든 광역 맵 공통 규약**으로 명시 —
 *      Overpass 는 문서상 이미 비정본인데 코드에만 폴백으로 남아 있었다.
 *   ② **조용한 오염 위험**: overpass.osm.ch 는 요청 bbox 와 무관하게 늘 같은 스위스 지역 응답을
 *      돌려주는데(2026-08-22 진단), 수집기는 elements.length>0 이면 채택했다. 앞 엔드포인트가
 *      실패하면 도쿄 맵에 스위스 지형이 조용히 구워진다 — 순서로만 막고 있었으니 방어가 아니라 운이었다.
 *   ③ **속도**: 실측 루앙프라방 1,558타일 · 약 8타일/분 → 3시간+ 대 추출 경로 **2분 26초**.
 *   ④ **폴백이 진짜 문제를 가린다**: 캐시가 없을 때 필요한 건 "추출을 먼저 돌려라"는 즉각적인
 *      실패다. 조용히 3시간짜리 우회로로 빠지면 원인을 못 본다(실제로 한 번 빠졌다).
 * 단일 쿼리 분기(bbox ≤ 0.06°)도 함께 사라졌다 — 등록된 104개 맵 중 해당하는 것이 0개인 죽은 코드였다.
 *
 * 수역만 다시 받는 일회성 수리 도구(refetch-water.mjs)는 자체 Overpass 경로를 갖고 있고 여기 영향받지
 * 않는다. 다만 같은 불안정성을 안고 있으니 동작하지 않을 수 있다.
 */
async function fetchOSM(id, _bbox) {
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
  // 레거시 단일 JSON(구 import-extract 산출 · 옛 Overpass 타일 병합 캐시).
  const cache = `/tmp/osm-${id}.json`;
  if (existsSync(cache) && statSync(cache).size > 1000) {
    console.error(`  using cached ${cache}`);
    return JSON.parse(readFileSync(cache, "utf8"));
  }
  // 캐시가 없다 — **조용히 우회하지 않고 여기서 멈춘다**. 무엇을 해야 하는지 함께 알려준다.
  throw new Error(
    `OSM 추출 캐시 없음: ${nd}\n` +
    `  Geofabrik 추출을 먼저 돌릴 것(광역 맵 공통 규약 — docs/spec/03-maps.md):\n` +
    `    curl -L -o /tmp/<region>-latest.osm.pbf https://download.geofabrik.de/<대륙>/<region>-latest.osm.pbf\n` +
    `    node --max-old-space-size=8192 scripts/import-extract.mjs ${id} /tmp/<region>-latest.osm.pbf /tmp/osmconvert\n` +
    `  그 다음 이 명령을 다시 실행한다.`
  );
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
function applyCuratedLandmarks(core, cityKey, proj, nameIndex = null, cover = null) {
  const buildings = core.buildings;
  if (!cityKey) return { matched: 0, sites: [], total: 0 };
  let cat;
  try { cat = JSON.parse(readFileSync(CURATED_PATH, "utf8")); }
  catch { console.error(`  ⚠ 큐레이션 카탈로그 읽기 실패(${CURATED_PATH}) — 자동분류만 사용`); return { matched: 0, sites: [], total: 0 }; }
  const own = cat.cities?.[cityKey];
  if (!Array.isArray(own)) { console.error(`  ⚠ 큐레이션 카탈로그에 '${cityKey}' 없음 — 자동분류만 사용`); return { matched: 0, sites: [], total: 0 }; }
  // ── 카탈로그를 **전역 랜드마크 레지스트리**로 본다 ──
  // 도시가 "맵의 특정 영역을 지칭하는 가상 개념"이면, 청크에 실리는 랜드마크도 위치로 결정돼야 한다.
  // 도시별 목록만 적용하면 같은 청크를 누가 굽느냐로 랜드마크 표시가 달라진다(순수 함수 위반).
  // 도시 이름은 조회·관리용 라벨일 뿐이다. 실측: 100도시 중 영향받는 곳은 1곳(선전 ← 홍콩 만불사).
  // 좌표 없는 항목은 자기 도시분만 이름 매칭에 넘긴다(남의 도시 이름을 이 추출에서 찾을 이유가 없다).
  const list = [...own];
  if (cover) {
    for (const [c, arr] of Object.entries(cat.cities ?? {})) {
      if (c === cityKey || !Array.isArray(arr)) continue;
      for (const lm of arr) {
        if (typeof lm.lat !== "number" || typeof lm.lon !== "number") continue;
        const [x, z] = proj(lm.lat, lm.lon);
        if (Math.abs(x) <= cover / 2 && Math.abs(z) <= cover / 2) list.push(lm);
      }
    }
    if (list.length !== own.length) console.error(`  큐레이션 전역 적용: 타도시 ${list.length - own.length}건이 이 영역에 포함`);
  }

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

/**
 * 자동 승격 차단(큐레이션 정책) — **applyCuratedLandmarks 와 분리해 항상 돈다**.
 *
 * 차단을 큐레이션 함수 안에 두면 그 함수의 조기 반환(catalogCity 없음 · 카탈로그 읽기 실패 ·
 * 도시 미등재)에 가려 손 맵과 무카탈로그 맵에서 조용히 건너뛰어진다. 차단은 **위치로 결정**되는
 * 규칙이라 어느 맵이 그 땅을 굽든 동일하게 적용돼야 한다(전역 레지스트리 원칙).
 *
 * 호출 순서도 계약이다 — 큐레이션 승격 **뒤**라야 큐레이션·자동 승격 둘 다 덮는다.
 */
function applyLandmarkBlocklist(core, proj, cover = null) {
  let cat;
  try { cat = JSON.parse(readFileSync(CURATED_PATH, "utf8")); }
  catch { return; } // 카탈로그를 못 읽으면 큐레이션 쪽에서 이미 경고했다
  const blk = cat.blockedLandmarks;
  if (!blk?.items?.length) return;
  const { blocked, misses } = applyBlocklist(core.buildings, blk.items, proj, cover, blk.matchRadiusM ?? BLOCK_MATCH_M);
  if (blocked) console.error(`  ⛔ 승격 차단(큐레이션 정책): ${blocked}채`);
  // 커버리지 **안**인데 건물이 없는 항목만 남는다 — OSM 에서 사라졌거나 좌표가 틀렸다는 신호.
  if (misses.length) console.error(`  ⚠ 차단 목록 미적중 ${misses.length}건: ${misses.join(", ")} (OSM 갱신/좌표 확인 필요)`);
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
    core.sites = applyCuratedLandmarks(core, m.catalogCity, proj, nameIndex, m.heightmap?.meters ?? null).sites; // 사람 검수 카탈로그: 건물은 승격, 비건물은 site
    applyLandmarkBlocklist(core, proj, m.heightmap?.meters ?? null); // 정책 차단 — 큐레이션·자동 승격 둘 다 덮는다(반드시 이 뒤)
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
