import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { sampleChunkHeight, chunkTerrainEntry, buildChunkMesh, disposeChunkGroup, LAYER_Y } from "../src/world/chunkMesh";
import type { WorldChunk } from "../src/world/chunkManifest";

// 청크 → 메시/등록 데이터 변환 — heightAt 샘플러, 지형 엔트리, 로컬 좌표 변환·콜리전 top 의 정확성.

const CHUNK = 1024;

/** 합성 청크 — cx,cz, 지형 size×size(heights), 건물/도로/수역. heights 는 x(열) 증가로 0→20 경사. */
function makeChunk(over: Partial<WorldChunk> = {}, size = 3): WorldChunk {
  const heights: number[] = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) heights.push((i / (size - 1)) * 20);
  return {
    cx: 1, cz: 2,
    terrain: { size, seaLevel: 0, heights },
    objects: { buildings: [], roads: [], water: [] },
    underground: null,
    ...over,
  };
}

describe("chunkTerrainEntry", () => {
  it("size/step/cellX0/cellZ0/heights 산출(셀-로컬 격자)", () => {
    const t = chunkTerrainEntry(makeChunk(), CHUNK)!;
    expect(t.size).toBe(3);
    expect(t.step).toBe(CHUNK / 2); // (size-1) 분할 = 512
    expect(t.cellX0).toBe(1 * CHUNK);
    expect(t.cellZ0).toBe(2 * CHUNK);
    expect(t.heights).toBeInstanceOf(Float32Array);
    expect(t.heights.length).toBe(9);
  });
  it("평지/미존재(size<2) 또는 heights 부족 → null", () => {
    expect(chunkTerrainEntry(makeChunk({ terrain: { size: 0, seaLevel: 0, heights: [] } }), CHUNK)).toBeNull();
    expect(chunkTerrainEntry(makeChunk({ terrain: { size: 3, seaLevel: 0, heights: [1, 2, 3] } }), CHUNK)).toBeNull();
  });
});

describe("sampleChunkHeight — 바이리니어 + 클램프", () => {
  const t = chunkTerrainEntry(makeChunk(), CHUNK)!; // cellX0=1024, step=512, 열따라 0→20

  it("격자점 정확 일치", () => {
    expect(sampleChunkHeight(t, 1024, 2048)).toBeCloseTo(0); // i=0
    expect(sampleChunkHeight(t, 1536, 2048)).toBeCloseTo(10); // i=1
    expect(sampleChunkHeight(t, 2048, 2048)).toBeCloseTo(20); // i=2
  });
  it("셀 중간 = 선형 보간", () => {
    expect(sampleChunkHeight(t, 1280, 2048)).toBeCloseTo(5); // i=0.5
    expect(sampleChunkHeight(t, 1792, 3000)).toBeCloseTo(15); // i=1.5 (z 무관 — 열만 경사)
  });
  it("격자 밖은 가장자리 클램프", () => {
    expect(sampleChunkHeight(t, 0, 0)).toBeCloseTo(0);
    expect(sampleChunkHeight(t, 999999, 999999)).toBeCloseTo(20);
  });
  it("null 격자 = 0", () => expect(sampleChunkHeight(null, 1500, 2500)).toBe(0));
  it("새들 셀: 지형 메시 삼각분할값(=대각 b-c) 반환 — bilinear(5) 아님", () => {
    // h: a(0,0)=0 b(1,0)=10 c(0,1)=10 d(1,1)=0. 셀 중앙은 b-c 대각 위 → 메시=10(삼각형), bilinear=5.
    const sad = chunkTerrainEntry({ cx: 0, cz: 0, terrain: { size: 2, seaLevel: 0, heights: [0, 10, 10, 0] }, objects: { buildings: [], roads: [], water: [] }, underground: null }, CHUNK)!;
    expect(sampleChunkHeight(sad, CHUNK / 2, CHUNK / 2)).toBeCloseTo(10); // 삼각형 평면값(렌더 표면과 일치)
  });
});

