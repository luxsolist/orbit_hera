// 도시 100선 → 맵 config 데이터 생성기.
//
// 세 소스를 조인해 scripts/data/city-catalog.json(맵 정의의 단일 출처)을 만든다:
//   docs/spec/09-city-catalog.md   장 배속(1~4)·국가 — 사람이 큐레이션한 정본
//   scripts/data/geocode-city-cache.json  실측 위경도(Nominatim/OSM) — 좌표 날조 금지 원칙의 산물
//   scripts/data/city-names.json   로마자 id(슬러그)·영문 표기 + 기등록 맵 연결(mapId)
//
// 왜 생성기인가: maps.config.mjs 를 손으로 100개 채우면 오탈자·bbox 계산 실수·누락이 그대로
// 수십 분짜리 빌드 낭비가 된다. 여기서 만들고 maps.config 가 읽어 쓰면 소스는 늘 세 데이터 파일뿐이다.
//
// 실행: node scripts/gen-city-config.mjs [--check]
//   --check : 파일을 쓰지 않고 현재 city-catalog.json 과 다르면 비0 종료(CI/테스트 게이트용)

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DOC = "docs/spec/09-city-catalog.md";
const GEO = "scripts/data/geocode-city-cache.json";
const NAMES = "scripts/data/city-names.json";
const OUT = "scripts/data/city-catalog.json";

// 전장 반경 20km(=변 40km) — 기존 서울/부산/에베레스트와 동일 규격. DEM 도 같은 40km 격자.
export const RADIUS_M = 20000;
export const DEM_SIZE = 2048;

const M_LAT = 111320;

/** 도시 중심 → 반경 radius(m) bbox [남,서,북,동]. 경도 폭은 위도 보정. 순수. */
export function radiusBbox(lat, lon, radius = RADIUS_M) {
  const dLat = radius / M_LAT;
  const dLon = radius / (M_LAT * Math.cos((lat * Math.PI) / 180));
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return [r4(lat - dLat), r4(lon - dLon), r4(lat + dLat), r4(lon + dLon)];
}

/** 괄호 주석·공백을 떼어낸 도시명 — 문서 표기("시엠레아프(앙코르)")와 캐시 키("시엠레아프")를 잇는다. 순수. */
export const normCity = (s) => s.replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();

/**
 * 09-city-catalog.md 의 장별 표 → { 도시명 → { chapter, country } }. 순수(문자열 입력).
 *
 * 장마다 표 모양이 다르다:
 *   1장 `| # | 도시 | 국가 | 힌트 |`      3장 `| # | 도시 | 국가 |`
 *   2장 `| 쌍 | 도시 A | 도시 B | 근거 |` (도시가 "뉴욕 (미국)" 꼴로 국가를 품음)
 *   4~6장 `| # | 도시 | 국가 | 권역 |`
 *
 * 표 밖의 **서장** 줄(서울·부산·오사카)은 chapter 0 으로 잡는다 — 표에 없다고 빠뜨리면
 * 100선 중 3개가 조용히 누락된다. 이 줄은 **장 배속 데이터**이지 빌드 상태가 아니다.
 */
export function parseCatalogDoc(md) {
  const out = {};
  const put = (name, chapter, country) => {
    const key = normCity(name);
    if (!key || key === "도시" || key === "도시 A" || key === "도시 B") return;
    if (!out[key]) out[key] = { chapter, country: country || "" };
  };
  // 서장 — "**서장**: 서울(홈) · 부산 · 오사카." 꼴. 국가는 표에 없으므로 빈 값(city-names 가 보정).
  const done = md.match(/\*\*서장\*\*\s*:\s*([^\n]*)/);
  if (done) for (const seg of done[1].split("·")) put(normCity(seg.split(".")[0]), 0, "");

  let chapter = 0;
  for (const line of md.split("\n")) {
    const h = line.match(/^##\s*([1-6])(?:~[1-6])?장\s/);
    if (h) { chapter = Number(h[1]); continue; }
    if (!chapter || !line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3 || /^[:\- ]+$/.test(cells[0])) continue; // 헤더 구분선
    if (chapter === 2) {
      // 자매쌍 — 한 행에 두 도시. "뉴욕 (미국)" 에서 국가를 괄호로 뽑는다.
      for (const cell of [cells[1], cells[2]]) {
        const m = cell.match(/^(.+?)\s*[(（]([^)）]*)[)）]\s*$/);
        if (m) put(m[1], 2, m[2].replace(/기완료/g, "").trim());
        else put(cell, 2, "");
      }
    } else {
      put(cells[1], chapter, cells[2]);
    }
  }
  return out;
}

