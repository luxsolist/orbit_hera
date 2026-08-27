import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { radiusBbox, normCity, parseCatalogDoc, cityEntry, RADIUS_M } from "../scripts/gen-city-config.mjs";
import { cityMapDef } from "../scripts/maps.config.mjs";
import { MAPS } from "../scripts/maps.config.mjs";

// 도시 100선 config 생성 경로. 손으로 100개를 적는 대신 세 데이터 파일(장 배속·실측 좌표·로마자 id)을
// 조인해 만든다 — 조인이 조용히 어긋나면 "97개 빌드했는데 3개가 없다"로 뒤늦게 터지므로 여기서 잠근다.

const catalog = JSON.parse(readFileSync("scripts/data/city-catalog.json", "utf8"));

describe("radiusBbox — 반경 20km bbox", () => {
  const M_LAT = 111320;

  it("위도 폭은 어디서나 40km", () => {
    for (const lat of [0, 35.68, 64.15, -33.87]) {
      const [s, , n] = radiusBbox(lat, 0);
      expect(((n - s) * M_LAT) / 1000).toBeCloseTo(40, 1);
    }
  });

  it("경도 폭은 위도 보정 후 40km — 고위도에서 좁아지지 않는다", () => {
    for (const lat of [0, 35.68, 64.15, -41.29]) {
      const [, w, , e] = radiusBbox(lat, 10);
      const km = ((e - w) * M_LAT * Math.cos((lat * Math.PI) / 180)) / 1000;
      expect(km).toBeCloseTo(40, 0);
    }
  });

  it("날짜변경선 인근 음수 경도도 그대로 유지(부호 뒤집힘 없음)", () => {
    const [, w, , e] = radiusBbox(64.15, -21.94);
    expect(w).toBeLessThan(-21.94);
    expect(e).toBeGreaterThan(-21.94);
  });
});

describe("normCity — 문서 표기 ↔ 캐시 키", () => {
  it("괄호 주석을 뗀다", () => {
    expect(normCity("시엠레아프(앙코르)")).toBe("시엠레아프");
    expect(normCity("시안(西安)")).toBe("시안");
    expect(normCity("뉴욕 (미국)")).toBe("뉴욕");
  });
  it("괄호가 없으면 그대로", () => {
    expect(normCity(" 도쿄 ")).toBe("도쿄");
  });
});

describe("parseCatalogDoc — 09-city-catalog.md 표 파싱", () => {
  const doc = parseCatalogDoc(readFileSync("docs/spec/09-city-catalog.md", "utf8"));

  it("장별 표 모양이 달라도 전부 잡는다(1장 4열 · 2장 자매쌍 · 3장 3열 · 4~6장 권역)", () => {
    expect(doc["로마"]).toEqual({ chapter: 1, country: "이탈리아" });
    expect(doc["뉴욕"].chapter).toBe(2);
    expect(doc["런던"].chapter).toBe(2);
    expect(doc["도쿄"]).toEqual({ chapter: 3, country: "일본" });
    expect(doc["레이캬비크"].chapter).toBe(4);
  });

  it("표 밖의 서장 3도시를 0장으로 잡는다 — 빠뜨리면 100선이 97선이 된다", () => {
    // ⚠ 이 줄(**서장**)은 **장 배속 데이터**다. 빌드 상태로 오해해 도시를 빼면 그 도시가 장을
    // 잃어 생성기가 죽는다 — 실제로 그랬다(2026-08-23, 오사카를 빼자 테스트 파일이 통째로 실패).
    expect(doc["서울"].chapter).toBe(0);
    expect(doc["부산"].chapter).toBe(0);
    expect(doc["오사카"].chapter).toBe(0);
  });

  it("헤더 행·구분선을 도시로 오인하지 않는다", () => {
    expect(doc["도시"]).toBeUndefined();
    expect(doc["도시 A"]).toBeUndefined();
    expect(doc["국가"]).toBeUndefined();
  });
});

