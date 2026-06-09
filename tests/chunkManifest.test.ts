import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  geoCell, landmarkIndexPath, worldChunkPath, chunkBlockDir, tilesPath, cellChunkOf, cellMLon, cellLocalOf,
  type TilesManifest, type WorldChunk,
} from "../src/world/chunkManifest";

// 위경도 셀 + 전지구 타일 경로 계약(순수) + 생성 산출물(있으면) 구조 가드.

describe("셀/타일 경로 헬퍼", () => {
  it("geoCell = floor(lat)/floor(lon) (음수 포함)", () => {
    expect(geoCell(37.578, 126.977)).toEqual([37, 126]);
    expect(geoCell(40.758, -73.9855)).toEqual([40, -74]);
  });
  it("월드 청크/타일 매니페스트/랜드마크 인덱스 경로", () => {
    expect(worldChunkPath([37, 126], 84, 45)).toBe("maps/37/126/5_2/84_45.json"); // 블록 디렉터리 5_2(=floor(84/16)_floor(45/16))
    expect(worldChunkPath([37, 126], 84, 45, 16)).toBe("maps/37/126/5_2/84_45.json");
    expect(chunkBlockDir(84, 45, 16)).toBe("5_2");
    expect(chunkBlockDir(0, 0, 16)).toBe("0_0");
    expect(chunkBlockDir(-1, -1, 16)).toBe("-1_-1"); // 음수 floor 분할
    expect(tilesPath([37, 126])).toBe("maps/37/126/tiles.json");
    expect(landmarkIndexPath()).toBe("maps/landmarks.json");
  });
});

describe("cellLocalOf / cellMLon — 위경도 → 셀-로컬 m(NW 원점)", () => {
  it("셀 NW 모서리(lat=cell+1, lon=cell) → (0,0)", () => {
    const o = cellLocalOf(38, 126, [37, 126]);
    expect(o.x).toBeCloseTo(0);
    expect(o.z).toBeCloseTo(0);
  });
  it("동(+x)/남(+z) 증가 — 경복궁 스폰", () => {
    const o = cellLocalOf(37.5797, 126.977, [37, 126]);
    expect(o.x).toBeGreaterThan(0);
    expect(o.z).toBeGreaterThan(0);
  });
  it("cellChunkOf 와 일관(floor(local/chunk) = cx,cz)", () => {
    const o = cellLocalOf(37.5797, 126.977, [37, 126]);
    const r = cellChunkOf(37.5797, 126.977, 1024);
    expect(Math.floor(o.x / 1024)).toBe(r.cx);
    expect(Math.floor(o.z / 1024)).toBe(r.cz);
  });
  it("cellMLon = 셀 중앙 위도 기준 경도 m/도", () => {
    expect(cellMLon(37)).toBeCloseTo(111320 * Math.cos((37.5 * Math.PI) / 180), 3);
  });
});

describe("생성된 경복궁 타일 월드(있으면)", () => {
  const tp = `public/${tilesPath([37, 126])}`;
  it.runIf(existsSync(tp))("tiles.json + 청크 파일 + 결합(지형+오브젝트) 구조", () => {
    const t = JSON.parse(readFileSync(tp, "utf8")) as TilesManifest;
    expect(t.chunkSize).toBe(1024);
    expect(t.chunks.length).toBeGreaterThan(0);
    // 생성기 격자 == 런타임 격자(StreamingWorld origin 정합 핵심) — mLon 동일
    expect(t.mLon).toBeCloseTo(cellMLon(t.cell[0]), 6);
    // 경복궁 위치 청크가 인덱스에 존재
    const { cx, cz } = cellChunkOf(37.5797, 126.977, t.chunkSize);
    const e = t.chunks.find((c) => c.cx === cx && c.cz === cz)!;
    expect(e).toBeTruthy();
    // 그 청크 파일 = 지형 + 오브젝트 결합
    const cp = `public/${worldChunkPath([37, 126], cx, cz)}`;
    expect(existsSync(cp)).toBe(true);
    const ch = JSON.parse(readFileSync(cp, "utf8")) as WorldChunk;
    expect(ch.terrain.size).toBeGreaterThan(0);
    expect(ch.terrain.heights.length).toBe(ch.terrain.size * ch.terrain.size);
    expect("buildings" in ch.objects).toBe(true);
    expect(ch.underground).toBeNull();
  });
});
