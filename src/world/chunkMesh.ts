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
  /** 건물 footprint(로컬 폴리 [x0,z0,...]) + 옥상 높이(top) — CollisionWorld 재구축용. */
  buildings: { poly: number[]; top: number }[];
  /** 담장/울타리 충돌 박스(로컬 AABB + 윗면 top) — CollisionWorld.addWallBox 용. */
  walls: { x0: number; x1: number; z0: number; z1: number; top: number }[];
  /** 도로 세그먼트(로컬) — 미니맵용. */
  roads: { p: number[]; w: number }[];
  /** 수역 폴리(로컬) — 미니맵용. */
  water: number[][];
}

const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
const cityMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.05 });
const roadMat = new THREE.MeshStandardMaterial({ color: 0x44484f, roughness: 1, metalness: 0, side: THREE.DoubleSide });
const centerMat = new THREE.MeshStandardMaterial({ color: 0xcdb24a, roughness: 1, metalness: 0, side: THREE.DoubleSide }); // 중앙선(연한 무광 노랑)
const waterMat = new THREE.MeshStandardMaterial({ color: 0x1f8cf0, transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.4 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x9c948a, flatShading: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
const areaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });

/**
 * 지표 레이어 높이 오프셋(m) — **강제 순서**: 지형(0) < 면 < 수역 < 보도 < 차도 < 중앙선 < 건물/벽(압출).
 * 면은 지형에 세분-드레이프되어 떠오르지 않고, 도로가 항상 그 위를 덮는다(녹색이 도로를 덮는 문제 방지).
 */
export const LAYER_Y = { area: 0.05, water: 0.12, path: 0.22, road: 0.5, centerAdd: 0.12 };

/**
 * 지표 면 종류 → 단일 2색 매핑(areaKind 와 짝): 초록 식생(공원/잔디/숲 등)은 바닥 초록, 비초록(사막/해변/바위/포장)은 황토색.
 * 바닥 초록과 동일 색이라 식생 면은 지형과 매끄럽게 이어진다.
 */
const AREA_COLOR: Record<string, number> = {
  park: GROUND_GREEN, garden: GROUND_GREEN, grass: GROUND_GREEN, pitch: GROUND_GREEN, wood: GROUND_GREEN, scrub: GROUND_GREEN,
  sand: SAND_TAN, rock: SAND_TAN, pavement: SAND_TAN,
};

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

/**
 * 폴리라인(로컬 pts [x,z,...])을 따라 반폭 half 의 **마이터 조인트 연속 리본**을 verts 에 추가.
 * 각 정점에서 인접 세그먼트 법선의 이등분(miter)으로 오프셋(겹침/틈 없음, 급커브는 4·half 클램프).
 * 높이는 **양 가장자리 정점 위치에서 yAt(x,z) 로 샘플** → 폭 방향으로도 지형에 밀착(교차 경사에서 가장자리로 지형이 솟지 않음).
 */
/** 폴리라인 끝점(endIdx)을 이웃(towardIdx)에서 바깥 방향으로 ext m 연장(in-place) — 조각 간 겹침/연결용. */
function extendEnd(pts: number[], endIdx: number, towardIdx: number, ext: number): void {
  const ex = pts[endIdx * 2], ez = pts[endIdx * 2 + 1];
  let dx = ex - pts[towardIdx * 2], dz = ez - pts[towardIdx * 2 + 1];
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  pts[endIdx * 2] = ex + dx * ext; pts[endIdx * 2 + 1] = ez + dz * ext;
}

