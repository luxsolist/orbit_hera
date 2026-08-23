// Geofabrik 지역 추출(.osm.pbf) → 맵 bbox 잘라내기(osmconvert) → Overpass-JSON 캐시 생성.
// 대면적 수집의 정석: Overpass 타일 폭격 대신 추출 1개에서 bbox 만 잘라 한 번에 확보(서버 부하 없음, 완전·재현 가능).
//
// 실행: node --max-old-space-size=8192 scripts/import-extract.mjs <id> [pbf=/tmp/south-korea.osm.pbf] [osmconvert=/tmp/osmconvert]
// 산출: /tmp/osm-<id>.json (build-maps 가 그대로 소비) → 이후 `node scripts/build-maps.mjs <id>` → build-world → validate.
import { execFileSync } from "node:child_process";
import { createReadStream, writeFileSync, existsSync, statSync } from "node:fs";
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
const cache = `/tmp/osm-${id}.json`;
writeFileSync(cache, JSON.stringify(j));
const nb = j.elements.filter((x) => x.tags?.building).length;
const nh = j.elements.filter((x) => x.tags?.highway).length;
console.error(`elements ${j.elements.length} (건물 ${nb}, highway ${nh}) → ${cache}`);
console.error(`다음: node scripts/build-maps.mjs ${id} → build-world → validate-world`);
