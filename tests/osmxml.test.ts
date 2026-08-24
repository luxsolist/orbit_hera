import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { parseOsmXml, createOsmParser, unesc } from "../scripts/osmxml.mjs";

// XML 엔티티 해제. osmconvert 는 아포스트로피를 &#39; 로 쓰는데 숫자 문자 참조를 빠뜨리면
// "Sant&#39;Agostino" 가 그대로 랜드마크 표시명이 된다(실측 회귀: 로마 랜드마크 960개 중 106개).
describe("osmxml.unesc — XML 엔티티", () => {
  it("명명 엔티티", () => {
    expect(unesc("&lt;tag&gt;")).toBe("<tag>");
    expect(unesc("&quot;q&quot;")).toBe('"q"');
    expect(unesc("&apos;a&apos;")).toBe("'a'");
    expect(unesc("A &amp; B")).toBe("A & B");
  });

  it("숫자 문자 참조(10진·16진) — osmconvert 가 쓰는 형식", () => {
    expect(unesc("Sant&#39;Agostino")).toBe("Sant'Agostino");
    expect(unesc("d&#x27;Assisi")).toBe("d'Assisi");
    expect(unesc("&#8364;")).toBe("\u20ac");
  });

  it("이중 해제하지 않는다 — &amp;#39; 는 리터럴 &#39;", () => {
    expect(unesc("&amp;#39;")).toBe("&#39;");
  });

  it("엔티티가 아닌 문자열·범위 밖 코드포인트는 그대로", () => {
    expect(unesc("plain")).toBe("plain");
    expect(unesc("100% & more")).toBe("100% & more");
    expect(unesc("&#999999999;")).toBe("&#999999999;");
    expect(unesc(null)).toBeNull();
  });

  it("태그 값에 적용된다(파서 통합)", () => {
    const j = parseOsmXml(`<?xml version="1.0"?>
<osm>
 <node id="1" lat="41.89" lon="12.49"/>
 <node id="2" lat="41.90" lon="12.50"/>
 <node id="3" lat="41.91" lon="12.49"/>
 <way id="10">
  <nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/>
  <tag k="building" v="church"/>
  <tag k="name" v="Chiesa di Sant&#39;Agostino"/>
 </way>
</osm>`);
    const w = j.elements.find((e: { type: string }) => e.type === "way");
    expect(w.tags.name).toBe("Chiesa di Sant'Agostino");
  });
});

// OSM XML(osmconvert 추출) → Overpass-JSON 변환 — node ref 해석/태그/관계 멤버 지오메트리.
describe("osmxml.parseOsmXml", () => {
  const xml = `<?xml version="1.0"?>
<osm>
 <node id="1" lat="37.50" lon="127.00"/>
 <node id="2" lat="37.51" lon="127.01"/>
 <node id="3" lat="37.52" lon="127.00"/>
 <node id="9" lat="37.50" lon="127.05">
  <tag k="amenity" v="cafe"/>
 </node>
 <way id="10">
  <nd ref="1"/>
  <nd ref="2"/>
  <nd ref="3"/>
  <nd ref="1"/>
  <tag k="building" v="yes"/>
 </way>
 <way id="11">
  <nd ref="1"/>
  <nd ref="2"/>
 </way>
 <relation id="20">
  <member type="way" ref="10" role="outer"/>
  <tag k="natural" v="water"/>
 </relation>
</osm>`;
  const { elements } = parseOsmXml(xml);

  it("태그 있는 way 는 geometry(좌표 해석) 포함", () => {
    const w = elements.find((e: any) => e.type === "way" && e.id === 10);
    expect(w.tags.building).toBe("yes");
    expect(w.geometry).toHaveLength(4);
    expect(w.geometry[0]).toEqual({ lat: 37.5, lon: 127.0 });
  });
  it("태그 없는 way(11) 는 방출 안 함(관계 지오메트리용으로만 보관)", () => {
    expect(elements.find((e: any) => e.id === 11 && e.type === "way")).toBeUndefined();
  });
  it("태그 있는 node 는 방출", () => {
    const n = elements.find((e: any) => e.type === "node" && e.id === 9);
    expect(n.tags.amenity).toBe("cafe");
  });
  it("relation 멤버 way 지오메트리 해석", () => {
    const r = elements.find((e: any) => e.type === "relation");
    expect(r.tags.natural).toBe("water");
    expect(r.members[0].geometry).toHaveLength(4);
  });
});

