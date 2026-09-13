import {ChunkPreparation} from './ChunkPreparation';
import {assembleChunk,discardPreparedChunk,type PreparedChunk} from './PreparedChunk';
import {ChunkCollisionWorld} from './ChunkCollisionWorld';
import {updateStreetDetail} from './StreetGeometry';
import {addPaintedSky} from './PaintedCityStyle';
import {cityAppearance,defaultAppearance} from './cities';
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
import { BuildingCombat } from "./BuildingCombat";
import { SkyEnvironment } from "./SkyEnvironment";
import { cellLocalOf, pickSpawnChunk, chunksOwnedBy, CHUNK_BLOCK, type Cell, type TilesManifest, type WorldChunk } from "./chunkManifest";
import { fetchCityTiles, manifestChunkAt, fetchWorldChunk } from "./mapLocator";
import { ChunkStreamer, chunkIndex, type ChunkIO, type ChunkReq, type ChunkConfig } from "./chunkStream";
import { buildChunkMesh, disposeChunkGroup, sampleChunkHeight, chunkTerrainEntry, forEachLandmarkNear, type ChunkTerrain, type ChunkBuild } from "./chunkMesh";

const chunkKey = (cx: number, cz: number): string => `${cx}_${cz}`;

// 스트리밍 LOD — 1024m 청크만(세밀), 거친 타일 비활성(coarseRadius=0). 고도 무관 항상 세밀.
const STREAM_CFG = (fineSize: number): ChunkConfig => ({
  fineSize,
  coarseSize: fineSize * 4,
  activeRadius: 2600,
  activeHysteresis: 128,
  fineRadius: 2600, // 로드 반경(m) — 포그(5km) 안. 셀 격자 ~25청크
  coarseRadius: 0, // 거친 타일 미사용(파일 없음)
  fineMaxAltitude: 1e9, // 고공에서도 세밀 유지
  prefetchLead: 1.5,
  hysteresis: 600,
  buildBudgetMs: 4, // Cooperative assembly; expensive geometry is prepared off-thread.
  maxConcurrentFetch: 6,
  maxCached: 4,
});

/** ChunkStreamer 가 보관하는 청크 핸들 — 빌드 결과(없으면 group=null=존재X 청크). */
interface ChunkHandle {
  cx: number;
  cz: number;
  group: THREE.Group | null;
  hasObjects: boolean;
  data?: ChunkBuild;
  active?: boolean;
  collision?:CollisionWorld;
  buildingMesh: THREE.Mesh | null; // 건물 전투 등록 해제용(언로드 시)
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
  private paintedSky?: THREE.Mesh;

  // 로드된 청크 레지스트리(질의 계층)
  private readonly terrainReg = new Map<string, ChunkTerrain>(); // heightAt
  private readonly objReg = new Map<string, { buildings: ChunkBuild["buildings"]; walls: ChunkBuild["walls"]; roads: ChunkBuild["roads"]; water: number[][] }>();
  private collision = new ChunkCollisionWorld();
  private collisionMs=0;
  private maxCollisionMs=0;
  private preparationMs=0;
  private activationMs=0;
  readonly buildings = new BuildingCombat(this.group); // 건물 체력/피격/파괴(잔해 더미 인스턴싱)

  // 속도 추정(프리페치) — update 간 위치 델타
  private lastX = 0;
  private lastZ = 0;
  private lastT = 0;
  private vx = 0;
  private vz = 0;

  private appearance = defaultAppearance;
  private readonly chunkPreparation = new ChunkPreparation();

