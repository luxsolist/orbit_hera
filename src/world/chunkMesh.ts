// 타일 월드 청크(WorldChunk, 셀-로컬 m) → THREE 메시 + 충돌/높이 등록 데이터.
// StreamingWorld 의 ChunkIO.build 가 호출하는 동기 메시화 단계(시간예산 빌드 큐 안에서 실행).
//
// 좌표: 청크 데이터는 셀-로컬 미터(원점 = 셀 NW). 렌더는 로컬 프레임(= 셀-로컬 − origin)으로 옮겨
// 플레이어를 원점 근처에 두고 Float32 정밀도를 확보한다(부동 원점 단순화판).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { setUniformColor, elevationColor, GROUND_GREEN, SAND_TAN } from "./geo";
import { buildingBaseColor } from "./precinct";
import type { WorldChunk } from "./chunkManifest";

/** 청크 지형 격자(heightAt 바이리니어용) — 좌표·높이는 셀-로컬(샘플 시 origin 보정). */
export interface ChunkTerrain {
  size: number;
  step: number;
  cellX0: number;
  cellZ0: number;
  heights: Float32Array;
}

/** 한 청크의 빌드 결과 — 씬 그룹 + 충돌/높이/미니맵 질의용 데이터(로컬 좌표). */
export interface ChunkBuild {
  cx: number;
  cz: number;
  group: THREE.Group;
  /** 지형 격자. 없으면(평지/미존재) null. */
  terrain: ChunkTerrain | null;
  /**
   * 건물 footprint(로컬 폴리 [x0,z0,...]) + 옥상 높이(top) — CollisionWorld 재구축용.
   * + 병합 메시 내 정점 범위(vStart/vCount) + base(바닥 y) — BuildingCombat 개별 갱신 바인딩.
   */
  buildings: { poly: number[]; top: number; vStart: number; vCount: number; baseY: number }[];
  /** 건물 병합 메시(정점 색·위치 부분 갱신 대상) — 건물 없으면 null. */
  buildingMesh: THREE.Mesh | null;
  /** 담장/울타리 충돌 박스(로컬 AABB + 윗면 top) — CollisionWorld.addWallBox 용. */
  walls: { x0: number; x1: number; z0: number; z1: number; top: number }[];
  /** 도로 세그먼트(로컬) — 미니맵용. */
  roads: { p: number[]; w: number }[];
  /** 수역 폴리(로컬) — 미니맵용. */
  water: number[][];
}

// 지형은 청크 전용 베이크 텍스처(map)를 쓴다(아래 bakeSurfaceTexture). terrainMat 은 텍스처 실패 시 폴백(고도 vertexColors).
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
const cityMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.05 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x9c948a, flatShading: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });

/**
 * 지표 면 종류 → 단일 2색 매핑(areaKind 와 짝): 초록 식생(공원/잔디/숲 등)은 바닥 초록, 비초록(사막/해변/바위/포장)은 황토색.
 * 바닥 초록과 동일 색이라 식생 면은 지형과 매끄럽게 이어진다(텍스처 베이크 시 비초록만 페인트).
 */
const AREA_COLOR: Record<string, number> = {
  park: GROUND_GREEN, garden: GROUND_GREEN, grass: GROUND_GREEN, pitch: GROUND_GREEN, wood: GROUND_GREEN, scrub: GROUND_GREEN,
  sand: SAND_TAN, rock: SAND_TAN, pavement: SAND_TAN,
};

// ── 지형 표면 베이크 텍스처 ── 도로/물/면을 별도 지오메트리로 띄우지 않고 지형 표면색으로 구워(=표면이 곧 색)
// 굴곡과 무관하게 완벽 밀착(z-fighting·뚫림·부유 제거). 페인트 순서 = 기존 레이어 순서(면<물<도로<중앙선).
const ROAD_CSS = "#44484f";   // 아스팔트
const CENTER_CSS = "#cdb24a"; // 중앙선(연 노랑)
const WATER_CSS = "#1f8cf0";  // 수역(평면 색)
const SAND_CSS = "#d8c89e";   // 비초록 지표(SAND_TAN)
const TEX_PER_M = 1;          // 텍스처 해상도(px/m)
const MAX_TEX = 1024;         // 청크 텍스처 한 변 최대 px(메모리 상한)
// 차선은 **간선도로만**(폭≥LANE_MIN_W m). OSM 은 한 도로를 방향·램프별 여러 평행 way 로 쪼개므로,
// 모든 way 에 차선을 그으면 주거로·서비스로·*_link 램프까지 노란 선 다발이 됨. 16=secondary↑(motorway/trunk/primary/secondary)만.
const LANE_MIN_W = 16;

