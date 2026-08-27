// 배포 청크의 **승격 랜드마크 전수 감사** — 큐레이션 정책(03-maps.md §큐레이션 배제 기준) 위반 후보를 뽑는다.
//
// 왜 큐레이션 카탈로그가 아니라 배포 청크를 보는가: 랜드마크의 대다수는 큐레이션이 아니라
// landmarkFrom() 태그+면적 **자동 승격**으로 들어온다(실측 2026-08-27: 큐레이션 8~26 대 자동
// 2~844 — 정책이 관장하던 범위는 전체의 1~10%였다). 카탈로그만 보면 실제로 배포되는 것을 못 본다.
//
// 이 스크립트는 **판정하지 않는다** — 사람이 볼 후보를 좁힐 뿐이다. 과잉 포착이 설계 의도다
// (실측: 6,190건 → 219건, 그중 다수가 오탐 — "المستنصرية"가 نصر(승리)에, "Santa Cecilia"가
// cecil(세실 로즈)에 걸린다). 놓치는 것이 오탐보다 훨씬 비싸다.
//
// 실행: node scripts/audit-landmarks.mjs [맵id...]   (인자 없으면 전체)
//   차단된 항목은 이미 lm/n 이 지워져 청크에 없다 — 즉 이 감사에 안 잡히면 차단이 먹은 것이다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MAPS_DIR = "public/maps";
const only = new Set(process.argv.slice(2));

// 정책 5범주에 걸릴 수 있는 어휘 — 다국어. 도시가 늘면 여기에 언어를 보탠다.
const RULES = [
  ["궁전·관저", /palace|palazzo|palacio|palais|saray|قصر|كاخ|کاخ|宮殿|宫殿|王宫|王宮|궁전|राजभवन|presidential|president|رئاسة|رئاسي|大統領|총통|government house|secretariat|राष्ट्रपति/i],
  ["승리·전쟁", /victory|triumph|conquer|conquest|انتصار|勝利|戦勝|战胜|승전|war memorial|arc de|arch of|개선문|凯旋|凱旋|قوس النصر/i],
  ["순교·전몰", /martyr|شهيد|شهداء|순교|殉国|殉國|忠烈|unknown soldier|무명용사|慰霊/i],
  ["혁명·정당", /revolution|革命|혁명|انقلاب|ثورة|ba'?ath|بعث|communist|共産|共产|國民黨/i],
  ["영묘·기념관", /mausoleum|ضريح|مقبرة|آرامگاه|陵墓|陵园|영묘|기념관|纪念堂|記念堂|纪念馆|記念館|tomb of|memorial hall/i],
  ["군사", /military|army|barracks|garrison|arsenal|عسكري|جيش|军事|軍事|병영|自衛隊|국방/i],
  ["식민·인물", /rhodes|columbus|colón|leopold|clive|kitchener|mussolini|franco|lenin|stalin|chiang|kai-shek|장제스|毛主席|毛泽东/i],
  ["신사·합사", /yasukuni|靖国|靖國|護国|忠魂/i],
];

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".json") && !p.endsWith("tiles.json")) out.push(p);
  }
  return out;
};

const idx = JSON.parse(readFileSync(join(MAPS_DIR, "index.json"), "utf8"));
const maps = (Array.isArray(idx) ? idx : idx.maps).filter((m) => m.stream && (!only.size || only.has(m.id)));

const flagged = {};
let total = 0;
for (const m of maps) {
  const dir = join(MAPS_DIR, `${Math.floor(m.lat)}/${Math.floor(m.lon)}`);
  let files;
  try { files = walk(dir); } catch { continue; }
  const seen = new Map();
  for (const f of files) {
    let j;
    try { j = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    for (const b of j.objects?.buildings ?? []) if (b.n) seen.set(b.n, b.lm ?? "?");
    for (const s of j.objects?.sites ?? []) if (s.n) seen.set(s.n, s.lm ?? "?");
  }
  total += seen.size;
  for (const [n, cls] of seen) {
    for (const [tag, re] of RULES) {
      if (re.test(n)) { (flagged[tag] ??= []).push(`${m.id.replace("-stream", "")}\t${cls}\t${n}`); break; }
    }
  }
}

const hits = Object.values(flagged).reduce((a, v) => a + v.length, 0);
console.error(`감사 대상 ${maps.length}개 맵 · 승격 랜드마크 ${total}건 → 검토 후보 ${hits}건`);
for (const [tag, list] of Object.entries(flagged)) {
  console.log(`\n===== ${tag} (${list.length}) =====`);
  for (const l of list.sort()) console.log("  " + l);
}
