// 저장 인프라(P0-1) — 버전·검증·마이그레이션·손상 복구를 갖춘 영속 계층.
// 원칙(TODO §10 과 동일 패턴): **백엔드는 교체 가능한 구현일 뿐** — 지금은 localStorage,
// P6 서버 시대엔 ServerBackend(계정 저장)로 교체하고 스키마·검증·마이그레이션 층은 그대로 간다.
// 세계 공유 상태(도시·함락률)는 그때 서버로 승격되고, 로컬은 오프라인/솔로 폴백을 계속 담당.
//
// 소비자: core.progress(§7.4 진행 — XP만 저장·레벨 파생) · core.campaign(§9 캠페인 — P0-2 가
// 전이 로직을 얹음). 새 도메인은 defineStore 로 슬롯 추가(예: Director 감사 로그 — 단계 1).

// ─────────────────────────── 백엔드(교체 지점) ───────────────────────────

/** 저장 백엔드 — 원시 문자열 read/write 만. 구현: localStorage(현재)/메모리(테스트·폴백)/서버(P6). */
export interface StorageBackend {
  read(key: string): string | null;
  write(key: string, raw: string): void;
  remove(key: string): void;
}

/** 인메모리 백엔드 — 테스트·사생활 모드·비브라우저 환경 폴백(세션 내 한정 영속). */
export class MemoryBackend implements StorageBackend {
  private map = new Map<string, string>();
  read(key: string): string | null { return this.map.get(key) ?? null; }
  write(key: string, raw: string): void { this.map.set(key, raw); }
  remove(key: string): void { this.map.delete(key); }
}

/** 사용 가능한 기본 백엔드 — localStorage 가용 검사(쓰기 프로브) 실패 시 인메모리 폴백. */
export function resolveBackend(): StorageBackend {
  try {
    const ls = globalThis.localStorage;
    const probe = "__core_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return {
      read: (k) => { try { return ls.getItem(k); } catch { return null; } },
      write: (k, raw) => { try { ls.setItem(k, raw); } catch { /* 용량 초과 등 — 다음 flush 재시도 */ } },
      remove: (k) => { try { ls.removeItem(k); } catch { /* 무시 */ } },
    };
  } catch {
    return new MemoryBackend(); // 사생활 모드/노드 환경 — 게임은 계속 동작(세션 내 저장)
  }
}

// ─────────────────────────── 스토어 팩토리 ───────────────────────────

const WRITE_THROTTLE_MS = 1000; // update() 직렬화 스로틀 — 킬마다 저장해도 프레임에 안 얹히게

/** 저장 봉투 — 슬롯 공통. 버전 불일치는 migrate, 구조 손상은 corrupt 백업 후 리셋. */
interface Envelope {
  v: number;
  updatedAt: number;
  data: unknown;
}

export interface StoreDef<T> {
  key: string; //                                  localStorage 키(도메인별 독립 슬롯)
  version: number;
  defaults: () => T; //                            매번 새 사본(공유 참조 방지)
  validate: (d: unknown) => d is T; //             구조 검증(순수 — 외부 스키마 라이브러리 무의존)
  migrate?: (fromV: number, data: unknown) => unknown; // 구버전 → 현재 형태(불가 시 undefined 반환)
}

export interface Store<T> {
  load(): T; //                  캐시 로드(최초 1회 파싱·검증)
  save(data: T): void; //        즉시 기록
  update(fn: (cur: T) => T): T; // 변경 + 스로틀 기록(pagehide flush 로 마감 보장)
  flush(): void; //              보류 중인 기록 강제 반영
  reset(): T; //                 기본값으로 리셋·기록
}

/**
 * 슬롯 스토어 생성 — 봉투 파싱 → 버전 마이그레이션 → 검증 → 실패 시 `<key>.corrupt` 백업 후
 * 기본값 리셋(다른 슬롯에 영향 없음). update 는 스로틀 기록(잦은 XP/증거 적립용).
 */
export function defineStore<T>(def: StoreDef<T>, backend: StorageBackend = resolveBackend()): Store<T> {
  let cache: T | null = null;
  let dirty = false;
  let lastWrite = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const writeNow = (data: T): void => {
    const env: Envelope = { v: def.version, updatedAt: Date.now(), data };
    backend.write(def.key, JSON.stringify(env));
    lastWrite = Date.now();
    dirty = false;
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const resetTo = (data: T): T => {
    cache = data;
    writeNow(data);
    return data;
  };

  const load = (): T => {
    if (cache !== null) return cache;
    const raw = backend.read(def.key);
    if (raw === null) return resetTo(def.defaults());
    let env: Envelope | null = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && typeof (parsed as Envelope).v === "number") env = parsed as Envelope;
    } catch { /* 손상 — 아래 corrupt 경로 */ }
    if (!env) {
      backend.write(`${def.key}.corrupt`, raw); // 디버깅용 1회 보존
      return resetTo(def.defaults());
    }
    let data = env.data;
    if (env.v !== def.version) {
      data = def.migrate ? def.migrate(env.v, data) : undefined;
    }
    if (!def.validate(data)) {
      backend.write(`${def.key}.corrupt`, raw);
      return resetTo(def.defaults());
    }
    cache = data;
    return data;
  };

  const flush = (): void => {
    if (dirty && cache !== null) writeNow(cache);
  };

  return {
    load,
    flush,
    save(data: T): void {
      cache = data;
      writeNow(data);
    },
    update(fn: (cur: T) => T): T {
      const next = fn(load());
      cache = next;
      const wait = WRITE_THROTTLE_MS - (Date.now() - lastWrite);
      if (wait <= 0) writeNow(next);
      else {
        dirty = true;
        if (!timer) timer = setTimeout(flush, wait);
      }
      return next;
    },
    reset(): T {
      return resetTo(def.defaults());
    },
  };
}