function pushRibbon(verts: number[], pts: number[], half: number, yAt: (x: number, z: number) => number): void {
  const n = pts.length / 2;
  if (n < 2) return;
  const nnx: number[] = [], nnz: number[] = []; // 세그먼트 단위 법선
  for (let i = 0; i < n - 1; i++) {
    let dx = pts[(i + 1) * 2] - pts[i * 2], dz = pts[(i + 1) * 2 + 1] - pts[i * 2 + 1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    nnx.push(-dz); nnz.push(dx);
  }
  const ox: number[] = [], oz: number[] = []; // 정점 오프셋(법선·miter 길이)
  for (let i = 0; i < n; i++) {
    let mx: number, mz: number, len: number;
    if (i === 0) { mx = nnx[0]; mz = nnz[0]; len = half; }
    else if (i === n - 1) { mx = nnx[n - 2]; mz = nnz[n - 2]; len = half; }
    else {
      let sx = nnx[i - 1] + nnx[i], sz = nnz[i - 1] + nnz[i];
      const sl = Math.hypot(sx, sz);
      if (sl < 1e-3) { mx = nnx[i]; mz = nnz[i]; len = half; } // 헤어핀 — 단순 버트
      else { sx /= sl; sz /= sl; mx = sx; mz = sz; len = Math.min(half * 4, half / Math.max(0.25, sx * nnx[i] + sz * nnz[i])); }
    }
    ox.push(mx * len); oz.push(mz * len);
  }
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[(i + 1) * 2], bz = pts[(i + 1) * 2 + 1];
    // 4 모서리(양끝 × 좌우 가장자리)를 각 위치의 지형 높이로 드레이프
    const aLx = ax + ox[i], aLz = az + oz[i], aRx = ax - ox[i], aRz = az - oz[i];
    const bLx = bx + ox[i + 1], bLz = bz + oz[i + 1], bRx = bx - ox[i + 1], bRz = bz - oz[i + 1];
    const yAL = yAt(aLx, aLz), yAR = yAt(aRx, aRz), yBL = yAt(bLx, bLz), yBR = yAt(bRx, bRz);
    verts.push(aLx, yAL, aLz, bLx, yBL, bLz, aRx, yAR, aRz);
    verts.push(aRx, yAR, aRz, bLx, yBL, bLz, bRx, yBR, bRz);
  }
}

/**
 * 면 폴리곤(로컬 [x,z,...])을 삼각분할 후 **긴 모서리를 maxEdge 이하로 세분**하고 각 정점을 지형에 드레이프.
 * 경계 정점만 드레이프하던 기존 방식은 큰 삼각형이 지형 위로 떠올라 도로를 덮었음 → 내부 세분으로 지형 밀착.
 * 반환: position+index BufferGeometry(색은 호출측). 퇴화/실패면 null.
 */
