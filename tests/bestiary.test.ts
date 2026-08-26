import { describe, it, expect } from "vitest";
import { bestiaryCards } from "../src/game/bestiary";
import { DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";

// 도감(§8.3 명칭 갱신의 시각화) — 인식 Ⅰ 아키타입별 카드 → 인식 Ⅱ(계시) 병합 단일 카드.

describe("bestiaryCards — 순수", () => {
  it("revealed=false — 스펙의 3개 아키타입 카드(순서 고정, 이름은 스펙 파생)", () => {
    const cards = bestiaryCards(DEFAULT_PLASMOID, false);
    expect(cards.map((c) => c.id)).toEqual(["rusher", "kiter", "marker"]);
    expect(cards.every((c) => !c.merged)).toBe(true);
    expect(cards.find((c) => c.id === "marker")!.name).toBe(DEFAULT_PLASMOID.archetypes.marker.name);
  });

  it("revealed=true — 병합 카드 1장만, merged=true", () => {
    const cards = bestiaryCards(DEFAULT_PLASMOID, true);
    expect(cards).toHaveLength(1);
    expect(cards[0].merged).toBe(true);
    expect(cards[0].name).toBe("그것 (투영체)");
  });

  it("스펙에 없는 아키타입은 카드에서 생략된다(하위호환)", () => {
    // 데이터가 일부 아키타입을 싣지 않아도 도감이 깨지지 않아야 한다.
    const spec = { ...DEFAULT_PLASMOID, archetypes: { ...DEFAULT_PLASMOID.archetypes, marker: undefined } } as never;
    expect(bestiaryCards(spec, false).map((c) => c.id)).toEqual(["rusher", "kiter"]);
  });
});
