// 스트리밍 전장 — 전지구 타일 월드(maps/<lat>/<lon>/) 를 플레이어 주변만 청크 단위로 로드/언로드.
// 모놀리식 World 의 대체 구현(GameWorld 동일 표면): JSON 1장 전체 대신 1024m 청크를 ChunkStreamer 로
// 스트리밍하고, heightAt/충돌은 로드된 청크 레지스트리에서 질의한다.
//
// 좌표계(부동 원점 단순화판): 셀-로컬 m(원점=셀 NW)을 그대로 쓰지 않고, 스폰 지점을 로컬 원점으로
// 잡아 플레이어를 0 근처에 유지(Float32 정밀도). 스트리밍 색인은 셀-로컬(= 로컬 + origin)로 환산해
// ChunkStreamer/파일 인덱스(cx,cz)와 일치시킨다.
import * as THREE from "three";
import type { GameWorld, MinimapSink } from "./GameWorld";
import type { SpawnPoint } from "./MapData";
import { CollisionWorld } from "./CollisionWorld";
import { SkyEnvironment } from "./SkyEnvironment";
import { cellLocalOf, CHUNK_BLOCK, type Cell, type TilesManifest, type WorldChunk } from "./chunkManifest";
import { fetchTiles, fetchWorldChunk } from "./mapLocator";
import { ChunkStreamer, chunkIndex, type ChunkIO, type ChunkReq, type ChunkConfig } from "./chunkStream";
import { buildChunkMesh, disposeChunkGroup, sampleChunkHeight, chunkTerrainEntry, type ChunkTerrain, type ChunkBuild } from "./chunkMesh";

const chunkKey = (cx: number, cz: number): string => `${cx}_${cz}`;

// 스트리밍 LOD — 1024m 청크만(세밀), 거친 타일 비활성(coarseRadius=0). 고도 무관 항상 세밀.
const STREAM_CFG = (fineSize: number): ChunkConfig => ({
  fineSize,
  coarseSize: fineSize * 4,
  fineRadius: 2600, // 로드 반경(m) — 포그(5km) 안. 셀 격자 ~25청크
  coarseRadius: 0, // 거친 타일 미사용(파일 없음)
  fineMaxAltitude: 1e9, // 고공에서도 세밀 유지
  prefetchLead: 1.5,
  hysteresis: 600,
  buildBudgetMs: 8, // 프레임당 동기 빌드 예산(무거운 도심 청크 1개는 1회 히치 허용)
  maxConcurrentFetch: 6,
  maxCached: 48,
});

/** ChunkStreamer 가 보관하는 청크 핸들 — 빌드 결과(없으면 group=null=존재X 청크). */
interface ChunkHandle {
  cx: number;
  cz: number;
  group: THREE.Group | null;
  hasObjects: boolean;
}

export class StreamingWorld implements GameWorld {
  readonly group = new THREE.Group();
  readonly spawn: SpawnPoint;
  readonly bounds = 1e7; // 사실상 무제한 배틀필드 — 스트리밍이 플레이어 주변만 로드(데이터 없는 곳은 평지 y=0). 멀티셀 전 단일셀 프레임에서 cx/cz 확장.

  private readonly cell: Cell;
  private readonly chunkSize: number;
  private readonly block: number; // 청크 블록 디렉터리 크기(경로 <bx>_<bz>/)
  private readonly originX: number; // 로컬 원점(셀-로컬 m)
  private readonly originZ: number;
  private readonly present: Set<string>; // 존재하는 청크(tiles.json) — fetch 404 회피
  private readonly streamer: ChunkStreamer;
  private readonly sky: SkyEnvironment;

  // 로드된 청크 레지스트리(질의 계층)
  private readonly terrainReg = new Map<string, ChunkTerrain>(); // heightAt
  private readonly objReg = new Map<string, { buildings: ChunkBuild["buildings"]; walls: ChunkBuild["walls"]; roads: ChunkBuild["roads"]; water: number[][] }>();
  private collision = new CollisionWorld();
  private collisionDirty = false;

  // 속도 추정(프리페치) — update 간 위치 델타
  private lastX = 0;
  private lastZ = 0;
  private lastT = 0;
  private vx = 0;
  private vz = 0;

