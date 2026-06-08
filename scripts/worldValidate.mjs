// 생성된 타일 월드의 불변식 검증 — 순수(부수효과 없음). validate-world.mjs(CLI)와 테스트가 공유.
// 지금까지 발생한 버그 클래스를 수치 불변식으로 고정해 회귀를 빌드 단계에서 차단한다:
//  - 지형 NaN/Inf(블룸 통한 검은 화면) · heights 크기 불일치
//  - 면/수역이 청크 경계 밖(클립 누락 → 산비탈 부유 판) · 퇴화 폴리곤(NaN 삼각형)
//  - 생성기↔런타임 격자(mLon) 불일치(오브젝트 어긋남)
//
// 반환: issue 객체 배열 [{ level:"error"|"warn", code, msg }]. error 가 있으면 CLI 가 비0 종료.

const M_LAT = 111320;
/** 셀 격자 경도 m/도(생성기·런타임 공통) — src/world/chunkManifest.cellMLon 과 동일 공식. */
export const cellMLon = (cellLat) => M_LAT * Math.cos(((cellLat + 0.5) * Math.PI) / 180);

/** 위경도 → 셀-로컬 m(원점=셀 NW). src/world/chunkManifest.cellLocalOf 와 동일. */
export const cellLocalOf = (lat, lon, cell, mLon = cellMLon(cell[0])) => ({ x: (lon - cell[1]) * mLon, z: (cell[0] + 1 - lat) * M_LAT });

/** chunkMesh AREA_COLOR 와 짝 — 알려진 지표 면 종류. */
export const KNOWN_AREA = new Set(["park", "garden", "grass", "pitch", "wood", "scrub", "sand", "rock", "pavement"]);

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** 폴리라인/폴리곤 좌표 배열 기본 검사. minPts=최소 점 수(면 3, 선 2). */
function polyIssues(p, minPts) {
  if (!Array.isArray(p)) return ["p가 배열이 아님"];
  const out = [];
  if (p.length % 2 !== 0) out.push("좌표 길이가 홀수");
  if (p.length / 2 < minPts) out.push(`점 ${p.length / 2}개 < 최소 ${minPts}`);
  for (let i = 0; i < p.length; i++) if (!finite(p[i])) { out.push(`좌표[${i}] 비유한값`); break; }
  return out;
}
/** 신발끈 면적(절댓값). */
function shoelace(p) {
  let a = 0; const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  return Math.abs(a) / 2;
}
/** 폴리곤이 [x0,x1]×[z0,z1] 안(여유 eps)인지. */
function inBounds(p, x0, z0, x1, z1, eps) {
  for (let i = 0; i < p.length; i += 2)
    if (p[i] < x0 - eps || p[i] > x1 + eps || p[i + 1] < z0 - eps || p[i + 1] > z1 + eps) return false;
  return true;
}

/** 연속 정점 중복(영길이 모서리) — 퇴화 삼각형/NaN 노멀 유발. 닫힘 반복(last==first)은 정상이라 내부만 검사. */
export function hasZeroLengthEdge(p) {
  const n = p.length / 2;
  for (let i = 0; i < n - 1; i++) if (p[i * 2] === p[(i + 1) * 2] && p[i * 2 + 1] === p[(i + 1) * 2 + 1]) return true;
  return false;
}
const orient = (ax, az, bx, bz, cx, cz) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
/** 두 선분(ab, cd)이 정상 교차(proper crossing)하는지 — 끝점 공유/접촉 제외. */
function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = orient(cx, cz, dx, dz, ax, az), d2 = orient(cx, cz, dx, dz, bx, bz);
  const d3 = orient(ax, az, bx, bz, cx, cz), d4 = orient(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
/** 닫힌 폴리곤(ring) 자기교차 — bowtie 등(압출/삼각분할 퇴화 유발). 비인접 모서리쌍 검사. 큰 폴리곤(>200)은 생략. */
export function isSelfIntersecting(p) {
  let n = p.length / 2;
  if (n >= 2 && p[0] === p[(n - 1) * 2] && p[1] === p[(n - 1) * 2 + 1]) n -= 1; // 닫힘 반복 제거
  if (n < 4 || n > 200) return false;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n;
    for (let j = i + 1; j < n; j++) {
      const c = j, d = (j + 1) % n;
      if (a === c || a === d || b === c || b === d) continue; // 인접/공유 모서리 제외
      if (segCross(p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1], p[c * 2], p[c * 2 + 1], p[d * 2], p[d * 2 + 1])) return true;
    }
  }
  return false;
}

