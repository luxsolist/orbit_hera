// 청크 스트리밍 스켈레톤 — 대규모/행성 규모 맵을 일정 청크로 분할해 플레이어 주변만 로드/언로드.
//
// 고속·고공 드론 대비 핵심 설계(분석: TODO §5):
//  - 로드율 = 2·R·v/C² (작은 청크 + 고속이 치명적) → **고도/속도 적응 LOD** 로 회피.
//  - 저고도·저속: 세밀 청크(건물+지형, 작은 반경). 고고도·고속: 거친 지형 타일(건물 생략, 큰 반경).
//  - 비용은 fetch 가 아니라 동기 빌드(mergeGeometries) → **프레임당 시간예산 빌드 큐**.
//  - **히스테리시스**(로드/언로드 반경 분리, 경계 thrash 차단), **속도방향 프리페치**, **LRU 캐시**.
//
// 결정 로직(desiredLoad/keepSet/fineActive)은 순수(테스트 가능). 실 fetch/메시빌드/dispose 는
// 주입형 ChunkIO 훅 — 데이터 파이프라인(§5) 완성 시 maps.ts/World 에 배선.

export type Lod = "fine" | "coarse";

export interface ChunkConfig {
  fineSize: number; // 세밀(건물) 청크변(m)
  coarseSize: number; // 거친 지형 타일변(m)
  activeRadius?: number; // Optional fine-chunk activation radius, independent of preparation.
  activeHysteresis?: number;
  fineRadius: number; // 세밀 로드 반경(m)
  coarseRadius: number; // 거친 로드 반경(m)
  fineMaxAltitude: number; // 이 고도(m) 초과 시 세밀 청크 스트리밍 중단(건물 생략)
  prefetchLead: number; // 속도방향 선로드 리드타임(s) — 창을 v·lead 전진
  hysteresis: number; // 언로드 여유(m) — keep 반경 = 로드반경 + 이 값
  buildBudgetMs: number; // 프레임당 동기 빌드 시간 예산
  maxConcurrentFetch: number; // 동시 비동기 fetch 상한
  maxCached: number; // 언로드 LRU 캐시 청크 수
}

export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  fineSize: 1024, coarseSize: 4096,
  fineRadius: 2048, coarseRadius: 20480,
  fineMaxAltitude: 350, prefetchLead: 1.5,
  hysteresis: 512, buildBudgetMs: 4,
  maxConcurrentFetch: 4, maxCached: 64,
};

/** 한 프레임의 뷰 상태 — 위치·속도(프리페치)·고도(LOD). 로컬 미터. */
export interface ViewState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  altitude: number; // 지표 대비 고도(m)
}

/** 로드 단위 1개 — LOD·청크 인덱스·변·키·우선순위(작을수록 먼저). */
export interface ChunkReq {
  lod: Lod;
  cx: number;
  cz: number;
  size: number;
  key: string;
  priority: number;
}

export function chunkKey(lod: Lod, cx: number, cz: number): string {
  return `${lod}:${cx}:${cz}`;
}

/** 좌표(m) → 청크 인덱스(정수). */
export function chunkIndex(coord: number, size: number): number {
  return Math.floor(coord / size);
}

/** 세밀(건물) 청크 스트리밍 활성 여부 — 고도가 임계 이하일 때만(고공은 거친 지형만). 순수. */
export function fineActive(altitude: number, cfg: ChunkConfig): boolean {
  return altitude <= cfg.fineMaxAltitude;
}

/** 한 LOD에서 (center 기준 reach 반경) 안 청크 목록. priority = center까지 거리. 순수. */
function chunksAround(lod: Lod, size: number, centerX: number, centerZ: number, reach: number): ChunkReq[] {
  const out: ChunkReq[] = [];
  const span = Math.ceil(reach / size) + 1;
  const c0x = chunkIndex(centerX, size), c0z = chunkIndex(centerZ, size);
  for (let cz = c0z - span; cz <= c0z + span; cz++) {
    for (let cx = c0x - span; cx <= c0x + span; cx++) {
      const mx = (cx + 0.5) * size, mz = (cz + 0.5) * size; // 청크 중심
      const d = Math.hypot(mx - centerX, mz - centerZ);
      if (d > reach) continue;
      out.push({ lod, cx, cz, size, key: chunkKey(lod, cx, cz), priority: d });
    }
  }
  return out;
}

/**
 * 이번 프레임 로드(+프리페치) 대상 — **속도방향으로 v·lead 전진한 중심** 기준 창.
 * 고도 임계 이하면 세밀+거친, 초과면 거친만. priority 오름차순(가까운 전방 먼저). 순수.
 */
