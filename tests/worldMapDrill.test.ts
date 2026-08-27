import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { clusterDots, zoomToSplit, projectInBox, FULL_VIEW } from "../src/ui/worldMapSvg";

// 재귀 확대(C안)의 **도달 보장** — 지도에 찍힌 모든 도시가 유한 클릭 안에 단일 점이 되는가.
// 이게 깨지면 특정 도시를 영영 못 고르는데, 눈으로는 "군집을 눌렀는데 그대로네" 로만 보인다.
// 실측(2026-08-27): 빌드 27개·전체 99개 모두 **최대 깊이 2** — 어느 도시든 두 번 안에 닿는다.
// 단언은 3으로 여유를 둔다(도시가 늘며 한 단계 깊어지는 건 정상, 그 이상은 군집 임계값을 봐야 한다).

const ASPECT = 2; // .worldmap aspect-ratio 2/1
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));

function drillAll(cities: { id: string; lat: number; lon: number }[]) {
  let maxDepth = 0, reached = new Set<string>();
  const walk = (view: typeof FULL_VIEW, depth: number) => {
    if (depth > 20) throw new Error("깊이 20 초과 — 수렴 실패(군집이 안 쪼개진다)");
    maxDepth = Math.max(maxDepth, depth);
    const vis = cities.map((c) => ({ ...c, ...projectInBox(c.lat, c.lon, view) }))
      .filter((p) => p.x >= -6 && p.x <= 106 && p.y >= -6 && p.y <= 106);
    for (const g of clusterDots(vis, 2.6)) {
      if (g.members.length === 1) { reached.add(g.members[0].id); continue; }
      walk(zoomToSplit(g.members, view, ASPECT), depth + 1);
    }
  };
  walk(FULL_VIEW, 0);
  return { maxDepth, reached };
}

describe("재귀 확대 — 실제 카탈로그 전수 도달", () => {
  it("빌드된 27개 맵: 모든 도시가 단일 점으로 도달", () => {
    const idx = load("public/maps/index.json");
    const cities = (Array.isArray(idx) ? idx : idx.maps)
      .filter((m: any) => m.stream && m.lat != null)
      .map((m: any) => ({ id: m.id, lat: m.lat, lon: m.lon }));
    const { maxDepth, reached } = drillAll(cities);
    expect(reached.size, `도달 ${reached.size}/${cities.length}`).toBe(cities.length);
    expect(maxDepth, `실측 2 · 현재 ${maxDepth}`).toBeLessThanOrEqual(3);
  });

  it("도시 100선 전체(미빌드 포함): 25개 군집도 도달", () => {
    const cat = load("scripts/data/city-catalog.json");
    const cities = cat.cities.filter((c: any) => !c.buildExcluded)
      .map((c: any) => ({ id: c.id, lat: c.lat, lon: c.lon }));
    const { maxDepth, reached } = drillAll(cities);
    expect(reached.size, `도달 ${reached.size}/${cities.length}`).toBe(cities.length);
    expect(maxDepth, `실측 2 · 현재 ${maxDepth}`).toBeLessThanOrEqual(3);
  });
});