describe("buildChunkMesh — 로컬 좌표 변환 + 콜리전 top", () => {
  const originX = CHUNK, originZ = 2 * CHUNK; // 로컬 원점 = 청크 NW 모서리

  it("건물 폴리 = 셀-로컬 − origin, top = 지표면 + 높이", () => {
    const chunk = makeChunk({
      objects: { buildings: [{ p: [1500, 2500, 1520, 2500, 1520, 2520, 1500, 2520], h: 12 }], roads: [], water: [] },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    expect(cb.buildings).toHaveLength(1);
    // 로컬 폴리(원점 차감)
    expect(cb.buildings[0].poly.slice(0, 4)).toEqual([1500 - originX, 2500 - originZ, 1520 - originX, 2500 - originZ]);
    // top = 중심 지표면(터레인 샘플) + h
    const groundY = sampleChunkHeight(cb.terrain, 1510, 2510);
    expect(cb.buildings[0].top).toBeCloseTo(groundY + 12);
  });

  it("도로 세그먼트·수역 = 로컬 좌표 보존", () => {
    const chunk = makeChunk({
      objects: {
        buildings: [],
        roads: [{ p: [1100, 2100, 1200, 2200], w: 8 }],
        water: [{ p: [1300, 2300, 1400, 2300, 1350, 2400] }],
      },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    expect(cb.roads).toHaveLength(1);
    expect(cb.roads[0].w).toBe(8);
    expect(cb.roads[0].p).toEqual([1100 - originX, 2100 - originZ, 1200 - originX, 2200 - originZ]);
    expect(cb.water).toHaveLength(1);
    expect(cb.water[0].slice(0, 2)).toEqual([1300 - originX, 2300 - originZ]);
  });

  it("지형+건물+간선도로(w≥16)+수역 → 그룹 메시 5개(지형·건물·도로·중앙선·수역)", () => {
    const chunk = makeChunk({
      objects: {
        buildings: [{ p: [1500, 2500, 1520, 2500, 1510, 2520], h: 9 }],
        roads: [{ p: [1100, 2100, 1200, 2200], w: 28 }], // 간선(≥16) → 도로 + 중앙선 2메시
        water: [{ p: [1300, 2300, 1400, 2300, 1350, 2400] }],
      },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    expect(cb.group).toBeInstanceOf(THREE.Group);
    expect(cb.group.children.length).toBe(5);
    expect(cb.terrain).not.toBeNull();
  });

  it("중앙선은 간선(w≥16)에만 — 작은 도로(w<16)는 중앙선 없음", () => {
    const minor = makeChunk({ objects: { buildings: [], roads: [{ p: [1100, 2100, 1200, 2200], w: 8 }], water: [] } });
    expect(buildChunkMesh(minor, CHUNK, originX, originZ).group.children.length).toBe(2); // 지형 + 도로(중앙선 X)
    const arterial = makeChunk({ objects: { buildings: [], roads: [{ p: [1100, 2100, 1200, 2200], w: 28 }], water: [] } });
    expect(buildChunkMesh(arterial, CHUNK, originX, originZ).group.children.length).toBe(3); // 지형 + 도로 + 중앙선
  });

  it("경사면 건물: base 를 footprint 최저 지표 아래까지 압출(틈 제거), 옥상=중심지표+높이", () => {
    // 열따라 0→20 경사 위에 x 1100~1590 을 가로지르는 건물 — 코너마다 지표 높이가 크게 다름.
    const chunk = makeChunk({
      objects: { buildings: [{ p: [1100, 2500, 1590, 2500, 1590, 2520, 1100, 2520], h: 10 }], roads: [], water: [] },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    const t = cb.terrain;
    const minGround = Math.min(sampleChunkHeight(t, 1100, 2510), sampleChunkHeight(t, 1590, 2510));
    const centroidGround = sampleChunkHeight(t, 1345, 2510);
    // group.children = [terrain, building]
    const bmesh = cb.group.children[1] as THREE.Mesh;
    bmesh.geometry.computeBoundingBox();
    const bb = bmesh.geometry.boundingBox!;
    expect(bb.min.y).toBeLessThanOrEqual(minGround); // 최저 지표 아래까지 채움(틈 없음)
    expect(bb.max.y).toBeCloseTo(centroidGround + 10, 1); // 옥상 = 중심 지표 + 높이
  });

  it("담장: 충돌 AABB + 윗면(top=지표+높이) 산출, 벽 메시 생성", () => {
    const chunk = makeChunk({
      objects: {
        buildings: [], roads: [], water: [],
        walls: [{ p: [1200, 2200, 1300, 2200], h: 3, w: 0.5 }],
      },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    expect(cb.walls).toHaveLength(1);
    const w = cb.walls[0];
    expect(w.x1).toBeGreaterThan(w.x0);
    expect(w.z1).toBeGreaterThan(w.z0);
    const topGround = Math.max(sampleChunkHeight(cb.terrain, 1200, 2200), sampleChunkHeight(cb.terrain, 1300, 2200));
    expect(w.top).toBeCloseTo(topGround + 3); // 양 끝 지표 최대 + 높이
    // group: [terrain, wall-mesh]
    expect(cb.group.children.length).toBe(2);
  });

  it("강/하천 라인(water w)은 리본으로 — 면 채움(cb.water) 아님", () => {
    const chunk = makeChunk({ objects: { buildings: [], roads: [], areas: [], water: [{ p: [1100, 2100, 1200, 2200, 1300, 2200], w: 6 }] } });
    const cb = buildChunkMesh(chunk, CHUNK, CHUNK, 2 * CHUNK);
    expect(cb.water).toHaveLength(0); // 라인은 fill 목록에 안 들어감
    expect(cb.group.children.length).toBe(2); // 지형 + 물 리본
  });

  it("지표 면(area): 메시 생성(충돌/미니맵 비대상)", () => {
    const chunk = makeChunk({
      objects: {
        buildings: [], roads: [], water: [],
        areas: [{ p: [1100, 2100, 1300, 2100, 1300, 2300, 1100, 2300], k: "sand" }],
      },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    // group: [terrain, area-mesh]
    expect(cb.group.children.length).toBe(2);
    expect(cb.buildings).toHaveLength(0);
    expect(cb.walls).toHaveLength(0);
  });

  it("지형 없는 청크(size 0) — 건물 top 은 지표면 0 기준", () => {
    const chunk = makeChunk({
      terrain: { size: 0, seaLevel: 0, heights: [] },
      objects: { buildings: [{ p: [1500, 2500, 1520, 2500, 1510, 2520], h: 7 }], roads: [], water: [] },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    expect(cb.terrain).toBeNull();
    expect(cb.buildings[0].top).toBeCloseTo(7); // groundY=0 + h
  });
});

describe("buildChunkMesh — 시각 가공(드레이프·수면·도로 조인트)", () => {
  const originX = CHUNK, originZ = 2 * CHUNK;
  const meshY = (m: THREE.Mesh) => {
    const pos = m.geometry.attributes.position;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < mn) mn = y; if (y > mx) mx = y; }
    return { mn, mx };
  };

  it("지표 면은 경사 지형에 드레이프(Y 변동 — 평면 부유 아님)", () => {
    const chunk = makeChunk({ objects: { buildings: [], roads: [], water: [], areas: [{ p: [1100, 2100, 1300, 2100, 1300, 2300, 1100, 2300], k: "sand" }] } });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    const { mn, mx } = meshY(cb.group.children[1] as THREE.Mesh); // [terrain, area]
    expect(mx - mn).toBeGreaterThan(1); // 경사 따라 높이 변동
  });

  it("수면은 경계 최저 지표 위 평탄(부유 아님, 도로 아래)", () => {
    const chunk = makeChunk({ objects: { buildings: [], roads: [], water: [{ p: [1100, 2100, 1300, 2100, 1300, 2300, 1100, 2300] }], areas: [] } });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    const { mn, mx } = meshY(cb.group.children[1] as THREE.Mesh); // [terrain, water]
    expect(mx - mn).toBeLessThan(0.01); // 평탄
    const minG = Math.min(
      sampleChunkHeight(cb.terrain, 1100, 2100), sampleChunkHeight(cb.terrain, 1300, 2100),
      sampleChunkHeight(cb.terrain, 1300, 2300), sampleChunkHeight(cb.terrain, 1100, 2300));
    expect(mn).toBeCloseTo(minG + LAYER_Y.water, 2);
    expect(LAYER_Y.water).toBeLessThan(LAYER_Y.road); // 수면은 도로 아래
  });

  it("도로 마이터 리본 — 짧은 세그먼트(≤12m)는 quad 하나, 연속 폴리라인은 이어진 quad", () => {
    // 짧은 2점(≤12m): 리샘플 없이 quad 1개 = 6정점(원반/연장 없음 — 조각·z-fighting 제거)
    const seg2 = makeChunk({ objects: { buildings: [], roads: [{ p: [1100, 2100, 1108, 2105], w: 8 }], water: [], areas: [] } });
    const r2 = (buildChunkMesh(seg2, CHUNK, originX, originZ).group.children[1] as THREE.Mesh).geometry.attributes.position.count;
    expect(r2).toBe(6);
    // 짧은 3점: 연속 2 quad = 12정점(마이터로 이어짐)
    const poly3 = makeChunk({ objects: { buildings: [], roads: [{ p: [1100, 2100, 1108, 2105, 1116, 2100], w: 8 }], water: [], areas: [] } });
    const r3 = (buildChunkMesh(poly3, CHUNK, originX, originZ).group.children[1] as THREE.Mesh).geometry.attributes.position.count;
    expect(r3).toBe(12);
  });

  it("도로 끝점이 진행방향으로 연장됨 — 조각/교차로 사이 틈 메움", () => {
    const chunk = makeChunk({ objects: { buildings: [], roads: [{ p: [1100, 2100, 1200, 2100], w: 8 }], water: [], areas: [] } }); // 수평, 반폭4, ext=4
    const road = buildChunkMesh(chunk, CHUNK, originX, originZ).group.children[1] as THREE.Mesh;
    road.geometry.computeBoundingBox();
    const bb = road.geometry.boundingBox!;
    expect(bb.max.x).toBeGreaterThan(1200 - originX + 2); // 끝점(176) 너머로 연장(≈+4)
    expect(bb.min.x).toBeLessThan(1100 - originX - 2); // 시작점(76) 이전으로 연장
  });

  it("긴 도로 세그먼트는 ≤12m 로 리샘플돼 지형에 밀착(정점 다수)", () => {
    const longRoad = makeChunk({ objects: { buildings: [], roads: [{ p: [1100, 2100, 1300, 2100], w: 8 }], water: [], areas: [] } }); // 200m
    const cnt = (buildChunkMesh(longRoad, CHUNK, originX, originZ).group.children[1] as THREE.Mesh).geometry.attributes.position.count;
    expect(cnt).toBeGreaterThan(6 * 10); // 200/12≈17 세그먼트 → 다수 quad(지형 삐져나옴 방지)
  });

  it("disposeChunkGroup — 지오메트리 해제(예외 없음)", () => {
    const cb = buildChunkMesh(makeChunk(), CHUNK, originX, originZ);
    expect(() => disposeChunkGroup(cb.group)).not.toThrow();
  });
});

describe("레이어 강제 — 지형 < 면 < 수역 < 보도 < 차도 (녹색이 도로 덮는 문제 방지)", () => {
  const originX = CHUNK, originZ = 2 * CHUNK;
  it("LAYER_Y 오프셋이 엄격히 증가(면<수역<보도<차도<중앙선)", () => {
    expect(LAYER_Y.area).toBeLessThan(LAYER_Y.water);
    expect(LAYER_Y.water).toBeLessThan(LAYER_Y.path);
    expect(LAYER_Y.path).toBeLessThan(LAYER_Y.road);
    expect(LAYER_Y.centerAdd).toBeGreaterThan(0);
  });

  it("큰 면이 지형에 밀착(세분-드레이프) — 모든 정점이 지표면+면오프셋, 떠오르지 않음", () => {
    // 900m 대형 면 — 경계만 드레이프하면 내부가 떠오르던 케이스. 세분으로 지형 밀착해야 함.
    const chunk = makeChunk({ objects: { buildings: [], roads: [], water: [], areas: [{ p: [1050, 2050, 1950, 2050, 1950, 2950, 1050, 2950], k: "sand" }] } });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    const area = cb.group.children[1] as THREE.Mesh; // [terrain, area]
    const pos = area.geometry.attributes.position;
    expect(pos.count).toBeGreaterThan(4); // 세분됨(경계 4점 초과)
    let maxDev = 0;
    for (let i = 0; i < pos.count; i++) {
      const expectY = sampleChunkHeight(cb.terrain, pos.getX(i) + originX, pos.getZ(i) + originZ) + LAYER_Y.area;
      maxDev = Math.max(maxDev, Math.abs(pos.getY(i) - expectY));
    }
    expect(maxDev).toBeLessThan(0.01); // 모든 정점이 지형 밀착 → 도로(LAYER_Y.road) 아래 보장
  });

  it("레이캐스트: 비평면(새들) 지형에서도 도로가 지형 위 — 초록 솟음(poke-through) 방지", () => {
    // 새들 셀(중앙이 대각으로 솟음) — bilinear 드레이프면 도로가 메시 아래로 가라앉아 지형이 솟던 케이스.
    const chunk: any = {
      cx: 1, cz: 2,
      terrain: { size: 2, seaLevel: 0, heights: [0, 10, 10, 0] }, // 새들
      objects: { buildings: [], water: [], areas: [], roads: [{ p: [1536, 2400, 1536, 2700], w: 8 }] },
      underground: null,
    };
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    const terrainMesh = cb.group.children[0] as THREE.Mesh; // 지형
    const road = cb.group.children[1] as THREE.Mesh; // 도로
    const px = 1536 - originX, pz = 2560 - originZ; // 도로가 지나는 중앙
    const ray = new THREE.Raycaster(new THREE.Vector3(px, 1000, pz), new THREE.Vector3(0, -1, 0));
    const hT = ray.intersectObject(terrainMesh)[0], hR = ray.intersectObject(road)[0];
    expect(hT && hR).toBeTruthy();
    expect(hR.point.y).toBeGreaterThan(hT.point.y); // 도로가 지형 위(초록 안 솟음)
  });

  it("레이캐스트: 급한 교차 경사(cross-slope)에서 넓은 도로 **가장자리**도 지형 위 — 가장자리 초록 솟음 방지", () => {
    // X 방향 급경사(0→100/512m). 도로는 Z 방향 종주(폭이 경사를 가로지름). 가장자리(중심선+10m)에서 검사.
    const chunk: any = {
      cx: 1, cz: 2,
      terrain: { size: 3, seaLevel: 0, heights: [0, 50, 100, 0, 50, 100, 0, 50, 100] },
      objects: { buildings: [], water: [], areas: [], roads: [{ p: [1536, 2200, 1536, 2900], w: 28 }] }, // 반폭 14m
      underground: null,
    };
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    const terrainMesh = cb.group.children[0] as THREE.Mesh, road = cb.group.children[1] as THREE.Mesh;
    const px = 1548 - originX, pz = 2550 - originZ; // 중심선(1536)에서 오르막 가장자리 쪽 12m
    const ray = new THREE.Raycaster(new THREE.Vector3(px, 1000, pz), new THREE.Vector3(0, -1, 0));
    const hT = ray.intersectObject(terrainMesh)[0], hR = ray.intersectObject(road)[0];
    expect(hT && hR).toBeTruthy();
    expect(hR.point.y).toBeGreaterThan(hT.point.y); // 가장자리에서도 도로가 지형 위(중심선 드레이프였다면 솟았을 지점)
  });

  it("레이캐스트: 도로가 면 위를 덮음 — 같은 지점에서 도로면이 면보다 위", () => {
    // 경사 지형 + 청크 전체를 덮는 면 + 그 위를 가로지르는 차도. 도로 위에서 수직 레이캐스트.
    const chunk = makeChunk({
      objects: {
        buildings: [], water: [],
        areas: [{ p: [1050, 2050, 1950, 2050, 1950, 2950, 1050, 2950], k: "sand" }],
        roads: [{ p: [1100, 2100, 1300, 2300], w: 8 }],
      },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    const area = cb.group.children[1] as THREE.Mesh; // [terrain, area, road, center]
    const road = cb.group.children[2] as THREE.Mesh;
    const px = (1100 + 1300) / 2 - originX, pz = (2100 + 2300) / 2 - originZ; // 도로 중점(로컬)
    const ray = new THREE.Raycaster(new THREE.Vector3(px, 1000, pz), new THREE.Vector3(0, -1, 0));
    const hitArea = ray.intersectObject(area)[0];
    const hitRoad = ray.intersectObject(road)[0];
    expect(hitArea && hitRoad).toBeTruthy();
    expect(hitRoad.point.y).toBeGreaterThan(hitArea.point.y); // 도로가 면 위(덮음)
  });
});

describe("buildChunkMesh — 면 세분 경계 케이스", () => {
  it("퇴화 면(점<3 또는 일직선)은 메시 없음", () => {
    const degen = makeChunk({ objects: { buildings: [], roads: [], water: [], areas: [{ p: [1100, 2100, 1200, 2100], k: "sand" }] } }); // 2점
    expect(buildChunkMesh(degen, CHUNK, CHUNK, 2 * CHUNK).group.children.length).toBe(1); // 지형만
  });
});
