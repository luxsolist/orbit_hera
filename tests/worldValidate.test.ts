import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { validateChunk, validateManifest, validateEntryConsistency, validateSeams, validateSpawn, validateDemConsistency, findDuplicateBuildings, demSample, cellToMapLocal, hasZeroLengthEdge, isSelfIntersecting, cellMLon } from "../scripts/worldValidate.mjs";
// @ts-expect-error — JS config(타입 선언 없음)
import { MAPS } from "../scripts/maps.config.mjs";

// 타일 월드 검증 불변식 — 지금까지의 버그 클래스(지형 NaN, 면 부유/클립누락, 격자 불일치)를 회귀 가드로 고정.

const C = 1024;
/** cx=1,cz=2 청크: x∈[1024,2048], z∈[2048,3072]. */
const codes = (issues: any[], level?: string) =>
  issues.filter((i) => !level || i.level === level).map((i) => i.code);
const goodChunk = (objects: any = {}) => ({
  cx: 1, cz: 2,
  terrain: { size: 2, seaLevel: 0, heights: [10, 12, 11, 13] },
  objects: { buildings: [], roads: [], water: [], walls: [], areas: [], ...objects },
});

describe("validateChunk — 지형", () => {
  it("정상 청크 = error 없음", () => {
    expect(codes(validateChunk(goodChunk(), C), "error")).toEqual([]);
  });
  it("지형 높이 NaN/Inf → terrain-nan", () => {
    const ch = goodChunk(); ch.terrain.heights = [10, NaN, 11, 13];
    expect(codes(validateChunk(ch, C))).toContain("terrain-nan");
  });
  it("heights 길이 ≠ size² → terrain-size", () => {
    const ch = goodChunk(); ch.terrain.heights = [10, 11, 12];
    expect(codes(validateChunk(ch, C))).toContain("terrain-size");
  });
  it("표고 범위 비정상 → terrain-range(warn)", () => {
    const ch = goodChunk(); ch.terrain.heights = [10, 10, 10, 99999];
    expect(codes(validateChunk(ch, C), "warn")).toContain("terrain-range");
  });
  it("인접 격자 급변(>30m) → terrain-steep(warn, DSM 잔여 스파이크)", () => {
    const ch = goodChunk(); ch.terrain.heights = [10, 60, 10, 12]; // 10→60 인접 50m 점프
    expect(codes(validateChunk(ch, C), "warn")).toContain("terrain-steep");
    const ok = goodChunk(); ok.terrain.heights = [10, 18, 12, 20]; // 완만 → 경고 없음
    expect(codes(validateChunk(ok, C), "warn")).not.toContain("terrain-steep");
  });
});

describe("validateChunk — 면/수역(클립 대상)은 청크 경계 내 강제", () => {
  it("청크 안 area = error 없음", () => {
    const ch = goodChunk({ areas: [{ p: [1100, 2100, 1300, 2100, 1300, 2300, 1100, 2300], k: "park" }] });
    expect(codes(validateChunk(ch, C), "error")).toEqual([]);
  });
  it("청크 밖 area → area-bounds (클립 누락 검출)", () => {
    const ch = goodChunk({ areas: [{ p: [50, 50, 300, 50, 300, 300, 50, 300], k: "park" }] });
    expect(codes(validateChunk(ch, C))).toContain("area-bounds");
  });
  it("퇴화(면적≈0) area → area-degenerate(warn)", () => {
    const ch = goodChunk({ areas: [{ p: [1100, 2100, 1300, 2100, 1100, 2100], k: "grass" }] });
    expect(codes(validateChunk(ch, C), "warn")).toContain("area-degenerate");
  });
  it("미지정 면 종류 → area-kind(warn)", () => {
    const ch = goodChunk({ areas: [{ p: [1100, 2100, 1300, 2100, 1300, 2300, 1100, 2300], k: "lava" }] });
    expect(codes(validateChunk(ch, C), "warn")).toContain("area-kind");
  });
  it("음수 좌표(NW 원점 위배) → celloob", () => {
    const ch = goodChunk({ areas: [{ p: [-5000, 100, 300, 100, 300, 300], k: "park" }] });
    expect(codes(validateChunk(ch, C))).toContain("area-celloob");
    const ch2 = goodChunk({ buildings: [{ p: [-9000, 100, 300, 100, 300, 300], h: 9 }] });
    expect(codes(validateChunk(ch2, C))).toContain("building-celloob");
  });
  it("청크 밖 filled water → water-bounds", () => {
    const ch = goodChunk({ water: [{ p: [50, 50, 300, 50, 300, 300, 50, 300] }] });
    expect(codes(validateChunk(ch, C))).toContain("water-bounds");
  });
  it("하천선(w 보유)은 경계 강제 안 함 — 청크 밖이어도 error 없음", () => {
    const ch = goodChunk({ water: [{ p: [50, 50, 9000, 9000], w: 12 }] });
    expect(codes(validateChunk(ch, C), "error")).toEqual([]);
  });
});

