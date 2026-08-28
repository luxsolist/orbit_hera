// 맵데이터 수집·가공 파이프라인 — 한 맵을 처음부터 끝까지 표준 절차로 빌드한다.
//   1) 실측 DEM(AWS Terrarium)            build-terrain.mjs real   ← stream 맵이면 건너뜀(아래 참조)
//   2) OSM 수집 + 오브젝트 가공(섹션형)     build-maps.mjs
//   3) 타일 청크(지형+오브젝트 결합·클립)    build-world.mjs
//   4) 검증 게이트(불변식)                  validate-world.mjs   ← 실패 시 전체 실패
//
// 각 단계는 자식 프로세스로 실행하고, 한 단계라도 비0 종료하면 파이프라인을 즉시 중단한다.
// 이것이 맵데이터를 가공하는 단일 진입점 — 개별 스크립트 직접 호출 대신 이 프로그램으로 처리한다.
//
// ── 1단계는 스트리밍 맵에서 죽은 작업이다(2026-08-24) ──
// 지형이 위치 순수 함수로 전환된 뒤(geodem.mjs) build-world 는 도시별 .bin 을 전혀 읽지 않는다
// (mapDef.heightmap.meters 라는 숫자 하나만 커버리지 크기로 쓴다 — 파일 내용 무관). 그런데도
// 1단계는 여전히 Terrarium 타일을 받아 2048² 격자를 굽고 build/<id>.terrain.bin 을 쓴다.
// 타일은 geodem 과 같은 /tmp 캐시를 공유해 재다운로드는 아니지만, 형태학 연산이 중복되고
// 아무도 안 읽는 16MB 파일이 도시마다 남는다(실측: 홍콩 빌드에서 "terrarium z13: 10×10 tiles"가
// 1·3단계에 한 번씩 두 번 찍혔다). 101개 맵 전부 stream 을 쓰므로(monolithic World 로 로드되는
// 경로가 없다 — catalogHidden 이라 build-maps 의 비-스트리밍 카탈로그에도 안 실린다) 1단계는
// 무조건 건너뛴다. --no-terrain 은 이제 실질적으로 항상 켜진 상태와 같지만, 미래의 비-스트리밍
// 맵(있다면 monolithic World 가 .bin 을 직접 읽는다)을 위해 옵션 자체는 남겨 둔다.
//
// ── 2단계는 OSM 추출 캐시를 **요구한다**(2026-08-27) ──
// build-maps 는 /tmp/osm-<id>.ndjson 을 읽기만 하고, 없으면 안내와 함께 **즉시 실패**한다.
// (옛 Overpass 1km 타일 폴백은 제거됐다 — 조용한 오염 위험과 70배 속도 차. spec/03-maps.md §OSM 수집.)
// 그러니 이 파이프라인을 부르기 **전에** 추출을 먼저 돌린다:
//
//   curl -L -o /tmp/<region>-latest.osm.pbf https://download.geofabrik.de/<대륙>/<region>-latest.osm.pbf
//   node --max-old-space-size=8192 scripts/import-extract.mjs <id> /tmp/<region>-latest.osm.pbf /tmp/osmconvert
//   node scripts/build-pipeline.mjs <id>
//
// 사용:
//   node scripts/build-pipeline.mjs <id> [--force-terrain] [--zoom=13]
//     --force-terrain : stream 맵이라도 1단계(도시별 .bin)를 강제로 굽는다(디버깅용 — 평소엔 불필요)
//     --zoom=N        : terrarium 줌(기본 13)
import { execFileSync } from "node:child_process";
import { MAPS } from "./maps.config.mjs";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
// 옛 --no-terrain 플래그는 파싱하지 않는다(무해한 미인식 인자로 무시됨) — 지금은 기본이 "생략"이라
// 뜻이 뒤집혔다. 예전 호출부에 남아 있어도 동작에 영향 없다.
const forceTerrain = args.includes("--force-terrain");
const zoom = (args.find((a) => a.startsWith("--zoom=")) || "--zoom=13").split("=")[1];

if (!id) { console.error("usage: node scripts/build-pipeline.mjs <id> [--force-terrain] [--zoom=13]"); process.exit(2); }
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

// 1) 지형 DEM(실측) — stream 맵은 build-world 가 geodem 으로 직접 뽑으므로 원칙적으로 불필요.
//    heightmap 스펙이 있고, stream 이 아니거나(미래의 monolithic 맵) --force-terrain 일 때만 굽는다.
if (m.heightmap && (forceTerrain || !m.stream)) {
  run("1/4 실측 DEM(terrarium)", "scripts/build-terrain.mjs",
    ["real", id, String(m.heightmap.size), String(m.heightmap.meters), zoom]);
} else if (m.heightmap) {
  console.error(`\n▶ 1/4 DEM 생략 — stream 맵은 build-world 가 geodem 으로 직접 샘플(도시별 .bin 미사용)`);
} else {
  console.error(`\n▶ 1/4 DEM 생략 (heightmap 스펙 없음)`);
}

// 2) OSM 수집 + 오브젝트 가공 → maps/<id>.json (+ catalogHidden 이면 카탈로그 비노출)
run("2/4 OSM 수집·가공", "scripts/build-maps.mjs", [id]);

// 3) 타일 청크(지형+오브젝트 결합, 면/수역 청크 클립) → maps/<lat>/<lon>/
run("3/4 타일 청크", "scripts/build-world.mjs", [id]);

// 4) 검증 게이트 — error 있으면 비0 → 여기서 파이프라인 실패
run("4/4 검증", "scripts/validate-world.mjs", [id]);

console.error(`\n✅ ${id} 파이프라인 완료 (DEM → OSM → 청크 → 검증 통과)`);