// ── 대용량 경로(2026-08-24) — 노드 테이블 타입배열 + 즉시 방출 ──
// 현행 파서는 카이로(754MB 추출)에서 힙 2.7GB 를 썼고, 오사카는 노드가 5배(14.1M)·way 가 10배라
// 선형 환산만 해도 13GB 였다(실측 OOM). 자료구조를 바꿔 카이로 95MB / 오사카 756MB 로 내렸는데,
// **파서 출력이 build-maps 전체의 입력**이라 조용한 회귀가 가장 위험하다.
// 실물 검증은 따로 했다(카이로 NDJSON 바이트 동일 · 로마 820,407 요소 전량 일치).
// 여기서는 그 검증이 닿지 않는 경계 조건을 잠근다.
//
// ⚠ 파서는 **줄 단위**다(osmconvert 는 요소·자식마다 개행). 아래 XML 을 한 줄로 몰아 쓰면
//   <nd>/<tag>/</way> 를 못 보고 way 가 영영 안 닫힌다 — 이 테스트를 쓰며 실제로 그랬다.

describe("osmxml — 좌표 정밀도(정수 1e7 스케일)", () => {
  it("소수 7자리를 왕복해도 값이 보존된다 — Float32 면 위도 35 에서 0.46m 가 어긋난다", () => {
    const { elements } = parseOsmXml(`<osm>
 <node id="1" lat="34.8734123" lon="135.2829456"/>
 <node id="2" lat="-33.8688197" lon="151.2092955"/>
 <node id="3" lat="0.0000001" lon="-0.0000001"/>
 <way id="10">
  <nd ref="1"/>
  <nd ref="2"/>
  <nd ref="3"/>
  <tag k="building" v="yes"/>
 </way>
</osm>`);
    const w = elements.find((e: any) => e.type === "way") as any;
    expect(w.geometry[0]).toEqual({ lat: 34.8734123, lon: 135.2829456 });
    expect(w.geometry[1]).toEqual({ lat: -33.8688197, lon: 151.2092955 });
    expect(w.geometry[2]).toEqual({ lat: 0.0000001, lon: -0.0000001 });
  });

  it("자릿수가 적은 표기도 그대로 — 34.87 이 34.8699999 로 새지 않는다", () => {
    const { elements } = parseOsmXml(`<osm>
 <node id="1" lat="34.87" lon="135.5"/>
 <way id="10">
  <nd ref="1"/>
  <tag k="building" v="yes"/>
 </way>
</osm>`);
    expect((elements[0] as any).geometry[0]).toEqual({ lat: 34.87, lon: 135.5 });
  });

  it("태그 있는 노드의 lat/lon 은 파싱 원값(스케일 왕복을 거치지 않는다)", () => {
    const { elements } = parseOsmXml(`<osm>
 <node id="9" lat="35.0116363" lon="135.7680294">
  <tag k="amenity" v="cafe"/>
 </node>
</osm>`);
    expect(elements[0]).toEqual({ type: "node", id: 9, lat: 35.0116363, lon: 135.7680294, tags: { amenity: "cafe" } });
  });
});