describe("validateChunk — 건물(배치형) / 도로·담장(청크 클립 → 경계 강제)", () => {
  it("건물 폴리 점<3 → building-poly", () => {
    const ch = goodChunk({ buildings: [{ p: [1100, 2100, 1200, 2100], h: 9 }] });
    expect(codes(validateChunk(ch, C))).toContain("building-poly");
  });
  it("건물은 footprint overhang 허용 — 청크 밖 좌표여도 bounds error 없음(셀 범위 내)", () => {
    const ch = goodChunk({ buildings: [{ p: [900, 2000, 2200, 2000, 2200, 3200], h: 9 }] }); // 청크(1,2) 밖이나 셀 내
    expect(codes(validateChunk(ch, C))).not.toContain("building-bounds");
  });
  it("도로 폭 ≤0 → road-w(warn)", () => {
    const ch = goodChunk({ roads: [{ p: [1100, 2100, 1300, 2300], w: 0 }] });
    expect(codes(validateChunk(ch, C), "warn")).toContain("road-w");
  });
  it("도로가 청크 경계 밖 → road-bounds(클립 누락 검출)", () => {
    const ch = goodChunk({ roads: [{ p: [50, 50, 9000, 9000], w: 8 }] });
    expect(codes(validateChunk(ch, C))).toContain("road-bounds");
  });
  it("담장이 청크 경계 밖 → wall-bounds, 높이 ≤0 → wall-h(warn)", () => {
    const oob = goodChunk({ walls: [{ p: [50, 50, 9000, 9000], h: 3, w: 0.4 }] });
    expect(codes(validateChunk(oob, C))).toContain("wall-bounds");
    const lowH = goodChunk({ walls: [{ p: [1100, 2100, 1300, 2100], h: 0, w: 0.4 }] });
    expect(codes(validateChunk(lowH, C), "warn")).toContain("wall-h");
  });
  it("하천선(water w 보유)은 청크 클립 비대상 — 경계 밖 허용", () => {
    const ch = goodChunk({ water: [{ p: [50, 50, 9000, 9000], w: 12 }] });
    expect(codes(validateChunk(ch, C), "error")).toEqual([]);
  });
});

describe("도형 품질 헬퍼", () => {
  it("hasZeroLengthEdge — 연속 중복 정점 검출(닫힘 반복 제외)", () => {
    expect(hasZeroLengthEdge([0, 0, 10, 0, 10, 0, 0, 10])).toBe(true); // (10,0) 연속 중복
    expect(hasZeroLengthEdge([0, 0, 10, 0, 10, 10, 0, 10])).toBe(false); // 정상 사각형
    expect(hasZeroLengthEdge([0, 0, 10, 0, 10, 10, 0, 0])).toBe(false); // 닫힘 반복(last==first)은 정상
  });
  it("isSelfIntersecting — bowtie 검출, 단순 폴리곤 통과", () => {
    expect(isSelfIntersecting([0, 0, 10, 0, 0, 10, 10, 10])).toBe(true); // 나비넥타이
    expect(isSelfIntersecting([0, 0, 10, 0, 10, 10, 0, 10])).toBe(false); // 정상 사각형
  });
});

describe("validateChunk — 도형 품질 경고", () => {
  it("자기교차 건물 footprint → building-selfx(warn)", () => {
    const ch = goodChunk({ buildings: [{ p: [1100, 2100, 1110, 2100, 1100, 2110, 1110, 2110], h: 9 }] });
    expect(codes(validateChunk(ch, C), "warn")).toContain("building-selfx");
  });
  it("영길이 모서리(중복 정점) → building-dupvert(warn)", () => {
    const ch = goodChunk({ buildings: [{ p: [1100, 2100, 1100, 2100, 1110, 2110], h: 9 }] });
    expect(codes(validateChunk(ch, C), "warn")).toContain("building-dupvert");
  });
});

describe("validateManifest — 격자 일관성", () => {
  const good = { cell: [37, 126], originLat: 38, originLon: 126, chunkSize: 1024, terrainSize: 33, mLon: cellMLon(37), block: 16, chunks: [{ cx: 84, cz: 45, objects: true, terrain: true }] };
  it("정상 매니페스트 = error 없음", () => expect(codes(validateManifest(good))).toEqual([]));
  it("block 누락/≤0 → block error(런타임 경로 계산 불가)", () => {
    expect(codes(validateManifest({ ...good, block: undefined }))).toContain("block");
    expect(codes(validateManifest({ ...good, block: 0 }))).toContain("block");
  });
  it("mLon 불일치(생성기↔런타임 격자) → mLon error", () => {
    expect(codes(validateManifest({ ...good, mLon: 99999 }))).toContain("mLon");
  });
  it("청크 목록 비어있음 → chunks error", () => {
    expect(codes(validateManifest({ ...good, chunks: [] }))).toContain("chunks");
  });
  it("셀 범위 밖 청크 인덱스(음수/거대) → entry-range", () => {
    expect(codes(validateManifest({ ...good, chunks: [{ cx: -1, cz: 5 }] }))).toContain("entry-range");
    expect(codes(validateManifest({ ...good, chunks: [{ cx: 5, cz: 9999 }] }))).toContain("entry-range");
  });
});

