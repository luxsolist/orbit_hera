// 맵데이터 수집·가공 파이프라인 — 한 맵을 처음부터 끝까지 표준 절차로 빌드한다.
//   1) 실측 DEM(AWS Terrarium)            build-terrain.mjs real
//   2) OSM 수집 + 오브젝트 가공(섹션형)     build-maps.mjs
//   3) 타일 청크(지형+오브젝트 결합·클립)    build-world.mjs
//   4) 검증 게이트(불변식)                  validate-world.mjs   ← 실패 시 전체 실패
//
// 각 단계는 자식 프로세스로 실행하고, 한 단계라도 비0 종료하면 파이프라인을 즉시 중단한다.
// 이것이 맵데이터를 가공하는 단일 진입점 — 개별 스크립트 직접 호출 대신 이 프로그램으로 처리한다.
//
// 사용:
//   node scripts/build-pipeline.mjs <id> [--no-terrain] [--zoom=13]
//     --no-terrain : DEM(.bin) 재생성 생략(이미 있을 때 빠르게 오브젝트/청크만 갱신)
//     --zoom=N     : terrarium 줌(기본 13)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { MAPS } from "./maps.config.mjs";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const noTerrain = args.includes("--no-terrain");
const zoom = (args.find((a) => a.startsWith("--zoom=")) || "--zoom=13").split("=")[1];

if (!id) { console.error("usage: node scripts/build-pipeline.mjs <id> [--no-terrain] [--zoom=13]"); process.exit(2); }
const m = MAPS.find((x) => x.id === id);
if (!m) { console.error(`maps.config 에 '${id}' 없음`); process.exit(2); }

const run = (label, file, a) => {
  console.error(`\n▶ ${label}  (node ${file} ${a.join(" ")})`);
  try { execFileSync("node", [file, ...a], { stdio: "inherit" }); }
  catch (e) { console.error(`\n✗ 단계 실패: ${label} (exit ${e.status ?? "?"})`); process.exit(1); }
};

console.error(`=== 맵데이터 파이프라인: ${id} ===`);

// 1) 지형 DEM(실측) — heightmap 스펙이 있을 때만.
if (m.heightmap && !noTerrain) {
  run("1/4 실측 DEM(terrarium)", "scripts/build-terrain.mjs",
    ["real", id, String(m.heightmap.size), String(m.heightmap.meters), zoom]);
} else {
  const why = m.heightmap ? "--no-terrain" : "heightmap 스펙 없음";
  if (m.heightmap && !existsSync(`public/${m.heightmap.src}`))
    console.error(`\n⚠ 1/4 DEM 생략(${why}) — 그런데 ${m.heightmap.src} 가 없음(지형이 평지가 됨)`);
  else console.error(`\n▶ 1/4 DEM 생략 (${why})`);
}

// 2) OSM 수집 + 오브젝트 가공 → maps/<id>.json (+ catalogHidden 이면 카탈로그 비노출)
run("2/4 OSM 수집·가공", "scripts/build-maps.mjs", [id]);

// 3) 타일 청크(지형+오브젝트 결합, 면/수역 청크 클립) → maps/<lat>/<lon>/
run("3/4 타일 청크", "scripts/build-world.mjs", [id]);

// 4) 검증 게이트 — error 있으면 비0 → 여기서 파이프라인 실패
run("4/4 검증", "scripts/validate-world.mjs", [id]);

console.error(`\n✅ ${id} 파이프라인 완료 (DEM → OSM → 청크 → 검증 통과)`);