/**
 * 청크 1개 검증. chunkSize=청크변(m). 좌표는 셀-로컬 m(원점=셀 NW).
 * 면/수역(클립 대상)은 청크 경계 내 강제, 건물/도로/담장(centroid·midpoint 배치)은 유한값만.
 */
export function validateChunk(chunk, chunkSize) {
  const issues = [];
  const E = (code, msg) => issues.push({ level: "error", code, msg });
  const W = (code, msg) => issues.push({ level: "warn", code, msg });
  const { cx, cz } = chunk;
  if (!Number.isInteger(cx) || !Number.isInteger(cz)) { E("cxcz", "cx/cz 정수 아님"); return issues; }
  const x0 = cx * chunkSize, z0 = cz * chunkSize, x1 = x0 + chunkSize, z1 = z0 + chunkSize;

  // ── 지형 ──
  const t = chunk.terrain || {};
  const size = t.size ?? 0;
  if (size > 0) {
    if (!Array.isArray(t.heights) || t.heights.length !== size * size) {
      E("terrain-size", `heights ${t.heights?.length} != ${size}²`);
    } else {
      let mn = Infinity, mx = -Infinity, bad = false, maxStep = 0;
      const h = t.heights;
      for (const v of h) { if (!finite(v)) { bad = true; break; } if (v < mn) mn = v; if (v > mx) mx = v; }
      if (bad) E("terrain-nan", "지형 높이 비유한값(NaN/Inf)");
      else {
        if (mn < -500 || mx > 9000) W("terrain-range", `표고 범위 ${mn.toFixed(0)}~${mx.toFixed(0)}m 비정상?`);
        // 인접 격자 급경사 — DSM(건물) 잔여 스파이크 의심(bare-earth 스무딩 누락). 격자 한 칸에 30m↑ 변화.
        for (let j = 0; j < size; j++) for (let i = 0; i < size - 1; i++) { const d = Math.abs(h[j * size + i] - h[j * size + i + 1]); if (d > maxStep) maxStep = d; }
        for (let j = 0; j < size - 1; j++) for (let i = 0; i < size; i++) { const d = Math.abs(h[j * size + i] - h[(j + 1) * size + i]); if (d > maxStep) maxStep = d; }
        if (maxStep > 30) W("terrain-steep", `인접 격자 급변 ${maxStep.toFixed(0)}m — DSM(건물) 잔여 스파이크 의심`);
      }
    }
  } else if (Array.isArray(t.heights) && t.heights.length) {
    W("terrain-empty", "size 0 인데 heights 비어있지 않음");
  }

  const o = chunk.objects || {};
  // 셀-로컬 NW 원점. 광역 맵(반경 20km↑)은 한 셀(~111km)을 넘어 인접 셀 영역까지 단일 프레임에 담으므로(멀티셀 전),
  // OOB 는 "투영 버그"(부호 반전 음수/수백만대 거대값)만 잡도록 넉넉히 ±250km. 정상 광역 좌표는 통과.
  const CELL_MAX = 250000;
  const cellOOB = (p) => { for (let i = 0; i < p.length; i++) if (p[i] < -2000 || p[i] > CELL_MAX) return true; return false; };
  // 면(클립 대상): 유한 + 비퇴화 + 청크 경계 내 + 셀 범위 + 도형 품질(영길이 모서리/자기교차)
  const checkFill = (r, name) => {
    const pi = polyIssues(r.p, 3);
    if (pi.length) { E(`${name}-poly`, `${name}: ${pi.join(", ")}`); return; }
    if (cellOOB(r.p)) { E(`${name}-celloob`, `${name} 좌표가 셀 범위 밖(투영 버그)`); return; }
    if (shoelace(r.p) < 0.5) W(`${name}-degenerate`, `${name} 면적 퇴화(≈0)`);
    if (hasZeroLengthEdge(r.p)) W(`${name}-dupvert`, `${name} 영길이 모서리(중복 정점)`);
    if (isSelfIntersecting(r.p)) W(`${name}-selfx`, `${name} 자기교차 폴리곤(압출 퇴화 위험)`);
    if (!inBounds(r.p, x0, z0, x1, z1, 1.0)) E(`${name}-bounds`, `${name} 폴리곤이 청크(${cx},${cz}) 경계 밖 — 클립 누락`);
  };
  // 선/세그먼트: 유한값 + 셀 범위 + 영길이. bounded=true(도로·담장: 파이프라인이 청크로 클립 → 경계 내 강제).
  const checkSeg = (r, name, bounded) => {
    const pi = polyIssues(r.p, 2);
    if (pi.length) { E(`${name}-poly`, `${name}: ${pi.join(", ")}`); return; }
    if (cellOOB(r.p)) { E(`${name}-celloob`, `${name} 좌표가 셀 범위 밖(투영 버그)`); return; }
    if (bounded && !inBounds(r.p, x0, z0, x1, z1, 1.0)) E(`${name}-bounds`, `${name}가 청크(${cx},${cz}) 경계 밖 — 폴리라인 클립 누락`);
    if (hasZeroLengthEdge(r.p)) W(`${name}-dupvert`, `${name} 영길이 세그먼트`);
  };

  for (const b of o.buildings ?? []) {
    const pi = polyIssues(b.p, 3);
    if (pi.length) { E("building-poly", pi.join(", ")); continue; }
    if (cellOOB(b.p)) { E("building-celloob", "건물 좌표가 셀 범위 밖(투영 버그)"); continue; }
    if (!finite(b.h) || b.h <= 0) W("building-h", `건물 높이 ${b.h}`);
    if (hasZeroLengthEdge(b.p)) W("building-dupvert", "건물 영길이 모서리(중복 정점)");
    if (isSelfIntersecting(b.p)) W("building-selfx", "건물 자기교차 footprint(압출 퇴화 위험)");
  }
  for (const r of o.roads ?? []) { checkSeg(r, "road", true); if (!finite(r.w) || r.w <= 0) W("road-w", `도로 폭 ${r.w}`); } // 도로=청크 클립 → 경계 강제
  for (const w of o.water ?? []) { if (w.w != null) checkSeg(w, "water-line", false); else checkFill(w, "water"); } // 하천선은 centroid 배치(비강제)
  for (const a of o.areas ?? []) { checkFill(a, "area"); if (!KNOWN_AREA.has(a.k)) W("area-kind", `미지정 면 종류 '${a.k}'`); }
  for (const w of o.walls ?? []) { checkSeg(w, "wall", true); if (!finite(w.h) || w.h <= 0) W("wall-h", `담장 높이 ${w.h}`); } // 담장=청크 클립 → 경계 강제
  return issues;
}

