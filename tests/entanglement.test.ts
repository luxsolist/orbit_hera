import { describe, it, expect } from "vitest";
import { classifyOsmTags, ENTANGLEMENT_CLASSES, type EntanglementClass } from "../src/world/entanglement";

// 얽힘 택소노미(06-missions §8) — OSM 태그 자동 분류 + 메타(표시명·브리핑)의 표면 어휘 가드.
// 전 세계 도시 확장의 미션 생성 엔진: 태그 → 유형 → 미션/브리핑이 자동으로 이어져야 한다.

describe("classifyOsmTags — 전 세계 공통 태그 분류", () => {
  const cases: [Record<string, string>, EntanglementClass | null][] = [
    // 추모(가장 구체 우선 — historic 포괄 폴백보다 먼저)
    [{ historic: "memorial" }, "memorial"],
    [{ historic: "monument" }, "memorial"],
    [{ landuse: "cemetery" }, "memorial"],
    // 의례
    [{ amenity: "place_of_worship", religion: "buddhist" }, "ritual"],
    [{ building: "mosque" }, "ritual"],
    // 응축고
    [{ tourism: "museum" }, "archive"],
    [{ amenity: "library" }, "archive"],
    // 결맞음
    [{ place: "square" }, "resonance"],
    [{ leisure: "stadium" }, "resonance"],
    [{ amenity: "theatre" }, "resonance"],
    // 이음
    [{ man_made: "communications_tower" }, "relay"],
    [{ man_made: "lighthouse" }, "relay"],
    [{ railway: "station" }, "relay"],
    [{ aeroway: "terminal" }, "relay"],
    // 오래 선 자리(포괄 폴백)
    [{ historic: "castle" }, "deep-roots"],
    [{ heritage: "1" }, "deep-roots"],
    [{ building: "palace" }, "deep-roots"],
    // 일반 건물 — 분류 없음
    [{ building: "apartments" }, null],
    [{}, null],
  ];
  for (const [tags, want] of cases) {
    it(`${JSON.stringify(tags)} → ${want}`, () => {
      expect(classifyOsmTags(tags)).toBe(want);
    });
  }

  it("복합 태그 — 더 구체적인 유형이 이긴다(추모 성당 = memorial 아님 ritual 아님 → 추모 우선)", () => {
    expect(classifyOsmTags({ historic: "memorial", amenity: "place_of_worship" })).toBe("memorial");
    expect(classifyOsmTags({ historic: "yes", tourism: "museum" })).toBe("archive"); // 응축고 > 포괄 사적
  });
});

describe("메타 — 표면 어휘 가드(서사편 §8.1)와 스키마 무결성", () => {
  const FORBIDDEN = ["삭제", "데이터", "정보", "시뮬레이션", "프로세스", "로그", "노드", "허브"];
  it("표시명·브리핑에 L4/시스템 어휘 없음", () => {
    for (const meta of Object.values(ENTANGLEMENT_CLASSES)) {
      for (const s of [meta.name, meta.brief]) {
        for (const bad of FORBIDDEN) {
          expect(s.includes(bad), `"${s}" 에 금지 어휘 "${bad}"`).toBe(false);
        }
      }
    }
  });

  it("전 유형 메타 완비 — 저항 배율은 1 이상, 키와 cls 일치", () => {
    for (const [key, meta] of Object.entries(ENTANGLEMENT_CLASSES)) {
      expect(meta.cls).toBe(key);
      expect(meta.resistMul).toBeGreaterThanOrEqual(1);
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.brief.length).toBeGreaterThan(0);
    }
  });
});
