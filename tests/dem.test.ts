import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { decodePNG, lonToPx, latToPx, terrariumElev, bareEarth, morphPass } from "../scripts/dem.mjs";

// 실측 DEM(terrarium) 처리 순수 헬퍼 — 투영/디코드 버그는 지형 전체를 어긋나게 하므로 고정.

describe("terrariumElev — RGB → 표고(m)", () => {
  it("32768 = 해수면 0m 기준 인코딩", () => {
    expect(terrariumElev(128, 0, 0)).toBe(0); // 128*256 = 32768
    expect(terrariumElev(129, 0, 0)).toBe(256); // +1 R = +256m
    expect(terrariumElev(128, 50, 0)).toBe(50); // G = m
    expect(terrariumElev(127, 255, 0)).toBe(-1); // 127*256+255-32768
  });
});

describe("lonToPx / latToPx — 웹 메르카토르 전역 픽셀(타일 256px)", () => {
  it("z0 의 중심(경위도 0) = 128px (단일 타일 중앙)", () => {
    expect(lonToPx(0, 0)).toBeCloseTo(128);
    expect(latToPx(0, 0)).toBeCloseTo(128);
  });
  it("경도 → x 타일 인덱스(경복궁 z13 = x6985)", () => {
    expect(Math.floor(lonToPx(126.977, 13) / 256)).toBe(6985);
  });
  it("위도 → y 타일 인덱스(경복궁 z13 = y3172)", () => {
    expect(Math.floor(latToPx(37.578, 13) / 256)).toBe(3172);
  });
  it("위도 증가 → y 감소(북쪽이 위)", () => {
    expect(latToPx(38, 10)).toBeLessThan(latToPx(37, 10));
  });
});

describe("decodePNG — 최소 RGB 디코더(필터 0)", () => {
  /** CRC 미검증 디코더용 최소 PNG 합성(2×1 RGB). */
  const makePNG = (w: number, h: number, scanlines: number[]) => {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(w, 0); ihdrData.writeUInt32BE(h, 4);
    ihdrData[8] = 8; ihdrData[9] = 2; // bitDepth 8, colorType 2(RGB)
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
      return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4) /*crc 무시*/]);
    };
    const idat = zlib.deflateSync(Buffer.from(scanlines));
    return Buffer.concat([sig, chunk("IHDR", ihdrData), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
  };

  it("IHDR/IDAT 파싱 + 필터0 스캔라인 복원", () => {
    // 2×1 픽셀: [filter=0, R0,G0,B0, R1,G1,B1]
    const png = makePNG(2, 1, [0, 10, 20, 30, 40, 50, 60]);
    const out = decodePNG(png);
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(out.ch).toBe(3);
    expect([...out.data]).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("필터1(Sub) 복원 — 좌측 픽셀 누적", () => {
    // [filter=1(Sub), 10,20,30, 5,5,5] → 두번째 픽셀 = 첫+델타 = 15,25,35
    const png = makePNG(2, 1, [1, 10, 20, 30, 5, 5, 5]);
    const out = decodePNG(png);
    expect([...out.data]).toEqual([10, 20, 30, 15, 25, 35]);
  });
});

describe("dem.bareEarth / morphPass — DSM(건물) 스파이크 제거(형태학적 열림)", () => {
  const mkGrid = (size: number, fill: number) => { const g = new Float32Array(size * size); g.fill(fill); return g; };
  it("고립된 건물 스파이크는 지면 레벨로 제거됨", () => {
    const s = 11; const g = mkGrid(s, 40); g[5 * s + 5] = 100; // 중앙 스파이크
    const out = bareEarth(g, s, 2, 1);
    expect(out[5 * s + 5]).toBeLessThan(50); // 100 → ~40 (제거)
  });
  it("넓은 고지대(산)는 보존", () => {
    const s = 15; const g = mkGrid(s, 40);
    for (let y = 0; y < s; y++) for (let x = 0; x < 7; x++) g[y * s + x] = 100; // 왼쪽 넓은 고지
    const out = bareEarth(g, s, 2, 0);
    expect(out[7 * s + 1]).toBeGreaterThan(90); // 고지 내부는 유지
  });
  it("morphPass 침식(min)은 밝은 스파이크를 낮춤", () => {
    const s = 7; const g = mkGrid(s, 10); g[3 * s + 3] = 99;
    const er = morphPass(g, s, 1, Math.min);
    expect(er[3 * s + 3]).toBe(10);
  });
});
