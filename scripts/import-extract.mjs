// Geofabrik 지역 추출(.osm.pbf) → 맵 bbox 잘라내기(osmconvert) → Overpass-JSON 캐시 생성.
// 대면적 수집의 정석: Overpass 타일 폭격 대신 추출 1개에서 bbox 만 잘라 한 번에 확보(서버 부하 없음, 완전·재현 가능).
//
// 실행: node --max-old-space-size=8192 scripts/import-extract.mjs <id> [pbf=/tmp/south-korea.osm.pbf] [osmconvert=/tmp/osmconvert]
// 산출: /tmp/osm-<id>.ndjson (build-maps 가 스트리밍으로 소비) → 이후 `node scripts/build-maps.mjs <id>` → build-world → validate.
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { MAPS } from "./maps.config.mjs";
import { createOsmParser } from "./osmxml.mjs";

const id = process.argv[2];
const pbf = process.argv[3] || "/tmp/south-korea.osm.pbf";
const osmconvert = process.argv[4] || "/tmp/osmconvert";
const m = MAPS.find((x) => x.id === id);
if (!id || !m) { console.error(`usage: import-extract.mjs <id>  (maps.config 에 bbox 필요)`); process.exit(1); }
if (!existsSync(pbf)) { console.error(`pbf 없음: ${pbf}`); process.exit(1); }
if (!existsSync(osmconvert)) { console.error(`osmconvert 없음: ${osmconvert} (gcc osmconvert.c -lz -O3 -o ...)`); process.exit(1); }

const [s, w, n, e] = m.bbox; // [남,서,북,동]
const out = `/tmp/${id}-extract.osm`;
if (!existsSync(out) || statSync(out).size < 1000 || process.env.REEXTRACT === "1") {
  console.error(`osmconvert bbox 추출 ${id}: lon ${w}..${e}, lat ${s}..${n}`);
  // --drop-author/--drop-version: 노드·웨이마다 붙는 version/timestamp/changeset 속성을 뺀다.
  // 우리가 전혀 쓰지 않는 메타인데 XML 부피의 상당량을 차지한다 — 아테네 실측 **828 → 520 MB(-37%)**.
  // 파싱은 전량을 메모리에 올리므로(osmxml) 이 감소가 그대로 OOM 여유가 된다. 7GB 머신에서
  // 아테네가 힙 5.8GB 로 겨우 통과했고 첫 시도는 실제로 죽었다.
  execFileSync(osmconvert, [pbf, `-b=${w},${s},${e},${n}`, "--complete-ways", "--complete-multipolygons",
    "--drop-author", "--drop-version", "--out-osm", `-o=${out}`],
    { stdio: ["ignore", "ignore", "inherit"], maxBuffer: 1 << 30 });
} else console.error(`기존 추출 재사용: ${out}`);
console.error(`추출 XML: ${(statSync(out).size / 1048576).toFixed(0)} MB → 스트리밍 파싱`);

// ── 파싱 → NDJSON 기록을 **한 패스로** 흘려보낸다 ──
// 요소를 배열에 모았다가 마지막에 쓰면 전량이 메모리에 남는다(오사카 3.0M 요소). 파서가 요소를
// 완성하는 즉시 한 줄씩 기록하면 그 객체는 바로 쓰레기가 된다.
//
// **역압 처리 필수**: write() 가 false 를 돌려줄 때 계속 밀어 넣으면 커널이 아니라 Node 내부
// 버퍼에 쌓여, 메모리를 줄이려던 게 도로 아미타불이 된다. 쓰기 버퍼가 차면 읽기를 멈춘다.
const cache = `/tmp/osm-${id}.ndjson`;
let nb = 0, nh = 0, count = 0;

await new Promise((resolve, reject) => {
  const ws = createWriteStream(cache);
  const rl = createInterface({ input: createReadStream(out), crlfDelay: Infinity });
  let paused = false;
  const parser = createOsmParser((el) => {
    count++;
    if (el.tags?.building) nb++;
    if (el.tags?.highway) nh++;
    if (!ws.write(JSON.stringify(el) + "\n") && !paused) { paused = true; rl.pause(); }
  });
  ws.on("drain", () => { if (paused) { paused = false; rl.resume(); } });
  ws.on("error", reject);
  rl.on("line", (l) => parser.line(l));
  rl.on("error", reject);
  rl.on("close", () => { ws.end(); });
  ws.on("finish", () => { console.error(`  노드 ${parser.stats().nodes} · way ${parser.stats().ways}`); resolve(); });
});

console.error(`elements ${count} (건물 ${nb}, highway ${nh}) → ${cache}`);
console.error(`다음: node scripts/build-maps.mjs ${id} → build-world → validate-world`);