describe("osmxml — 노드 id 순서 가정", () => {
  // osmconvert 출력은 id 오름차순이라 이진 탐색을 쓴다(오사카 표본 200만 건 위반 0).
  // 그래도 가정에 기대지 않는다 — 다른 도구가 만든 XML 이 들어오면 조용히 좌표가 어긋난다.
  it("역순으로 들어와도 좌표를 올바로 찾는다", () => {
    const { elements } = parseOsmXml(`<osm>
 <node id="900" lat="1.0000001" lon="2.0000002"/>
 <node id="5" lat="3.0000003" lon="4.0000004"/>
 <node id="77" lat="5.0000005" lon="6.0000006"/>
 <way id="10">
  <nd ref="5"/>
  <nd ref="900"/>
  <nd ref="77"/>
  <tag k="building" v="yes"/>
 </way>
</osm>`);
    expect((elements[0] as any).geometry).toEqual([
      { lat: 3.0000003, lon: 4.0000004 },
      { lat: 1.0000001, lon: 2.0000002 },
      { lat: 5.0000005, lon: 6.0000006 },
    ]);
  });

  it("뒤섞인 순서에서도 전량을 찾는다(이진 탐색이 정렬 후에 도는지)", () => {
    const ids = [50, 3, 900, 12, 7, 400, 1, 88];
    const nodes = ids.map((id, i) => ` <node id="${id}" lat="${(i + 1) / 10}" lon="${(i + 1) / 5}"/>`).join("\n");
    const nds = ids.map((id) => `  <nd ref="${id}"/>`).join("\n");
    const { elements } = parseOsmXml(`<osm>\n${nodes}\n <way id="10">\n${nds}\n  <tag k="building" v="yes"/>\n </way>\n</osm>`);
    expect((elements[0] as any).geometry).toHaveLength(ids.length);
  });
});

describe("osmxml — 방출 계약", () => {
  const XML = `<osm>
 <node id="1" lat="1" lon="1"/>
 <node id="2" lat="2" lon="2"/>
 <way id="10">
  <nd ref="1"/>
  <nd ref="2"/>
  <tag k="highway" v="residential"/>
 </way>
 <way id="11">
  <nd ref="2"/>
 </way>
</osm>`;

  it("onElement 를 주면 즉시 넘기고 누적하지 않는다(대용량 경로)", () => {
    const seen: any[] = [];
    const p = createOsmParser((e: any) => seen.push(e));
    for (const l of XML.split("\n")) p.line(l);
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("way");
    expect(p.result().elements).toEqual([]); // 콜백 경로에서는 내부에 쌓지 않는다
  });

  it("stats 로 노드·way 수를 보고한다(입력이 정렬돼 있었는지 포함)", () => {
    const p = createOsmParser(() => {});
    for (const l of XML.split("\n")) p.line(l);
    expect(p.stats()).toEqual({ nodes: 2, ways: 2, sortedInput: true });
  });
});

describe("osmxml — 추출 경계·결손", () => {
  it("없는 nd ref 는 건너뛴다 — bbox 밖 노드를 참조하는 way(추출 가장자리)", () => {
    const { elements } = parseOsmXml(`<osm>
 <node id="1" lat="1.1" lon="2.2"/>
 <way id="10">
  <nd ref="1"/>
  <nd ref="999"/>
  <tag k="building" v="yes"/>
 </way>
</osm>`);
    expect((elements[0] as any).geometry).toEqual([{ lat: 1.1, lon: 2.2 }]);
  });

  it("relation 멤버 ref 는 **문자열**로 남는다 — 기존 출력 형식(processOSM 계약)", () => {
    const { elements } = parseOsmXml(`<osm>
 <node id="1" lat="1" lon="1"/>
 <way id="10">
  <nd ref="1"/>
 </way>
 <relation id="20">
  <member type="way" ref="10" role="outer"/>
  <tag k="natural" v="water"/>
 </relation>
</osm>`);
    const r = elements.find((e: any) => e.type === "relation") as any;
    expect(r.members[0].ref).toBe("10");
    expect(r.members[0].geometry).toHaveLength(1);
  });

  it("빈 way·태그 없는 relation 은 방출하지 않는다", () => {
    const { elements } = parseOsmXml(`<osm>
 <way id="10"/>
 <relation id="20">
  <member type="way" ref="10" role="outer"/>
 </relation>
</osm>`);
    expect(elements).toEqual([]);
  });
});