  private constructor(scene: THREE.Scene, manifest: TilesManifest, lat: number, lon: number, _yaw: number, mapId?: string, exact=false) {
    this.appearance = cityAppearance(mapId);
    this.cell = manifest.cell;
    this.chunkSize = manifest.chunkSize;
    this.block = manifest.block ?? CHUNK_BLOCK;
    this.present = new Set(manifest.chunks.map((c) => chunkKey(c.cx, c.cz)));
    // 로컬 원점 = 시작 위치의 셀-로컬 좌표(셀 NW 기준 동/남 m). 플레이어는 항상 로컬 (0,0)에 두어
    // Float32 정밀도를 확보(부동 원점). **시작 위치는 매 게임 무작위** — 건물 있는 청크 중 하나를 골라
    // 그 중심을 원점으로 삼는다(맵마다 다른 곳에서 시작). 후보 없으면 카탈로그 좌표(lat/lon)로 폴백.
    // 셀 공유(오사카↔나라·홍콩↔선전) 대비 — **자기 도시 청크에서만** 고른다.
    // 이걸 빠뜨리면 파일은 멀쩡한데 "나라를 골랐는데 오사카에서 시작"한다.
    // 스트리밍 자체는 제한하지 않는다(옆 도시로 이어지는 지형은 정상) — 작전구역이 5km 로 묶는다.
    const sc = exact ? null : pickSpawnChunk(chunksOwnedBy(manifest.chunks, mapId), Math.random);
    if (sc) {
      this.originX = (sc.cx + 0.5) * this.chunkSize;
      this.originZ = (sc.cz + 0.5) * this.chunkSize;
    } else {
      const o = cellLocalOf(lat, lon, this.cell, manifest.mLon);
      this.originX = o.x;
      this.originZ = o.z;
    }
    this.spawn = { x: 0, z: 0, yaw: Math.random() * Math.PI * 2 }; // 시작 방위도 무작위(카탈로그 spawnYaw 대체)
    this.collision.finalize(); // 빈 충돌 세계(초기)
    this.buildings.attachCollision(this.collision);

    const streamConfig = STREAM_CFG(this.chunkSize);
    const viewFar = streamConfig.fineRadius;
    // Keep the visible horizon, but preload one extra tile ring for both game and viewers.
    streamConfig.fineRadius += this.chunkSize;
    this.streamer = new ChunkStreamer(this.makeIO(), streamConfig);
    // 추가 선로딩 영역은 기존 가시거리 바깥에 유지한다.
    this.sky = new SkyEnvironment(scene, this.spawn, viewFar,this.appearance.environment);
    if(this.appearance.renderStyle==='painted')this.paintedSky=addPaintedSky(scene);
    scene.userData.paintedCity=this.appearance.renderStyle==='painted';
    scene.add(this.group);
  }