export function desiredLoad(view: ViewState, cfg: ChunkConfig): ChunkReq[] {
  const px = view.x + view.vx * cfg.prefetchLead;
  const pz = view.z + view.vz * cfg.prefetchLead;
  const out: ChunkReq[] = [];
  if (fineActive(view.altitude, cfg)) out.push(...chunksAround("fine", cfg.fineSize, px, pz, cfg.fineRadius));
  out.push(...chunksAround("coarse", cfg.coarseSize, px, pz, cfg.coarseRadius));
  out.sort((a, b) => a.priority - b.priority);
  return out;
}

/**
 * 유지(언로드 금지) 집합 — **플레이어 실위치** 기준 (로드반경 + hysteresis). 경계 thrash 차단.
 * 세밀이 비활성(고공)이면 fine 키는 포함 안 됨 → 자연 언로드. 순수.
 */
export function keepSet(view: ViewState, cfg: ChunkConfig): Set<string> {
  const keep = new Set<string>();
  if (fineActive(view.altitude, cfg))
    for (const r of chunksAround("fine", cfg.fineSize, view.x, view.z, cfg.fineRadius + cfg.hysteresis)) keep.add(r.key);
  for (const r of chunksAround("coarse", cfg.coarseSize, view.x, view.z, cfg.coarseRadius + cfg.hysteresis)) keep.add(r.key);
  return keep;
}

/** 청크 입출력 훅(주입) — fetch=비동기 로드, build=동기 메시화(예산 내), dispose=해제. */
export interface ChunkIO {
  fetch(req: ChunkReq, signal?:AbortSignal): Promise<unknown>;
  buildIncremental?(req:ChunkReq,raw:unknown):Generator<void,unknown>;
  discardRaw?(raw:unknown):void;
  prioritize?(keys:string[]):void;
  build(req: ChunkReq, raw: unknown, active?: boolean): unknown;
  dispose(handle: unknown): void;
  setActive?(handle: unknown, active: boolean): void;
}

/**
 * 청크 스트리머 — 매 프레임 update(view)로 원하는 집합 산출 → 언로드(→LRU) → 프리페치 큐 → 예산 빌드.
 * fetch/preparation and cooperative assembly are separate; a synchronous fallback step can still exceed the budget.
 */
export class ChunkStreamer {
  private built = new Map<string, unknown>(); // key → handle(빌드 완료)
  private fetching = new Set<string>();
  private controllers=new Map<string,AbortController>(); // fetch 진행 중
  private ready: { req: ChunkReq; raw: unknown; iterator?:Generator<void,unknown> }[] = []; // fetch 완료·빌드 대기
  private active = new Set<string>();
  private currentView?: ViewState;
  private lastBuildMs=0;
  private maxBuildMs=0;
  private disposed = false;
  private wanted = new Set<string>();
  private cache = new Map<string, unknown>(); // 언로드 보관(LRU; Map 삽입순)

  constructor(
    private io: ChunkIO,
    private cfg: ChunkConfig = DEFAULT_CHUNK_CONFIG,
    private now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
  ) {}

  /** 매 프레임 호출. */
  update(view: ViewState): void {
    if (this.disposed) return;
    this.currentView=view;this.lastBuildMs=0;
    const desired = desiredLoad(view, this.cfg);
    // Visible coverage must remain available even when prediction points far ahead.
    if(this.cfg.activeRadius!==undefined){
      const local=desiredLoad({...view,vx:0,vz:0},this.cfg);
      const keys=new Set(desired.map(r=>r.key));
      for(const r of local)if(!keys.has(r.key)&&this.shouldActivate(r.key))desired.push(r);
      desired.sort((a,b)=>Number(this.shouldActivate(b.key))-Number(this.shouldActivate(a.key))||a.priority-b.priority);
    }
    const keep = keepSet(view, this.cfg);
    this.wanted = new Set([...keep, ...desired.map(r => r.key)]);
    this.io.prioritize?.(desired.map(r=>r.key));
    for(const [key,controller] of this.controllers)if(!this.wanted.has(key)){this.controllers.delete(key);this.fetching.delete(key);controller.abort();}
    this.ready = this.ready.filter(item => {if(this.wanted.has(item.req.key))return true;item.iterator?.return(undefined);this.io.discardRaw?.(item.raw);return false;});
    const priority=new Map(desired.map((r,i)=>[r.key,i]));
    for(const item of this.ready)item.req.priority=priority.get(item.req.key)??Infinity;
    // 1) keep 밖 언로드 → LRU 캐시
    for (const [key, handle] of this.built) {
      if (!keep.has(key)) {
        this.built.delete(key);this.active.delete(key);
        this.toCache(key, handle);
      }
    }
    for(const [key,handle] of this.built){
      const active=this.shouldActivate(key);
      if(active!==this.active.has(key)){this.io.setActive?.(handle,active);if(active)this.active.add(key);else this.active.delete(key);}
    }
    // 2) 로드 대상 enqueue(우선순위순). 캐시 히트는 즉시 복귀, 아니면 fetch(동시 상한).
    for (const req of desired) {
      if (this.built.has(req.key) || this.fetching.has(req.key) || this.ready.some(item => item.req.key === req.key)) continue;
      const cached = this.cache.get(req.key);
      if (cached !== undefined) {
        this.cache.delete(req.key);
        this.built.set(req.key, cached);
        const active=this.shouldActivate(req.key);this.io.setActive?.(cached, active);if(active)this.active.add(req.key);
        continue;
      }
      if (this.pendingCount >= this.cfg.maxConcurrentFetch) continue;
      this.startFetch(req);
    }
    // 3) 시간예산 내 동기 빌드
    this.drainBuilds();
  }