  private constructor(scene: THREE.Scene, manifest: TilesManifest, lat: number, lon: number, yaw: number) {
    this.cell = manifest.cell;
    this.chunkSize = manifest.chunkSize;
    this.block = manifest.block ?? CHUNK_BLOCK;
    this.present = new Set(manifest.chunks.map((c) => chunkKey(c.cx, c.cz)));
    // 로컬 원점 = 스폰의 셀-로컬 좌표(셀 NW 기준 동/남 m). build-world 와 동일 격자(매니페스트 mLon).
    const o = cellLocalOf(lat, lon, this.cell, manifest.mLon);
    this.originX = o.x;
    this.originZ = o.z;
    this.spawn = { x: 0, z: 0, yaw };
    this.collision.finalize(); // 빈 충돌 세계(초기)

    this.streamer = new ChunkStreamer(this.makeIO(), STREAM_CFG(this.chunkSize));
    this.sky = new SkyEnvironment(scene, this.spawn);
    scene.add(this.group);
  }

  /**
   * 스트리밍 전장 생성 — tiles.json 로드 → 인스턴스 구성 → 스폰 주변 지형 프리로드(지표면 확보).
   * (lat,lon)=스폰 위경도, yaw=시작 방위.
   */
  static async create(scene: THREE.Scene, lat: number, lon: number, yaw = 0): Promise<StreamingWorld> {
    const cell: Cell = [Math.floor(lat), Math.floor(lon)];
    const manifest = await fetchTiles(cell);
    if (!manifest) throw new Error(`타일 매니페스트 없음: maps/${cell[0]}/${cell[1]}/tiles.json`);
    const w = new StreamingWorld(scene, manifest, lat, lon, yaw);
    await w.preloadSpawn();
    return w;
  }

  /** ChunkStreamer 주입 IO — fetch(존재 청크만)/build(메시화+등록)/dispose(해제+등록해제). */
  private makeIO(): ChunkIO {
    return {
      fetch: (req: ChunkReq) => {
        if (!this.present.has(chunkKey(req.cx, req.cz))) return Promise.resolve(null); // 미존재 → 네트워크 생략
        return fetchWorldChunk(this.cell, req.cx, req.cz, this.block);
      },
      build: (req: ChunkReq, raw: unknown): ChunkHandle => {
        if (!raw) return { cx: req.cx, cz: req.cz, group: null, hasObjects: false };
        const cb = buildChunkMesh(raw as WorldChunk, this.chunkSize, this.originX, this.originZ);
        const key = chunkKey(cb.cx, cb.cz);
        this.group.add(cb.group);
        if (cb.terrain) this.terrainReg.set(key, cb.terrain);
        const hasObjects = cb.buildings.length > 0 || cb.walls.length > 0 || cb.roads.length > 0 || cb.water.length > 0;
        if (hasObjects) {
          this.objReg.set(key, { buildings: cb.buildings, walls: cb.walls, roads: cb.roads, water: cb.water });
          if (cb.buildings.length > 0 || cb.walls.length > 0) this.collisionDirty = true; // 충돌체 변화 시만 재구축
        }
        return { cx: cb.cx, cz: cb.cz, group: cb.group, hasObjects };
      },
      dispose: (h: unknown) => {
        const handle = h as ChunkHandle;
        const key = chunkKey(handle.cx, handle.cz);
        if (handle.group) {
          this.group.remove(handle.group);
          disposeChunkGroup(handle.group);
        }
        this.terrainReg.delete(key);
        if (handle.hasObjects) {
          this.objReg.delete(key);
          this.collisionDirty = true;
        }
      },
    };
  }

