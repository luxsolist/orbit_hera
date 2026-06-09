// 타일 월드 검증 CLI — public/maps/<lat>/<lon>/ 를 읽어 불변식 검사(worldValidate). 빌드 게이트.
// error 가 하나라도 있으면 비0 종료 → 파이프라인(build-pipeline)·CI 가 빌드를 실패시킨다.
//
// 사용:
//   node scripts/validate-world.mjs <id>          (maps.config 의 lat0/lon0 로 셀 결정)
//   node scripts/validate-world.mjs <lat> <lon>   (셀 직접 지정)
import { readFileSync, existsSync } from "node:fs";
import { MAPS } from "./maps.config.mjs";
import { validateChunk, validateManifest, validateEntryConsistency, validateSeams, validateSpawn, validateDemConsistency, findDuplicateBuildings, demSample, cellToMapLocal } from "./worldValidate.mjs";

const a = process.argv.slice(2);
let cellLat, cellLon;
if (a.length >= 2 && !Number.isNaN(Number(a[0])) && !Number.isNaN(Number(a[1]))) {
  cellLat = Math.floor(Number(a[0])); cellLon = Math.floor(Number(a[1]));
} else {
  const m = MAPS.find((x) => x.id === a[0]);
  if (!m) { console.error("usage: node scripts/validate-world.mjs <id> | <lat> <lon>"); process.exit(2); }
  cellLat = Math.floor(m.lat0); cellLon = Math.floor(m.lon0);
}

const dir = `public/maps/${cellLat}/${cellLon}`;
const tp = `${dir}/tiles.json`;
if (!existsSync(tp)) { console.error(`타일 매니페스트 없음: ${tp}`); process.exit(2); }

const manifest = JSON.parse(readFileSync(tp, "utf8"));
let errors = 0, warns = 0;
const warnCodes = new Map();
const report = (loc, issues) => {
  for (const i of issues) {
    if (i.level === "error") { errors++; console.error(`  [error] ${loc} ${i.code}: ${i.msg}`); }
    else { warns++; warnCodes.set(i.code, (warnCodes.get(i.code) ?? 0) + 1); }
  }
};

report("tiles.json", validateManifest(manifest));

// 소스 DEM(.bin) 로드 — 청크 표고를 소스와 교차검증(있으면). 이 셀을 덮는 heightmap 보유 맵을 찾는다.
let demExpected = null;
const srcMap = MAPS.find((m) => m.heightmap && Math.floor(m.lat0) === cellLat && Math.floor(m.lon0) === cellLon);
if (srcMap) {
  const binPath = `build/${srcMap.heightmap.src.split("/").pop()}`; // DEM .bin = 빌드 중간물(build/)
  if (existsSync(binPath)) {
    const buf = readFileSync(binPath);
    const bin = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
    const { size, meters } = srcMap.heightmap;
    const ox = srcMap.heightmap.originX ?? -meters / 2, oz = srcMap.heightmap.originZ ?? -meters / 2;
    const seaLevel = srcMap.seaLevel ?? 0;
    demExpected = (cellX, cellZ) => {
      const [mx, mz] = cellToMapLocal(cellX, cellZ, manifest.cell, srcMap.lat0, srcMap.lon0);
      return demSample(bin, size, meters, ox, oz, seaLevel, mx, mz);
    };
  } else console.error(`  ⚠ DEM 교차검증 생략 — ${binPath} 없음`);
}

// 파일↔매니페스트 정합 + 청크별 불변식 + 플래그 일치 + DEM 정합. 청크는 이음새 검사용으로 수집.
const chunks = [];
for (const e of manifest.chunks) {
  const blk = manifest.block || 1; // 블록 디렉터리 분산
  const f = `${dir}/${Math.floor(e.cx / blk)}_${Math.floor(e.cz / blk)}/${e.cx}_${e.cz}.json`;
  if (!existsSync(f)) { report(`${e.cx}_${e.cz}`, [{ level: "error", code: "missing-file", msg: "매니페스트에 있으나 파일 없음" }]); continue; }
  let ch;
  try { ch = JSON.parse(readFileSync(f, "utf8")); }
  catch (err) { report(`${e.cx}_${e.cz}`, [{ level: "error", code: "parse", msg: String(err.message) }]); continue; }
  report(`${e.cx}_${e.cz}`, validateChunk(ch, manifest.chunkSize));
  report(`${e.cx}_${e.cz}`, validateEntryConsistency(e, ch));
  if (demExpected) report(`${e.cx}_${e.cz}`, validateDemConsistency(ch, manifest.chunkSize, demExpected));
  chunks.push(ch);
}

// 인접 청크 지형 연속성(이음새/크랙) + 동일 footprint 건물 중복
report("seams", validateSeams(chunks));
report("dup", findDuplicateBuildings(chunks));

// 스폰 지표면 sanity — 이 셀을 가리키는 스트리밍 카탈로그 엔트리의 스폰 위치
const idxPath = "public/maps/index.json";
if (existsSync(idxPath)) {
  try {
    const cat = JSON.parse(readFileSync(idxPath, "utf8"));
    for (const entry of cat) {
      if (!entry.stream || entry.lat == null || entry.lon == null) continue;
      if (Math.floor(entry.lat) !== cellLat || Math.floor(entry.lon) !== cellLon) continue;
      report(`spawn:${entry.id}`, validateSpawn(entry.lat, entry.lon, manifest));
    }
  } catch { /* 카탈로그 파싱 실패는 별도 빌드 단계 책임 */ }
}

// 경고는 코드별 집계만(노이즈 억제)
if (warns) {
  console.error("  warnings:");
  for (const [code, n] of [...warnCodes].sort((x, y) => y[1] - x[1])) console.error(`    [warn] ${code} ×${n}`);
}
console.error(`\nvalidate-world ${cellLat}/${cellLon}: ${errors} errors, ${warns} warnings across ${manifest.chunks.length} chunks`);
process.exit(errors ? 1 : 0);
