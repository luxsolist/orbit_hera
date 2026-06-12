import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { sampleChunkHeight, chunkTerrainEntry, buildChunkMesh, disposeChunkGroup } from "../src/world/chunkMesh";
import type { WorldChunk } from "../src/world/chunkManifest";

// 청크 → 메시/등록 데이터 변환 — heightAt 샘플러, 지형 엔트리, 로컬 좌표 변환·콜리전 top 의 정확성.
// 도로/물(면)/지표면/차선은 **지형 표면 텍스처에 베이크**되어 별도 메시를 만들지 않는다(아래 "텍스처 베이크" describe).
// 테스트 환경(node, document 없음)에선 캔버스 베이크가 null → 지형은 폴백 vertexColors 머티리얼, 도로/물/면 메시 0.

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

describe("buildChunkMesh — 로컬 좌표 변환 + 콜리전/미니맵 데이터", () => {
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

  it("도로 세그먼트·수역(면) = 로컬 좌표로 미니맵 데이터에 보존", () => {
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

  it("강/하천 라인(water w)은 미니맵 면 목록(cb.water)에서 제외 — 면 폴리곤만 수집", () => {
    const chunk = makeChunk({ objects: { buildings: [], roads: [], areas: [], water: [{ p: [1100, 2100, 1200, 2200, 1300, 2200], w: 6 }] } });
    const cb = buildChunkMesh(chunk, CHUNK, CHUNK, 2 * CHUNK);
    expect(cb.water).toHaveLength(0); // 라인(w 보유)은 면 목록에 안 들어감
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
    const bmesh = cb.group.children[1] as THREE.Mesh; // [terrain, building]
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
    expect(cb.group.children.length).toBe(2); // [terrain, wall]
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

describe("buildChunkMesh — 도로/물/면/차선은 지형 표면 텍스처에 베이크(별도 메시 없음)", () => {
  const originX = CHUNK, originZ = 2 * CHUNK;

  it("지형+도로+수역면+지표면+간선차선 → 그룹 메시는 지형 1개만(나머지 전부 텍스처 베이크)", () => {
    const chunk = makeChunk({
      objects: {
        buildings: [],
        roads: [{ p: [1100, 2100, 1200, 2200], w: 28 }], // 간선(차선) — 텍스처 베이크
        water: [{ p: [1300, 2300, 1400, 2300, 1350, 2400] }],
        areas: [{ p: [1100, 2600, 1300, 2600, 1300, 2800, 1100, 2800], k: "sand" }],
      },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    expect(cb.group).toBeInstanceOf(THREE.Group);
    expect(cb.group.children.length).toBe(1); // 지형 메시뿐 — 도로/물/면/차선 메시 없음
    expect(cb.group.children[0]).toBeInstanceOf(THREE.Mesh);
    // 데이터는 미니맵/충돌용으로 보존
    expect(cb.roads).toHaveLength(1);
    expect(cb.water).toHaveLength(1);
  });

  it("건물만 추가 메시 — [지형, 건물]", () => {
    const chunk = makeChunk({
      objects: {
        buildings: [{ p: [1500, 2500, 1520, 2500, 1510, 2520], h: 9 }],
        roads: [{ p: [1100, 2100, 1200, 2200], w: 28 }],
        water: [{ p: [1300, 2300, 1400, 2300, 1350, 2400] }],
      },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    expect(cb.group.children.length).toBe(2); // [terrain, building]
  });

  it("node 환경(캔버스 없음): 지형은 폴백 vertexColors 머티리얼(map 없음)", () => {
    const cb = buildChunkMesh(makeChunk(), CHUNK, originX, originZ);
    const mat = (cb.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeFalsy(); // 텍스처 베이크 실패 → 폴백
    expect(mat.vertexColors).toBe(true);
    // 폴백 경로에서도 UV 는 항상 부여(텍스처 성공 시 사용)
    expect((cb.group.children[0] as THREE.Mesh).geometry.getAttribute("uv")).toBeTruthy();
  });

  it("지표 면만 있는 청크 — 메시는 지형 1개(면은 텍스처), 충돌/미니맵 비대상", () => {
    const chunk = makeChunk({
      objects: { buildings: [], roads: [], water: [], areas: [{ p: [1100, 2100, 1300, 2100, 1300, 2300, 1100, 2300], k: "sand" }] },
    });
    const cb = buildChunkMesh(chunk, CHUNK, originX, originZ);
    expect(cb.group.children.length).toBe(1); // 지형만
    expect(cb.buildings).toHaveLength(0);
    expect(cb.walls).toHaveLength(0);
  });

  it("disposeChunkGroup — 지오메트리 해제(예외 없음)", () => {
    const cb = buildChunkMesh(makeChunk(), CHUNK, originX, originZ);
    expect(() => disposeChunkGroup(cb.group)).not.toThrow();
  });
});
