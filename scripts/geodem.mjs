// 실측 표고의 **위치 순수 함수** 계층 — Terrarium 타일 모자이크 + 셀 정렬 작업 격자.
//
// ── 왜 이 계층이 생겼나 ──
// 예전에는 도시마다 자기 중심의 2048² 격자(.bin)를 굽고 청크가 그것을 샘플했다. 청크 샘플 **위치**는
// 이미 셀-로컬 정수 격자라 도시와 무관했는데, **높이 조회만** 도시별 격자에 묶여 있었다.
// 그래서 한 셀에 두 도시가 살면 소유 경계에서 지형이 어긋났다 — 실측 이음새 최대 30m(눈에 보이는 절벽).
// 도시마다 자기 건물만 평탄화하는 것이 차이를 30배로 증폭했다(원본 격자 차이는 최대 1.1m).
//
// 이제 높이도 위치의 순수 함수다: 같은 위경도 → 항상 같은 값. 실측 검증에서 두 도시 관점의 차이가
// **0.00m(비트 동일)** 이었다. 그 결과 도시는 "맵의 특정 영역을 지칭하는 가상 개념"이 될 수 있고,
// 도시가 겹쳐도 무해하다 — 같은 청크를 누가 구워도 결과가 같다.
//
// ── 이웃 연산과 halo ──
// bareEarth(침식4 → 팽창4 → 블러2)와 flattenUnderBuildings 는 이웃을 본다. 그래서 작업 격자를
// 필요 범위보다 **halo 만큼 넓게** 잡고 그 안에서 계산해야 경계가 어긋나지 않는다.
// 이론 영향 반경 = 4+4+2 = 10 샘플. 실측도 지형에 따라 6~10 에서 수렴했다(그 이상은 완전 동일).
// 여유를 둬 **12** 를 쓴다(≈236m). 비용은 무시할 수준 — 오사카 범위에서 격자가 2048² → 2729² 다.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { decodePNG, lonToPx, latToPx, terrariumElev, bareEarth, flattenUnderBuildings } from "./dem.mjs";

const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
export const M_LAT = 111320;
export const DEM_HALO = 12; //        작업 격자 여유(샘플) — 위 주석의 근거
export const DEM_PER_CHUNK = 52; //  청크 한 변당 작업 격자 샘플 수(1024m → 19.69m/샘플)

/** bbox 를 덮는 Terrarium 타일 모자이크. 타일은 /tmp 에 캐시(도시 간 공유). */
export function elevationMosaic(latS, latN, lonW, lonE, z = 13) {
  const minTX = Math.floor(lonToPx(lonW, z) / 256), maxTX = Math.floor(lonToPx(lonE, z) / 256);
  const minTY = Math.floor(latToPx(latN, z) / 256), maxTY = Math.floor(latToPx(latS, z) / 256);
  const cols = maxTX - minTX + 1, rows = maxTY - minTY + 1;
  const W = cols * 256, H = rows * 256;
  const elev = new Float32Array(W * H);
  console.error(`  terrarium z${z}: ${cols}×${rows} tiles (x ${minTX}..${maxTX}, y ${minTY}..${maxTY})`);
  for (let ty = minTY; ty <= maxTY; ty++) for (let tx = minTX; tx <= maxTX; tx++) {
    const cache = `/tmp/terr-${z}-${tx}-${ty}.png`;
    if (!(existsSync(cache) && readFileSync(cache).length > 100))
      execFileSync("curl", ["-sS", "-m", "60", "-o", cache, `${TERRARIUM}/${z}/${tx}/${ty}.png`], { stdio: ["ignore", "ignore", "inherit"] });
    const png = decodePNG(readFileSync(cache));
    const ox = (tx - minTX) * 256, oy = (ty - minTY) * 256;
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const i = (py * png.width + px) * png.ch;
      elev[(oy + py) * W + (ox + px)] = terrariumElev(png.data[i], png.data[i + 1], png.data[i + 2]);
    }
  }
  return { elev, W, H, minTX, minTY, z };
}

