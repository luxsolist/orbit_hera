// Natural Earth 110m land(GeoJSON, 공개 도메인) → equirectangular(x=lon+180, y=90-lat) SVG path
// → src/ui/worldLand.ts 로 임베드. 재생성: `node scripts/gen-worldmap.mjs`
import { writeFileSync } from "node:fs";

const URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson";

const r1 = (n) => Math.round(n * 10) / 10; // 0.1° ≈ 11km — 소형 지도엔 충분, 경로 크기 절감

function ringPath(ring) {
  let d = "", px = null, py = null, started = false;
  for (const [lon, lat] of ring) {
    const x = r1(lon + 180), y = r1(90 - lat);
    if (x === px && y === py) continue; // 반올림 후 중복점 제거
    d += (started ? "L" : "M") + x + " " + y + " ";
    started = true; px = x; py = y;
  }
  return started ? d + "Z" : "";
}

const gj = await (await fetch(URL)).json();
const parts = [];
for (const f of gj.features) {
  const g = f.geometry;
  if (!g) continue;
  if (g.type === "Polygon") for (const ring of g.coordinates) parts.push(ringPath(ring));
  else if (g.type === "MultiPolygon") for (const poly of g.coordinates) for (const ring of poly) parts.push(ringPath(ring));
}
const d = parts.filter(Boolean).join(" ");
const out =
  "// 자동 생성: Natural Earth 110m land(GeoJSON, 공개 도메인) → equirectangular SVG path.\n" +
  "// x = lon+180, y = 90-lat (viewBox 360×180). 편집 금지 — scripts/gen-worldmap.mjs 로 재생성.\n" +
  "export const LAND_PATH =\n  \"" + d + "\";\n";
writeFileSync("src/ui/worldLand.ts", out);
console.log("rings:", parts.filter(Boolean).length, "| path chars:", d.length);