  /**
   * 스트리밍 전장 생성 — tiles.json 로드 → 인스턴스 구성 → 스폰 주변 지형 프리로드(지표면 확보).
   * (lat,lon)=스폰 위경도, yaw=시작 방위, mapId=스트림 카탈로그 id(셀 공유 시 스폰 범위 한정).
   */
  static async create(scene: THREE.Scene, lat: number, lon: number, yaw = 0, mapId?: string, exact=false): Promise<StreamingWorld> {
    const manifest = await fetchCityTiles(lat,lon,mapId);
    if(exact){
      const p=manifestChunkAt(manifest,lat,lon);
      if(!manifest.chunks.some(c=>c.cx===p.cx&&c.cz===p.cz))
        throw new Error(`선택한 도시의 지도 범위 밖입니다: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    }
    const w = new StreamingWorld(scene, manifest, lat, lon, yaw, mapId, exact);
    try { await w.preloadSpawn(); } catch (error) { w.dispose(); throw error; }
    return w;
  }

  /** ChunkStreamer 주입 IO — fetch(존재 청크만)/build(메시화+등록)/dispose(해제+등록해제). */
  private makeIO(): ChunkIO {
    return {
      fetch: async (req: ChunkReq,signal) => {
        if (!this.present.has(chunkKey(req.cx, req.cz))) return null;
        if(ChunkPreparation.supported)return this.chunkPreparation.prepare(req.key,{baseUrl:new URL(import.meta.env.BASE_URL,location.href).href,cell:this.cell,cx:req.cx,cz:req.cz,block:this.block,size:this.chunkSize,ox:this.originX,oz:this.originZ,profile:this.appearance},signal);
        return fetchWorldChunk(this.cell,req.cx,req.cz,this.block);
      },
      prioritize:keys=>this.chunkPreparation.prioritize(keys),
      discardRaw:raw=>{if(raw&&'meshes' in (raw as object))discardPreparedChunk(raw as PreparedChunk);},
      build:()=>{throw new Error('StreamingWorld requires incremental assembly');},
      buildIncremental:(req,raw)=>this.assemble(req,raw),
      setActive: (h, active) => {
        const handle = h as ChunkHandle, cb = handle.data;
        if (!cb || handle.active === active) return;
        handle.active = active;
        const key = chunkKey(cb.cx, cb.cz),activationStart=performance.now();
        if (active) {
          this.group.add(cb.group);
          if (cb.terrain) this.terrainReg.set(key, cb.terrain);
          if (handle.hasObjects) this.objReg.set(key, cb);
        } else {
          cb.group.removeFromParent();
          this.terrainReg.delete(key);
          this.objReg.delete(key);
        }
        this.buildings.setChunkActive(cb.buildingMesh, key, active);
        const start=performance.now();
        if(active&&handle.collision){this.collision.setChunk(key,handle.collision);this.buildings.reopenDestroyed();}
        else this.collision.removeChunk(key);
        this.collisionMs+=performance.now()-start;this.maxCollisionMs=Math.max(this.maxCollisionMs,this.collisionMs);
        this.activationMs=Math.max(this.activationMs,performance.now()-activationStart);
      },
      dispose: (h: unknown) => {
        const handle = h as ChunkHandle;
        const key = chunkKey(handle.cx, handle.cz);
        if (handle.buildingMesh) this.buildings.unregisterMesh(handle.buildingMesh);
        this.buildings.unregisterSites(key); // site 는 메시가 없어 별도 해제(없으면 no-op)
        if (handle.group) {
          this.group.remove(handle.group);
          disposeChunkGroup(handle.group);
        }
        this.terrainReg.delete(key);
        if (handle.hasObjects && handle.active) {
          this.objReg.delete(key);
          this.collision.removeChunk(key);
        }
      },
    };
  }

  private *assemble(req:ChunkReq,raw:unknown):Generator<void,ChunkHandle> {
    if(!raw)return {cx:req.cx,cz:req.cz,group:null,hasObjects:false,buildingMesh:null};
    const packet='meshes' in (raw as object)?raw as PreparedChunk:undefined;
    if(packet)this.preparationMs=Math.max(this.preparationMs,packet.timings.geometry+packet.timings.streets+packet.timings.collision);
    const cb=packet?yield* assembleChunk(packet,this.originX,this.originZ,this.appearance):buildChunkMesh(raw as WorldChunk,this.chunkSize,this.originX,this.originZ,this.appearance);
    const key=chunkKey(cb.cx,cb.cz);
    const start=performance.now();
    const collision=packet?CollisionWorld.fromSnapshot(packet.collision):new CollisionWorld();
    if(!packet){for(const b of cb.buildings)collision.addFootprintBox(b.poly,.3,b.top);for(const w of cb.walls)collision.addWallBox(w.x0,w.x1,w.z0,w.z1,w.top);collision.finalize();}
    this.collisionMs+=performance.now()-start;this.maxCollisionMs=Math.max(this.maxCollisionMs,this.collisionMs);
    let finished=false;
    try {
      // Keep a partially registered tile out of combat queries until assembly is complete.
      for(let i=0;i<cb.buildings.length;i++){
        const b=cb.buildings[i];
        if(cb.buildingMesh)this.buildings.registerBuilding(cb.buildingMesh,b.vStart,b.vCount,b.poly,b.baseY,b.top,b.lm?{cls:b.lm,...(b.n?{name:b.n}:{})}:undefined,false);
        if(i%32===31)yield;
      }
      for(const st of cb.sites)this.buildings.registerSite(key,st.x,st.y,st.z,st.r,st.lm,st.n);
      this.buildings.setChunkActive(cb.buildingMesh,key,false);
      finished=true;return {cx:cb.cx,cz:cb.cz,group:cb.group,hasObjects:!!(cb.buildings.length||cb.walls.length||cb.roads.length||cb.water.length),buildingMesh:cb.buildingMesh,data:cb,active:false,collision};
    }finally{if(!finished){if(cb.buildingMesh)this.buildings.unregisterMesh(cb.buildingMesh);this.buildings.unregisterSites(key);disposeChunkGroup(cb.group);}}
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

  segmentHitsBuilding(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): number {
    return this.collision.segmentBlocked(sx, sy, sz, ex, ey, ez);
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
    // 랜드마크 덧그림 — 일반 건물 **뒤에** 그려야 위로 뜬다.
    for (const o of this.objReg.values()) forEachLandmarkNear(o.buildings, cx, cz, radius, (poly) => sink.landmark(poly));
  }

  update(px: number, pz: number, py?: number): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (this.lastT) {
      const dt = Math.max(0.008, (now - this.lastT) / 1000);
      this.vx = (px - this.lastX) / dt;
      this.vz = (pz - this.lastZ) / dt;
    }
    this.lastX = px; this.lastZ = pz; this.lastT = now;

    const altitude = py != null ? Math.max(0, py - this.heightAt(px, pz)) : 0;
    // 셀-로컬 색인으로 환산해 스트리머/파일 인덱스(cx,cz)와 일치
    this.collisionMs=0;
    this.streamer.update({ x: px + this.originX, z: pz + this.originZ, vx: this.vx, vz: this.vz, altitude });

    for (const child of this.group.children) if (child instanceof THREE.Group) updateStreetDetail(child, px, pz);
    this.sky.update(px, pz);
  }

  get performanceMetrics(){return {...this.streamer.metrics,collisionMs:this.collisionMs,maxCollisionMs:this.maxCollisionMs,preparationMs:this.preparationMs,activationMs:this.activationMs};}

  /** 디버그/HUD용 — 로드 완료 청크 수. */
  get loadedChunks(): number {
    return this.streamer.loadedCount;
  }

  geoPosition(x:number,z:number){return {lat:this.cell[0]+1-(z+this.originZ)/111320,lon:this.cell[1]+(x+this.originX)/(111320*Math.cos((this.cell[0]+.5)*Math.PI/180))};}
  /** 맵 전환/종료 — 청크·그룹 전체 해제. */
  dispose(): void {
    this.chunkPreparation.dispose();
    this.streamer.dispose();
    if(this.paintedSky){this.paintedSky.removeFromParent();this.paintedSky.geometry.dispose();(this.paintedSky.material as THREE.Material).dispose();}
    this.terrainReg.clear();
    this.objReg.clear();
    this.group.removeFromParent();
  }
}