/**
 * 모자이크 바이리니어 표고(위경도) — **이 함수가 순수성의 근거**다.
 * 타일 픽셀 좌표가 전역(웹 메르카토르)이라 어떤 bbox 로 모자이크를 만들었는지와 무관하게 같은 값이 나온다.
 */
export function sampleMosaic(M, lat, lon) {
  const gx = lonToPx(lon, M.z) - M.minTX * 256;
  const gy = latToPx(lat, M.z) - M.minTY * 256;
  const x0 = Math.max(0, Math.min(M.W - 1, Math.floor(gx))), y0 = Math.max(0, Math.min(M.H - 1, Math.floor(gy)));
  const x1 = Math.min(M.W - 1, x0 + 1), y1 = Math.min(M.H - 1, y0 + 1);
  const fx = gx - x0, fy = gy - y0;
  const a = M.elev[y0 * M.W + x0], b = M.elev[y0 * M.W + x1], c = M.elev[y1 * M.W + x0], d = M.elev[y1 * M.W + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/**
 * 셀 정렬 작업 격자 — 셀-로컬 좌표계(원점 = 셀 NW, x=동, z=남)에 정사각 격자를 깐다.
 *
 * 정사각·단일 원점인 이유: dem.mjs 의 morphPass/flattenUnderBuildings 가 그 형태를 전제한다.
 * x·z 범위가 달라도 둘을 감싸는 정사각으로 잡는다(오사카 실측 2729² = 30MB — 종전 2048² 와 같은 급).
 *
 * @param range {cxMin,cxMax,czMin,czMax} 담을 청크 인덱스 범위
 * @returns {{grid, size, orig, step}} orig/step 은 셀-로컬 m
 */
export function cellLattice(range, chunkSize, cell, mLon, mosaic, opts = {}) {
  const { bareEarthOn = true, buildings = null, halo = DEM_HALO, perChunk = DEM_PER_CHUNK } = opts;
  const step = chunkSize / perChunk;
  const lo = Math.min(range.cxMin, range.czMin) * chunkSize - halo * step;
  const hi = Math.max(range.cxMax + 1, range.czMax + 1) * chunkSize + halo * step;
  const size = Math.ceil((hi - lo) / step) + 1;
  let grid = new Float32Array(size * size);
  const [cellLat, cellLon] = cell;
  for (let j = 0; j < size; j++) {
    const cz = lo + j * step;
    const lat = cellLat + 1 - cz / M_LAT;
    for (let i = 0; i < size; i++) {
      const cx = lo + i * step;
      grid[j * size + i] = sampleMosaic(mosaic, lat, cellLon + cx / mLon);
    }
  }
  // 도시(기본): terrarium DSM(건물·수목 포함) → 형태학적 열림+블러로 bare-earth 근사.
  // 자연 산악(bareEarth:false): 봉우리/능선이 깎이므로 생략하고 실측 그대로.
  if (bareEarthOn) grid = bareEarth(grid, size, 4, 2);
  // 건물 footprint 아래 평탄화(도시 DSM 스파이크 제거). buildings 는 **셀-로컬** 폴리곤.
  if (buildings?.length) grid = flattenUnderBuildings(grid, size, buildings, lo, step, 4);
  return { grid, size, orig: lo, step };
}

/** 작업 격자 바이리니어 샘플(셀-로컬 x,z). 인접 청크가 같은 격자를 보므로 모서리 값이 정확히 일치한다. */
export function sampleLattice(L, cx, cz) {
  const gx = Math.min(L.size - 1, Math.max(0, (cx - L.orig) / L.step));
  const gz = Math.min(L.size - 1, Math.max(0, (cz - L.orig) / L.step));
  const x0 = Math.floor(gx), z0 = Math.floor(gz), x1 = Math.min(L.size - 1, x0 + 1), z1 = Math.min(L.size - 1, z0 + 1);
  const fx = gx - x0, fz = gz - z0;
  const a = L.grid[z0 * L.size + x0], b = L.grid[z0 * L.size + x1], c = L.grid[z1 * L.size + x0], d = L.grid[z1 * L.size + x1];
  const t = a + (b - a) * fx, bo = c + (d - c) * fx;
  return t + (bo - t) * fz;
}
