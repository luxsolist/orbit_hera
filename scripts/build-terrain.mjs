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
import { writeFileSync, mkdirSync } from "node:fs";

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

/** size×size 격자 표고를 elevFn(x,z)로 채워 Float32 raw 로 기록. */
function build(id, size, meters, elevFn) {
  const origin = -meters / 2;
  const step = meters / (size - 1);
  const out = new Float32Array(size * size);
  for (let zi = 0; zi < size; zi++) {
    const z = origin + zi * step;
    for (let xi = 0; xi < size; xi++) {
      const x = origin + xi * step;
      out[zi * size + xi] = elevFn(x, z);
    }
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${id}.terrain.bin`;
  writeFileSync(path, Buffer.from(out.buffer));
  console.error(`wrote ${path}: ${size}×${size} Float32 (${(out.byteLength / 1024).toFixed(0)}KB), meters=${meters}`);
  console.error(`add to maps.config.mjs → heightmap: { src: "maps/${id}.terrain.bin", size: ${size}, meters: ${meters} }`);
}

const [mode, id, sizeArg, metersArg] = process.argv.slice(2);
if (mode === "synthetic" && id) {
  const peaks = PEAK_PRESETS[id] ?? DEFAULT_PEAKS;
  build(id, Number(sizeArg) || 256, Number(metersArg) || 6000, syntheticElevation(peaks));
} else {
  console.error("usage: node scripts/build-terrain.mjs synthetic <id> [size=256] [meters=6000]");
  process.exit(1);
}
