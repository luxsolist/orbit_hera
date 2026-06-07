import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  geoCell, landmarkIndexPath, worldChunkPath, tilesPath, cellChunkOf,
  type TilesManifest, type WorldChunk,
} from "../src/world/chunkManifest";

// 위경도 셀 + 전지구 타일 경로 계약(순수) + 생성 산출물(있으면) 구조 가드.

describe("셀/타일 경로 헬퍼", () => {
  it("geoCell = floor(lat)/floor(lon) (음수 포함)", () => {
    expect(geoCell(37.578, 126.977)).toEqual([37, 126]);
    expect(geoCell(40.758, -73.9855)).toEqual([40, -74]);
  });
  it("월드 청크/타일 매니페스트/랜드마크 인덱스 경로", () => {
    expect(worldChunkPath([37, 126], 84, 45)).toBe("maps/37/126/84_45.json");
    expect(tilesPath([37, 126])).toBe("maps/37/126/tiles.json");
    expect(landmarkIndexPath()).toBe("maps/landmarks.json");
  });
});

describe("생성된 경복궁 타일 월드(있으면)", () => {
  const tp = `public/${tilesPath([37, 126])}`;
  it.runIf(existsSync(tp))("tiles.json + 청크 파일 + 결합(지형+오브젝트) 구조", () => {
    const t = JSON.parse(readFileSync(tp, "utf8")) as TilesManifest;
    expect(t.chunkSize).toBe(1024);
    expect(t.chunks.length).toBeGreaterThan(0);
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
