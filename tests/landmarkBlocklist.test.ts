import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyBlocklist,
  blockedBuildingIndices,
  BLOCK_MATCH_M,
  projFns,
  landmarkFrom,
} from "../scripts/osm.mjs";

// 큐레이션 정책의 **강제** 계약(2026-08-27). 이 스위트가 없던 동안 정책은 문서상 선언일 뿐이었다:
// excludedLandmarks 는 "큐레이션 배열에서 뺐다"는 이력이라 강제력이 없고, 랜드마크는 큐레이션
// 말고도 landmarkFrom() 태그+면적 자동 승격으로 들어온다. 그래서 손으로 뺀 대상이 OSM 이름을
// 달고 되돌아왔다 — 실증 2건:
//   · 베이징 천안문광장을 뺐으나 그 광장의 毛主席纪念堂(historic=tomb)이 배포본에 승격돼 있었다.
//   · 바그다드 '승리의 손'은 OSM 'سيوف القادسية' 2채로 승격 예정이었다(빌드 전 감사에서 포착).
// 여기서 잠그는 것은 "차단이 실제로 승격을 취소하는가"다.

const CATALOG = JSON.parse(readFileSync("scripts/data/landmark-catalog.json", "utf8"));

/** 중심(cx,cz)에 한 변 s 인 정사각 footprint. */
const sq = (cx: number, cz: number, s = 20) => ({
  p: [cx - s / 2, cz - s / 2, cx + s / 2, cz - s / 2, cx + s / 2, cz + s / 2, cx - s / 2, cz + s / 2],
});

describe("차단 목록 — 데이터 무결성", () => {
  const blk = CATALOG.blockedLandmarks;

  it("카탈로그에 blockedLandmarks 가 있다", () => {
    expect(blk).toBeTruthy();
    expect(Array.isArray(blk.items)).toBe(true);
    expect(blk.items.length).toBeGreaterThan(0);
  });

  it("모든 항목이 좌표·범주·근거를 갖는다 — 이름만 적힌 항목은 강제할 수 없다", () => {
    const cats = new Set(Object.keys(CATALOG.curationPolicy.categories));
    for (const it of blk.items) {
      expect(typeof it.lat, it.name).toBe("number");
      expect(typeof it.lon, it.name).toBe("number");
      expect(cats.has(it.category), `${it.name}: 미정의 범주 ${it.category}`).toBe(true);
      expect(String(it.reason ?? "").length, it.name).toBeGreaterThan(10);
    }
  });

  it("excludedLandmarks 의 바그다드 '승리의 손'이 차단 목록으로 실체화돼 있다", () => {
    // 제외 이력만 있고 차단이 없으면 자동 승격으로 되돌아온다 — 그 회귀를 막는 고정점.
    const excluded = CATALOG.excludedLandmarks.find((e: { name: string }) => e.name.includes("승리의 손"));
    expect(excluded).toBeTruthy();
    const blocks = blk.items.filter((i: { name: string }) => i.name.includes("승리의 손"));
    expect(blocks.length).toBe(2); // 한 쌍이라 OSM 에 2채
  });
});

describe("blockedBuildingIndices — 좌표 매칭", () => {
  it("footprint 안에 좌표가 있으면 잡는다", () => {
    const bs = [sq(0, 0), sq(500, 500)];
    expect(blockedBuildingIndices(bs, 3, 3, 40)).toEqual([0]);
  });

  it("반경 안 중심도 잡는다 — 좌표가 마당에 찍힌 항목", () => {
    const bs = [sq(0, 0, 10)];
    expect(blockedBuildingIndices(bs, 25, 0, 40)).toEqual([0]); // 밖이지만 중심에서 25m
    expect(blockedBuildingIndices(bs, 100, 0, 40)).toEqual([]); // 반경 밖
  });

  it("한 좌표에 여러 동이 걸리면 **전부** 반환 — 궁전 단지에서 한 채만 막으면 나머지가 남는다", () => {
    const bs = [sq(0, 0, 10), sq(15, 0, 10), sq(1000, 0, 10)];
    expect(blockedBuildingIndices(bs, 5, 0, 40).sort()).toEqual([0, 1]);
  });
});

describe("applyBlocklist — 승격 취소", () => {
  const proj = projFns(0, 0); // 적도 원점 — lat/lon 을 m 로 다루기 쉽게

  it("승격된 랜드마크의 lm 과 n 을 **함께** 지운다", () => {
    // n 만 남으면 청크에 표시명이 실린다 — 이름이 남는 게 정확히 막으려던 것이다.
    const b = { ...sq(0, 0), lm: "deep-roots", n: "Victory Arch" } as Record<string, unknown>;
    const r = applyBlocklist([b], [{ name: "t", lat: 0, lon: 0 }], proj, 0, 40);
    expect(r.blocked).toBe(1);
    expect(b.lm).toBeUndefined();
    expect(b.n).toBeUndefined();
  });

  it("승격 안 된 건물에 걸려도 무해하다 — blocked 로 세지 않는다", () => {
    const b = sq(0, 0) as Record<string, unknown>;
    expect(applyBlocklist([b], [{ name: "t", lat: 0, lon: 0 }], proj, 0, 40).blocked).toBe(0);
  });

  it("커버리지 밖 항목은 조용히 건너뛴다 — 미적중 경고를 오염시키지 않게", () => {
    const b = { ...sq(0, 0), lm: "deep-roots", n: "X" };
    // cover=1000m → ±500m. 위도 1° ≈ 111km 라 한참 밖이다.
    const r = applyBlocklist([b], [{ name: "먼곳", lat: 1, lon: 1 }], proj, 1000, 40);
    expect(r.blocked).toBe(0);
    expect(r.misses).toEqual([]);
  });

  it("커버리지 안인데 건물이 없으면 미적중으로 보고한다 — 좌표 낡음 신호", () => {
    const r = applyBlocklist([sq(0, 0)], [{ name: "사라진궁", lat: 0.002, lon: 0.002 }], proj, 2000, 40);
    expect(r.misses).toEqual(["사라진궁"]);
  });

  it("좌표 없는 항목은 무시한다 — 강제할 수 없는 항목이 조용히 통과하지 않게 misses 로도 세지 않는다", () => {
    const r = applyBlocklist([sq(0, 0)], [{ name: "좌표없음" }], proj, 0, 40);
    expect(r.blocked).toBe(0);
    expect(r.misses).toEqual([]);
  });
});

