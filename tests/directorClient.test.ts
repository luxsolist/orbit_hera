import { describe, it, expect, vi } from "vitest";
import {
  RemoteDirector, parseDirectorResponse, resolveDirectorEndpoint, DIRECTOR_ENDPOINT_KEY,
} from "../src/game/directorClient";
import type { DirectorSnapshot } from "../src/game/director";

// LLM 감독 파일럿(§10 단계 1) — 원격 감독의 우아한 강등 계약: 어떤 실패도 "개입 없음"([]).

const SNAP: DirectorSnapshot = {
  missionId: "m", goalType: "purge",
  runtime: { elapsed: 10, kills: 3, buildingsDestroyed: 0, landmarksDestroyed: 0, deaths: 0 },
  respawnsLeft: 2, aliveEnemies: 12, reinforceQueued: 5, brandCount: 0, score: 30,
  players: { count: 1, avgHpFrac: 0.8 },
};

describe("resolveDirectorEndpoint — 설정 우선순위", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      read: (k: string) => m.get(k) ?? null,
      write: (k: string, v: string) => void m.set(k, v),
      remove: (k: string) => void m.delete(k),
      map: m,
    };
  };

  it("?director=<url> 이 저장되고 우선한다", () => {
    const s = mem();
    expect(resolveDirectorEndpoint("?director=https://d.example/api", s.read, s.write, s.remove))
      .toBe("https://d.example/api");
    expect(s.map.get(DIRECTOR_ENDPOINT_KEY)).toBe("https://d.example/api");
    // 쿼리 없으면 저장값 사용
    expect(resolveDirectorEndpoint("", s.read, s.write, s.remove)).toBe("https://d.example/api");
  });

  it("off 는 저장 해제, 비 URL 값·빈 설정은 null(감독 없음)", () => {
    const s = mem();
    s.write(DIRECTOR_ENDPOINT_KEY, "https://d.example/api");
    expect(resolveDirectorEndpoint("?director=off", s.read, s.write, s.remove)).toBeNull();
    expect(s.map.has(DIRECTOR_ENDPOINT_KEY)).toBe(false);
    expect(resolveDirectorEndpoint("?director=notaurl", s.read, s.write, s.remove)).toBeNull();
    expect(resolveDirectorEndpoint("", s.read, s.write, s.remove)).toBeNull();
  });
});

describe("parseDirectorResponse — 1차 형식 방어(검증 게이트 전)", () => {
  it("actions 배열의 type 있는 객체만 통과", () => {
    expect(parseDirectorResponse({ actions: [{ type: "none" }, { type: "brief", text: "x" }] })).toHaveLength(2);
    expect(parseDirectorResponse({ actions: [null, 1, "s", {}, { type: "none" }] })).toEqual([{ type: "none" }]);
    expect(parseDirectorResponse({})).toEqual([]);
    expect(parseDirectorResponse(null)).toEqual([]);
    expect(parseDirectorResponse("[]")).toEqual([]);
  });
});

describe("RemoteDirector.decide — 우아한 강등", () => {
  it("정상 응답 → 행동 전달, 스냅샷이 봉투(v/snapshot)로 POST 된다", async () => {
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(init!.body as string)).toEqual({ v: 1, snapshot: SNAP });
      return { ok: true, json: async () => ({ actions: [{ type: "none" }] }) } as Response;
    });
    const d = new RemoteDirector("https://d.example/api", fetchFn as unknown as typeof fetch);
    expect(await d.decide(SNAP)).toEqual([{ type: "none" }]);
  });

  it("HTTP 오류·예외·잘못된 JSON → [](절대 던지지 않음)", async () => {
    const bad = new RemoteDirector("https://d", (async () => ({ ok: false })) as unknown as typeof fetch);
    expect(await bad.decide(SNAP)).toEqual([]);
    const boom = new RemoteDirector("https://d", (async () => { throw new Error("net"); }) as unknown as typeof fetch);
    expect(await boom.decide(SNAP)).toEqual([]);
    const badJson = new RemoteDirector("https://d", (async () => ({ ok: true, json: async () => { throw new Error("parse"); } })) as unknown as typeof fetch);
    expect(await badJson.decide(SNAP)).toEqual([]);
  });

  it("타임아웃 — abort 신호로 중단되어 []", async () => {
    vi.useFakeTimers();
    const never = new RemoteDirector(
      "https://d",
      ((_u: unknown, init?: RequestInit) => new Promise((_, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      })) as unknown as typeof fetch,
      1000,
    );
    const p = never.decide(SNAP);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await p).toEqual([]);
    vi.useRealTimers();
  });
});
