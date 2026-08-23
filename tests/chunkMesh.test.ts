import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { sampleChunkHeight, chunkTerrainEntry, buildChunkMesh, disposeChunkGroup, forEachLandmarkNear, linearToSrgbByte } from "../src/world/chunkMesh";
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

// ─────────── 랜드마크 시각 구분(2026-08-23) ───────────
// 사수 미션이 실제로 랜드마크를 표적으로 삼게 된 뒤에도 렌더가 일반 건물과 똑같아
// "무엇을 지켜야 하는지" 볼 수 없었다. 밝기(정점색 >1 → 블룸)로 가른다 —
// 색상으로 가르면 플라즈모이드 온도 스펙트럼(빨강~파랑)·피격 틴트와 충돌한다.

describe("buildChunkMesh — 랜드마크 발광", () => {
  const twoBuildings = () => buildChunkMesh(
    makeChunk({
      objects: {
        buildings: [
          { p: [0, 0, 20, 0, 20, 20, 0, 20], h: 30, lm: "deep-roots", n: "L" }, // 랜드마크
          { p: [50, 0, 70, 0, 70, 20, 50, 20], h: 30 },                          // 같은 높이 일반 건물
        ],
        roads: [], water: [],
      },
    } as never),
    CHUNK, 0, 0
  );
  /** 병합 메시에서 그 건물 정점 범위의 첫 정점 색(RGB 최댓값). */
  const peak = (cb: ReturnType<typeof buildChunkMesh>, i: number) => {
    const col = cb.buildingMesh!.geometry.getAttribute("color") as THREE.BufferAttribute;
    const v = cb.buildings[i].vStart;
    return Math.max(col.getX(v), col.getY(v), col.getZ(v));
  };

  it("랜드마크는 **어떤 일반 건물보다도** 밝다 — 최고층(linear 0.956)보다 위", () => {
    const cb = twoBuildings();
    expect(peak(cb, 0)).toBeGreaterThan(0.956);
  });

  it("일반 건물은 1.0 을 넘지 않는다 — 도시 전체가 빛나지 않는다", () => {
    const cb = twoBuildings();
    expect(peak(cb, 1)).toBeLessThan(1);
  });

  it("파괴 번쩍임(FLASH 2.0)보다는 어둡다 — 파괴 피드백이 묻히지 않게", () => {
    const cb = twoBuildings();
    expect(peak(cb, 0)).toBeLessThan(2);
  });

  it("따뜻한 색조를 갖는다 — 밝기만으로는 ACES 톤매핑에 먹힌다(직사광 차이 0.027)", () => {
    const cb = twoBuildings();
    const col = cb.buildingMesh!.geometry.getAttribute("color") as THREE.BufferAttribute;
    const v = cb.buildings[0].vStart;
    const [r, g, b] = [col.getX(v), col.getY(v), col.getZ(v)];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeLessThan(r * 0.5); // 파랑을 확실히 낮춰야 포화 상태에서도 색이 남는다

    // 대조군: 일반 건물은 무채색(R=G=B)
    const w = cb.buildings[1].vStart;
    expect(col.getX(w)).toBeCloseTo(col.getZ(w), 5);
  });

  it("높이가 달라도 랜드마크 밝기는 동일 — 한 부류로 읽힌다", () => {
    const cb = buildChunkMesh(
      makeChunk({
        objects: {
          buildings: [
            { p: [0, 0, 20, 0, 20, 20, 0, 20], h: 8, lm: "ritual" },    // 저층 랜드마크
            { p: [50, 0, 70, 0, 70, 20, 50, 20], h: 95, lm: "ritual" }, // 고층 랜드마크
          ],
          roads: [], water: [],
        },
      } as never),
      CHUNK, 0, 0
    );
    expect(peak(cb, 0)).toBeCloseTo(peak(cb, 1), 5);
  });
});

describe("forEachLandmarkNear — 미니맵 덧그림 선택", () => {
  const B = (x: number, lm?: string) => ({ poly: [x, 0, x + 10, 0, x + 10, 10, x, 10], ...(lm ? { lm } : {}) });

  it("랜드마크만 고른다", () => {
    const out: number[][] = [];
    forEachLandmarkNear([B(0, "ritual"), B(20), B(40, "relay")] as never, 0, 0, 500, (p) => out.push(p));
    expect(out).toHaveLength(2);
  });

  it("반경 + 여유 밖은 제외(중심 기준 컬링)", () => {
    const out: number[][] = [];
    forEachLandmarkNear([B(0, "ritual"), B(5000, "ritual")] as never, 0, 0, 300, (p) => out.push(p));
    expect(out).toHaveLength(1);
  });

  it("여유(margin)만큼은 살린다 — 대형 footprint 가 화면에 걸치는 경우", () => {
    const out: number[][] = [];
    // 중심 x=395 → 반경 300 밖이지만 여유 120 안
    forEachLandmarkNear([B(390, "deep-roots")] as never, 0, 0, 300, (p) => out.push(p));
    expect(out).toHaveLength(1);
  });

  it("퇴화 폴리곤(정점 3 미만)은 건너뛴다", () => {
    const out: number[][] = [];
    forEachLandmarkNear([{ poly: [0, 0, 1, 1], lm: "relay" }] as never, 0, 0, 500, (p) => out.push(p));
    expect(out).toHaveLength(0);
  });
});


// ─────────── 지형 텍스처 베이크 감마(2026-08-23) ───────────
// 베이스(elevationColor)는 **선형** THREE.Color 를, 덧칠(하천·도로)은 **sRGB** CSS 문자열을 쓴다.
// 베이스에서 변환을 빼먹어 같은 0x55bcc4 가 바다에선 #17808d, 강에선 #55bcc4 로 나왔다 —
// 색을 통일해도 바다만 어둡게 보이던 원인. 두 경로가 같은 바이트를 내는지 고정한다.

describe("linearToSrgbByte — 베이스/덧칠 경로 색 일치", () => {
  const roundTrip = (hex: number) => {
    const c = new THREE.Color().setHex(hex); // 선형 작업 색공간
    return (linearToSrgbByte(c.r) << 16) | (linearToSrgbByte(c.g) << 8) | linearToSrgbByte(c.b);
  };

  it("선형 THREE.Color 를 되돌리면 원래 sRGB 값이 나온다(덧칠 CSS 와 동일)", () => {
    for (const hex of [0x55bcc4, 0xa6d985, 0xe4d8ba, 0xeef4f7, 0x44484f]) {
      expect(roundTrip(hex), hex.toString(16)).toBe(hex);
    }
  });

  it("변환을 빼먹으면 어두워진다 — 회귀의 크기를 명시", () => {
    const c = new THREE.Color().setHex(0x55bcc4);
    const naive = (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
    expect(naive).not.toBe(0x55bcc4);
    expect(naive).toBeLessThan(0x55bcc4); // 실제로 #17808d 로 어두워졌다
  });

  it("경계값 클램프", () => {
    expect(linearToSrgbByte(0)).toBe(0);
    expect(linearToSrgbByte(1)).toBe(255);
    expect(linearToSrgbByte(-1)).toBe(0);
    expect(linearToSrgbByte(2)).toBe(255);
  });
});