/**
 * 청크 지형 표면 텍스처를 캔버스에 굽는다 — 고도색 베이스(tn×tn ImageData 업스케일) 위에
 * 면(비초록)·수역·도로·중앙선을 평면 페인트. 셀-로컬 [x,z,...] → 캔버스 px(원점=셀 NW, +X=동/+Z=남).
 * 반환 텍스처는 청크 전용(언로드 시 dispose). document 없거나 ctx 실패면 null(폴백 vertexColors).
 */
function bakeSurfaceTexture(chunk: WorldChunk, t: ChunkTerrain): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const { size: tn, cellX0, cellZ0, step } = t;
  const chunkSize = step * (tn - 1);
  const texSize = Math.min(MAX_TEX, Math.max(256, Math.round(chunkSize * TEX_PER_M)));
  const canvas = document.createElement("canvas");
  canvas.width = texSize; canvas.height = texSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // 1) 고도색 베이스 — tn×tn ImageData 를 작은 캔버스에 그려 전체로 부드럽게 업스케일.
  const small = document.createElement("canvas");
  small.width = tn; small.height = tn;
  const sctx = small.getContext("2d");
  if (!sctx) return null;
  const img = sctx.createImageData(tn, tn);
  const col = new THREE.Color();
  for (let k = 0; k < tn * tn; k++) {
    elevationColor(t.heights[k], col);
    const o = k * 4;
    img.data[o] = col.r * 255; img.data[o + 1] = col.g * 255; img.data[o + 2] = col.b * 255; img.data[o + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, tn, tn, 0, 0, texSize, texSize);

  // 셀-로컬 좌표 → 캔버스 px(베이스 격자와 동일 매핑: vertex i,j ↔ px i/(tn-1), j/(tn-1)).
  const sc = texSize / chunkSize;
  const px = (cellX: number) => (cellX - cellX0) * sc;
  const py = (cellZ: number) => (cellZ - cellZ0) * sc;
  const trace = (p: number[], close: boolean) => {
    const n = p.length / 2;
    ctx.beginPath();
    ctx.moveTo(px(p[0]), py(p[1]));
    for (let i = 1; i < n; i++) ctx.lineTo(px(p[i * 2]), py(p[i * 2 + 1]));
    if (close) ctx.closePath();
  };
  ctx.lineCap = "round"; ctx.lineJoin = "round";

  // 2) 면 — 비초록(사막/해변/바위/포장)만(식생은 베이스 초록과 동일).
  ctx.fillStyle = SAND_CSS;
  for (const a of chunk.objects?.areas ?? []) {
    if (a.p.length / 2 < 3 || AREA_COLOR[a.k] !== SAND_TAN) continue;
    trace(a.p, true); ctx.fill();
  }
  // 3) 수역 — 면(연못/호수)은 구멍(섬·제방) 도려내며 채움(even-odd), 강/하천(w)은 폭 리본 stroke.
  ctx.fillStyle = WATER_CSS; ctx.strokeStyle = WATER_CSS;
  for (const w of chunk.objects?.water ?? []) {
    const n = w.p.length / 2;
    if (n < 2) continue;
    if (w.w != null) { trace(w.p, false); ctx.lineWidth = Math.max(1, w.w * sc); ctx.stroke(); continue; }
    if (n < 3) continue;
    ctx.beginPath();
    ctx.moveTo(px(w.p[0]), py(w.p[1]));
    for (let i = 1; i < n; i++) ctx.lineTo(px(w.p[i * 2]), py(w.p[i * 2 + 1]));
    ctx.closePath();
    for (const h of (w as { holes?: number[][] }).holes ?? []) { // 구멍=육지 → even-odd 로 물에서 제외
      const hn = h.length / 2;
      if (hn < 3) continue;
      ctx.moveTo(px(h[0]), py(h[1]));
      for (let i = 1; i < hn; i++) ctx.lineTo(px(h[i * 2]), py(h[i * 2 + 1]));
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  // 4) 도로(아스팔트).
  ctx.strokeStyle = ROAD_CSS;
  for (const r of chunk.objects?.roads ?? []) {
    if (r.p.length / 2 < 2) continue;
    trace(r.p, false); ctx.lineWidth = Math.max(1, (r.w ?? 6) * sc); ctx.stroke();
  }
  // 5) 차선(노랑) — 간선도로(폭≥LANE_MIN_W)만 가운데 1줄(가늘게). 그 미만(램프·주거로·서비스로)은 생략.
  ctx.strokeStyle = CENTER_CSS;
  ctx.lineWidth = Math.max(0.5, 0.2 * sc);
  for (const r of chunk.objects?.roads ?? []) {
    if ((r.w ?? 6) < LANE_MIN_W || r.p.length / 2 < 2) continue;
    trace(r.p, false); ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;        // UV v=j/(tn-1) 와 직접 매핑(상단 행=북쪽).
  tex.anisotropy = 4;       // 그레이징 앵글 선명도.
  tex.needsUpdate = true;
  return tex;
}

/** 청크 → 지형 격자 등록 엔트리(평지/미존재면 null). 메시 빌드·스폰 프리로드 공용. 순수. */
export function chunkTerrainEntry(chunk: WorldChunk, chunkSize: number): ChunkTerrain | null {
  const tn = chunk.terrain?.size ?? 0;
  if (tn < 2 || chunk.terrain.heights.length < tn * tn) return null;
  return {
    size: tn,
    step: chunkSize / (tn - 1),
    cellX0: chunk.cx * chunkSize,
    cellZ0: chunk.cz * chunkSize,
    heights: chunk.terrain.heights instanceof Float32Array ? chunk.terrain.heights : new Float32Array(chunk.terrain.heights),
  };
}

/**
 * 청크-로컬 격자 표고(셀-로컬 입력). 격자 밖은 클램프. null 격자 = 0. 순수.
 * **지형 메시 삼각분할(a,c,b)+(b,c,d)과 동일하게 보간** — bilinear 가 아니라 렌더되는 삼각형 평면값을
 * 반환해, 이 높이로 드레이프한 도로/면이 지형 메시 위로 정확히 떠 지형(초록)이 솟지 않게 한다.
 */
export function sampleChunkHeight(t: ChunkTerrain | null, cellX: number, cellZ: number): number {
  if (!t) return 0;
  const s = t.size, h = t.heights;
  const gx = Math.min(s - 1, Math.max(0, (cellX - t.cellX0) / t.step));
  const gz = Math.min(s - 1, Math.max(0, (cellZ - t.cellZ0) / t.step));
  const i = Math.min(Math.floor(gx), s - 2), j = Math.min(Math.floor(gz), s - 2);
  const fx = gx - i, fz = gz - j;
  const ha = h[j * s + i], hb = h[j * s + i + 1], hc = h[(j + 1) * s + i], hd = h[(j + 1) * s + i + 1];
  // 셀을 b-c 대각(fx+fz=1)으로 분할: (a,b,c) 하측 / (b,c,d) 상측
  return fx + fz <= 1 ? ha + (hb - ha) * fx + (hc - ha) * fz : hd + (hb - hd) * (1 - fz) + (hc - hd) * (1 - fx);
}

/** 셀-로컬 폴리 [x,z,...] → 로컬 프레임(− origin) 새 배열. */
function localize(p: number[], originX: number, originZ: number): number[] {
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) { out[i] = p[i] - originX; out[i + 1] = p[i + 1] - originZ; }
  return out;
}

/** 지오메트리 배열을 병합(입력 해제)해 그룹에 메시로 추가 후 메시 반환. 비었으면 null. cast=그림자 투사. */
function addMerged(group: THREE.Group, geos: THREE.BufferGeometry[], mat: THREE.Material, cast: boolean): THREE.Mesh | null {
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, mat);
  if (cast) mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/**
 * 청크 → 메시 + 등록 데이터. chunkSize=청크변(m), originX/Z=로컬 원점(셀-로컬 m).
 * 지형(격자 색칠) + 건물(압출·표고 위 안착·병합) + 도로 리본 + 수역 면. 전부 로컬 좌표.
 */
export function buildChunkMesh(chunk: WorldChunk, chunkSize: number, originX: number, originZ: number): ChunkBuild {
  const group = new THREE.Group();
  group.name = `chunk:${chunk.cx}:${chunk.cz}`;

  // ── 지형 격자 ── 표면 텍스처(도로/물/면 베이크)를 UV 매핑. 텍스처 실패 시 고도 vertexColors 폴백.
  const terrain = chunkTerrainEntry(chunk, chunkSize);
  if (terrain) {
    const { size: tn, step, cellX0, cellZ0, heights } = terrain;
    const positions: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const col = new THREE.Color();
    for (let j = 0; j < tn; j++) {
      for (let i = 0; i < tn; i++) {
        const y = heights[j * tn + i];
        positions.push(cellX0 + i * step - originX, y, cellZ0 + j * step - originZ);
        elevationColor(y, col); // 폴백용 vertexColors(텍스처 있으면 무시됨)
        colors.push(col.r, col.g, col.b);
        uvs.push(i / (tn - 1), j / (tn - 1)); // u=동(+X), v=남(+Z) — flipY=false 라 텍스처 상단 행=북.
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < tn - 1; j++) {
      for (let i = 0; i < tn - 1; i++) {
        const a = j * tn + i, b = a + 1, c = a + tn, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tex = bakeSurfaceTexture(chunk, terrain);
    // 텍스처 성공 → 청크 전용 머티리얼(언로드 시 dispose). 실패 → 공유 폴백(고도 vertexColors).
    const mat = tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 }) : terrainMat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ── 건물(압출 → 표고 위 안착 → 병합) ──
  const buildings: ChunkBuild["buildings"] = [];
  const bGeos: THREE.BufferGeometry[] = [];
  const bcol = new THREE.Color();
  let bVtx = 0; // 병합 누적 정점 수 — 건물별 정점 범위(병합은 입력 순서 보존) 추적
  for (const b of chunk.objects?.buildings ?? []) {
    const p = b.p;
    const n = p.length / 2;
    if (n < 3) continue;
    const h = b.h ?? 9;
    const local = localize(p, originX, originZ);
    let cxs = 0, czs = 0;
    for (let i = 0; i < n; i++) { cxs += p[i * 2]; czs += p[i * 2 + 1]; }
    // 경사 대응: footprint 각 꼭짓점의 지표면을 샘플해 최저점까지 base 를 내려 틈을 메운다.
    // 옥상(top)은 중심 지표면 + 높이 기준(건물끼리 처마선 일관). depth = top − base.
    const groundY = sampleChunkHeight(terrain, cxs / n, czs / n);
    let minGround = groundY;
    for (let i = 0; i < n; i++) {
      const g = sampleChunkHeight(terrain, p[i * 2], p[i * 2 + 1]);
      if (g < minGround) minGround = g;
    }
    const baseY = minGround - 0.6; // 최저 지표 아래 0.6m 스커트(완전 밀착)
    const top = groundY + h;
    const depth = top - baseY;

    const shape = new THREE.Shape();
    shape.moveTo(local[0], -local[1]);
    for (let i = 1; i < n; i++) shape.lineTo(local[i * 2], -local[i * 2 + 1]);
    shape.closePath();
    let geo: THREE.ExtrudeGeometry;
    try {
      geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
    } catch {
      continue;
    }
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, baseY, 0);
    const jitter = ((Math.abs(Math.round(cxs / n * 7 + czs / n * 13)) % 100) / 100) || 0.5;
    bcol.setHex(buildingBaseColor(h, null)).offsetHSL(0, 0, (jitter - 0.5) * 0.12);
    setUniformColor(geo, bcol);
    geo.deleteAttribute("uv");
    const vCount = geo.getAttribute("position").count;
    bGeos.push(geo);
    buildings.push({ poly: local, top, vStart: bVtx, vCount, baseY });
    bVtx += vCount;
  }
  const buildingMesh = addMerged(group, bGeos, cityMat, true);

  // ── 도로 — 지형 표면 텍스처에 베이크됨(bakeSurfaceTexture). 여기선 미니맵용 폴리라인만 수집. ──
  const roads: ChunkBuild["roads"] = [];
  for (const r of chunk.objects?.roads ?? []) {
    if (r.p.length / 2 < 2) continue;
    roads.push({ p: localize(r.p, originX, originZ), w: r.w ?? 6 });
  }

  // ── 담장/울타리 — 건물처럼 바닥까지 채우고(아래로 스커트) 윗면은 지형+높이로 스무딩한 연속 수직 리본. ──
  const walls: ChunkBuild["walls"] = [];
  const wallVerts: number[] = [];
  for (const wl of chunk.objects?.walls ?? []) {
    const p = wl.p;
    const n = p.length / 2;
    if (n < 2) continue;
    const wh = wl.h ?? 2.5;
    const half = (wl.w ?? 0.4) / 2;
    // 폴리라인 ≤12m 리샘플 + 정점별 지형 드레이프(윗면 부드럽게). baseY = 구간 최저 지표 − 스커트(바닥 채움).
    const lx: number[] = [], lz: number[] = [], topY: number[] = [];
    let minG = Infinity;
    const add = (cellX: number, cellZ: number) => { const g = sampleChunkHeight(terrain, cellX, cellZ); if (g < minG) minG = g; lx.push(cellX - originX); lz.push(cellZ - originZ); topY.push(g + wh); };
    add(p[0], p[1]);
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[(i + 1) * 2], bz = p[(i + 1) * 2 + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 12));
      for (let s = 1; s <= steps; s++) { const t = s / steps; add(ax + (bx - ax) * t, az + (bz - az) * t); }
    }
    const baseY = minG - 0.5;
    for (let i = 0; i < lx.length - 1; i++) { // 수직 리본(양면 머티리얼) — base→top
      wallVerts.push(lx[i], baseY, lz[i], lx[i + 1], baseY, lz[i + 1], lx[i], topY[i], lz[i]);
      wallVerts.push(lx[i], topY[i], lz[i], lx[i + 1], baseY, lz[i + 1], lx[i + 1], topY[i + 1], lz[i + 1]);
    }
    // 충돌 AABB(원본 세그먼트별), 윗면 = 양 끝 지표 최대 + 높이(넘기 판정)
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 2] - originX, az = p[i * 2 + 1] - originZ, bx = p[(i + 1) * 2] - originX, bz = p[(i + 1) * 2 + 1] - originZ;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, px = -uz * half, pz = ux * half;
      const top = Math.max(sampleChunkHeight(terrain, p[i * 2], p[i * 2 + 1]), sampleChunkHeight(terrain, p[(i + 1) * 2], p[(i + 1) * 2 + 1])) + wh;
      walls.push({
        x0: Math.min(ax + px, ax - px, bx + px, bx - px), x1: Math.max(ax + px, ax - px, bx + px, bx - px),
        z0: Math.min(az + pz, az - pz, bz + pz, bz - pz), z1: Math.max(az + pz, az - pz, bz + pz, bz - pz),
        top,
      });
    }
  }
  if (wallVerts.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(wallVerts, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, wallMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ── 수역 — 지형 표면 텍스처에 베이크됨. 여기선 미니맵용 면(연못/호수) 폴리곤만 수집(강 리본은 미니맵 제외, 기존과 동일). ──
  const water: number[][] = [];
  for (const wpoly of chunk.objects?.water ?? []) {
    if (wpoly.w != null || wpoly.p.length / 2 < 3) continue;
    water.push(localize(wpoly.p, originX, originZ));
  }

  return { cx: chunk.cx, cz: chunk.cz, group, terrain, buildings, buildingMesh, walls, roads, water };
}

/**
 * 청크 그룹 해제 — 지오메트리 전부, 그리고 지형의 청크 전용 텍스처/머티리얼(map 보유)만 dispose.
 * 공유 머티리얼(cityMat/wallMat/terrainMat 폴백)은 map 이 없어 건드리지 않는다.
 */
export function disposeChunkGroup(group: THREE.Group): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (mat && mat.map) { mat.map.dispose(); mat.dispose(); }
  });
}