describe("승격 → 차단 왕복 — 실제 회귀 재현", () => {
  const proj = projFns(0, 0);

  it("historic=tomb 는 자동 승격되고(=회귀의 원인), 차단이 그것을 되돌린다", () => {
    // 毛主席纪念堂 의 실제 태그 조합. classifyOsmTags 의 historic 포괄 폴백에 걸려 deep-roots 가 된다.
    const tags = { building: "yes", historic: "tomb", "name:en": "Chairman Mao Memorial Hall" };
    const lm = landmarkFrom(tags, 5000);
    expect(lm, "승격되지 않으면 이 회귀 자체가 성립하지 않는다").toBeTruthy();

    const b = { ...sq(0, 0, 70), lm: lm!.cls, n: lm!.n } as Record<string, unknown>;
    expect(applyBlocklist([b], [{ name: "마오쩌둥 기념당", lat: 0, lon: 0 }], proj, 0, BLOCK_MATCH_M).blocked).toBe(1);
    expect(b.lm).toBeUndefined();
  });
});

describe("항목별 반경(radiusM) — 경내 전체가 대상인 경우", () => {
  const proj = projFns(0, 0);
  const sq = (cx: number, cz: number, s = 20) => ({
    p: [cx - s / 2, cz - s / 2, cx + s / 2, cz - s / 2, cx + s / 2, cz + s / 2, cx - s / 2, cz + s / 2],
    lm: "archive", n: "X",
  });

  it("기본 반경 밖은 못 막고, radiusM 을 주면 막는다", () => {
    const far = () => sq(0, 113); // 좌표에서 113m — 유슈칸과 같은 거리
    const a = far(); applyBlocklist([a], [{ name: "t", lat: 0, lon: 0 }], proj, 0, BLOCK_MATCH_M);
    expect(a.lm, "기본 40m 로는 안 잡혀야 한다(전제 확인)").toBe("archive");
    const b = far(); applyBlocklist([b], [{ name: "t", lat: 0, lon: 0, radiusM: 200 }], proj, 0, BLOCK_MATCH_M);
    expect(b.lm).toBeUndefined();
  });

  it("radiusM 은 그 항목에만 적용된다 — 다른 항목이 덩달아 넓어지지 않게", () => {
    const wide = sq(0, 113), narrow = sq(500, 113);
    applyBlocklist([wide, narrow], [
      { name: "wide", lat: 0, lon: 0, radiusM: 200 },
      { name: "narrow", lat: 0, lon: -0.0045 }, // ≈500m 동쪽, 기본 반경
    ], proj, 0, BLOCK_MATCH_M);
    expect(wide.lm).toBeUndefined();
    expect(narrow.lm, "기본 반경 항목은 113m 를 못 잡는다").toBe("archive");
  });
});

// 야스쿠니는 **좌표만 넣었으면 아무것도 못 막았을** 사례다 — 본전 40m 안에 승격 건물이 없고,
// 실제 승격은 76m 노가쿠도와 113m 유슈칸(신사 부속 전쟁박물관)이다. 도쿄 추출 실측으로 확인했고
// (승격 407 → 405, 미적중 0), 400m 안에 야스쿠니 소속이 아닌 승격 건물은 없어 과잉 차단도 없다.
describe("야스쿠니 — 경내 반경 차단", () => {
  const item = CATALOG.blockedLandmarks.items.find((i: { name: string }) => i.name.includes("야스쿠니"));

  it("차단 목록에 있고 excludedLandmarks 와 짝이 맞는다", () => {
    expect(item, "blockedLandmarks 에 야스쿠니가 없다").toBeTruthy();
    expect(CATALOG.excludedLandmarks.some((e: { name: string }) => e.name.includes("야스쿠니"))).toBe(true);
    expect(item.category).toBe("war-perpetrator");
  });

  it("반경이 유슈칸(113m)을 덮는다 — 기본 40m 로는 못 막는다", () => {
    expect(item.radiusM, "radiusM 이 없으면 기본 40m 라 아무것도 안 막힌다").toBeGreaterThanOrEqual(120);
    expect(item.radiusM, "400m 밖까지 넓히면 남의 건물을 삼킬 수 있다").toBeLessThanOrEqual(400);
  });
});
