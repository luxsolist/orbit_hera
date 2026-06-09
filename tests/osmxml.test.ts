import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { parseOsmXml } from "../scripts/osmxml.mjs";

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
