// 지형 하이트맵(DEM) 빌드 — 로컬 격자(size×size)의 표고를 Float32 raw(.bin, little-endian, row-major)로
// public/maps/<id>.terrain.bin 에 굽는다. 런타임(TerrainField)은 이 .bin 을 바이리니어 샘플한다.
//
// row-major: 인덱스 = z*size + x, 행(z) 증가 = 북→남(-Z→+Z... 로컬 +z), 열(x) 증가 = 서→동.
// 좌상단(최소 x,z) = origin (기본 -meters/2). 텍셀 간격 = meters/(size-1).
//
// ── 실행 ──
//   node scripts/build-terrain.mjs synthetic <id> [size=256] [meters=6000]
//     → 테스트용 합성 표고(가우시안 봉우리). 런타임 DEM 경로 검증/플레이스홀더용.
//   (실 DEM) sampleElevation 를 아래 가이드대로 교체해 실측 SRTM/Terrarium 표고로 빌드.
//
// ── config 연동 ──
//   생성 후 출력되는 heightmap 스펙을 maps.config.mjs 의 해당 맵에 추가:
//     heightmap: { src: "maps/<id>.terrain.bin", size, meters }
//   그리고 `node scripts/build-maps.mjs <id>` 로 맵 JSON(섹션형)에 반영.
//
// ── 실 NASA/오픈 DEM 파이프라인 가이드(데이터 취득은 네트워크 의존) ──
//   1) 소스: AWS Terrarium 타일(PNG, elevation = R*256 + G + B/256 - 32768) 또는 SRTM 90m GeoTIFF.
//   2) 각 격자점 (x,z) → 로컬미터를 위경도로 역투영(scripts/osm.mjs projFns 의 역) → 소스에서 표고 샘플.
//   3) sampleElevation(lat, lon) 로 캡슐화해 아래 build() 의 합성 함수만 교체하면 됨.
//      (PNG 디코드 필요 시 sharp/pngjs, GeoTIFF 는 geotiff 패키지 — devDependency 추가.)
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { MAPS } from "./maps.config.mjs";
import { decodePNG, lonToPx, latToPx, terrariumElev, bareEarth } from "./dem.mjs";

const OUT_DIR = "public/maps";

// 합성 표고 프리셋(테스트용 가우시안 봉우리, 로컬 m: +X=동, -Z=북, 원점=맵 lat0/lon0). 실 DEM 으로 교체 대상.
const PEAK_PRESETS = {
  // 경복궁 주변 ~10km — 서울 주요 산세 근사(실측 위치 기반, 게임 스케일 높이).
  gyeongbokgung: [
    { x: 100, z: -1300, h: 300, r: 600 }, // 북악산
    { x: -1250, z: -350, h: 260, r: 550 }, // 인왕산
    { x: -200, z: -4600, h: 550, r: 1500 }, // 북한산(최고·북측)
    { x: 650, z: 3900, h: 240, r: 700 }, // 남산(남측)
    { x: 900, z: -1180, h: 150, r: 320 }, // 응봉/매봉
    { x: 2600, z: 350, h: 110, r: 500 }, // 낙산(동측)
  ],
};
const DEFAULT_PEAKS = [
  { x: 120, z: -1250, h: 250, r: 300 },
  { x: -1150, z: -260, h: 220, r: 320 },
  { x: 860, z: -1180, h: 150, r: 260 },
];

function syntheticElevation(peaks) {
  return (x, z) => {
    let h = 0;
    for (const p of peaks) {
      const dx = x - p.x, dz = z - p.z;
      h += p.h * Math.exp(-(dx * dx + dz * dz) / (2 * p.r * p.r));
    }
    return h;
  };
}

// ─────────────────────────── 실측 DEM (AWS Terrarium 타일) ───────────────────────────
// 무료·키 불필요 전지구 DEM. PNG RGB → 표고(m) = R*256 + G + B/256 − 32768. 내장 zlib 로 디코드.

const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

