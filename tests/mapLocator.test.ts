import { describe, it, expect } from "vitest";
import { latLonDistanceM, neighborChunks, cellChunkOf } from "../src/world/mapLocator";

// 전지구 타일 월드 위치 조회의 순수 로직.

describe("latLonDistanceM", () => {
  it("같은 점 = 0", () => expect(latLonDistanceM(37.5, 127, 37.5, 127)).toBeCloseTo(0, 6));
  it("위도 0.01° ≈ 1113m", () => expect(latLonDistanceM(37.5, 127, 37.51, 127)).toBeCloseTo(1113, -1));
  it("경도는 cos(위도)로 축소(고위도일수록 짧음)", () => {
    expect(latLonDistanceM(60, 0, 60, 1)).toBeLessThan(latLonDistanceM(0, 0, 0, 1) * 0.55);
  });
});

describe("cellChunkOf — 위경도 → 셀 + 청크(셀 NW 원점, 1024m)", () => {
  it("경복궁(37.5797,126.977) → 셀[37,126], cx84 cz45 (생성기와 일치)", () => {
    const r = cellChunkOf(37.5797, 126.977, 1024);
    expect(r.cell).toEqual([37, 126]);
    expect(r.cx).toBe(84);
    expect(r.cz).toBe(45);
  });
  it("셀 NW 모서리 근처 → cx≈0, cz≈0", () => {
    const r = cellChunkOf(37.999, 126.001, 1024);
    expect(r.cell).toEqual([37, 126]);
    expect(r.cx).toBe(0);
    expect(r.cz).toBe(0);
  });
  it("음수 경도 셀(맨해튼 -73.98) floor", () => {
    expect(cellChunkOf(40.758, -73.9855).cell).toEqual([40, -74]);
  });
});

describe("neighborChunks — 스트리밍 로드 창", () => {
  it("반경 1 → 3×3 = 9칸, 중심 포함", () => {
    const n = neighborChunks(5, 7, 1);
    expect(n.length).toBe(9);
    expect(n).toContainEqual([5, 7]);
    expect(n).toContainEqual([4, 6]);
    expect(n).toContainEqual([6, 8]);
  });
  it("반경 2 → 5×5 = 25칸", () => {
    expect(neighborChunks(0, 0, 2).length).toBe(25);
  });
});
