// Geofabrik 지역 추출(.osm.pbf) → 맵 bbox 잘라내기(osmconvert) → Overpass-JSON 캐시 생성.
// 대면적 수집의 정석: Overpass 타일 폭격 대신 추출 1개에서 bbox 만 잘라 한 번에 확보(서버 부하 없음, 완전·재현 가능).
//
// 실행: node --max-old-space-size=8192 scripts/import-extract.mjs <id> [pbf=/tmp/south-korea.osm.pbf] [osmconvert=/tmp/osmconvert]
// 산출: /tmp/osm-<id>.json (build-maps 가 그대로 소비) → 이후 `node scripts/build-maps.mjs <id>` → build-world → validate.
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

const parser = createOsmParser();
await new Promise((resolve, reject) => {
  const rl = createInterface({ input: createReadStream(out), crlfDelay: Infinity });
  rl.on("line", (l) => parser.line(l));
  rl.on("close", resolve);
  rl.on("error", reject);
});
const j = parser.result();
// **NDJSON(요소 1개 = 1줄)** 로 기록한다. 단일 JSON 은 Node 의 문자열 한계(0x1fffffe8 ≈ 512MB)에
// 걸린다 — 카이로 캐시가 545MB 로 넘어 JSON.stringify/readFileSync 양쪽에서 ERR_STRING_TOO_LONG
// 이 났다(2026-08-23). 100 도시 중 도쿄·델리·멕시코시티 등 대도시가 같은 벽에 부딪힌다.
// 줄 단위면 한 줄이 작아 한계와 무관하고, 읽는 쪽도 스트리밍으로 받을 수 있다.
const cache = `/tmp/osm-${id}.ndjson`;
await new Promise((resolve, reject) => {
  const ws = createWriteStream(cache);
  ws.on("error", reject);
  ws.on("finish", resolve);
  for (const el of j.elements) if (!ws.write(JSON.stringify(el) + "\n")) { /* 백프레셔는 무시 — 로컬 디스크 */ }
  ws.end();
});
const nb = j.elements.filter((x) => x.tags?.building).length;
const nh = j.elements.filter((x) => x.tags?.highway).length;
console.error(`elements ${j.elements.length} (건물 ${nb}, highway ${nh}) → ${cache}`);
console.error(`다음: node scripts/build-maps.mjs ${id} → build-world → validate-world`);