  /** 스폰 3×3 청크의 지형을 미리 등록(메시는 스트리머가 채움) — 시작 지표면 확보. */
  private async preloadSpawn(): Promise<void> {
    const sCx = chunkIndex(this.originX, this.chunkSize);
    const sCz = chunkIndex(this.originZ, this.chunkSize);
    const jobs: Promise<void>[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = sCx + dx, cz = sCz + dz;
        if (!this.present.has(chunkKey(cx, cz))) continue;
        jobs.push(
          fetchWorldChunk(this.cell, cx, cz, this.block).then((chunk) => {
            const t = chunk && chunkTerrainEntry(chunk, this.chunkSize);
            if (t) this.terrainReg.set(chunkKey(cx, cz), t);
          })
        );
      }
    }
    await Promise.all(jobs);
  }

  // ─────────────────────────── GameWorld 표면 ───────────────────────────

  heightAt(x: number, z: number): number {
    const cellX = x + this.originX, cellZ = z + this.originZ;
    const cx = chunkIndex(cellX, this.chunkSize), cz = chunkIndex(cellZ, this.chunkSize);
    const t = this.terrainReg.get(chunkKey(cx, cz));
    return t ? sampleChunkHeight(t, cellX, cellZ) : 0;
  }

  topAt(x: number, z: number): number {
    return this.collision.topAt(x, z);
  }

  resolveCollision(x: number, z: number, radius: number, feetY: number): { x: number; z: number } {
    return this.collision.resolveCollision(x, z, radius, feetY);
  }

  queryMinimap(cx: number, cz: number, radius: number, sink: MinimapSink): void {
    for (const o of this.objReg.values()) {
      for (const w of o.water) {
        const m = w.length / 2;
        if (m < 3) continue;
        let mx = 0, mz = 0;
        for (let i = 0; i < m; i++) { mx += w[i * 2]; mz += w[i * 2 + 1]; }
        if (Math.hypot(mx / m - cx, mz / m - cz) > radius + 250) continue;
        sink.water(w);
      }
      for (const r of o.roads) {
        const q = r.p; // 연속 폴리라인 [x0,z0,x1,z1,...] — 인접 정점쌍이 한 세그먼트(step 2)
        for (let i = 0; i + 3 < q.length; i += 2) {
          const ax = q[i], az = q[i + 1], bx = q[i + 2], bz = q[i + 3];
          if (Math.hypot((ax + bx) / 2 - cx, (az + bz) / 2 - cz) > radius + 20) continue;
          sink.road(ax, az, bx, bz, r.w);
        }
      }
    }
    const minX = cx - radius, minZ = cz - radius, maxX = cx + radius, maxZ = cz + radius;
    this.collision.forEachBuildingNear(minX, minZ, maxX, maxZ, (c) => sink.building(c));
    this.collision.forEachTriNear(minX, minZ, maxX, maxZ, (ax, az, bx, bz, tx, tz) => sink.triangle(ax, az, bx, bz, tx, tz));
  }

  update(px: number, pz: number, py?: number): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (this.lastT) {
      const dt = Math.min(0.1, Math.max(0.008, (now - this.lastT) / 1000));
      this.vx = (px - this.lastX) / dt;
      this.vz = (pz - this.lastZ) / dt;
    }
    this.lastX = px; this.lastZ = pz; this.lastT = now;

    const altitude = py != null ? Math.max(0, py - this.heightAt(px, pz)) : 0;
    // 셀-로컬 색인으로 환산해 스트리머/파일 인덱스(cx,cz)와 일치
    this.streamer.update({ x: px + this.originX, z: pz + this.originZ, vx: this.vx, vz: this.vz, altitude });

    if (this.collisionDirty) {
      this.rebuildCollision();
      this.collisionDirty = false;
    }
    this.sky.update(px, pz);
  }

  /** 로드된 오브젝트 청크 전체에서 충돌 세계 재구축(청크 집합 변경 시에만). 건물 + 담장. */
  private rebuildCollision(): void {
    const c = new CollisionWorld();
    for (const o of this.objReg.values()) {
      for (const b of o.buildings) c.addFootprintBox(b.poly, 0.3, b.top);
      for (const w of o.walls) c.addWallBox(w.x0, w.x1, w.z0, w.z1, w.top); // 발이 윗면 이상이면 통과(넘기)
    }
    c.finalize();
    this.collision = c;
  }

  /** 디버그/HUD용 — 로드 완료 청크 수. */
  get loadedChunks(): number {
    return this.streamer.loadedCount;
  }

  /** 맵 전환/종료 — 청크·그룹 전체 해제. */
  dispose(): void {
    this.streamer.dispose();
    this.terrainReg.clear();
    this.objReg.clear();
  }
}