describe("demSample / cellToMapLocal — DEM 표본·역투영(독립 재구현)", () => {
  // 2×2 격자, meters 1000, origin −500. bin: z0행[0,10] z1행[20,30].
  const bin = new Float32Array([0, 10, 20, 30]);
  it("격자점·중앙 바이리니어", () => {
    expect(demSample(bin, 2, 1000, -500, -500, 0, -500, -500)).toBeCloseTo(0);
    expect(demSample(bin, 2, 1000, -500, -500, 0, 500, -500)).toBeCloseTo(10);
    expect(demSample(bin, 2, 1000, -500, -500, 0, 0, 0)).toBeCloseTo(15); // 중앙
  });
  it("seaLevel 차감", () => {
    expect(demSample(bin, 2, 1000, -500, -500, 5, -500, -500)).toBeCloseTo(-5);
  });
  it("cellToMapLocal 라운드트립: 맵 원점(lat0,lon0)의 셀-로컬 → 맵 (0,0)", () => {
    const lat0 = 37.578, lon0 = 126.977, cell = [37, 126];
    const x = (lon0 - 126) * cellMLon(37), z = (38 - lat0) * 111320; // 맵 원점의 셀-로컬
    const [mx, mz] = cellToMapLocal(x, z, cell, lat0, lon0);
    expect(Math.hypot(mx, mz)).toBeLessThan(1);
  });
});

describe("validateDemConsistency — 청크 표고 ↔ 소스 DEM 교차검증", () => {
  const expectedAt = (cellX: number, cellZ: number) => 0.01 * cellX + 0.02 * cellZ; // 임의 결정함수
  const chunkFrom = (mut = (h: number[]) => h) => {
    const C2 = 1024, size = 2, step = C2 / (size - 1);
    const heights: number[] = [];
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++)
      heights.push(Math.round(expectedAt(0 * C2 + i * step, 0 * C2 + j * step) * 10) / 10);
    return { cx: 0, cz: 0, terrain: { size, heights: mut(heights) } };
  };
  it("DEM 과 일치하는 청크 = error 없음", () => {
    expect(validateDemConsistency(chunkFrom(), 1024, expectedAt, { stride: 1 })).toEqual([]);
  });
  it("표고 어긋남 → dem-mismatch", () => {
    const bad = chunkFrom((h) => { h[3] += 50; return h; });
    expect(codes(validateDemConsistency(bad, 1024, expectedAt, { stride: 1 }))).toContain("dem-mismatch");
  });
});

describe("validateEntryConsistency — 매니페스트 플래그 ↔ 파일", () => {
  it("플래그 일치 = error 없음", () => {
    const ch = goodChunk({ buildings: [{ p: [1100, 2100, 1300, 2100, 1300, 2300], h: 9 }] });
    expect(codes(validateEntryConsistency({ cx: 1, cz: 2, terrain: true, objects: true }, ch))).toEqual([]);
  });
  it("objects 플래그=true 인데 파일 비어있음 → flag-objects", () => {
    expect(codes(validateEntryConsistency({ cx: 1, cz: 2, terrain: true, objects: true }, goodChunk()))).toContain("flag-objects");
  });
  it("terrain 플래그=false 인데 파일에 지형 있음 → flag-terrain", () => {
    expect(codes(validateEntryConsistency({ cx: 1, cz: 2, terrain: false, objects: false }, goodChunk()))).toContain("flag-terrain");
  });
});

describe("validateSeams — 인접 청크 지형 연속성", () => {
  // (1,2) 동쪽 이웃(2,2): 내 i=1열(heights[1],[3]) == 이웃 i=0열(heights[0],[2])
  const A = { cx: 1, cz: 2, terrain: { size: 2, heights: [10, 20, 30, 40] } }; // i=1 → 20,40
  it("모서리 일치 = error 없음", () => {
    const east = { cx: 2, cz: 2, terrain: { size: 2, heights: [20, 99, 40, 99] } }; // i=0 → 20,40
    expect(codes(validateSeams([A, east]))).toEqual([]);
  });
  it("동쪽 모서리 불일치 → seam-east", () => {
    const east = { cx: 2, cz: 2, terrain: { size: 2, heights: [21, 99, 41, 99] } };
    expect(codes(validateSeams([A, east]))).toContain("seam-east");
  });
  it("남쪽 모서리 불일치 → seam-south", () => {
    const south = { cx: 1, cz: 3, terrain: { size: 2, heights: [99, 99, 0, 0] } }; // j=0 → 99,99 ; A j=1 → 30,40
    expect(codes(validateSeams([A, south]))).toContain("seam-south");
  });
});

