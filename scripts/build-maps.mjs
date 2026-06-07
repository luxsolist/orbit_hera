// 전지구 명소 전장 데이터 빌드: OSM(Overpass) 실측 수집 → 로컬 미터 투영 → public/maps/<id>.json
// + 카탈로그 public/maps/index.json. 일부 환경에서 Node fetch 가 IPv6 로만 시도해 막히므로
// 수집은 curl(IPv4)을 자식 프로세스로 호출한다.
//
// 실행: node scripts/build-maps.mjs            (모든 맵)
//       node scripts/build-maps.mjs manhattan  (특정 맵만)
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { MAPS } from "./maps.config.mjs";
import { RECIPES } from "./landmarks.mjs";
import { projFns, buildingHeight, roadWidth, ringArea } from "./osm.mjs";

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
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const only = process.argv[2];
const OUT_DIR = "public/maps";
mkdirSync(OUT_DIR, { recursive: true });

function overpassQuery(bbox) {
  const b = bbox.join(",");
  return `[out:json][timeout:120];
(
  way["building"](${b});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|pedestrian)$"](${b});
  way["natural"="water"](${b});
  way["waterway"="river"](${b});
);
out geom;`;
}

function fetchOSM(id, bbox) {
  const cache = `/tmp/osm-${id}.json`;
  if (existsSync(cache) && statSync(cache).size > 1000) {
    console.error(`  using cached ${cache}`);
    return JSON.parse(readFileSync(cache, "utf8"));
  }
  const qf = `/tmp/q-${id}.overpassql`;
  writeFileSync(qf, overpassQuery(bbox));
  let lastErr;
  for (const ep of ENDPOINTS) {
    try {
      console.error(`  fetching ${id} from ${ep}`);
      execFileSync(
        "curl",
        ["-sS", "-m", "180", "-A", "SeedGame/0.4 (map builder; contact luxsolist@gmail.com)",
          "-G", ep, "--data-urlencode", `data@${qf}`, "-o", cache],
        { stdio: ["ignore", "ignore", "inherit"] }
      );
      const txt = readFileSync(cache, "utf8");
      if (txt.trim().startsWith("{")) {
        const j = JSON.parse(txt);
        if (j.elements?.length) return j;
      }
      throw new Error("empty/invalid response");
    } catch (e) {
      console.error("   failed:", e.message);
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetch failed");
}

function processOSM(osm, proj) {
  const buildings = [];
  const roads = [];
  const water = [];
  for (const el of osm.elements) {
    if (el.type !== "way" || !el.geometry) continue;
    const t = el.tags || {};
    const flat = [];
    for (const g of el.geometry) {
      const [x, z] = proj(g.lat, g.lon);
      flat.push(x, z);
    }
    if (flat.length < 4) continue;
    if (t.building) {
      if (ringArea(flat) < 12) continue;
      buildings.push({ p: flat, h: buildingHeight(t) });
    } else if (t.highway) {
      roads.push({ p: flat, w: roadWidth(t.highway) });
    } else if (t.natural === "water") {
      // 닫힌 면(수역)만. waterway=river 는 중심선(선형)이라 채우면 퇴화 폴리곤이 되어 제외.
      if (flat.length >= 6) water.push({ p: flat });
    }
  }
  return { buildings, roads, water };
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
      core = { buildings: src.objects.buildings, roads: src.objects.roads, water: src.terrain?.water ?? [] };
      boundary = src.objects.boundary;
      precinct = src.objects.precinct;
    } else {
      core = { buildings: src.buildings, roads: src.roads, water: src.water };
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
      ...(boundary ? { boundary } : {}),
      ...(m.gates ? { gates: m.gates } : {}),
      ...(m.landmarks ? { landmarks: bakeLandmarks(m.landmarks) } : {}),
      ...(precinct ? { precinct } : {}),
    },
    ...(m.spawn ? { spawn: m.spawn } : {}),
  };

  const path = `${OUT_DIR}/${m.id}.json`;
  writeFileSync(path, JSON.stringify(data));
  const bytes = statSync(path).size;
  console.error(`  wrote ${path}: ${core.buildings.length} buildings, ${core.roads.length} roads, ${(bytes / 1024).toFixed(0)}KB`);
  catalog.push({ id: m.id, name: m.name, subtitle: m.subtitle, bytes, buildings: core.buildings.length, lat: m.lat0, lon: m.lon0 });
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
// MAPS 정의 순서대로 정렬
const ordered = MAPS.map((m) => byId.get(m.id)).filter(Boolean);
writeFileSync(`${OUT_DIR}/index.json`, JSON.stringify(ordered, null, 1));
console.error(`wrote ${OUT_DIR}/index.json: ${ordered.length} maps`);
