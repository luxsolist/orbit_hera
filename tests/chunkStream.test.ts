import { describe, it, expect } from "vitest";
import {
  chunkIndex, fineActive, desiredLoad, keepSet, chunkKey,
  ChunkStreamer, type ChunkConfig, type ChunkIO, type ViewState, type ChunkReq,
} from "../src/world/chunkStream";

// 청크 스트리밍 — 순수 결정 로직(LOD·프리페치·히스테리시스) + 스트리머 생명주기(fetch→예산빌드→언로드→캐시).

const CFG: ChunkConfig = {
  fineSize: 1024, coarseSize: 4096, fineRadius: 2048, coarseRadius: 8192,
  fineMaxAltitude: 350, prefetchLead: 1.5, hysteresis: 512,
  buildBudgetMs: 1000, maxConcurrentFetch: 4, maxCached: 2,
};
const view = (o: Partial<ViewState> = {}): ViewState => ({ x: 0, z: 0, vx: 0, vz: 0, altitude: 0, ...o });

describe("chunkIndex / fineActive", () => {
  it("좌표 → 청크 인덱스(floor)", () => {
    expect(chunkIndex(0, 1024)).toBe(0);
    expect(chunkIndex(1023, 1024)).toBe(0);
    expect(chunkIndex(1024, 1024)).toBe(1);
    expect(chunkIndex(-1, 1024)).toBe(-1);
  });
  it("세밀 청크는 고도 임계 이하에서만 활성", () => {
    expect(fineActive(0, CFG)).toBe(true);
    expect(fineActive(350, CFG)).toBe(true);
    expect(fineActive(351, CFG)).toBe(false);
  });
});

describe("desiredLoad — LOD + 프리페치 + 정렬", () => {
  it("저고도: 세밀+거친 모두 포함, 우선순위 오름차순", () => {
    const reqs = desiredLoad(view(), CFG);
    expect(reqs.some((r) => r.lod === "fine")).toBe(true);
    expect(reqs.some((r) => r.lod === "coarse")).toBe(true);
    for (let i = 1; i < reqs.length; i++) expect(reqs[i].priority).toBeGreaterThanOrEqual(reqs[i - 1].priority);
  });
  it("고고도: 세밀 제외(거친 지형만)", () => {
    const reqs = desiredLoad(view({ altitude: 500 }), CFG);
    expect(reqs.some((r) => r.lod === "fine")).toBe(false);
    expect(reqs.every((r) => r.lod === "coarse")).toBe(true);
  });
  it("속도방향 프리페치: 창이 전방으로 이동", () => {
    const rest = desiredLoad(view(), CFG).filter((r) => r.lod === "fine");
    const fwd = desiredLoad(view({ vx: 2048 }), CFG).filter((r) => r.lod === "fine"); // +3072m≈3청크 전진
    const maxCx = (a: ChunkReq[]) => Math.max(...a.map((r) => r.cx));
    const minCx = (a: ChunkReq[]) => Math.min(...a.map((r) => r.cx));
    expect(maxCx(fwd)).toBeGreaterThan(maxCx(rest)); // 전방 더 멀리
    expect(minCx(fwd)).toBeGreaterThan(minCx(rest)); // 후방 버림
  });
});

describe("keepSet — 히스테리시스 + 고도 LOD", () => {
  it("로드 대상은 모두 keep(언로드 금지) — 히스테리시스로 더 넓게", () => {
    const load = desiredLoad(view(), CFG).filter((r) => r.lod === "fine");
    const keep = keepSet(view(), CFG);
    for (const r of load) expect(keep.has(r.key)).toBe(true);
    expect(keep.size).toBeGreaterThan(load.length); // 여유 밴드만큼 더 큼
  });
  it("고고도면 fine 키는 keep 에서 빠짐(자연 언로드)", () => {
    const keep = keepSet(view({ altitude: 500 }), CFG);
    expect([...keep].some((k) => k.startsWith("fine:"))).toBe(false);
  });
});