// ─────────────────────────── 슬롯 1 — 진행(§7.4 계약) ───────────────────────────

/** 드론 진행 — xp 만 저장, 레벨은 파생(progression.ts — P2). stats 는 해금·업적의 선행 집계. */
export interface ProgressData {
  drones: Record<string, { xp: number }>;
  stats: { kills: number; battlefieldsCleared: number; landmarks: string[]; achievements: string[] };
}

export function validateProgress(d: unknown): d is ProgressData {
  if (!d || typeof d !== "object") return false;
  const p = d as ProgressData;
  if (!p.drones || typeof p.drones !== "object") return false;
  for (const v of Object.values(p.drones)) {
    if (!v || typeof v.xp !== "number" || !Number.isFinite(v.xp) || v.xp < 0) return false;
  }
  const s = p.stats;
  return !!s && typeof s.kills === "number" && typeof s.battlefieldsCleared === "number"
    && Array.isArray(s.landmarks) && Array.isArray(s.achievements);
}

export const PROGRESS_DEFAULTS = (): ProgressData => ({
  drones: { walker: { xp: 0 }, flyer: { xp: 0 } },
  stats: { kills: 0, battlefieldsCleared: 0, landmarks: [], achievements: [] },
});

// ─────────────────────────── 슬롯 2 — 캠페인(§9 계약, 전이 로직은 P0-2) ───────────────────────────

export type CityState = "defended" | "contested" | "fallen";

/** 소산 표류 벡터 — 지도 오버레이 누적(3장 "죽음의 방향" 증거). 상한 초과 시 오래된 것부터 제거. */
export interface DriftVector {
  cityId: string;
  x: number; z: number; //   관측 도시의 경도(x=lon)·위도(z=lat) — 오버레이가 투영해 그림
  dx: number; dz: number; // 지도 평면 표류 방향(정규화, y축=남향 양수) — campaign.driftVectorFor
}
export const DRIFT_VECTOR_CAP = 200;

/** 캠페인 상태 — 챕터(0=서장..6)·증거 4트랙(0..100)·도시 상태·표류 벡터·자매쌍 유대. */
export interface CampaignData {
  chapter: number;
  evidence: { heatmap: number; pulse: number; drift: number; immortal: number };
  cities: Record<string, { state: CityState; defenses: number; falls: number }>;
  driftVectors: DriftVector[];
  pairs: Record<string, { linked: string; bond: number }>;
  /** 직전 출격 요약(선택) — 자매도시 2연전 관측 보고(2장 앵커)의 연결 고리. */
  lastSortie?: { cityId: string; kills: number };
}

export function validateCampaign(d: unknown): d is CampaignData {
  if (!d || typeof d !== "object") return false;
  const c = d as CampaignData;
  if (typeof c.chapter !== "number" || c.chapter < 0 || c.chapter > 6) return false;
  const e = c.evidence;
  if (!e || [e.heatmap, e.pulse, e.drift, e.immortal].some((v) => typeof v !== "number" || v < 0)) return false;
  if (!c.cities || typeof c.cities !== "object") return false;
  for (const city of Object.values(c.cities)) {
    if (!city || !["defended", "contested", "fallen"].includes(city.state)) return false;
    if (typeof city.defenses !== "number" || typeof city.falls !== "number") return false;
  }
  if (!Array.isArray(c.driftVectors) || c.driftVectors.length > DRIFT_VECTOR_CAP) return false;
  return !!c.pairs && typeof c.pairs === "object";
}

export const CAMPAIGN_DEFAULTS = (): CampaignData => ({
  chapter: 0,
  evidence: { heatmap: 0, pulse: 0, drift: 0, immortal: 0 },
  cities: {},
  driftVectors: [],
  pairs: {},
});

// ─────────────────────────── 게임 전역 싱글턴 + 마감 ───────────────────────────

export const progressStore: Store<ProgressData> = defineStore({
  key: "core.progress", version: 1, defaults: PROGRESS_DEFAULTS, validate: validateProgress,
});

export const campaignStore: Store<CampaignData> = defineStore({
  key: "core.campaign", version: 1, defaults: CAMPAIGN_DEFAULTS, validate: validateCampaign,
});

/** 페이지 이탈 마감 — 스로틀로 보류된 기록을 전부 반영(Game.teardown/pagehide 에서 호출). */
export function flushStores(): void {
  progressStore.flush();
  campaignStore.flush();
}
