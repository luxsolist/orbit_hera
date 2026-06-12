// OSM → 로컬 미터 가공의 순수 헬퍼(부수효과 없음). build-maps.mjs 와 테스트가 공유.

/**
 * 큰 bbox 를 ≤maxDeg(위·경도) 타일 격자로 분할 — 대면적 Overpass 단일 쿼리 타임아웃/메모리 한계 회피(타일별 수집·캐시·재개).
 * bbox=[s,w,n,e]. 반환: 동일 포맷 sub-bbox 배열(행=남→북, 열=서→동). 순수.
 */
export function bboxTiles(bbox, maxDeg = 0.03) {
  const [s, w, n, e] = bbox;
  const rows = Math.max(1, Math.ceil((n - s) / maxDeg - 1e-9)); // -eps: 부동소수 ceil 과대 방지
  const cols = Math.max(1, Math.ceil((e - w) / maxDeg - 1e-9));
  const dz = (n - s) / rows, dx = (e - w) / cols;
  const tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    tiles.push([s + r * dz, w + c * dx, s + (r + 1) * dz, w + (c + 1) * dx]);
  }
  return tiles;
}

/** 여러 OSM 응답({elements})을 type+id 로 중복 제거해 병합. 순수. */
export function mergeOSM(responses) {
  const seen = new Set();
  const elements = [];
  for (const res of responses) {
    for (const el of res?.elements ?? []) {
      const k = `${el.type}/${el.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      elements.push(el);
    }
  }
  return { elements };
}

/**
 * Overpass 수집 쿼리 — 가능한 모든 구성요소(건물+관계, 전체 highway, barrier(담장), 수역(+관계+하천),
 * 자연/공원/녹지 면(+관계), 주차장). opts.date(ISO) 지정 시 [date:] 스냅샷으로 **재현 가능**한 결과.
 */
export function overpassQuery(bbox, opts = {}) {
  const b = bbox.join(",");
  const date = opts.date ? `[date:"${opts.date}"]` : "";
  return `[out:json][timeout:180]${date};
(
  way["building"](${b});
  relation["building"](${b});
  way["highway"](${b});
  way["barrier"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["water"](${b});
  way["waterway"~"^(river|stream|canal|riverbank)$"](${b});
  way["natural"~"^(wood|tree_row|scrub|grassland|heath|sand|beach|rock|bare_rock|scree|stone)$"](${b});
  way["leisure"~"^(park|garden|pitch|playground|recreation_ground|golf_course)$"](${b});
  way["landuse"~"^(grass|meadow|forest|recreation_ground|village_green|cemetery|parking)$"](${b});
  way["amenity"="parking"](${b});
  relation["leisure"~"^(park|garden|recreation_ground)$"](${b});
  relation["landuse"~"^(grass|meadow|forest|cemetery)$"](${b});
  relation["natural"~"^(wood|scrub|grassland|sand|rock)$"](${b});
);
out geom;`;
}

/** lat0/lon0 원점의 등거 투영기 — (lat,lon) → [x,z] 미터(북=-Z), cm 정밀도 반올림. */
export function projFns(lat0, lon0) {
  const M_LAT = 111320;
  const M_LON = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return (lat, lon) => [
    Math.round((lon - lon0) * M_LON * 100) / 100,
    Math.round(-(lat - lat0) * M_LAT * 100) / 100,
  ];
}

/** OSM building 태그의 첫 수치 토큰(구분기호/단위/범위/가비지 안전). 없으면 NaN. */
const firstNum = (s) => { const m = String(s).match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
export const BUILDING_H_MAX = 830; // 실존 최고 건물(부르즈 할리파 828m) — 초과 height/levels 태그는 오류로 간주(폴백). 검증기와 공유.
const BUILDING_LVL_MAX = 200;      // 층수 상한(가비지 levels 예: "12345678910111212" 차단)

/**
 * OSM building 태그 → { h, estimated }.
 * h: height > building:levels > 종류별 기본. **현실적 상한 가드**: 첫 수치 토큰만 취하고
 * height>BUILDING_H_MAX·levels>200 인 오류/가비지 태그는 무시하고 폴백(예: levels="12345678910111212" → 4e16m 바늘 방지).
 * estimated: 실측 신호(height/levels)·명시 타입(hut/house/palace…)이 전혀 없어 일반 기본 9m 로 떨어진 경우 true
 * → 빌드 단계에서 주변 건물 높이로 보간(interpolateBuildingHeights) 대상.
 */
export function buildingHeightInfo(t = {}) {
  const hv = firstNum(t.height);
  if (hv > 0 && hv <= BUILDING_H_MAX) return { h: Math.round(hv * 10) / 10, estimated: false };
  const lv = firstNum(t["building:levels"]);
  if (lv > 0 && lv <= BUILDING_LVL_MAX) return { h: Math.round(Math.max(3, lv * 3.3) * 10) / 10, estimated: false };
  const b = t.building;
  if (b === "hut" || b === "shed" || b === "roof") return { h: 3, estimated: false };
  if (b === "temple" || b === "shrine" || b === "palace" || b === "pavilion") return { h: 7, estimated: false };
  if (b === "house" || b === "detached" || b === "hanok") return { h: 6, estimated: false };
  return { h: 9, estimated: true }; // 일반/미지정 → 주변 보간 대상
}

/** OSM building 태그 → 높이(m)만. (buildingHeightInfo 의 h) */
export function buildingHeight(t = {}) { return buildingHeightInfo(t).h; }

/**
 * 높이 미상(estimated) 건물의 h 를 **주변 실측(seed) 건물 높이의 반경 내 중앙값**으로 추정 — in-place.
 * buildings: [{p:[x,z,...], h}], estimated: boolean[](buildings 와 동일 정렬). 좌표는 평면 m.
 * 공간 그리드(셀=radius)로 근사 O(n). 반경 radius(m) 내 seed 가 minNeighbors↑ 면 중앙값(이상치 강인)으로 대체, 아니면 기본값 유지.
 * estimated 끼리는 서로 seed 가 되지 않아(전파 드리프트 방지) 결과가 입력 순서에 무관.
 */
export function interpolateBuildingHeights(buildings, estimated, { radius = 220, minNeighbors = 3 } = {}) {
  const n = buildings.length;
  if (!n) return buildings;
  const cx = new Float64Array(n), cz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = buildings[i].p, m = p.length / 2; let sx = 0, sz = 0;
    for (let k = 0; k < m; k++) { sx += p[k * 2]; sz += p[k * 2 + 1]; }
    cx[i] = sx / m; cz[i] = sz / m;
  }
  const cell = radius, grid = new Map(), key = (gx, gz) => `${gx}_${gz}`;
  for (let i = 0; i < n; i++) { // seed(실측)만 색인
    if (estimated[i]) continue;
    const k = key(Math.floor(cx[i] / cell), Math.floor(cz[i] / cell));
    let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(i);
  }
  const r2 = radius * radius, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!estimated[i]) continue;
    const gx = Math.floor(cx[i] / cell), gz = Math.floor(cz[i] / cell), hs = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(key(gx + dx, gz + dz)); if (!arr) continue;
      for (const j of arr) { const ax = cx[j] - cx[i], az = cz[j] - cz[i]; if (ax * ax + az * az <= r2) hs.push(buildings[j].h); }
    }
    if (hs.length >= minNeighbors) {
      hs.sort((a, b) => a - b); const mid = hs.length >> 1;
      out[i] = hs.length % 2 ? hs[mid] : (hs[mid - 1] + hs[mid]) / 2;
    } else out[i] = NaN; // 주변 seed 부족 → 기본값 유지
  }
  for (let i = 0; i < n; i++) if (estimated[i] && Number.isFinite(out[i])) buildings[i].h = Math.round(out[i] * 10) / 10;
  return buildings;
}

/** 차도(차량 통행) highway 인지 — 보도/오솔길/계단/자전거도로/보행자 전용은 제외(수집 안 함). */
const VEHICULAR = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link", "residential",
  "living_street", "unclassified", "road", "service", "busway",
]);
export const isVehicularHighway = (hw) => VEHICULAR.has(hw);

/** 지하/복개 waterway 인지 — 복개천(tunnel)·층<0·covered 는 지표수 아님(수집 제외). */
export const isUndergroundWaterway = (t = {}) => !!t.tunnel || (t.layer != null && Number(t.layer) < 0) || t.covered === "yes";

/**
 * 지표 노출 하천만 추림 — segments: [{p, culverted, stream}]. 연결성(끝점 공유)으로 수계를 묶어:
 *  - 명시 복개 구간(culverted) 제외.
 *  - **하천(stream)** 은 수계에 복개가 하나라도 있으면 전체 제외(중학천 등 복개천의 태그 누락 지표 구간까지 숨김).
 *  - 강/운하는 복개 구간만 제외, 지표부 유지. 복개 없는 순수 지표 하천(산 계곡)은 노출. 순수.
 */
export function surfaceWaterways(segments) {
  const K = (x, z) => Math.round(x) + "," + Math.round(z);
  const parent = segments.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const endMap = new Map();
  segments.forEach((s, i) => {
    const p = s.p;
    for (const k of [K(p[0], p[1]), K(p[p.length - 2], p[p.length - 1])]) {
      const j = endMap.get(k);
      if (j != null) parent[find(i)] = find(j); else endMap.set(k, i);
    }
  });
  const compCulvert = new Set();
  segments.forEach((s, i) => { if (s.culverted) compCulvert.add(find(i)); });
  return segments.filter((s, i) => {
    if (s.culverted) return false;                          // 명시 복개 구간
    if (s.stream && compCulvert.has(find(i))) return false; // 복개 포함 하천계 전체(태그 누락 보정)
    return true;
  });
}

/** highway 종류 → 도로 폭(m). 보도/계단/서비스 등 보행로까지 포함(전체 highway 수집). 미지정 6. */
export const roadWidth = (hw) =>
  ({
    motorway: 26, motorway_link: 12, trunk: 24, trunk_link: 12,
    primary: 28, primary_link: 12, secondary: 16, secondary_link: 9,
    tertiary: 11, tertiary_link: 7, residential: 7, living_street: 6,
    unclassified: 7, busway: 7, road: 7,
    service: 4, track: 3.5,
    pedestrian: 9, footway: 2.2, path: 1.8, steps: 2.4, cycleway: 2.5,
    bridleway: 2, corridor: 2,
  }[hw] || 6);

/**
 * OSM barrier 태그 → 벽 사양 {h:높이, w:두께}. 벽이 아닌 barrier(연석·볼라드·문 등)는 null.
 * height 태그가 있으면 우선. 담장/성곽/옹벽/울타리/생울타리 등 수집.
 */
export function wallSpec(t = {}) {
  const base = {
    wall: { h: 2.5, w: 0.4 },
    city_wall: { h: 6, w: 1.3 },
    retaining_wall: { h: 2.2, w: 0.6 },
    fence: { h: 1.5, w: 0.12 },
    hedge: { h: 1.6, w: 0.6 },
    guard_rail: { h: 0.9, w: 0.12 },
    handrail: { h: 1.0, w: 0.1 },
  }[t.barrier];
  if (!base) return null;
  let h = base.h;
  if (t.height) {
    const v = parseFloat(String(t.height).replace(/[^\d.]/g, ""));
    if (v > 0) h = Math.round(v * 10) / 10;
  }
  return { h, w: base.w };
}

/**
 * OSM 면 태그(natural/leisure/landuse/amenity) → 지표 면 종류(색 구분 키). 해당 없으면 null.
 * 도시 용도지역(commercial/residential 등 전역 zoning)은 제외 — 전체 맵을 덮어 의미 없음.
 */
export function areaKind(t = {}) {
  const nat = t.natural, lei = t.leisure, lu = t.landuse;
  if (nat === "wood" || nat === "tree_row" || lu === "forest") return "wood";
  if (nat === "scrub") return "scrub";
  if (nat === "grassland" || nat === "heath") return "grass";
  if (nat === "sand" || nat === "beach") return "sand";
  if (nat === "rock" || nat === "bare_rock" || nat === "scree" || nat === "stone") return "rock";
  if (lei === "park" || lei === "recreation_ground" || lei === "playground" || lei === "golf_course") return "park";
  if (lei === "garden") return "garden";
  if (lei === "pitch") return "pitch";
  if (lu === "grass" || lu === "meadow" || lu === "village_green" || lu === "recreation_ground" || lu === "cemetery") return "grass";
  if (t.amenity === "parking" || lu === "parking") return "pavement";
  return null;
}

/**
 * Overpass relation(out geom) → outer 멤버 폴리곤들의 평면 좌표 배열 목록.
 * 멀티폴리곤 구멍(inner)은 단순화를 위해 무시. proj=투영 함수.
 */
export function relationRings(el, proj) {
  const out = [];
  for (const m of el.members ?? []) {
    if (m.type !== "way" || m.role === "inner" || !m.geometry) continue;
    const flat = [];
    for (const g of m.geometry) {
      const [x, z] = proj(g.lat, g.lon);
      flat.push(x, z);
    }
    if (flat.length >= 6) out.push(flat);
  }
  return out;
}

// ── 멀티폴리곤 조립(구멍 보존) ── outer/inner 멤버 way 를 끝점으로 봉합해 닫힌 링으로, 각 outer 에 그 안의 inner(구멍)를 귀속.
function ptClose(ax, az, bx, bz, eps) { return Math.abs(ax - bx) <= eps && Math.abs(az - bz) <= eps; }

/** 멤버 way 들(flat [x,z,...] 배열)을 공유 끝점으로 봉합 → 닫힌 링 목록(닫힘 중복점 제거). */
function assembleRings(ways, eps = 0.5) {
  const rings = [], segs = [];
  for (const w of ways) {
    const n = w.length;
    if (n < 4) continue;
    if (n >= 6 && ptClose(w[0], w[1], w[n - 2], w[n - 1], eps)) rings.push(w.slice(0, n - 2));
    else segs.push(w.slice());
  }
  const used = new Array(segs.length).fill(false);
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = segs[i].slice();
    for (let grew = true; grew;) {
      grew = false;
      const m = chain.length, hx = chain[0], hz = chain[1], tx = chain[m - 2], tz = chain[m - 1];
      if (m >= 6 && ptClose(hx, hz, tx, tz, eps)) break;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const s = segs[j], sn = s.length, sx = s[0], sz = s[1], ex = s[sn - 2], ez = s[sn - 1];
        if (ptClose(tx, tz, sx, sz, eps)) { for (let k = 2; k < sn; k += 2) chain.push(s[k], s[k + 1]); }
        else if (ptClose(tx, tz, ex, ez, eps)) { for (let k = sn - 4; k >= 0; k -= 2) chain.push(s[k], s[k + 1]); }
        else if (ptClose(hx, hz, ex, ez, eps)) { const pre = []; for (let k = 0; k < sn - 2; k += 2) pre.push(s[k], s[k + 1]); chain = pre.concat(chain); }
        else if (ptClose(hx, hz, sx, sz, eps)) { const pre = []; for (let k = sn - 2; k >= 2; k -= 2) pre.push(s[k], s[k + 1]); chain = pre.concat(chain); }
        else continue;
        used[j] = true; grew = true; break;
      }
    }
    const m = chain.length;
    if (m >= 8 && ptClose(chain[0], chain[1], chain[m - 2], chain[m - 1], eps)) chain = chain.slice(0, m - 2);
    if (chain.length >= 6) rings.push(chain);
  }
  return rings;
}

/** 점 (x,z) 가 링 r([x,z,...]) 내부인지(ray-casting). */
function pointInRing(x, z, r) {
  let inside = false; const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

/**
 * Overpass relation(out geom) → 멀티폴리곤 목록 [{ outer:flat, holes:flat[] }].
 * outer/inner 멤버 way 를 끝점 봉합해 닫힌 링으로 만들고, 각 inner(구멍=섬/제방/육지)를 자신을 포함하는
 * 가장 작은 outer 에 귀속(중첩 다중폴리곤 대응). proj=투영. relationRings 와 달리 구멍을 보존한다.
 */
export function relationPolys(el, proj) {
  const outerWays = [], innerWays = [];
  for (const m of el.members ?? []) {
    if (m.type !== "way" || !m.geometry) continue;
    const flat = [];
    for (const g of m.geometry) { const [x, z] = proj(g.lat, g.lon); flat.push(x, z); }
    if (flat.length >= 4) (m.role === "inner" ? innerWays : outerWays).push(flat);
  }
  const polys = assembleRings(outerWays).map((o) => ({ outer: o, holes: [] }));
  if (!polys.length) return [];
  for (const h of assembleRings(innerWays)) {
    let best = -1, bestA = Infinity;
    for (let i = 0; i < polys.length; i++) {
      if (pointInRing(h[0], h[1], polys[i].outer)) { const a = ringArea(polys[i].outer); if (a < bestA) { bestA = a; best = i; } }
    }
    if (best >= 0) polys[best].holes.push(h); // 어느 outer 에도 안 들면 버림(잘못 도려내기 방지)
  }
  return polys;
}

/** 평면 폴리곤 [x0,z0,x1,z1,...] 의 넓이(shoelace, 절댓값). */
export function ringArea(p) {
  let a = 0;
  for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++)
    a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  return Math.abs(a) / 2;
}

// ── 폴리곤 정리(수집 시점) — 영길이 모서리/자기교차로 인한 퇴화 삼각형·이상 압출을 사전 제거 ──

/** 연속 중복 정점 제거. ring=true 면 닫힘 반복(last==first)도 제거. eps(m) 이내는 같은 점 취급. */
export function dedupeConsecutive(p, eps = 0.05, ring = false) {
  const out = [];
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const x = p[i * 2], z = p[i * 2 + 1];
    const m = out.length;
    if (m >= 2 && Math.abs(x - out[m - 2]) <= eps && Math.abs(z - out[m - 1]) <= eps) continue;
    out.push(x, z);
  }
  if (ring) {
    const m = out.length;
    if (m >= 4 && Math.abs(out[0] - out[m - 2]) <= eps && Math.abs(out[1] - out[m - 1]) <= eps) out.length -= 2;
  }
  return out;
}

const orient3 = (ox, oz, ax, az, bx, bz) => (ax - ox) * (bz - oz) - (az - oz) * (bx - ox);
function segProperCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = orient3(cx, cz, dx, dz, ax, az), d2 = orient3(cx, cz, dx, dz, bx, bz);
  const d3 = orient3(ax, az, bx, bz, cx, cz), d4 = orient3(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
/** 닫힌 폴리곤 자기교차(bowtie) 여부 — 비인접 모서리쌍 검사. 큰 폴리곤(>200)은 생략(false). */
export function isSelfIntersecting(p) {
  let n = p.length / 2;
  if (n >= 2 && p[0] === p[(n - 1) * 2] && p[1] === p[(n - 1) * 2 + 1]) n -= 1;
  if (n < 4 || n > 200) return false;
  for (let i = 0; i < n; i++) {
    const b = (i + 1) % n;
    for (let j = i + 1; j < n; j++) {
      const d = (j + 1) % n;
      if (i === j || i === d || b === j || b === d) continue;
      if (segProperCross(p[i * 2], p[i * 2 + 1], p[b * 2], p[b * 2 + 1], p[j * 2], p[j * 2 + 1], p[d * 2], p[d * 2 + 1])) return true;
    }
  }
  return false;
}

/** 볼록껍질(monotone chain, CCW). 점<3 또는 일직선이면 null. 자기교차 footprint 복구용. */
export function convexHull(p) {
  const pts = [];
  for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  if (pts.length < 3) return null;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const pt of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pt) <= 0) lo.pop(); lo.push(pt); }
  const up = [];
  for (let i = pts.length - 1; i >= 0; i--) { const pt = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pt) <= 0) up.pop(); up.push(pt); }
  lo.pop(); up.pop();
  const hull = lo.concat(up);
  if (hull.length < 3) return null;
  const out = [];
  for (const h of hull) out.push(h[0], h[1]);
  return out;
}

/**
 * 면(닫힌 폴리곤) 정리 — 연속 중복 제거 후 점<3 이면 null. 자기교차면 hullRepair=true 는 볼록껍질로 복구,
 * 아니면 null(드롭). build-maps 가 건물=복구, 면/수역=드롭으로 적용.
 */
export function sanitizeRing(p, hullRepair = false) {
  const d = dedupeConsecutive(p, 0.05, true);
  if (d.length / 2 < 3) return null;
  if (isSelfIntersecting(d)) return hullRepair ? convexHull(d) : null;
  return d;
}

/** 폴리라인(도로/담장/하천선) 정리 — 연속 중복 제거 후 점<2 이면 null. */
export function sanitizePolyline(p) {
  const d = dedupeConsecutive(p, 0.05, false);
  return d.length / 2 >= 2 ? d : null;
}

/**
 * 도로 stroke 병합 — 끝점을 공유하는 **같은 폭** 도로들을 가장 직선에 가까운 방향으로 이어 긴 연속 폴리라인으로 합친다.
 * OSM 이 교차로마다 way 를 끊어 중앙선·표면이 조각나는 문제 해결(간선이 교차로를 관통해 연속). angleTolDeg=최대 굴절각.
 */
export function mergeStrokes(roads, angleTolDeg = 50) {
  const K = (x, z) => Math.round(x) + "," + Math.round(z);
  const ends = new Map();
  const add = (k, ri) => { let a = ends.get(k); if (!a) { a = []; ends.set(k, a); } a.push(ri); };
  roads.forEach((r, ri) => { const p = r.p; add(K(p[0], p[1]), ri); add(K(p[p.length - 2], p[p.length - 1]), ri); });
  const used = new Array(roads.length).fill(false);
  const cosTol = Math.cos((angleTolDeg * Math.PI) / 180);
  const reverseFlat = (p) => { const o = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o; };
  const extendTail = (pts, w) => {
    for (;;) {
      const n = pts.length / 2, tx = pts[(n - 1) * 2], tz = pts[(n - 1) * 2 + 1];
      let tdx = tx - pts[(n - 2) * 2], tdz = tz - pts[(n - 2) * 2 + 1];
      const tl = Math.hypot(tdx, tdz) || 1; tdx /= tl; tdz /= tl;
      let best = -1, bestDot = cosTol, bestSeq = null;
      for (const ri of ends.get(K(tx, tz)) || []) {
        if (used[ri] || Math.abs(roads[ri].w - w) > 0.1) continue;
        const p = roads[ri].p;
        const seq = K(p[0], p[1]) === K(tx, tz) ? p : reverseFlat(p); // tail 에서 시작하도록 정렬
        let dx = seq[2] - seq[0], dz = seq[3] - seq[1]; const l = Math.hypot(dx, dz) || 1;
        const dot = (dx / l) * tdx + (dz / l) * tdz; // 진행방향 정렬도(클수록 직선)
        if (dot > bestDot) { bestDot = dot; best = ri; bestSeq = seq; }
      }
      if (best < 0) break;
      used[best] = true;
      for (let i = 2; i < bestSeq.length; i += 2) pts.push(bestSeq[i], bestSeq[i + 1]); // 공유 첫점 제외 append
    }
  };
  const out = [];
  for (let ri = 0; ri < roads.length; ri++) {
    if (used[ri]) continue;
    used[ri] = true;
    let pts = [...roads[ri].p];
    extendTail(pts, roads[ri].w);          // 꼬리 방향 확장
    pts = reverseFlat(pts);
    extendTail(pts, roads[ri].w);          // 반대(머리) 방향 확장
    out.push({ p: pts, w: roads[ri].w });
  }
  return out;
}

/** 거의 일직선인 내부 점 제거 — 이웃 직선에서 수직거리 ≤ tol(m) 이면 드롭. 끝점 유지. */
function simplifyCollinear(pts, tol) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const acx = c[0] - a[0], acz = c[1] - a[1];
    const cross = Math.abs((b[0] - a[0]) * acz - (b[1] - a[1]) * acx);
    const perp = cross / (Math.hypot(acx, acz) || 1); // a-c 직선에서 b 의 수직거리
    if (perp > tol) out.push(b); // 굴곡 지점만 유지(직선 구간은 솎음)
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * 폴리라인 곡선 스무딩(Chaikin 코너 커팅) — 굴곡을 부드럽게 + 이음매 메움.
 * 끝점은 고정(교차점/연결 유지), 내부 모서리만 자른다. iterations 회 반복 후 직선 구간은 솎아
 * 데이터 폭증을 막는다(곡선만 조밀, 직선은 희소). 2점(직선)·점<3 은 그대로. 결과 cm 반올림. 순수.
 */
export function smoothPolyline(p, iterations = 2, simplifyTol = 0.2) {
  let pts = [];
  for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  for (let it = 0; it < iterations && pts.length >= 3; it++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]); // Q (1/4)
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); // R (3/4)
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  if (simplifyTol > 0) pts = simplifyCollinear(pts, simplifyTol);
  const flat = [];
  for (const pt of pts) flat.push(Math.round(pt[0] * 100) / 100, Math.round(pt[1] * 100) / 100);
  return flat;
}