describe("findDuplicateBuildings — 동일 footprint 중복", () => {
  const b = { p: [1100, 2100, 1110, 2100, 1110, 2110, 1100, 2110], h: 9 };
  it("같은 footprint 가 2청크에 → building-dup(warn)", () => {
    const chunks = [{ cx: 1, cz: 2, objects: { buildings: [b] } }, { cx: 1, cz: 3, objects: { buildings: [b] } }];
    expect(codes(findDuplicateBuildings(chunks))).toContain("building-dup");
  });
  it("서로 다른 위치 건물은 중복 아님", () => {
    const chunks = [
      { cx: 1, cz: 2, objects: { buildings: [b] } },
      { cx: 1, cz: 2, objects: { buildings: [{ p: [1500, 2500, 1510, 2500, 1510, 2510], h: 9 }] } },
    ];
    expect(findDuplicateBuildings(chunks)).toEqual([]);
  });
});

describe("validateSpawn — 스폰 지표면 sanity", () => {
  const base = { cell: [37, 126], chunkSize: 1024, mLon: cellMLon(37) };
  it("스폰 청크(84,45) 존재+지형 → error 없음", () => {
    const m = { ...base, chunks: [{ cx: 84, cz: 45, objects: true, terrain: true }] };
    expect(codes(validateSpawn(37.5797, 126.977, m))).toEqual([]);
  });
  it("스폰 청크 없음 → spawn-missing", () => {
    expect(codes(validateSpawn(37.5797, 126.977, { ...base, chunks: [] }))).toContain("spawn-missing");
  });
  it("스폰 청크 지형 없음 → spawn-noterrain", () => {
    const m = { ...base, chunks: [{ cx: 84, cz: 45, objects: true, terrain: false }] };
    expect(codes(validateSpawn(37.5797, 126.977, m))).toContain("spawn-noterrain");
  });
});

// 실제 생성된 경복궁 타일 월드(있으면) — error 0 회귀 가드. 데이터/파이프라인 변경 시 자동 검출.
describe("실데이터 회귀 가드(생성된 경복궁 타일)", () => {
  const tp = "public/maps/37/126/tiles.json";
  it.runIf(existsSync(tp))("매니페스트·청크·플래그·이음새 모두 error 0", () => {
    const m = JSON.parse(readFileSync(tp, "utf8"));
    let errs: string[] = [...codes(validateManifest(m), "error")];
    const loaded: any[] = [];
    const blk = m.block || 1; // 블록 디렉터리 분산
    for (const e of m.chunks) {
      const ch = JSON.parse(readFileSync(`public/maps/37/126/${Math.floor(e.cx / blk)}_${Math.floor(e.cz / blk)}/${e.cx}_${e.cz}.json`, "utf8"));
      loaded.push(ch);
      errs = errs.concat(codes(validateChunk(ch, m.chunkSize), "error").map((c: string) => `${e.cx}_${e.cz}:${c}`));
      errs = errs.concat(codes(validateEntryConsistency(e, ch), "error").map((c: string) => `${e.cx}_${e.cz}:${c}`));
    }
    errs = errs.concat(codes(validateSeams(loaded), "error")); // 인접 청크 지형 연속성
    errs = errs.concat(codes(validateSpawn(37.5797, 126.977, m), "error")); // 경복궁 스폰
    // DEM 교차검증 — 청크 표고가 소스 .bin 과 일치
    const src = MAPS.find((x: any) => x.heightmap && Math.floor(x.lat0) === 37 && Math.floor(x.lon0) === 126);
    if (src && existsSync(`public/${src.heightmap.src}`)) {
      const buf = readFileSync(`public/${src.heightmap.src}`);
      const bin = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
      const { size, meters } = src.heightmap;
      const exp = (cx: number, cz: number) => {
        const [mx, mz] = cellToMapLocal(cx, cz, m.cell, src.lat0, src.lon0);
        return demSample(bin, size, meters, -meters / 2, -meters / 2, src.seaLevel ?? 0, mx, mz);
      };
      for (const ch of loaded) errs = errs.concat(codes(validateDemConsistency(ch, m.chunkSize, exp), "error"));
    }
    expect(errs).toEqual([]);
    expect(findDuplicateBuildings(loaded)).toEqual([]); // 수집 시 dedup → 중복 0
  });
});
