import { describe, it, expect } from "vitest";
import { SpatialGrid } from "../src/world/SpatialGrid";

type Box = { id: number; minX: number; minZ: number; maxX: number; maxZ: number };
const bound = (b: Box): [number, number, number, number] => [b.minX, b.minZ, b.maxX, b.maxZ];

function collect(g: SpatialGrid<Box>, x0: number, z0: number, x1: number, z1: number): number[] {
  const out: number[] = [];
  g.query(x0, z0, x1, z1, (b) => out.push(b.id));
  return out.sort((a, b) => a - b);
}

describe("SpatialGrid", () => {
  it("empty grid yields nothing", () => {
    const g = new SpatialGrid<Box>([], bound);
    expect(collect(g, -100, -100, 100, 100)).toEqual([]);
  });

  it("returns only items overlapping the query region", () => {
    const items: Box[] = [
      { id: 1, minX: 0, minZ: 0, maxX: 2, maxZ: 2 },
      { id: 2, minX: 100, minZ: 100, maxX: 102, maxZ: 102 },
    ];
    const g = new SpatialGrid(items, bound, 16);
    expect(collect(g, -1, -1, 1, 1)).toEqual([1]);
    expect(collect(g, 99, 99, 101, 101)).toEqual([2]);
    expect(collect(g, 40, 40, 50, 50)).toEqual([]);
  });

  it("visits a multi-cell item exactly once per query (epoch dedup)", () => {
    // 한 변이 셀(8)보다 훨씬 큰 아이템 → 여러 셀에 등록됨
    const big: Box = { id: 7, minX: 0, minZ: 0, maxX: 40, maxZ: 40 };
    const g = new SpatialGrid([big], bound, 8);
    let count = 0;
    g.query(-5, -5, 45, 45, () => count++);
    expect(count).toBe(1);
  });

  it("resets dedup between queries (epoch increments)", () => {
    const big: Box = { id: 7, minX: 0, minZ: 0, maxX: 40, maxZ: 40 };
    const g = new SpatialGrid([big], bound, 8);
    expect(collect(g, 0, 0, 40, 40)).toEqual([7]);
    expect(collect(g, 0, 0, 40, 40)).toEqual([7]); // 두 번째 질의에서도 다시 방문
  });

  it("returns every item when the query covers the whole grid", () => {
    const items: Box[] = Array.from({ length: 20 }, (_, i) => ({
      id: i, minX: i * 5, minZ: 0, maxX: i * 5 + 1, maxZ: 1,
    }));
    const g = new SpatialGrid(items, bound, 8);
    expect(collect(g, -10, -10, 200, 10)).toHaveLength(20);
  });
});
