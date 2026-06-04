import { describe, it, expect, vi, afterEach } from "vitest";
import { makeLoader } from "../src/core/loader";

// 정적 JSON 로더(fetch 래퍼)의 성공/에러경로 + id 인코딩 가드. fetch 를 스텁.

afterEach(() => vi.unstubAllGlobals());

describe("makeLoader", () => {
  it("catalog/one: ok → json 반환", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [{ id: "a" }] })));
    const l = makeLoader<{ id: string }, { id: string }>("dir", "X");
    expect(await l.catalog()).toEqual([{ id: "a" }]);
  });

  it("ok=false → 라벨 포함 에러로 reject", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const l = makeLoader("dir", "전장");
    await expect(l.catalog()).rejects.toThrow("전장 목록");
    await expect(l.one("x")).rejects.toThrow("전장 데이터");
  });

  it("one: id 를 URL 인코딩", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    await makeLoader("drones", "X").one("a b");
    expect(String(fetchMock.mock.calls[0][0])).toContain("a%20b");
  });
});
