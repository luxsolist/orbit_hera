// OSM XML(osmconvert 추출) → Overpass-JSON {elements} 변환 — 순수 파서(외부 의존 없음).
// processOSM(build-maps) 이 소비하는 Overpass `out geom` 형식과 동일하게 맞춘다:
//   node:     { type:"node", id, lat, lon, tags }
//   way:      { type:"way", id, tags, geometry:[{lat,lon},...] }   (nd ref → 좌표 해석)
//   relation: { type:"relation", id, tags, members:[{type,ref,role,geometry?}] }
// OSM XML 은 node→way→relation 순서라 way/relation 파싱 시 참조 대상이 이미 적재돼 있다.

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

/**
 * 스트리밍 OSM XML 파서 — 라인을 하나씩 먹여(line) 누적, result() 로 {elements} 회수.
 * 거대(>512MB, Node 문자열 한계 초과) 추출도 readline 으로 라인 단위 처리. 태그 있는 요소만 방출.
 */
export function createOsmParser() {
  const nodes = new Map();    // id -> [lat, lon]
  const wayGeom = new Map();  // id -> [{lat,lon}...]
  const elements = [];
  let cur = null;             // 현재 열린 way/relation/tagged-node

  const finishWay = (w) => {
    const geom = [];
    for (const ref of w.nds) { const n = nodes.get(ref); if (n) geom.push({ lat: n[0], lon: n[1] }); }
    wayGeom.set(w.id, geom);
    if (Object.keys(w.tags).length) elements.push({ type: "way", id: +w.id, tags: w.tags, geometry: geom });
  };
  const finishRel = (r) => {
    if (!Object.keys(r.tags).length) return;
    for (const m of r.members) { if (m.type === "way") { const g = wayGeom.get(m.ref); if (g) m.geometry = g; } }
    elements.push({ type: "relation", id: +r.id, tags: r.tags, members: r.members });
  };

  const line = (raw) => {
    const t = raw.trimStart();
    if (t.charCodeAt(0) !== 60) return; // '<'
    if (t.startsWith("<node")) {
      const id = attr(t, "id"), lat = +attr(t, "lat"), lon = +attr(t, "lon");
      if (id != null) nodes.set(id, [lat, lon]);
      if (!t.endsWith("/>")) cur = { type: "node", id: +id, lat, lon, tags: {} }; // 태그 보유 노드(닫힘에서 방출)
    } else if (t.startsWith("<nd ")) { if (cur) cur.nds?.push(attr(t, "ref")); }
    else if (t.startsWith("<tag")) { if (cur) cur.tags[unesc(attr(t, "k"))] = unesc(attr(t, "v")); }
    else if (t.startsWith("<way")) { cur = { type: "way", id: attr(t, "id"), tags: {}, nds: [] }; if (t.endsWith("/>")) { finishWay(cur); cur = null; } }
    else if (t.startsWith("<member")) { if (cur) cur.members.push({ type: attr(t, "type"), ref: attr(t, "ref"), role: attr(t, "role") || "" }); }
    else if (t.startsWith("<relation")) { cur = { type: "relation", id: attr(t, "id"), tags: {}, members: [] }; if (t.endsWith("/>")) cur = null; }
    else if (t.startsWith("</node>")) { if (cur && Object.keys(cur.tags).length) elements.push(cur); cur = null; }
    else if (t.startsWith("</way>")) { if (cur) finishWay(cur); cur = null; }
    else if (t.startsWith("</relation>")) { if (cur) finishRel(cur); cur = null; }
  };
  return { line, result: () => ({ elements }) };
}

/** 작은 XML 문자열 → {elements} (테스트/소량용). 대용량은 createOsmParser + readline 사용. */
export function parseOsmXml(xml) {
  const p = createOsmParser();
  for (const l of xml.split("\n")) p.line(l);
  return p.result();
}