/** 줌 z 에서 [latS..latN]×[lonW..lonE] 를 덮는 terrarium 타일을 받아 표고 모자이크(Float32) 구성. */
function fetchElevationMosaic(latS, latN, lonW, lonE, z) {
  const minTX = Math.floor(lonToPx(lonW, z) / 256), maxTX = Math.floor(lonToPx(lonE, z) / 256);
  const minTY = Math.floor(latToPx(latN, z) / 256), maxTY = Math.floor(latToPx(latS, z) / 256);
  const cols = maxTX - minTX + 1, rows = maxTY - minTY + 1;
  const W = cols * 256, H = rows * 256;
  const elev = new Float32Array(W * H);
  console.error(`  terrarium z${z}: ${cols}×${rows} tiles (x ${minTX}..${maxTX}, y ${minTY}..${maxTY})`);
  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      const cache = `/tmp/terr-${z}-${tx}-${ty}.png`;
      if (!(existsSync(cache) && readFileSync(cache).length > 100)) {
        execFileSync("curl", ["-sS", "-m", "60", "-o", cache, `${TERRARIUM}/${z}/${tx}/${ty}.png`], { stdio: ["ignore", "ignore", "inherit"] });
      }
      const png = decodePNG(readFileSync(cache));
      const ox = (tx - minTX) * 256, oy = (ty - minTY) * 256;
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const i = (py * png.width + px) * png.ch;
          elev[(oy + py) * W + (ox + px)] = terrariumElev(png.data[i], png.data[i + 1], png.data[i + 2]);
        }
      }
    }
  }
  return { elev, W, H, minTX, minTY, z };
}

/** 모자이크 바이리니어 표고 샘플(위경도). */
function sampleMosaic(M, lat, lon) {
  const gx = lonToPx(lon, M.z) - M.minTX * 256;
  const gy = latToPx(lat, M.z) - M.minTY * 256;
  const x0 = Math.max(0, Math.min(M.W - 1, Math.floor(gx))), y0 = Math.max(0, Math.min(M.H - 1, Math.floor(gy)));
  const x1 = Math.min(M.W - 1, x0 + 1), y1 = Math.min(M.H - 1, y0 + 1);
  const fx = gx - x0, fy = gy - y0;
  const a = M.elev[y0 * M.W + x0], b = M.elev[y0 * M.W + x1], c = M.elev[y1 * M.W + x0], d = M.elev[y1 * M.W + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** 실측 DEM 빌드 — 맵 lat0/lon0 중심 size×size 격자에 terrarium 표고를 역투영 샘플해 .bin 기록. */
function buildReal(id, size, meters, zoom) {
  const m = MAPS.find((x) => x.id === id);
  if (!m) throw new Error(`maps.config 에 '${id}' 없음`);
  const { lat0, lon0 } = m;
  const M_LAT = 111320, M_LON = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const origin = -meters / 2, step = meters / (size - 1);
  // 격자 위경도 범위(z=origin=북, z=origin+meters=남)
  const latN = lat0 - origin / M_LAT, latS = lat0 - (origin + meters) / M_LAT;
  const lonW = lon0 + origin / M_LON, lonE = lon0 + (origin + meters) / M_LON;
  const mosaic = fetchElevationMosaic(latS, latN, lonW, lonE, zoom);
  const elevFn = (x, z) => sampleMosaic(mosaic, lat0 - z / M_LAT, lon0 + x / M_LON);
  // terrarium 은 건물·수목 포함 표면모델(DSM) → 형태학적 열림 + 블러로 bare-earth 근사(도로 밑 스파이크 제거).
  build(id, size, meters, elevFn, (grid) => bareEarth(grid, size, 4, 2));
}

/** size×size 격자 표고를 elevFn(x,z)로 채워 (옵션 post 후처리) Float32 raw 로 기록. */
function build(id, size, meters, elevFn, post) {
  const origin = -meters / 2;
  const step = meters / (size - 1);
  let out = new Float32Array(size * size);
  for (let zi = 0; zi < size; zi++) {
    const z = origin + zi * step;
    for (let xi = 0; xi < size; xi++) {
      const x = origin + xi * step;
      out[zi * size + xi] = elevFn(x, z);
    }
  }
  if (post) out = post(out);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${id}.terrain.bin`;
  writeFileSync(path, Buffer.from(out.buffer));
  console.error(`wrote ${path}: ${size}×${size} Float32 (${(out.byteLength / 1024).toFixed(0)}KB), meters=${meters}`);
  console.error(`add to maps.config.mjs → heightmap: { src: "maps/${id}.terrain.bin", size: ${size}, meters: ${meters} }`);
}

const [mode, id, sizeArg, metersArg, zoomArg] = process.argv.slice(2);
if (mode === "synthetic" && id) {
  const peaks = PEAK_PRESETS[id] ?? DEFAULT_PEAKS;
  build(id, Number(sizeArg) || 256, Number(metersArg) || 6000, syntheticElevation(peaks));
} else if (mode === "real" && id) {
  buildReal(id, Number(sizeArg) || 512, Number(metersArg) || 10000, Number(zoomArg) || 13);
} else {
  console.error("usage: node scripts/build-terrain.mjs synthetic <id> [size=256] [meters=6000]");
  console.error("       node scripts/build-terrain.mjs real <id> [size=512] [meters=10000] [zoom=13]   (AWS terrarium 실측 DEM)");
  process.exit(1);
}
