import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { normName, coreName, coreTokens, tokensSubsume, buildNameIndex, matchCuratedByName } from "../scripts/osm.mjs";

// 큐레이션 랜드마크 ↔ OSM **이름** 매칭. 지오코딩 미해결 175개(10%·71개 도시)를 외부 API 대신
// 그 도시의 추출 안에서 해결하는 경로다. 규칙이 느슨하면 엉뚱한 대상을 랜드마크로 승격시키고,
// 빡빡하면 표기 차이 하나로 통째로 놓친다 — 실측한 표기 흔들림을 그대로 못박는다.
//
// 실측 근거(교토·바라나시 미해결 6개):
//   "Philosopher's Path"(큐레이션) ↔ "Philosopher's Walk"(OSM way 190875728)
//   "Bharat Mata Mandir"           ↔ "Bharatmata Mandir"(way 420064449)
//   "Togetsukyo Bridge"            ↔ "Togetsukyo"(node 243776548)
//   "Gion District"                ↔ "Gion"(node 266605718)

const proj = (lat: number, lon: number) => [lon * 1000, -lat * 1000]; // 테스트용 단순 투영

describe("normName — 표기 정규화", () => {
  it("대소문자·아포스트로피·하이픈·구두점을 흡수", () => {
    expect(normName("Philosopher's Path")).toBe("philosophers path");
    expect(normName("Hanamikoji-dori")).toBe("hanamikoji dori");
    expect(normName("  Bab   Tuma  ")).toBe("bab tuma");
  });
  it("발음기호를 뗀다 — Café ↔ Cafe", () => {
    expect(normName("Café Müller")).toBe("cafe muller");
    expect(normName("Sant'Agostino")).toBe("santagostino");
  });
  it("null·빈 값에도 안전", () => {
    expect(normName(null)).toBe("");
    expect(normName(undefined)).toBe("");
  });
});

describe("coreName — 유형 일반명사 제거", () => {
  it("접미사가 달라도 핵심어는 같다 — 이걸 안 떼면 전부 미매칭", () => {
    expect(coreName("Philosopher's Path")).toBe(coreName("Philosopher's Walk"));
    expect(coreName("Togetsukyo Bridge")).toBe(coreName("Togetsukyo"));
    expect(coreName("Gion District")).toBe(coreName("Gion"));
  });
  it("띄어쓰기 차이를 흡수 — Bharat Mata ↔ Bharatmata", () => {
    expect(coreName("Bharat Mata Mandir")).toBe(coreName("Bharatmata Mandir"));
  });
  it("핵심어가 너무 짧으면 null — 일반명사만 남은 이름으로 매칭하면 아무거나 걸린다", () => {
    expect(coreName("The Temple")).toBeNull();
    expect(coreName("Museum")).toBeNull();
    expect(coreName("Old Gate")).toBeNull(); // "old" 3자
  });
  it("서로 다른 대상은 여전히 구분된다", () => {
    expect(coreName("Umayyad Mosque")).not.toBe(coreName("Sayyida Zainab Mosque"));
  });
});

describe("buildNameIndex / matchCuratedByName", () => {
  const elements = [
    { type: "way", id: 190875728, tags: { name: "哲学の道", "name:en": "Philosopher's Walk" },
      geometry: [{ lat: 35.02, lon: 135.79 }, { lat: 35.03, lon: 135.79 }, { lat: 35.04, lon: 135.80 }] },
    { type: "node", id: 243776548, tags: { name: "渡月橋", "name:en": "Togetsukyo" }, lat: 35.0136, lon: 135.6778 },
    { type: "way", id: 420064449, tags: { name: "Bharatmata Mandir", "name:hi": "भारत माता मन्दिर" },
      geometry: [{ lat: 25.29, lon: 82.99 }, { lat: 25.30, lon: 82.99 }, { lat: 25.30, lon: 83.00 }] },
    { type: "node", id: 1, tags: { amenity: "cafe" }, lat: 35.0, lon: 135.0 }, // 이름 없음 — 색인 제외
  ];
  const idx = buildNameIndex(elements, proj);

  it("영문 표기 차이를 핵심어로 해결한다", () => {
    const hit = matchCuratedByName(idx, { name: "철학의 길", nameEn: "Philosopher's Path" });
    expect(hit.src.osmId).toBe(190875728);
    expect(hit.via).toBe("name-core");
  });

  it("띄어쓰기 차이도 해결한다", () => {
    expect(matchCuratedByName(idx, { name: "바라트 마타 사원", nameEn: "Bharat Mata Mandir" }).src.osmId).toBe(420064449);
  });

  it("완전일치가 있으면 핵심어 단계로 내려가지 않는다 — 느슨한 규칙이 먼저 이기면 안 된다", () => {
    const hit = matchCuratedByName(idx, { name: "도게츠쿄", nameEn: "Togetsukyo" });
    expect(hit.via).toBe("name-exact");
    expect(hit.src.osmId).toBe(243776548);
  });

  it("현지어 표기(name:*)로도 찾는다 — 영문명이 없는 카탈로그 항목 대비", () => {
    expect(matchCuratedByName(idx, { name: "哲学の道" }).src.osmId).toBe(190875728);
  });

  it("way 지오메트리는 중심 좌표를 준다", () => {
    const hit = matchCuratedByName(idx, { name: "x", nameEn: "Togetsukyo" });
    expect(hit.x).toBeCloseTo(135.6778 * 1000, 3);
    expect(hit.z).toBeCloseTo(-35.0136 * 1000, 3);
  });

  it("없는 이름은 null — 못 찾으면 좌표를 지어내지 않는다", () => {
    expect(matchCuratedByName(idx, { name: "뉴 비슈와나트 사원", nameEn: "New Vishwanath Temple" })).toBeNull();
  });

  it("이름 없는 요소는 색인되지 않는다", () => {
    expect(idx.exact.size).toBeGreaterThan(0);
    for (const arr of idx.exact.values()) for (const it of arr) expect(it.id).not.toBe(1);
  });

  it("색인이 없어도 죽지 않는다(카탈로그만 있고 추출이 없는 경로)", () => {
    expect(matchCuratedByName(null, { name: "x", nameEn: "y" })).toBeNull();
  });

  it("후보가 여럿이면 면을 가진 쪽(건물·폴리곤)을 고른다", () => {
    const many = buildNameIndex([
      { type: "node", id: 10, tags: { "name:en": "Bab Tuma" }, lat: 33.5, lon: 36.3 },
      { type: "way", id: 11, tags: { "name:en": "Bab Tuma" },
        geometry: [{ lat: 33.51, lon: 36.31 }, { lat: 33.52, lon: 36.31 }, { lat: 33.52, lon: 36.32 }] },
    ], proj);
    expect(matchCuratedByName(many, { nameEn: "Bab Tuma" }).src.osmId).toBe(11);
  });
});

