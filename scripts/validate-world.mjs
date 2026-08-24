// 타일 월드 검증 CLI — public/maps/<lat>/<lon>/ 를 읽어 불변식 검사(worldValidate). 빌드 게이트.
// error 가 하나라도 있으면 비0 종료 → 파이프라인(build-pipeline)·CI 가 빌드를 실패시킨다.
//
// 사용:
//   node scripts/validate-world.mjs <id>          (maps.config 의 lat0/lon0 로 셀 결정)
//   node scripts/validate-world.mjs <lat> <lon>   (셀 직접 지정)
import { readFileSync, existsSync } from "node:fs";
import { MAPS } from "./maps.config.mjs";
import { sampleLattice } from "./geodem.mjs";
import { validateChunk, validateManifest, validateEntryConsistency, validateSeams, validateSpawn, validateDemConsistency, findDuplicateBuildings } from "./worldValidate.mjs";

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

// ── 소스 DEM 교차검증 — **셀 정렬 작업 격자** 기준 ──
// 지형이 위치의 순수 함수가 된 뒤(geodem.cellLattice) 도시마다 다른 격자를 볼 이유가 없어졌다.
// 예전에는 셀에서 맵 하나를 골라 그 .bin 으로 전부 검사해 옆 도시 청크가 통째로 틀렸다
// (실측: 나라 청크 529개가 오사카 DEM 과 최대 532m 불일치). 지금은 청크 소유자의 격자를 쓰되,
// **어느 도시의 격자를 써도 같은 값**이므로 표기가 없어도 안전하다.
const demCache = new Map(); // 스트림 id → 샘플러(또는 null)
const demFor = (streamId) => {
  const key = streamId ?? "";
  if (demCache.has(key)) return demCache.get(key);
  const m = streamId
    ? MAPS.find((x) => (x.stream?.id ?? `${x.id}-stream`) === streamId)
    : MAPS.find((x) => x.heightmap && Math.floor(x.lat0) === cellLat && Math.floor(x.lon0) === cellLon);
  let fn = null;
  if (m) {
    const binPath = `build/${m.id}.lattice.bin`, metaPath = `build/${m.id}.lattice.json`;
    if (existsSync(binPath) && existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const buf = readFileSync(binPath);
      const grid = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
      const L = { grid, size: meta.size, orig: meta.orig, step: meta.step };
      fn = (cellX, cellZ) => sampleLattice(L, cellX, cellZ) - (meta.seaLevel ?? 0);
    } else console.error(`  ⚠ DEM 교차검증 생략(${m.id}) — ${binPath} 없음`);
  }
  demCache.set(key, fn);
  return fn;
};
const srcMap = MAPS.find((m) => m.heightmap && Math.floor(m.lat0) === cellLat && Math.floor(m.lon0) === cellLon);

// 파일↔매니페스트 정합 + 청크별 불변식 + 플래그 일치 + DEM 정합. 청크는 이음새 검사용으로 수집.
const naturalTerrain = srcMap?.bareEarth === false; // 자연 산악(bareEarth 끔) → terrain-steep 검사 생략(실제 급경사)
const chunks = [];
for (const e of manifest.chunks) {
  const blk = manifest.block || 1; // 블록 디렉터리 분산
  const f = `${dir}/${Math.floor(e.cx / blk)}_${Math.floor(e.cz / blk)}/${e.cx}_${e.cz}.json`;
  if (!existsSync(f)) { report(`${e.cx}_${e.cz}`, [{ level: "error", code: "missing-file", msg: "매니페스트에 있으나 파일 없음" }]); continue; }
  let ch;
  try { ch = JSON.parse(readFileSync(f, "utf8")); }
  catch (err) { report(`${e.cx}_${e.cz}`, [{ level: "error", code: "parse", msg: String(err.message) }]); continue; }
  report(`${e.cx}_${e.cz}`, validateChunk(ch, manifest.chunkSize, { naturalTerrain }));
  report(`${e.cx}_${e.cz}`, validateEntryConsistency(e, ch));
  const dem = demFor(e.m);
  if (dem) report(`${e.cx}_${e.cz}`, validateDemConsistency(ch, manifest.chunkSize, dem));
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