// ── 스트리머 생명주기 ──
const flush = () => new Promise((r) => setTimeout(r));

function fakeIO() {
  const disposed: string[] = [];
  const io: ChunkIO = {
    fetch: (req) => Promise.resolve(`raw:${req.key}`),
    build: (req, raw) => `built:${req.key}:${raw}`,
    dispose: (h) => { disposed.push(String(h)); },
  };
  return { io, disposed };
}

describe("ChunkStreamer — fetch → 예산 빌드 → 언로드 → 캐시", () => {
  it("update → fetch 시작 → 다음 프레임 빌드 완료", async () => {
    const { io } = fakeIO();
    const s = new ChunkStreamer(io, CFG, () => 0); // now=0 고정 → 예산 무한
    s.update(view());
    expect(s.pendingCount).toBeGreaterThan(0); // fetch 진행 중
    expect(s.loadedCount).toBe(0);
    await flush(); // fetch 완료 → ready
    s.update(view()); // drainBuilds
    expect(s.loadedCount).toBeGreaterThan(0);
  });

  it("동시 fetch 상한 준수", () => {
    const { io } = fakeIO();
    const s = new ChunkStreamer(io, { ...CFG, maxConcurrentFetch: 3 }, () => 0);
    s.update(view());
    expect(s.pendingCount).toBeLessThanOrEqual(3);
  });

  it("시간 예산 초과 시 프레임당 빌드 수 제한", async () => {
    const { io } = fakeIO();
    let t = 0;
    const clock = () => (t += 2); // 호출마다 +2ms
    // budget 6 → start=2, 4<6 build1, 6<6 stop → 1빌드/프레임(대략)
    const s = new ChunkStreamer(io, { ...CFG, buildBudgetMs: 6 }, clock);
    s.update(view());
    await flush();
    const before = s.loadedCount;
    s.update(view());
    const built = s.loadedCount - before;
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThan(desiredLoad(view(), CFG).length); // 한 프레임에 전부는 아님
  });

  it("멀리 이동 → 이탈 청크 언로드(→캐시), 복귀 → 캐시 히트(재fetch 0)", async () => {
    const { io, disposed } = fakeIO();
    let fetches = 0;
    io.fetch = (req: ChunkReq) => { fetches++; return Promise.resolve(`raw:${req.key}`); };
    // 동시fetch·캐시 넉넉 → 한 사이클에 전부 로드 + 캐시 전부 보관(결정적).
    const big: ChunkConfig = { ...CFG, maxConcurrentFetch: 1000, maxCached: 1000 };
    const s = new ChunkStreamer(io, big, () => 0);
    s.update(view()); await flush(); s.update(view());
    const loaded0 = s.loadedCount;
    expect(loaded0).toBeGreaterThan(0);
    // 아주 멀리 이동 → 기존 청크 keep 밖 → 언로드(캐시, dispose 안 됨)
    s.update(view({ x: 100000 })); await flush(); s.update(view({ x: 100000 }));
    expect(disposed.length).toBe(0); // 캐시가 넉넉 → 해제 없음
    // 복귀 — 원래 청크 전부 캐시 히트 → 재fetch 0
    fetches = 0;
    s.update(view());
    expect(fetches).toBe(0);
    expect(s.loadedCount).toBeGreaterThanOrEqual(loaded0);
  });

  it("캐시 한도 초과 시 가장 오래된 것부터 dispose", async () => {
    const { io, disposed } = fakeIO();
    const s = new ChunkStreamer(io, { ...CFG, maxConcurrentFetch: 1000, maxCached: 2 }, () => 0);
    s.update(view()); await flush(); s.update(view());
    s.update(view({ x: 100000 })); await flush(); // 원래 청크 다수 언로드 → 캐시 2개 초과분 dispose
    expect(disposed.length).toBeGreaterThan(0);
  });
});