function buildDrapedArea(local: number[], t: ChunkTerrain | null, originX: number, originZ: number, yOff: number, maxEdge = 16): THREE.BufferGeometry | null {
  const n = local.length / 2;
  if (n < 3) return null;
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(local[i * 2], local[i * 2 + 1]));
  let faces: number[][];
  try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch { return null; }
  if (!faces.length) return null;
  const vx: number[] = [], vz: number[] = [];
  for (const c of contour) { vx.push(c.x); vz.push(c.y); }
  let idx: number[] = [];
  for (const f of faces) idx.push(f[0], f[1], f[2]);
  const elen = (a: number, b: number) => Math.hypot(vx[a] - vx[b], vz[a] - vz[b]);
  for (let pass = 0; pass < 5; pass++) {
    let changed = false; const out: number[] = []; const mid = new Map<number, number>();
    const gm = (a: number, b: number) => {
      const k = a < b ? a * 1e6 + b : b * 1e6 + a; let m = mid.get(k);
      if (m === undefined) { m = vx.length; vx.push((vx[a] + vx[b]) / 2); vz.push((vz[a] + vz[b]) / 2); mid.set(k, m); }
      return m;
    };
    for (let tri = 0; tri < idx.length; tri += 3) {
      const a = idx[tri], b = idx[tri + 1], c = idx[tri + 2];
      if (Math.max(elen(a, b), elen(b, c), elen(c, a)) <= maxEdge) { out.push(a, b, c); continue; }
      changed = true; const ab = gm(a, b), bc = gm(b, c), ca = gm(c, a);
      out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    idx = out; if (!changed) break;
  }
  const pos = new Float32Array(vx.length * 3);
  for (let i = 0; i < vx.length; i++) {
    pos[i * 3] = vx[i];
    pos[i * 3 + 1] = sampleChunkHeight(t, vx[i] + originX, vz[i] + originZ) + yOff; // 지형 밀착
    pos[i * 3 + 2] = vz[i];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 셀-로컬 폴리 [x,z,...] → 로컬 프레임(− origin) 새 배열. */
function localize(p: number[], originX: number, originZ: number): number[] {
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) { out[i] = p[i] - originX; out[i + 1] = p[i + 1] - originZ; }
  return out;
}

/** 지오메트리 배열을 병합(입력 해제)해 그룹에 메시로 추가. 비었으면 무시. cast=그림자 투사. */
function addMerged(group: THREE.Group, geos: THREE.BufferGeometry[], mat: THREE.Material, cast: boolean): void {
  if (!geos.length) return;
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, mat);
  if (cast) mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/**
 * 청크 → 메시 + 등록 데이터. chunkSize=청크변(m), originX/Z=로컬 원점(셀-로컬 m).
 * 지형(격자 색칠) + 건물(압출·표고 위 안착·병합) + 도로 리본 + 수역 면. 전부 로컬 좌표.
 */
export function buildChunkMesh(chunk: WorldChunk, chunkSize: number, originX: number, originZ: number): ChunkBuild {
  const group = new THREE.Group();
  group.name = `chunk:${chunk.cx}:${chunk.cz}`;

  // ── 지형 격자 ──
  const terrain = chunkTerrainEntry(chunk, chunkSize);
  if (terrain) {
    const { size: tn, step, cellX0, cellZ0, heights } = terrain;
    const positions: number[] = [];
    const colors: number[] = [];
    const col = new THREE.Color();
    for (let j = 0; j < tn; j++) {
      for (let i = 0; i < tn; i++) {
        const y = heights[j * tn + i];
        positions.push(cellX0 + i * step - originX, y, cellZ0 + j * step - originZ);
        elevationColor(y, col);
        colors.push(col.r, col.g, col.b);
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
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ── 지표 면 — **비초록(사막/해변/바위/포장)만** 렌더. 식생(초록)은 지형과 동일 색이라 생략(겹침 z-fighting 제거). ──
  const aGeos: THREE.BufferGeometry[] = [];
  const acol = new THREE.Color();
  for (const a of chunk.objects?.areas ?? []) {
    if (a.p.length / 2 < 3 || AREA_COLOR[a.k] !== SAND_TAN) continue; // 초록 식생은 스킵
    const g = buildDrapedArea(localize(a.p, originX, originZ), terrain, originX, originZ, LAYER_Y.area); // 세분-드레이프(지형 밀착, 도로 아래)
    if (!g) continue;
    setUniformColor(g, acol.setHex(SAND_TAN));
    aGeos.push(g);
  }
  addMerged(group, aGeos, areaMat, false);

  // ── 건물(압출 → 표고 위 안착 → 병합) ──
  const buildings: ChunkBuild["buildings"] = [];
  const bGeos: THREE.BufferGeometry[] = [];
  const bcol = new THREE.Color();
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
    bGeos.push(geo);
    buildings.push({ poly: local, top });
  }
  addMerged(group, bGeos, cityMat, true);

  // ── 도로 리본(차도, 표고 밀착) — 마이터 연속 리본 + 중앙선. 폴리라인을 짧게 리샘플해 지형 삐져나옴 방지. ──
  const roads: ChunkBuild["roads"] = [];
  const roadVerts: number[] = [];
  const centerVerts: number[] = []; // 중앙선(연 노랑)
  for (const r of chunk.objects?.roads ?? []) {
    const p = r.p;
    const n = p.length / 2;
    if (n < 2) continue;
    const w = r.w ?? 6;
    // 폴리라인을 ≤12m 로 리샘플(중심선). 높이는 pushRibbon 이 가장자리 위치에서 직접 드레이프(폭 방향 밀착).
    const rsLocal: number[] = [p[0] - originX, p[1] - originZ];
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[(i + 1) * 2], bz = p[(i + 1) * 2 + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 12));
      for (let s = 1; s <= steps; s++) { const t = s / steps; rsLocal.push(ax + (bx - ax) * t - originX, az + (bz - az) * t - originZ); }
    }
    // 끝점만 진행방향으로 연장(min(반폭,10)m) — 인접 조각(OSM way·청크 클립 경계)·교차로와 겹쳐 틈/중앙선 끊김 메움.
    const ext = Math.min(w / 2, 10);
    const m = rsLocal.length;
    extendEnd(rsLocal, 0, 1, ext); extendEnd(rsLocal, m / 2 - 1, m / 2 - 2, ext);
    const roadY = (x: number, z: number) => sampleChunkHeight(terrain, x + originX, z + originZ) + LAYER_Y.road;
    pushRibbon(roadVerts, rsLocal, w / 2, roadY); // 가장자리도 지형 드레이프 → 교차 경사에서 초록 솟음 방지
    // 중앙선은 **간선도로(폭≥16m: primary/secondary)** 에만 — 작은 도로까지 그리면 교차로에서 뒤엉킴.
    if (w >= 16) pushRibbon(centerVerts, rsLocal, 0.2, (x, z) => roadY(x, z) + LAYER_Y.centerAdd);
    roads.push({ p: localize(p, originX, originZ), w }); // 미니맵용(원본 폴리라인)
  }
  const addRibbon = (verts: number[], mat: THREE.Material) => {
    if (!verts.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addRibbon(roadVerts, roadMat);
  addRibbon(centerVerts, centerMat);

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

  // ── 수역 — 면(연못/호수)은 평탄 채움, 강/하천 중심선(w 보유)은 **얇은 리본**(면 채움 시 퇴화 블롭 방지). ──
  const water: number[][] = [];
  const waterRibbon: number[] = [];
  for (const wpoly of chunk.objects?.water ?? []) {
    const p = wpoly.p;
    const n = p.length / 2;
    if (n < 2) continue;
    if (wpoly.w != null) {
      // 강/하천 라인 → 폭 w 리본(도로처럼). 면으로 채우면 자기교차 퇴화 → 공중 파란 판.
      const rs: number[] = [p[0] - originX, p[1] - originZ];
      for (let i = 0; i < n - 1; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[(i + 1) * 2], bz = p[(i + 1) * 2 + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 12));
        for (let s = 1; s <= steps; s++) { const t = s / steps; rs.push(ax + (bx - ax) * t - originX, az + (bz - az) * t - originZ); }
      }
      pushRibbon(waterRibbon, rs, wpoly.w / 2, (x, z) => sampleChunkHeight(terrain, x + originX, z + originZ) + LAYER_Y.water);
      continue;
    }
    if (n < 3) continue;
    const local: number[] = new Array(n * 2);
    let minY = Infinity;
    for (let i = 0; i < n; i++) {
      local[i * 2] = p[i * 2] - originX; local[i * 2 + 1] = p[i * 2 + 1] - originZ;
      const gy = sampleChunkHeight(terrain, p[i * 2], p[i * 2 + 1]);
      if (gy < minY) minY = gy;
    }
    water.push(local);
    const shape = new THREE.Shape();
    shape.moveTo(local[0], -local[1]);
    for (let i = 1; i < n; i++) shape.lineTo(local[i * 2], -local[i * 2 + 1]);
    let g: THREE.ShapeGeometry;
    try { g = new THREE.ShapeGeometry(shape); } catch { continue; }
    g.rotateX(-Math.PI / 2);
    g.translate(0, minY + LAYER_Y.water, 0); // 경계 최저 지표 위 평면(부유 방지, 도로 아래)
    const mesh = new THREE.Mesh(g, waterMat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (waterRibbon.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(waterRibbon, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, waterMat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return { cx: chunk.cx, cz: chunk.cz, group, terrain, buildings, walls, roads, water };
}

/** 청크 그룹의 모든 지오메트리 해제(머티리얼은 모듈 공유라 보존). */
export function disposeChunkGroup(group: THREE.Group): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}
