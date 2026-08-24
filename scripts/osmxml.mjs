// OSM XML(osmconvert 추출) → Overpass-JSON {elements} 변환 — 순수 파서(외부 의존 없음).
// processOSM(build-maps) 이 소비하는 Overpass `out geom` 형식과 동일하게 맞춘다:
//   node:     { type:"node", id, lat, lon, tags }
//   way:      { type:"way", id, tags, geometry:[{lat,lon},...] }   (nd ref → 좌표 해석)
//   relation: { type:"relation", id, tags, members:[{type,ref,role,geometry?}] }
// OSM XML 은 node→way→relation 순서라 way/relation 파싱 시 참조 대상이 이미 적재돼 있다.
//
// ── 메모리 설계(2026-08-24) ──
// 읽기는 원래부터 readline 줄 단위였다. 터진 건 읽기가 아니라 **누적 자료구조**였다.
// 실측(카이로 754MB 추출): 힙 2,732MB. 오사카는 노드가 5배(14.1M)·way 가 10배(2.75M)라
// 선형 환산만 해도 13GB — 힙 상한으로 해결되는 문제가 아니었다.
//
// 세 가지를 바꿔 카이로 2,732MB → 95MB, 오사카 756MB(39s)로 내렸다:
//   ① 노드 테이블을 **타입배열**로: Map<문자열id,[lat,lon]>(항목 ~180B) → Float64Array(id) +
//      Int32Array(좌표) 16B. 좌표는 OSM 내부 표현과 같은 **정수 1e7 스케일**(정밀도 1.1cm).
//      Float32 는 위도 35 에서 0.46m 라 건물 footprint 에 못 쓴다.
//   ② way 지오메트리를 **평면 Int32Array** 로: {lat,lon} 객체 17.3M 개가 사라진다.
//   ③ 요소를 **즉시 방출**(onElement): 전량을 배열에 쌓았다가 마지막에 기록하던 것을 흘려보낸다.
//
// bbox 타일 분할도 검토했으나 버렸다 — 경계를 걸친 건물·도로가 잘리고, --complete-ways 로 살리면
// 타일마다 중복이 생겨 id 중복 제거가 필요하다. 경계 정합성이라는 **새 오류 표면**을 얻는 대신
// 자료구조만 고치면 같은 효과가 난다. "필요한 노드만 두 번 읽어 유지"도 무의미했다 —
// nd 참조 17.3M 에 노드 14.1M 이라 사실상 모든 노드가 참조된다.

const ATTR = {};
const attr = (s, name) => { const re = ATTR[name] || (ATTR[name] = new RegExp(` ${name}="([^"]*)"`)); const m = s.match(re); return m ? m[1] : null; };
// XML 엔티티 해제 — 명명(&lt; 등) + **숫자 문자 참조**(&#39; / &#x27;) 둘 다. osmconvert 는 아포스트로피를
// &#39; 로 쓰므로 숫자형을 빠뜨리면 "Sant&#39;Agostino" 가 그대로 랜드마크 표시명이 된다(실측: 로마 960개 중 106개).
// 한 번의 치환으로 처리해야 "&amp;#39;"(= 리터럴 "&#39;")가 이중 해제되지 않는다.
const NAMED = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
export const unesc = (s) =>
  s == null ? s : s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(lt|gt|quot|apos|amp));/g, (m, dec, hex, name) => {
    if (dec != null) { const c = Number(dec); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; }
    if (hex != null) { const c = parseInt(hex, 16); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; }
    return NAMED[name];
  });

/** 좌표 스케일 — OSM 내부 표현과 동일(1e-7도 ≈ 1.1cm). lat·lon 최대 ±1.8e9 로 Int32 범위 안. */
const S = 1e7;

/**
 * 노드 좌표 테이블 — id 오름차순 가정 + 이진 탐색. osmconvert 출력은 실제로 정렬돼 있지만
 * (오사카 표본 200만 건 위반 0) **가정에 기대지 않고** 삽입 중 역순을 감지해 필요할 때만 정렬한다.
 */
function nodeTable(initial = 1 << 12) {
  let cap = initial, n = 0, sorted = true, dirty = false;
  let ids = new Float64Array(cap); //  OSM node id 는 ~1.2e10 — Float64 정수 정확 표현 범위(2^53) 안
  let lats = new Int32Array(cap);
  let lons = new Int32Array(cap);
  const grow = () => {
    cap *= 2;
    const a = new Float64Array(cap); a.set(ids); ids = a;
    const b = new Int32Array(cap); b.set(lats); lats = b;
    const c = new Int32Array(cap); c.set(lons); lons = c;
  };
  const push = (id, lat, lon) => {
    if (n === cap) grow();
    if (n && id < ids[n - 1]) { sorted = false; dirty = true; }
    ids[n] = id; lats[n] = Math.round(lat * S); lons[n] = Math.round(lon * S); n++;
  };
  const reorder = () => { // 역순 입력 폴백 — 순열로 세 배열을 함께 재배치
    const ord = new Uint32Array(n);
    for (let i = 0; i < n; i++) ord[i] = i;
    const arr = Array.from(ord).sort((a, b) => ids[a] - ids[b]);
    const ni = new Float64Array(cap), nl = new Int32Array(cap), no = new Int32Array(cap);
    for (let i = 0; i < n; i++) { const k = arr[i]; ni[i] = ids[k]; nl[i] = lats[k]; no[i] = lons[k]; }
    ids = ni; lats = nl; lons = no; dirty = false; sorted = true;
  };
  /** id → 인덱스(없으면 -1). */
  const find = (id) => {
    if (dirty) reorder();
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1, v = ids[m];
      if (v === id) return m;
      if (v < id) lo = m + 1; else hi = m - 1;
    }
    return -1;
  };
  return { push, find, lat: (i) => lats[i], lon: (i) => lons[i], get size() { return n; }, get sorted() { return sorted; } };
}