/** 셀 매니페스트(tiles.json) 검증 — 격자 파라미터 + 생성기↔런타임 mLon 일치. */
export function validateManifest(m) {
  const issues = [];
  const E = (code, msg) => issues.push({ level: "error", code, msg });
  if (!Array.isArray(m.cell) || m.cell.length !== 2) E("cell", "cell 형식 오류");
  if (!(m.chunkSize > 0)) E("chunkSize", "chunkSize ≤ 0");
  if (!(m.terrainSize >= 2)) E("terrainSize", "terrainSize < 2");
  if (!Array.isArray(m.chunks) || !m.chunks.length) E("chunks", "청크 목록 비어있음");
  if (Array.isArray(m.cell) && finite(m.mLon)) {
    const exp = cellMLon(m.cell[0]);
    if (Math.abs(m.mLon - exp) > 1) E("mLon", `mLon ${m.mLon} != cellMLon ${exp.toFixed(2)} (생성기↔런타임 격자 불일치)`);
  }
  // 셀-로컬 청크 인덱스는 NW 원점 기준 ≥0, 한 셀(≈111km)에 chunkSize 분할 개수 이하.
  const maxIdx = Math.ceil(M_LAT / (m.chunkSize || 1024)) + 1;
  for (const e of m.chunks ?? []) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cz)) { E("entry", "청크 엔트리 cx/cz 정수 아님"); break; }
    if (e.cx < 0 || e.cz < 0 || e.cx > maxIdx || e.cz > maxIdx) { E("entry-range", `청크 인덱스(${e.cx},${e.cz}) 셀 범위[0,${maxIdx}] 밖`); break; }
  }
  return issues;
}

