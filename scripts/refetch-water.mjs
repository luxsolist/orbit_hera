// 수역만 재추출해 build/<id>.json 의 terrain.water 를 **멀티폴리곤 구멍(holes) 보존판**으로 교체.
// 전체 OSM 재페치(40km 맵 = 수천 타일) 없이 수역(희소)만 카테고리별 단일 쿼리로 받아,
// 한강 등 relation natural=water 의 inner ring(섬·제방=육지)을 복원한다 → 도심 침수 제거.
// 실행: node scripts/refetch-water.mjs <id>   (maps.config 의 bbox/lat0/lon0 사용) → 이후 build-world 재실행.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { MAPS } from "./maps.config.mjs";
import { projFns, relationPolys, sanitizeRing, ringArea, sanitizePolyline, isUndergroundWaterway, surfaceWaterways } from "./osm.mjs";

const id = process.argv[2];
const m = MAPS.find((x) => x.id === id);
if (!m) { console.error(`unknown id: ${id} (maps.config 에 없음)`); process.exit(1); }
const [s, w, n, e] = m.bbox;
const proj = projFns(m.lat0, m.lon0);
const UA = "SeedGame/0.4 (map builder; contact luxsolist@gmail.com)";
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

// 단일 bbox 쿼리(엔드포인트별 1회). 성공 시 elements, 실패 시 throw.
function fetchOnce(ql) {
  const qf = `/tmp/refetch-water-${id}.ql`, tmp = `/tmp/refetch-water-${id}.json`;
  writeFileSync(qf, ql);
  let lastErr;
  for (const ep of ENDPOINTS) {
    try {
      execFileSync("curl", ["-sS", "-m", "130", "-A", UA, "-G", ep, "--data-urlencode", `data@${qf}`, "-o", tmp], { stdio: ["ignore", "ignore", "inherit"] });
      const txt = readFileSync(tmp, "utf8");
      if (!txt.trim().startsWith("{")) throw new Error("non-JSON(타임아웃/과부하?)");
      const j = JSON.parse(txt);
      if (!Array.isArray(j.elements)) throw new Error("elements 누락");
      return j.elements;
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error("fetch 실패");
}

// 카테고리별 페치 — 실패(타임아웃/과부하) 시 bbox 를 4분할 재귀(최대 depth). 연안 밀집 카테고리(way water=*) 대응.
function fetchTiled(buildQL, label, box, depth = 0) {
  try {
    const els = fetchOnce(buildQL(box));
    console.error(`  ${label} ${depth ? box.map((v) => v.toFixed(3)).join(",") : ""}: ${els.length}`);
    return els;
  } catch (err) {
    if (depth >= 3) { console.error(`  ${label} ${box.map((v) => v.toFixed(3))} 포기: ${err.message}`); return []; }
    const [bs, bw, bn, be] = box, ml = (bs + bn) / 2, mo = (bw + be) / 2;
    console.error(`  ${label} 분할(depth ${depth}) — ${err.message}`);
    return [
      ...fetchTiled(buildQL, label, [bs, bw, ml, mo], depth + 1),
      ...fetchTiled(buildQL, label, [bs, mo, ml, be], depth + 1),
      ...fetchTiled(buildQL, label, [ml, bw, bn, mo], depth + 1),
      ...fetchTiled(buildQL, label, [ml, mo, bn, be], depth + 1),
    ];
  }
}

const box0 = [s, w, n, e];
const bs = (b) => b.join(",");
console.error(`== refetch-water ${id} bbox ${bs(box0)} ==`);
const raw = [
  ...fetchTiled((b) => `[out:json][timeout:120];relation["natural"="water"](${bs(b)});out geom;`, "rel natural=water", box0),
  ...fetchTiled((b) => `[out:json][timeout:120];way["natural"="water"](${bs(b)});out geom;`, "way natural=water", box0),
  ...fetchTiled((b) => `[out:json][timeout:120];way["water"](${bs(b)});out geom;`, "way water=*", box0),
  ...fetchTiled((b) => `[out:json][timeout:120];way["waterway"~"^(river|stream|canal|riverbank)$"](${bs(b)});out geom;`, "way waterway", box0),
];
// 타일 분할 시 같은 요소가 여러 타일에 중복 → type/id 로 중복 제거.
const seen = new Set();
const els = raw.filter((el) => { const k = `${el.type}/${el.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
console.error(`  수집 ${raw.length} → 중복제거 ${els.length} elements`);

const water = [], waterways = [];
let holesTotal = 0, relPolys = 0;
for (const el of els) {
  const t = el.tags || {};
  if (el.type === "relation") {
    if (!(t.natural === "water" || t.water)) continue;
    for (const poly of relationPolys(el, proj)) {
      const cp = sanitizeRing(poly.outer, false);
      if (!cp) continue;
      const hs = [];
      for (const h of poly.holes) { const hc = sanitizeRing(h, false); if (hc && ringArea(hc) >= 4) hs.push(hc); }
      holesTotal += hs.length; relPolys++;
      water.push(hs.length ? { p: cp, holes: hs } : { p: cp });
    }
    continue;
  }
  if (el.type !== "way" || !el.geometry) continue;
  const flat = [];
  for (const g of el.geometry) { const [x, z] = proj(g.lat, g.lon); flat.push(x, z); }
  if (t.natural === "water" || t.water || t.waterway === "riverbank") {
    const cp = sanitizeRing(flat, false);
    if (cp) water.push({ p: cp });
  } else if (t.waterway === "river" || t.waterway === "stream" || t.waterway === "canal") {
    const wl = sanitizePolyline(flat);
    if (wl && wl.length >= 4) waterways.push({ p: wl, culverted: isUndergroundWaterway(t), stream: t.waterway === "stream", w: t.waterway === "river" ? 24 : 6 });
  }
}
for (const sfc of surfaceWaterways(waterways)) water.push({ p: sfc.p, w: sfc.w });

const path = `build/${id}.json`;
if (!existsSync(path)) { console.error(`${path} 없음 — build-maps 먼저 실행`); process.exit(1); }
const d = JSON.parse(readFileSync(path, "utf8"));
d.terrain = d.terrain || {};
const before = (d.terrain.water || []).length;
d.terrain.water = water;
writeFileSync(path, JSON.stringify(d));
console.error(`✔ ${id}: terrain.water ${before} → ${water.length} (relation 면 ${relPolys}개, 구멍 ${holesTotal}개 보존). 이제: node scripts/build-world.mjs ${id}`);
