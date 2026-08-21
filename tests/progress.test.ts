import { describe, it, expect, vi, afterEach } from "vitest";
import {
  defineStore, MemoryBackend, resolveBackend, flushStores,
  validateProgress, validateCampaign, PROGRESS_DEFAULTS, CAMPAIGN_DEFAULTS, DRIFT_VECTOR_CAP,
  type StoreDef,
} from "../src/core/progress";

// 저장 인프라(P0-1, TODO §9.3/§10) — 백엔드 교체 가능 계층 위의 버전·검증·손상 복구·스로틀.
// localStorage 는 어댑터일 뿐(P6 서버 백엔드로 교체) — 스키마·검증·마이그레이션이 살아남는 부분.

interface Toy { n: number; tag: string }
const toyDef = (over: Partial<StoreDef<Toy>> = {}): StoreDef<Toy> => ({
  key: "t.toy", version: 2,
  defaults: () => ({ n: 0, tag: "fresh" }),
  validate: (d): d is Toy => !!d && typeof (d as Toy).n === "number" && typeof (d as Toy).tag === "string",
  ...over,
});

afterEach(() => vi.useRealTimers());

describe("defineStore — 라운드트립·기본값", () => {
  it("빈 백엔드 → 기본값 생성·기록, save → 재로드 시 동일", () => {
    const be = new MemoryBackend();
    const s = defineStore(toyDef(), be);
    expect(s.load()).toEqual({ n: 0, tag: "fresh" });
    s.save({ n: 7, tag: "x" });
    const s2 = defineStore(toyDef(), be); // 새 스토어(캐시 없음)로 재로드
    expect(s2.load()).toEqual({ n: 7, tag: "x" });
  });

  it("봉투에 버전·갱신시각이 실린다", () => {
    const be = new MemoryBackend();
    defineStore(toyDef(), be).save({ n: 1, tag: "a" });
    const env = JSON.parse(be.read("t.toy")!);
    expect(env.v).toBe(2);
    expect(typeof env.updatedAt).toBe("number");
    expect(env.data).toEqual({ n: 1, tag: "a" });
  });

  it("reset — 기본값으로 되돌리고 즉시 기록", () => {
    const be = new MemoryBackend();
    const s = defineStore(toyDef(), be);
    s.save({ n: 9, tag: "z" });
    expect(s.reset()).toEqual({ n: 0, tag: "fresh" });
    expect(defineStore(toyDef(), be).load()).toEqual({ n: 0, tag: "fresh" });
  });
});

describe("defineStore — 손상 복구·마이그레이션", () => {
  it("JSON 손상 → corrupt 백업 후 기본값 리셋(다른 슬롯 무영향)", () => {
    const be = new MemoryBackend();
    be.write("t.toy", "{{{broken");
    const s = defineStore(toyDef(), be);
    expect(s.load()).toEqual({ n: 0, tag: "fresh" });
    expect(be.read("t.toy.corrupt")).toBe("{{{broken");
  });

  it("구조 검증 실패 → corrupt 백업 후 리셋", () => {
    const be = new MemoryBackend();
    be.write("t.toy", JSON.stringify({ v: 2, updatedAt: 1, data: { n: "bad" } }));
    expect(defineStore(toyDef(), be).load()).toEqual({ n: 0, tag: "fresh" });
    expect(be.read("t.toy.corrupt")).not.toBeNull();
  });

  it("버전 불일치 + migrate 성공 → 변환본 사용", () => {
    const be = new MemoryBackend();
    be.write("t.toy", JSON.stringify({ v: 1, updatedAt: 1, data: { n: 5 } })); // v1 엔 tag 없음
    const s = defineStore(toyDef({
      migrate: (fromV, data) => (fromV === 1 ? { ...(data as { n: number }), tag: "migrated" } : undefined),
    }), be);
    expect(s.load()).toEqual({ n: 5, tag: "migrated" });
  });

  it("버전 불일치 + migrate 없음/실패 → 리셋", () => {
    const be = new MemoryBackend();
    be.write("t.toy", JSON.stringify({ v: 1, updatedAt: 1, data: { n: 5 } }));
    expect(defineStore(toyDef(), be).load()).toEqual({ n: 0, tag: "fresh" }); // migrate 미지정
    be.write("t.toy", JSON.stringify({ v: 1, updatedAt: 1, data: { n: 5 } }));
    const failing = defineStore(toyDef({ migrate: () => undefined }), be);
    expect(failing.load()).toEqual({ n: 0, tag: "fresh" });
  });
});