/** 도시 하나의 맵 config 항목. 순수. */
export function cityEntry(cityKo, meta, geo, name) {
  const bbox = radiusBbox(geo.lat, geo.lon);
  return {
    id: name.id,
    cityKo, //   landmark-catalog.json / geocode-city-cache.json 조회 키(build-maps 의 catalogCity)
    en: name.en,
    country: name.country ?? meta.country, // city-names 의 country 가 문서 표를 보정(서장 3개는 표에 국가가 없음)
    chapter: meta.chapter,
    lat: geo.lat,
    lon: geo.lon,
    bbox,
  };
}

// ─────────────────────────── 실행 ───────────────────────────
// **직접 실행할 때만** 돈다 — 테스트가 위 순수 헬퍼를 import 하는데, 조인 실패 시 process.exit 가
// 파일 전체를 죽여 테스트 14개가 조용히 사라졌다(2026-08-23).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

function main() {
const doc = parseCatalogDoc(readFileSync(DOC, "utf8"));
const geo = JSON.parse(readFileSync(GEO, "utf8"));
const names = JSON.parse(readFileSync(NAMES, "utf8")).cities;

const cities = [];
const missing = [];
for (const [cityKo, name] of Object.entries(names)) {
  const g = geo[cityKo];
  const m = doc[normCity(cityKo)];
  if (!g || typeof g.lat !== "number") { missing.push(`${cityKo}: 실측 좌표 없음(${GEO})`); continue; }
  if (!m) { missing.push(`${cityKo}: 장 배속 없음(${DOC} 표에서 못 찾음)`); continue; }
  // buildExcluded: 큐레이션 정책 판단으로 **빌드하지 않기로 한** 도시(maps.config 가 MAPS 에서 제외).
  // 카탈로그에서 지우지 않고 표시만 하는 이유: 장 배속·도시 100선 집계가 그대로 유지돼야 하고,
  // 왜 빠졌는지가 데이터에 남아야 한다(빈자리는 누락과 구분되지 않는다).
  cities.push({ ...cityEntry(cityKo, m, g, name),
    ...(name.mapId ? { mapId: name.mapId } : {}),
    ...(name.buildExcluded ? { buildExcluded: name.buildExcluded } : {}) });
}

if (missing.length) {
  // 조용한 누락은 "97개 도시를 빌드했는데 3개가 없다"로 나중에 터진다 — 여기서 실패시킨다.
  console.error(`✗ 조인 실패 ${missing.length}건:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

cities.sort((a, b) => a.chapter - b.chapter || a.id.localeCompare(b.id));
const payload = {
  note: `도시 100선 맵 정의 — scripts/gen-city-config.mjs 가 ${DOC}(장·국가) + ${GEO}(실측 좌표) + ${NAMES}(id/영문)에서 생성. 직접 편집하지 말 것: 소스를 고치고 재생성한다. bbox = 중심 반경 ${RADIUS_M / 1000}km.`,
  generator: "scripts/gen-city-config.mjs",
  radiusM: RADIUS_M,
  demSize: DEM_SIZE,
  cityCount: cities.length,
  cities,
};
const text = JSON.stringify(payload, null, 1) + "\n";

if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync(OUT, "utf8"); } catch {}
  if (cur !== text) {
    console.error(`✗ ${OUT} 이 소스와 어긋남 — node scripts/gen-city-config.mjs 로 재생성 필요`);
    process.exit(1);
  }
  console.error(`✓ ${OUT} 최신 (${cities.length}개 도시)`);
} else {
  writeFileSync(OUT, text);
  const byCh = cities.reduce((a, c) => ((a[c.chapter] = (a[c.chapter] ?? 0) + 1), a), {});
  const handled = cities.filter((c) => c.mapId).length;
  const excl = cities.filter((c) => c.buildExcluded).length;
  console.error(`wrote ${OUT}: ${cities.length}개 도시 (장별 ${JSON.stringify(byCh)}, 기등록 맵 연결 ${handled}개, 빌드 제외 ${excl}개)`);
}
}