/**
 * 매니페스트 엔트리 플래그(terrain/objects) ↔ 실제 청크 파일 내용 일치 검증.
 * 불일치 = 스트리머가 잘못 로드/스킵(빈 청크 fetch 등)할 수 있어 error.
 */
export function validateEntryConsistency(entry, chunk) {
  const issues = [];
  const E = (code, msg) => issues.push({ level: "error", code, msg });
  const hasTerrain = (chunk.terrain?.size ?? 0) > 0;
  const o = chunk.objects || {};
  const hasObjects = !!(o.buildings?.length || o.roads?.length || o.water?.length || o.walls?.length || o.areas?.length);
  if (!!entry.terrain !== hasTerrain) E("flag-terrain", `terrain 플래그=${!!entry.terrain} 이나 파일 지형=${hasTerrain}`);
  if (!!entry.objects !== hasObjects) E("flag-objects", `objects 플래그=${!!entry.objects} 이나 파일 오브젝트=${hasObjects}`);
  return issues;
}

/**
 * 인접 청크의 공유 모서리 지형 연속성 — chunk(cx,cz) 동/남 이웃과 경계 샘플이 일치해야 한다.
 * 생성기는 경계점(예: x=(cx+1)·C)을 양쪽 청크에서 동일 좌표로 샘플하므로 값이 같아야 함.
 * 어긋나면 지형에 크랙/이음새(또는 투영 드리프트) → error. chunks=청크 객체 배열. 순수.
 */
export function validateSeams(chunks) {
  const issues = [];
  const E = (code, msg) => issues.push({ level: "error", code, msg });
  const eps = 0.06; // 생성기 0.1m 반올림 허용
  const map = new Map();
  for (const c of chunks) map.set(`${c.cx}_${c.cz}`, c);
  const sz = (c) => c?.terrain?.size ?? 0;
  for (const c of chunks) {
    const n = sz(c);
    if (n < 2) continue;
    const h = c.terrain.heights;
    // 동쪽 이웃: 내 마지막 열(i=n-1) == 이웃 첫 열(i=0)
    const east = map.get(`${c.cx + 1}_${c.cz}`);
    if (east && sz(east) === n) {
      for (let j = 0; j < n; j++) if (Math.abs(h[j * n + (n - 1)] - east.terrain.heights[j * n]) > eps) { E("seam-east", `(${c.cx},${c.cz})↔(${c.cx + 1},${c.cz}) 동쪽 모서리 지형 불연속(row ${j})`); break; }
    }
    // 남쪽 이웃: 내 마지막 행(j=n-1) == 이웃 첫 행(j=0)
    const south = map.get(`${c.cx}_${c.cz + 1}`);
    if (south && sz(south) === n) {
      for (let i = 0; i < n; i++) if (Math.abs(h[(n - 1) * n + i] - south.terrain.heights[i]) > eps) { E("seam-south", `(${c.cx},${c.cz})↔(${c.cx},${c.cz + 1}) 남쪽 모서리 지형 불연속(col ${i})`); break; }
    }
  }
  return issues;
}

/**
 * DEM 하이트맵 바이리니어 샘플(맵-로컬 입력) — build-world.sampleMap 과 독립 재구현(교차검증용).
 * bin=Float32Array 표고, size·meters=격자, originX/Z=좌상단(기본 −meters/2), seaLevel 차감.
 */
export function demSample(bin, size, meters, originX, originZ, seaLevel, mapX, mapZ) {
  const step = meters / (size - 1);
  const gx = Math.min(size - 1, Math.max(0, (mapX - originX) / step));
  const gz = Math.min(size - 1, Math.max(0, (mapZ - originZ) / step));
  const x0 = Math.floor(gx), z0 = Math.floor(gz), x1 = Math.min(size - 1, x0 + 1), z1 = Math.min(size - 1, z0 + 1);
  const fx = gx - x0, fz = gz - z0;
  const a = bin[z0 * size + x0], b = bin[z0 * size + x1], c = bin[z1 * size + x0], d = bin[z1 * size + x1];
  const t = a + (b - a) * fx, bo = c + (d - c) * fx;
  return (t + (bo - t) * fz) - seaLevel;
}

