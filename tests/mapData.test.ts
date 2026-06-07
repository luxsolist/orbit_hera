import { describe, it, expect } from "vitest";
import { normalizeMapData, sampleHeightmap } from "../src/world/MapData";

// 섹션형 스키마 정규화(평면 v1 ↔ 섹션 v2) + 하이트맵 바이리니어 샘플 — 순수 가드.

describe("normalizeMapData — 평면(v1) → 섹션", () => {
  const v1 = {
    id: "m", name: "M", subtitle: "s",
    meta: { lat0: 1, lon0: 2, source: "OSM" },
    buildings: [{ p: [0, 0, 1, 1] }],
    roads: [{ p: [0, 0, 5, 0], w: 6 }],
    water: [{ p: [0, 0, 1, 0, 1, 1] }],
    boundary: [0, 0, 10, 0, 10, 10],
    gates: [{ x: 1, z: 2, r: 3 }],
    landmarks: [{ type: "structure", x: 0, z: 0 }],
    mountains: [{ x: 0, z: -100, h: 200, r: 300 }],
    precinct: { suppressRoads: true },
    spawn: { x: 0, z: 9, yaw: 0 },
  };
  const n = normalizeMapData(v1);

  it("최상위 오브젝트 → objects 섹션", () => {
    expect(n.objects.buildings).toBe(v1.buildings);
    expect(n.objects.roads).toBe(v1.roads);
    expect(n.objects.landmarks).toBe(v1.landmarks);
    expect(n.objects.boundary).toBe(v1.boundary);
    expect(n.objects.gates).toBe(v1.gates);
    expect(n.objects.precinct).toBe(v1.precinct);
  });
  it("water/mountains → terrain 섹션(절차적), seaLevel 0", () => {
    expect(n.terrain.water).toBe(v1.water);
    expect(n.terrain.procedural?.mountains).toBe(v1.mountains);
    expect(n.terrain.procedural?.flattenCity).toBe(true);
    expect(n.terrain.seaLevel).toBe(0);
    expect(n.terrain.heightmap).toBeUndefined();
  });
  it("schema 1 추론 + spawn 보존", () => {
    expect(n.meta.schema).toBe(1);
    expect(n.spawn).toBe(v1.spawn);
  });
});

describe("normalizeMapData — 섹션(v2) 패스스루 + 기본값", () => {
  const v2 = {
    id: "m2", name: "M2", subtitle: "s2",
    meta: { lat0: 1, lon0: 2, source: "OSM", schema: 2 },
    terrain: {
      seaLevel: 4,
      heightmap: { src: "/maps/m2.terrain.bin", size: 256, meters: 4000 },
      water: [{ p: [0, 0, 1, 1, 2, 2] }],
    },
    objects: { buildings: [{ p: [0, 0] }], roads: [] },
  };
  const n = normalizeMapData(v2);

  it("섹션 그대로 + heightmap 보존", () => {
    expect(n.meta.schema).toBe(2);
    expect(n.terrain.seaLevel).toBe(4);
    expect(n.terrain.heightmap?.size).toBe(256);
    expect(n.objects.buildings).toBe(v2.objects.buildings);
  });
  it("누락 필드 기본값(spawn·roads)", () => {
    expect(n.spawn).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(n.objects.roads).toEqual([]);
  });
});

describe("sampleHeightmap — 바이리니어", () => {
  // 2×2 격자, meters=10 → 텍셀당 10. origin (0,0). 값: [[0,10],[20,30]] (row=z, col=x)
  const h = new Float32Array([0, 10, 20, 30]);
  const S = (x: number, z: number) => sampleHeightmap(h, 2, 10, 0, 0, x, z);

  it("격자점은 정확값", () => {
    expect(S(0, 0)).toBeCloseTo(0, 6);
    expect(S(10, 0)).toBeCloseTo(10, 6);
    expect(S(0, 10)).toBeCloseTo(20, 6);
    expect(S(10, 10)).toBeCloseTo(30, 6);
  });
  it("중앙은 4점 평균", () => {
    expect(S(5, 5)).toBeCloseTo(15, 6); // (0+10+20+30)/4
  });
  it("한 축 보간", () => {
    expect(S(5, 0)).toBeCloseTo(5, 6); // x중간, z=0 → (0+10)/2
    expect(S(0, 5)).toBeCloseTo(10, 6); // z중간, x=0 → (0+20)/2
  });
  it("격자 밖은 가장자리 클램프", () => {
    expect(S(-50, -50)).toBeCloseTo(0, 6);
    expect(S(999, 999)).toBeCloseTo(30, 6);
  });
});
