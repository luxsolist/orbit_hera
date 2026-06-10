// 실측 세계지도(Natural Earth 110m land, GeoJSON) 윤곽을 equirectangular 로 임베드.
// 대륙 path 는 자동 생성(worldLand.ts, scripts/gen-worldmap.mjs). 점(침공 지점)과 동일 투영(x=lon+180, y=90-lat).
import { LAND_PATH } from "./worldLand";

/** 위경도 → 지도 컨테이너 내 백분율 좌표(equirectangular). 점/팝업 배치 공통. */
export function projectLatLon(lat: number, lon: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * 100, y: ((90 - lat) / 180) * 100 };
}

/**
 * 세계지도 점 클러스터링 — threshold(width-%) 이내로 가까운 점들을 한 그룹으로 묶는다(연결성 union, 2:1 종횡비 반영).
 * 근접 도시(서울·부산)는 한 대표 점으로 묶여 확대창에서 세부 표시. 반환: 그룹 배열(각 그룹 members + 대표 위치 x,y=평균). 순수.
 */
export function clusterDots<T extends { x: number; y: number }>(pts: T[], threshold = 2.6, aspect = 0.5): Array<{ members: T[]; x: number; y: number }> {
  const n = pts.length;
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(pts[j].x - pts[i].x, (pts[j].y - pts[i].y) * aspect); // px 비례(width-%)
      if (d < threshold) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, T[]>();
  pts.forEach((p, i) => { const r = find(i); const g = groups.get(r); if (g) g.push(p); else groups.set(r, [p]); });
  return [...groups.values()].map((members) => ({
    members,
    x: members.reduce((s, p) => s + p.x, 0) / members.length,
    y: members.reduce((s, p) => s + p.y, 0) / members.length,
  }));
}

// 월드 SVG 좌표(equirectangular): x = lon+180 (0~360), y = 90−lat (0~180). 전체 지도·확대 지도 공통.
const SVG_W = 360, SVG_H = 180;

/**
 * 시안 톤 세계지도(그리드 + 실측 대륙 윤곽). 전체(기본) 또는 **임의 viewBox 로 크롭(확대)** 가능 — 확대창과 공유.
 * box={x,y,w,h}(SVG 좌표) 주면 그 영역만 보이고 그리드 간격은 step(°)로. 점 위치는 projectInBox 와 동일 기준이라 정확히 일치.
 */
export function buildWorldSvg(box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: SVG_W, h: SVG_H }, step = 30, landStroke = 0.3): string {
  const dim = "rgba(52,245,255,0.09)", main = "rgba(52,245,255,0.22)";
  let g = "";
  const x1 = box.x + box.w, y1 = box.y + box.h;
  if (step > 0) { // step≤0 → 그리드 생략(확대창)
    for (let x = Math.ceil(box.x / step) * step; x <= x1; x += step) { const m = Math.abs(x - 180) < 1e-6; g += `<line x1="${x}" y1="${box.y}" x2="${x}" y2="${y1}" stroke="${m ? main : dim}" stroke-width="${m ? 0.5 : 0.3}"/>`; }
    for (let y = Math.ceil(box.y / step) * step; y <= y1; y += step) { const m = Math.abs(y - 90) < 1e-6; g += `<line x1="${box.x}" y1="${y}" x2="${x1}" y2="${y}" stroke="${m ? main : dim}" stroke-width="${m ? 0.5 : 0.3}"/>`; }
  }
  const land = `<path d="${LAND_PATH}" fill="rgba(52,245,255,0.13)" stroke="rgba(120,245,255,0.62)" stroke-width="${landStroke}" stroke-linejoin="round" fill-rule="evenodd"/>`;
  return (
    `<svg viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="none">` +
    `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="rgba(6,18,28,0.5)"/>` +
    g + land + `</svg>`
  );
}

/**
 * 점들(위경도)을 둘러싸는 **확대 뷰 박스**(SVG 좌표) — 패딩 + 박스 종횡비(boxAspect=너비/높이)에 맞춰 확장(왜곡 방지).
 * 확대창마다 호출하는 공통 로직. minSpan(°)으로 한 점/근접 점도 적당히 확대. 순수.
 */
export function zoomMapBox(items: Array<{ lat: number; lon: number }>, boxAspect: number, padFrac = 0.5, minSpan = 1.2): { x: number; y: number; w: number; h: number } {
  let sxMin = Infinity, sxMax = -Infinity, syMin = Infinity, syMax = -Infinity;
  for (const p of items) { const sx = p.lon + 180, sy = 90 - p.lat; if (sx < sxMin) sxMin = sx; if (sx > sxMax) sxMax = sx; if (sy < syMin) syMin = sy; if (sy > syMax) syMax = sy; }
  const cx = (sxMin + sxMax) / 2, cy = (syMin + syMax) / 2;
  let w = Math.max(sxMax - sxMin, minSpan) * (1 + padFrac * 2);
  let h = Math.max(syMax - syMin, minSpan) * (1 + padFrac * 2);
  if (w / h < boxAspect) w = h * boxAspect; else h = w / boxAspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** 위경도 → 확대 박스 내 백분율(0~100). buildWorldSvg 와 동일 좌표라 점이 지도에 정확히 찍힌다. 순수. */
export function projectInBox(lat: number, lon: number, box: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: ((lon + 180 - box.x) / box.w) * 100, y: ((90 - lat - box.y) / box.h) * 100 };
}

/** 확대 박스 폭(°)에 어울리는 그리드 간격(약 4분할, 1·2·5·10 계열). 순수. */
export function niceGridStep(span: number): number {
  const raw = span / 4, pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}