/** 평면 Int32(lat,lon 쌍) → Overpass geometry 객체 배열. 방출 시점에만 만든다(그 전까지는 평면 유지). */
const toGeom = (g) => {
  const out = new Array(g.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = { lat: g[i * 2] / S, lon: g[i * 2 + 1] / S };
  return out;
};

/**
 * 스트리밍 OSM XML 파서 — 라인을 하나씩 먹인다(line).
 *
 * @param onElement 주면 요소를 **즉시** 넘긴다(누적 없음 — 대용량 경로). 없으면 내부에 모아 result() 로 회수.
 */
export function createOsmParser(onElement) {
  const nodes = nodeTable();
  const wayGeom = new Map(); // 숫자 way id -> Int32Array [lat,lon,...] (relation 멤버 해석용)
  const collected = onElement ? null : [];
  const emit = onElement ?? ((e) => collected.push(e));
  let cur = null; // 현재 열린 way/relation/tagged-node

  const finishWay = (w) => {
    const k = w.nds.length;
    const g = new Int32Array(k * 2);
    let j = 0;
    for (let i = 0; i < k; i++) {
      const p = nodes.find(w.nds[i]);
      if (p >= 0) { g[j++] = nodes.lat(p); g[j++] = nodes.lon(p); } // 없는 ref 는 건너뛴다(추출 경계)
    }
    const geo = j === g.length ? g : g.subarray(0, j);
    wayGeom.set(w.id, geo);
    if (w.tagged) emit({ type: "way", id: w.id, tags: w.tags, geometry: toGeom(geo) });
  };
  const finishRel = (r) => {
    if (!r.tagged) return;
    // 멤버 ref 는 **문자열 그대로** 둔다(기존 출력 형식) — 조회에만 숫자로 쓴다.
    for (const m of r.members) if (m.type === "way") { const g = wayGeom.get(+m.ref); if (g) m.geometry = toGeom(g); }
    emit({ type: "relation", id: r.id, tags: r.tags, members: r.members });
  };

  const line = (raw) => {
    const t = raw.trimStart();
    if (t.charCodeAt(0) !== 60) return; // '<'
    if (t.startsWith("<node")) {
      const id = +attr(t, "id"), lat = +attr(t, "lat"), lon = +attr(t, "lon");
      nodes.push(id, lat, lon);
      // 태그 보유 노드는 닫힘(</node>)에서 방출. lat/lon 은 **파싱 원값**을 그대로 실어 보낸다.
      if (!t.endsWith("/>")) cur = { type: "node", id, lat, lon, tags: {}, tagged: false };
    } else if (t.startsWith("<nd ")) { if (cur) cur.nds?.push(+attr(t, "ref")); }
    else if (t.startsWith("<tag")) { if (cur) { cur.tags[unesc(attr(t, "k"))] = unesc(attr(t, "v")); cur.tagged = true; } }
    else if (t.startsWith("<way")) { cur = { id: +attr(t, "id"), tags: {}, nds: [], tagged: false }; if (t.endsWith("/>")) { finishWay(cur); cur = null; } }
    else if (t.startsWith("<member")) { if (cur) cur.members.push({ type: attr(t, "type"), ref: attr(t, "ref"), role: attr(t, "role") || "" }); }
    else if (t.startsWith("<relation")) { cur = { id: +attr(t, "id"), tags: {}, members: [], tagged: false }; if (t.endsWith("/>")) cur = null; }
    else if (t.startsWith("</node>")) { if (cur?.tagged) emit({ type: "node", id: cur.id, lat: cur.lat, lon: cur.lon, tags: cur.tags }); cur = null; }
    else if (t.startsWith("</way>")) { if (cur) finishWay(cur); cur = null; }
    else if (t.startsWith("</relation>")) { if (cur) finishRel(cur); cur = null; }
  };

  return {
    line,
    /** onElement 없이 만들었을 때만 유효(소량·테스트용). */
    result: () => ({ elements: collected ?? [] }),
    stats: () => ({ nodes: nodes.size, ways: wayGeom.size, sortedInput: nodes.sorted }),
  };
}

/** 작은 XML 문자열 → {elements} (테스트/소량용). 대용량은 createOsmParser(onElement) + readline 사용. */
export function parseOsmXml(xml) {
  const p = createOsmParser();
  for (const l of xml.split("\n")) p.line(l);
  return p.result();
}