describe("city-catalog.json — 생성 결과", () => {
  it("100개 도시, 장별 분포가 문서와 일치", () => {
    expect(catalog.cityCount).toBe(100);
    expect(catalog.cities).toHaveLength(100);
    const byCh: Record<number, number> = {};
    for (const c of catalog.cities) byCh[c.chapter] = (byCh[c.chapter] ?? 0) + 1;
    expect(byCh).toEqual({ 0: 3, 1: 25, 2: 19, 3: 20, 4: 33 });
  });

  it("모든 항목이 id·실측 좌표·국가·bbox 를 갖는다", () => {
    for (const c of catalog.cities) {
      expect(c.id, c.cityKo).toMatch(/^[a-z0-9-]+$/);
      expect(Number.isFinite(c.lat) && Number.isFinite(c.lon), c.cityKo).toBe(true);
      expect(c.country, c.cityKo).toBeTruthy();
      expect(c.bbox, c.cityKo).toHaveLength(4);
      const [s, w, n, e] = c.bbox;
      expect(n, c.cityKo).toBeGreaterThan(s);
      expect(e, c.cityKo).toBeGreaterThan(w);
      expect(c.lat > s && c.lat < n, `${c.cityKo} 중심이 bbox 안`).toBe(true);
      expect(c.lon > w && c.lon < e, `${c.cityKo} 중심이 bbox 안`).toBe(true);
    }
  });

  it("id 가 유일 — 충돌하면 한 도시가 다른 도시의 청크를 덮어쓴다", () => {
    const ids = catalog.cities.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("소스와 동기 상태 — 소스를 고치고 재생성을 잊으면 실패", () => {
    // gen-city-config --check 는 현재 파일이 소스에서 다시 만든 결과와 다르면 비0 종료.
    expect(() => execFileSync("node", ["scripts/gen-city-config.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
  });
});

describe("maps.config — 손 맵 + 생성 맵 병합", () => {
  it("100개(손 4 + 생성 96) — 기등록 도시와 빌드 제외 도시는 생성에서 빠진다", () => {
    // 97 → 96: 예루살렘이 buildExcluded(큐레이션 정책 판단, 2026-08-27). 카탈로그 100선에는
    // 남아 있고 MAPS 에서만 빠진다 — 이 차이가 곧 "빌드하지 않는다"의 실체다.
    expect(MAPS).toHaveLength(100);
    const gen = MAPS.filter((m: { chapter?: number }) => m.chapter !== undefined);
    expect(gen).toHaveLength(96);
    // 서울/부산/로마는 손 맵이 담당 → 생성 목록에 없어야(도시가 두 벌 생기지 않게)
    for (const id of ["seoul", "busan", "rome"]) {
      expect(gen.find((m: { id: string }) => m.id === id), id).toBeUndefined();
    }
  });

  it("buildExcluded 도시는 MAPS 에 없고 카탈로그에는 남는다 — 빈자리가 누락과 구분되게", () => {
    const cat = JSON.parse(readFileSync("scripts/data/city-catalog.json", "utf8"));
    const excluded = cat.cities.filter((c: { buildExcluded?: unknown }) => c.buildExcluded);
    expect(excluded.length).toBeGreaterThan(0);
    for (const c of excluded) {
      expect(MAPS.find((m: { id: string }) => m.id === c.id), `${c.id} 가 빌드 가능 상태다`).toBeUndefined();
      expect(String(c.buildExcluded.reason ?? "").length, c.id).toBeGreaterThan(20);
      expect(c.buildExcluded.decidedAt, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.chapter, `${c.id}: 장 배속은 유지돼야 한다`).toBeTypeOf("number");
    }
  });

  it("모든 맵이 스트리밍 카탈로그 항목(stream)을 갖는다 — build-world 가 index.json 을 업서트한다", () => {
    for (const m of MAPS as { id: string; stream?: { id: string } }[]) {
      expect(m.stream, m.id).toBeDefined();
      expect(m.stream!.id, m.id).toMatch(/-stream$/);
    }
  });

  it("stream id 가 유일 — 겹치면 카탈로그 항목이 서로를 덮어쓴다", () => {
    const ids = (MAPS as { stream: { id: string } }[]).map((m) => m.stream.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("기존 스트리밍 3맵의 카탈로그 id 가 보존된다(저장 슬롯·자매쌍이 이 id 로 묶여 있음)", () => {
    const byId = new Map((MAPS as { id: string; stream: { id: string } }[]).map((m) => [m.id, m.stream.id]));
    expect(byId.get("gyeongbokgung")).toBe("seoul-stream");
    expect(byId.get("busan")).toBe("busan-stream");
    expect(byId.get("everest")).toBe("everest-stream");
  });

  it("cityMapDef — 반경 20km DEM 과 맵 범위가 같은 규격", () => {
    const def = cityMapDef({ id: "x", cityKo: "테스트", en: "Test", country: "국", chapter: 1, lat: 35, lon: 129, bbox: radiusBbox(35, 129) });
    expect(def.heightmap.meters).toBe(RADIUS_M * 2); // DEM 변 = 반경×2 — 어긋나면 지형이 맵보다 좁아진다
    expect(def.catalogHidden).toBe(true); // 메뉴에는 스트리밍 항목만 노출
    expect(def.catalogCity).toBe("테스트"); // 큐레이션 랜드마크 조회 키
    expect(def.stream.id).toBe("x-stream");
  });

  it("생성 맵은 전부 큐레이션 랜드마크 조회 키를 갖는다 — 없으면 그 도시만 자동분류로 떨어진다", () => {
    const curated = JSON.parse(readFileSync("scripts/data/landmark-catalog.json", "utf8")).cities;
    for (const m of MAPS as { id: string; chapter?: number; catalogCity?: string }[]) {
      if (m.chapter === undefined) continue; // 손 맵(에베레스트는 도시 아님)
      expect(m.catalogCity, m.id).toBeTruthy();
      expect(curated[m.catalogCity!], `${m.id} 가 landmark-catalog 에 없음`).toBeDefined();
    }
  });
});

describe("cityEntry — 조인 결과", () => {
  it("문서 국가를 city-names 의 country 가 덮는다(서장 3개는 표에 국가가 없음)", () => {
    const e = cityEntry("서울", { chapter: 0, country: "" }, { lat: 37.5, lon: 127 }, { id: "seoul", en: "Seoul", country: "대한민국" });
    expect(e.country).toBe("대한민국");
  });
  it("country 보정이 없으면 문서 값을 쓴다", () => {
    const e = cityEntry("도쿄", { chapter: 3, country: "일본" }, { lat: 35.6, lon: 139.7 }, { id: "tokyo", en: "Tokyo" });
    expect(e.country).toBe("일본");
    expect(e.chapter).toBe(3);
  });
});