// ── 3단계(토큰 포함) — 가장 느슨한 규칙이라 오매칭 방어가 본체다 ──
// 실측 근거: OSM `name:en` 이 "The Great Sphinx" 인데 큐레이션은 "Great Sphinx of Giza" 다.
// 지명 수식어 차이라 앞 두 단계로는 못 잡는다. 그런데 이 규칙을 열자 곧바로 오매칭이 나왔다 —
// "Dongnae Eupseong"(동래읍성지·사적)이 `name:en="Dongnae"` 인 **동래역**(지하철역)에 붙었다.

describe("tokensSubsume — 수식어 차이 흡수", () => {
  it("한쪽이 다른 쪽의 부분집합이면 같은 대상", () => {
    expect(tokensSubsume(coreTokens("Great Sphinx of Giza"), coreTokens("The Great Sphinx"))).toBe(true);
  });
  it("토큰 1개짜리는 6자 이상이어야 한다 — 짧은 지명 하나로는 아무거나 걸린다", () => {
    expect(tokensSubsume(["old"], ["old", "town"])).toBe(false);
    expect(tokensSubsume(["vishwanath"], ["new", "vishwanath"])).toBe(true);
  });
  it("빈 입력은 매칭 아님", () => {
    expect(tokensSubsume([], ["a", "b"])).toBe(false);
  });
});

describe("오매칭 방어", () => {
  const proj = (lat: number, lon: number) => [lon * 1000, -lat * 1000];

  it("역·상점은 3단계 후보에서 제외 — 동래읍성지가 동래역에 붙던 회귀", () => {
    const idx = buildNameIndex([
      { type: "node", id: 289245376, lat: 35.2, lon: 129.08,
        tags: { name: "동래", "name:en": "Dongnae", railway: "station", public_transport: "station" } },
    ], proj);
    expect(matchCuratedByName(idx, { name: "동래읍성지", nameEn: "Dongnae Eupseong" })).toBeNull();
  });

  it("유적·종교·건물은 3단계 후보로 남는다", () => {
    const idx = buildNameIndex([
      { type: "way", id: 540058405, tags: { name: "أبو الهول", "name:en": "The Great Sphinx", historic: "monument" },
        geometry: [{ lat: 29.97, lon: 31.13 }, { lat: 29.98, lon: 31.13 }, { lat: 29.98, lon: 31.14 }] },
    ], proj);
    const hit = matchCuratedByName(idx, { name: "스핑크스", nameEn: "Great Sphinx of Giza" });
    expect(hit.via).toBe("name-subset");
    expect(hit.src.osmId).toBe(540058405);
  });

  it('"house"·"hall" 은 일반명사가 아니다 — 기온 지구가 The Gion House 에 붙던 회귀', () => {
    expect(coreName("Gion District")).not.toBe(coreName("The Gion House"));
    const idx = buildNameIndex([
      { type: "way", id: 357213264, tags: { name: "The Gion House", building: "yes" },
        geometry: [{ lat: 35.00, lon: 135.77 }, { lat: 35.01, lon: 135.77 }, { lat: 35.01, lon: 135.78 }] },
      { type: "node", id: 266605718, tags: { name: "祇園", "name:en": "Gion", place: "neighbourhood" }, lat: 35.0037, lon: 135.7772 },
    ], proj);
    expect(matchCuratedByName(idx, { name: "기온 지구", nameEn: "Gion District" }).src.osmId).toBe(266605718);
  });
});