/** 셀-로컬(cellX,cellZ) → 맵-로컬(x,z) — build-world.cellToMap 와 동일. DEM 샘플 역투영용. */
export function cellToMapLocal(cellX, cellZ, cell, lat0, lon0) {
  const M_LONc = cellMLon(cell[0]);
  const M_LON0 = M_LAT * Math.cos((lat0 * Math.PI) / 180);
  const la = cell[0] + 1 - cellZ / M_LAT;
  const lo = cell[1] + cellX / M_LONc;
  return [(lo - lon0) * M_LON0, -(la - lat0) * M_LAT];
}

/**
 * 청크 지형이 소스 DEM 과 일치하는지 교차검증 — build-world 구현과 독립적으로 기대 표고를 재계산.
 * expectedAt(cellX, cellZ) = 그 지점의 기대 표고(CLI 가 demSample∘cellToMapLocal 로 주입).
 * 격자를 stride 간격으로 표본해 최대 오차가 tol(m) 초과면 error. 투영/샘플 회귀를 직접 검출. 순수.
 */
export function validateDemConsistency(chunk, chunkSize, expectedAt, { stride = 8, tol = 0.6 } = {}) {
  const t = chunk.terrain; const size = t?.size ?? 0;
  if (size < 2) return [];
  const step = chunkSize / (size - 1);
  let worst = 0, worstAt = null;
  for (let j = 0; j < size; j += stride) for (let i = 0; i < size; i += stride) {
    const cellX = chunk.cx * chunkSize + i * step, cellZ = chunk.cz * chunkSize + j * step;
    const expect = Math.round(expectedAt(cellX, cellZ) * 10) / 10; // 생성기 0.1m 반올림
    const d = Math.abs(t.heights[j * size + i] - expect);
    if (d > worst) { worst = d; worstAt = [i, j]; }
  }
  return worst > tol
    ? [{ level: "error", code: "dem-mismatch", msg: `청크(${chunk.cx},${chunk.cz}) 표고가 소스 DEM 과 불일치(최대 ${worst.toFixed(1)}m @ ${worstAt})` }]
    : [];
}

/**
 * 동일 footprint 건물 중복 검출 — 건물은 centroid 로 정확히 한 청크에 배치되므로 같은 footprint 가
 * 둘 이상 나오면 OSM 중복 way 또는 청킹 버그(중복 배치 → z-fighting). 시그니처=centroid+면적+정점수. warn.
 */
export function findDuplicateBuildings(chunks) {
  const sig = new Map();
  for (const c of chunks) {
    for (const b of c.objects?.buildings ?? []) {
      const p = b.p; const n = p.length / 2;
      if (n < 3) continue;
      let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; }
      const key = `${Math.round((cx / n) * 10)}_${Math.round((cz / n) * 10)}_${Math.round(shoelace(p))}_${n}`;
      const arr = sig.get(key) ?? []; arr.push(`${c.cx}_${c.cz}`); sig.set(key, arr);
    }
  }
  const issues = [];
  for (const [, locs] of sig) if (locs.length > 1)
    issues.push({ level: "warn", code: "building-dup", msg: `동일 footprint 건물 ${locs.length}개 중복(청크 ${[...new Set(locs)].join(",")})` });
  return issues;
}

/**
 * 스폰 위경도가 떨어지는 청크가 매니페스트에 존재하고 지형을 가져야 한다(없으면 시작 시 지표면 0 → 추락/공중).
 * cell=매니페스트 cell, mLon=매니페스트 mLon. → issues.
 */
export function validateSpawn(lat, lon, manifest) {
  const issues = [];
  const E = (code, msg) => issues.push({ level: "error", code, msg });
  if (!Array.isArray(manifest.cell)) return [{ level: "error", code: "spawn-cell", msg: "매니페스트 cell 없음" }];
  const { x, z } = cellLocalOf(lat, lon, manifest.cell, manifest.mLon);
  const cx = Math.floor(x / manifest.chunkSize), cz = Math.floor(z / manifest.chunkSize);
  const e = (manifest.chunks ?? []).find((c) => c.cx === cx && c.cz === cz);
  if (!e) E("spawn-missing", `스폰 청크(${cx},${cz})가 매니페스트에 없음 — 시작 지표면 없음`);
  else if (!e.terrain) E("spawn-noterrain", `스폰 청크(${cx},${cz})에 지형 없음 — 시작 시 추락/공중`);
  return issues;
}