  private startFetch(req: ChunkReq): void {
    this.fetching.add(req.key);
    const controller=new AbortController();this.controllers.set(req.key,controller);
    Promise.resolve(this.io.fetch(req,controller.signal)).then(
      (raw) => {
        if(this.controllers.get(req.key)!==controller){this.io.discardRaw?.(raw);return;}
        this.controllers.delete(req.key);this.fetching.delete(req.key);
        if (!this.disposed && this.wanted.has(req.key)) this.ready.push({ req, raw });else this.io.discardRaw?.(raw);
      },
      () => { if(this.controllers.get(req.key)===controller){this.controllers.delete(req.key);this.fetching.delete(req.key);} } // 실패 → 다음 프레임 재시도
    );
  }

  private drainBuilds(): void {
    const start = this.now();
    this.ready.sort((a,b)=>Number(this.shouldActivate(b.req.key))-Number(this.shouldActivate(a.req.key))||a.req.priority-b.req.priority);
    while (this.ready.length && this.now() - start < this.cfg.buildBudgetMs) {
      const item=this.ready[0],{req,raw}=item;
      if (this.built.has(req.key)){this.ready.shift();this.io.discardRaw?.(raw);continue;}
      const active=this.shouldActivate(req.key),before=this.now();
      let handle:unknown,done=true;
      if(this.io.buildIncremental){
        item.iterator??=this.io.buildIncremental(req,raw);
        const result=item.iterator.next();done=!!result.done;handle=result.value;
      }else handle=this.io.build(req,raw,active);
      if(done){this.ready.shift();this.built.set(req.key,handle);if(this.io.buildIncremental)this.io.setActive?.(handle,active);if(active)this.active.add(req.key);}
      const elapsed=Math.max(0,this.now()-before);this.lastBuildMs+=elapsed;this.maxBuildMs=Math.max(this.maxBuildMs,elapsed);
    }
  }

  private shouldActivate(key:string):boolean {
    if(this.cfg.activeRadius===undefined||!this.currentView)return true;
    const [lod,x,z]=key.split(':');if(lod!=='fine')return true;
    const size=this.cfg.fineSize,cx=Number(x)*size,cz=Number(z)*size,v=this.currentView;
    const distance=Math.hypot(Math.max(cx-v.x,0,v.x-cx-size),Math.max(cz-v.z,0,v.z-cz-size));
    return distance<=this.cfg.activeRadius+(this.active.has(key)?this.cfg.activeHysteresis??128:0);
  }
  get metrics(){return {active:this.active.size,prepared:this.built.size-this.active.size,cached:this.cache.size,pending:this.pendingCount,buildMs:this.lastBuildMs,maxBuildMs:this.maxBuildMs};}

  private toCache(key: string, handle: unknown): void {
    this.io.setActive?.(handle, false);
    this.cache.set(key, handle);
    while (this.cache.size > this.cfg.maxCached) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const h = this.cache.get(oldest);
      this.cache.delete(oldest);
      this.io.dispose(h);
    }
  }

  /** 현재 빌드 완료 청크 수(디버그/HUD용). */
  get loadedCount(): number {
    return this.built.size;
  }
  /** 처리 중(fetch + 빌드대기) 청크 수. */
  get pendingCount(): number {
    return this.fetching.size + this.ready.length;
  }

  /** 전체 해제(맵 전환/종료). */
  dispose(): void {
    this.disposed = true;
    this.wanted.clear();
    for (const h of this.built.values()) this.io.dispose(h);
    for (const h of this.cache.values()) this.io.dispose(h);
    this.built.clear();this.active.clear();
    this.cache.clear();
    for(const controller of this.controllers.values())controller.abort();this.controllers.clear();
    this.fetching.clear();
    for(const item of this.ready){item.iterator?.return(undefined);this.io.discardRaw?.(item.raw);}
    this.ready.length = 0;
  }
}
