// 맵데이터 수집·가공 파이프라인 — 한 도시를 처음부터 끝까지 표준 절차로 빌드한다.
//   1) OSM 수집 + 오브젝트 가공(섹션형)     build-maps.mjs
//   2) 타일 청크(지형+오브젝트 결합·클립)    build-world.mjs   ← 지형은 geodem.mjs 가 위치 순수 함수로 샘플
//   3) 검증 게이트(불변식)                  validate-world.mjs   ← 실패 시 전체 실패
//   4) 도시 표면·가로 빌드 → 완성 청크       build-city-surfaces.mjs (도시 전역 가로 컴파일 포함)
//
// 각 단계는 자식 프로세스로 실행하고, 한 단계라도 비0 종료하면 파이프라인을 즉시 중단한다.
// 이것이 맵데이터를 가공하는 단일 진입점 — 개별 스크립트 직접 호출 대신 이 프로그램으로 처리한다.
// 대상 도시는 config/street-regions.json 에 도시 전역 가로 구역이 등록돼 있어야 한다(maps.config 가 걸러낸다).
//
// ── 1단계는 OSM 추출 캐시를 **요구한다**(2026-08-27) ──
// build-maps 는 /tmp/osm-<id>.ndjson 을 읽기만 하고, 없으면 안내와 함께 **즉시 실패**한다.
// (옛 Overpass 1km 타일 폴백은 제거됐다 — 조용한 오염 위험과 70배 속도 차. spec/03-maps.md §OSM 수집.)
// 그러니 이 파이프라인을 부르기 **전에** 추출을 먼저 돌린다:
//
//   curl -L -o /tmp/<region>-latest.osm.pbf https://download.geofabrik.de/<대륙>/<region>-latest.osm.pbf
//   node --max-old-space-size=8192 scripts/import-extract.mjs <id> /tmp/<region>-latest.osm.pbf /tmp/osmconvert
//   node scripts/build-pipeline.mjs <id>
//
// 사용:
//   node scripts/build-pipeline.mjs <id>
import { execFileSync } from "node:child_process";
import {streetRegions} from './street-config.mjs';
import {restoreMapBuildInputs} from './complete-map-chunks.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {buildCitySurfaces} from './build-city-surfaces.mjs';
import { MAPS } from "./maps.config.mjs";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));

if (!id) { console.error("usage: node scripts/build-pipeline.mjs <id>"); process.exit(2); }
const m = MAPS.find((x) => x.id === id);
if (!m) { console.error(`maps.config 에 '${id}' 없음`); process.exit(2); }

// 힙 상한을 **명시**한다 — 대도시는 기본 힙으로 터진다. build-maps 는 NDJSON 전량을 JS 객체로
// 올리고(시카고 762MB → OOM 실측), build-world 도 build/<id>.json 을 통째로 읽는다. import-extract
// 는 이미 호출부에서 같은 값을 받고 있었는데 여기만 빠져 있었다.
// ⚠ 물리 메모리(7.8GB)보다 큰 값이라 **동시에 무거운 작업을 돌리면 여전히 죽는다** — 실측: 이 배치와
//    osmconvert 병합(1.1GB 산출)을 겹쳐 돌렸다가 시카고가 OOM 났다. 맵 빌드는 한 번에 하나만.
const NODE_MEM = "--max-old-space-size=8192";
const run = (label, file, a) => {
  console.error(`\n▶ ${label}  (node ${file} ${a.join(" ")})`);
  try { execFileSync("node", [NODE_MEM, file, ...a], { stdio: "inherit" }); }
  catch (e) { console.error(`\n✗ 단계 실패: ${label} (exit ${e.status ?? "?"})`); process.exit(1); }
};

console.error(`=== 맵데이터 파이프라인: ${id} ===`);

const registeredCities=JSON.parse(readFileSync('config/map-cities.json','utf8'));
const targetCity=Object.entries(registeredCities).find(([name,cell])=>name===(m.stream?.id?.replace(/-stream$/, '')??m.id)||cell[0]===Math.floor(m.lat0)&&cell[1]===Math.floor(m.lon0))?.[0];
streetRegions(targetCity??m.stream?.id?.replace(/-stream$/, '')??m.id,undefined,{requireSource:true,requireCityCoverage:true});
// A first build has no completed chunks to restore inputs from.
if(targetCity&&existsSync(`public/maps/${registeredCities[targetCity].join('/')}/tiles.json`))restoreMapBuildInputs(targetCity);

// 1) OSM 수집 + 오브젝트 가공 → build/<id>.json
run("1/4 OSM 수집·가공", "scripts/build-maps.mjs", [id]);

// 2) 타일 청크(지형+오브젝트 결합, 면/수역 청크 클립) → maps/<lat>/<lon>/
run("2/4 타일 청크", "scripts/build-world.mjs", [id]);

// 3) 검증 게이트 — error 있으면 비0 → 여기서 파이프라인 실패
run("3/4 검증", "scripts/validate-world.mjs", [id]);

// 4) 도시 표면·가로 빌드 → 완성 청크
buildCitySurfaces(targetCity??m.stream?.id?.replace(/-stream$/, '')??m.id);

console.error(`\n✅ ${id} 파이프라인 완료 (OSM → 청크 → 검증 → 표면·가로 빌드; 도로 전수 품질은 build/<city>-road-profile.json 참조)`);