describe("defineStore — update 스로틀 + flush", () => {
  it("스로틀 창 안의 연속 update 는 기록을 미루고, flush 가 마감한다", () => {
    vi.useFakeTimers();
    const be = new MemoryBackend();
    const s = defineStore(toyDef(), be);
    s.load(); // 최초 기본값 기록(lastWrite 갱신)
    s.update((c) => ({ ...c, n: 1 })); // 창 안 — 보류
    s.update((c) => ({ ...c, n: 2 }));
    expect(JSON.parse(be.read("t.toy")!).data.n).toBe(0); // 아직 이전 기록
    s.flush();
    expect(JSON.parse(be.read("t.toy")!).data.n).toBe(2); // 마감 반영
  });

  it("스로틀 타이머가 자동으로 마감한다(pagehide 전이라도 1초 내 반영)", () => {
    vi.useFakeTimers();
    const be = new MemoryBackend();
    const s = defineStore(toyDef(), be);
    s.load();
    s.update((c) => ({ ...c, n: 42 }));
    vi.advanceTimersByTime(1100);
    expect(JSON.parse(be.read("t.toy")!).data.n).toBe(42);
  });

  it("update 반환값·캐시는 즉시 최신(기록만 지연)", () => {
    vi.useFakeTimers();
    const s = defineStore(toyDef(), new MemoryBackend());
    s.load();
    expect(s.update((c) => ({ ...c, n: 3 })).n).toBe(3);
    expect(s.load().n).toBe(3);
  });
});

describe("백엔드 폴백·전역 마감", () => {
  it("resolveBackend — 비브라우저(node)에선 인메모리 폴백으로 동작", () => {
    const be = resolveBackend();
    be.write("k", "v");
    expect(be.read("k")).toBe("v");
    be.remove("k");
    expect(be.read("k")).toBeNull();
  });

  it("flushStores — 전역 싱글턴 마감이 예외 없이 동작(폴백 백엔드)", () => {
    expect(() => flushStores()).not.toThrow();
  });
});

describe("슬롯 계약 — progress(§7.4)·campaign(§9)", () => {
  it("기본값이 자체 검증을 통과하고 매번 새 사본이다", () => {
    expect(validateProgress(PROGRESS_DEFAULTS())).toBe(true);
    expect(validateCampaign(CAMPAIGN_DEFAULTS())).toBe(true);
    const a = CAMPAIGN_DEFAULTS(), b = CAMPAIGN_DEFAULTS();
    a.evidence.drift = 50;
    expect(b.evidence.drift).toBe(0); // 공유 참조 없음
  });

  it("validateProgress — 음수/비수치 xp·stats 결손 거부", () => {
    expect(validateProgress({ drones: { walker: { xp: -1 } }, stats: PROGRESS_DEFAULTS().stats })).toBe(false);
    expect(validateProgress({ drones: { walker: { xp: 10 } } })).toBe(false);
  });

  it("validateCampaign — 챕터 범위·도시 상태·벡터 상한 거부", () => {
    const base = CAMPAIGN_DEFAULTS();
    expect(validateCampaign({ ...base, chapter: 7 })).toBe(false);
    expect(validateCampaign({ ...base, cities: { seoul: { state: "??", defenses: 0, falls: 0 } } })).toBe(false);
    expect(validateCampaign({
      ...base,
      driftVectors: Array.from({ length: DRIFT_VECTOR_CAP + 1 }, () => ({ cityId: "s", x: 0, z: 0, dx: 1, dz: 0 })),
    })).toBe(false);
  });
});
