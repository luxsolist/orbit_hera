import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { parseOsmXml, unesc } from "../scripts/osmxml.mjs";

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
