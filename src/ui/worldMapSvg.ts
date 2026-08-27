// 실측 세계지도(Natural Earth 110m land, GeoJSON) 윤곽을 equirectangular 로 임베드.
// 대륙 path 는 자동 생성(worldLand.ts, scripts/gen-worldmap.mjs). 점(침공 지점)과 동일 투영(x=lon+180, y=90-lat).
import { LAND_PATH } from "./worldLand";

/** 위경도 → 지도 컨테이너 내 백분율 좌표(equirectangular). 점/팝업 배치 공통. */
export function projectLatLon(lat: number, lon: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * 100, y: ((90 - lat) / 180) * 100 };
}

/**
 * 세계지도 점 클러스터링 — threshold(width-%) 이내로 가까운 점들을 한 그룹으로 묶는다(연결성 union, 2:1 종횡비 반영).
 * 근접 도시(서울·부산)는 한 대표 점으로 묶이고, 클릭하면 그 지역으로 **확대**해 풀린다(재귀 확대).
 * 임계값이 화면 백분율이라 배율과 무관하게 같은 시각 밀도를 유지한다 — 이게 재귀 확대가 성립하는 근거다.
 * 반환: 그룹 배열(각 그룹 members + 대표 위치 x,y=평균). 순수.
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
 * 시안 톤 세계지도(그리드 + 실측 대륙 윤곽). 전체(기본) 또는 **임의 viewBox 로 크롭(확대)** 가능 — 재귀 확대가 매 단계 이걸 다시 부른다.
 * box={x,y,w,h}(SVG 좌표) 주면 그 영역만 보이고 그리드 간격은 step(°)로. 점 위치는 projectInBox 와 동일 기준이라 정확히 일치.
 */
export function buildWorldSvg(box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: SVG_W, h: SVG_H }, step = 30, landStroke = 0.3): string {
  const dim = "rgba(52,245,255,0.09)", main = "rgba(52,245,255,0.22)";
  let g = "";
  const x1 = box.x + box.w, y1 = box.y + box.h;
  if (step > 0) { // step≤0 → 그리드 생략
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

/** 지도 뷰 박스(SVG 좌표계 x=lon+180, y=90−lat). 전체 지도·확대 지도·점 투영이 공유하는 단일 기준. */
export interface ViewBox { x: number; y: number; w: number; h: number }

/** 지도 전체 뷰 — 확대하지 않은 기본 상태. */
export const FULL_VIEW: ViewBox = { x: 0, y: 0, w: SVG_W, h: SVG_H };

/**
 * 점들(위경도)을 담는 **확대 뷰 박스**(SVG 좌표) — 패딩 + 박스 종횡비에 맞춰 확장(왜곡 방지).
 *
 * 옛 zoomMapBox 는 "최근접 쌍을 화면에서 13% 이상 벌린다"는 목표를 함께 지려다 **여백을 0 으로
 * 붕괴**시켰다(축소 하한이 `exW/w` 라 상자 폭이 점 분포 폭과 같아지는 지점까지 당겨졌다). 그 결과
 * 양 끝 도시가 0%·100% 에 박혀 점이 테두리에 잘렸다(실측: 서울 0.0% · 나라 100.0%).
 *
 * 재귀 확대(drill-down)로 바뀌면서 그 목표 자체가 불필요해졌다 — 한 화면에 다 벌려 놓을 필요가 없고,
 * 겹치면 한 번 더 파고들면 된다. 그래서 이 함수는 **담기만** 한다: 여백은 항상 padFrac 만큼 남는다.
 */
export function fitViewBox(
  items: Array<{ lat: number; lon: number }>,
  boxAspect: number,
  padFrac = 0.35,
  minSpan = 0.02, // ≈2.2km — 같은 자리에 겹친 점에서 무한 확대 방지
): ViewBox {
  if (!items.length) return { ...FULL_VIEW };
  let sxMin = Infinity, sxMax = -Infinity, syMin = Infinity, syMax = -Infinity;
  for (const p of items) {
    const sx = p.lon + 180, sy = 90 - p.lat;
    if (sx < sxMin) sxMin = sx; if (sx > sxMax) sxMax = sx;
    if (sy < syMin) syMin = sy; if (sy > syMax) syMax = sy;
  }
  const cx = (sxMin + sxMax) / 2, cy = (syMin + syMax) / 2;
  let w = Math.max(sxMax - sxMin, minSpan) * (1 + padFrac * 2);
  let h = Math.max(syMax - syMin, minSpan) * (1 + padFrac * 2);
  if (w / h < boxAspect) w = h * boxAspect; else h = w / boxAspect;
  return clampToWorld({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/**
 * 뷰 박스를 세계 범위 안으로 — 크기가 넘치면 줄이고, 위치만 넘치면 **밀어 넣는다**(크기 유지).
 * 밖으로 나간 채 두면 지도 옆에 빈 공간이 생기고 점 좌표가 화면 밖으로 벗어난다.
 */
export function clampToWorld(b: ViewBox): ViewBox {
  const w = Math.min(b.w, SVG_W), h = Math.min(b.h, SVG_H);
  return {
    w, h,
    x: Math.min(Math.max(b.x, 0), SVG_W - w),
    y: Math.min(Math.max(b.y, 0), SVG_H - h),
  };
}

/**
 * 뷰 박스를 (cx,cy) 중심으로 k 배 축소(k<1 = 확대). 재귀 확대가 **매번 전진**하도록 보장하는 데 쓴다.
 *
 * 왜 필요한가: fitViewBox 는 점 분포에만 의존하므로, 같은 군집을 다시 클릭하면 **같은 박스**가 나온다.
 * 등간격으로 늘어선 N 개(예: 25개가 2.45% 간격)는 확대해도 상대 간격이 그대로라 영원히 안 쪼개진다 —
 * 클릭이 먹히지 않는 것처럼 보인다. 호출부가 "전진 없음"을 감지하면 이걸로 강제 확대한다.
 */
export function zoomAt(b: ViewBox, cx: number, cy: number, k: number): ViewBox {
  const w = b.w * k, h = b.h * k;
  return clampToWorld({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/**
 * 군집을 **반드시 쪼개는** 다음 뷰(순수) — 재귀 확대의 핵심 계약.
 *
 * fitViewBox 만으로는 부족하다. 그 함수는 점 분포에만 의존해 "담기만" 하므로 **상대 간격이 보존**되고,
 * 등간격으로 늘어선 다수는 아무리 확대해도 같은 군집으로 남는다(실측: 100도시 확장 시 동아시아
 * 25개가 2.45% 간격 — 군집 임계 2.6% 미만이라 영원히 한 덩어리다. 사용자에겐 "클릭이 안 먹는다").
 *
 * 그래서 판정 기준은 "박스가 줄었나"가 아니라 **"군집이 실제로 쪼개졌나"** 다. 안 쪼개지면 중심 기준
 * 강제 확대를 반복한다 — 일부 멤버가 뷰 밖으로 나가지만 축소로 돌아갈 수 있으니 갇히지 않는다.
 */
export function zoomToSplit(
  members: Array<{ lat: number; lon: number }>,
  cur: ViewBox,
  boxAspect: number,
  threshold = 2.6,
  maxSteps = 12,
): ViewBox {
  if (members.length < 2) return fitViewBox(members, boxAspect);
  const cx = members.reduce((a, m) => a + m.lon + 180, 0) / members.length;
  const cy = members.reduce((a, m) => a + 90 - m.lat, 0) / members.length;
  /** 이 뷰에서 멤버들이 여전히 **통째로 한 군집**인가. */
  const stillOne = (b: ViewBox): boolean => {
    const g = clusterDots(members.map((m) => projectInBox(m.lat, m.lon, b)), threshold);
    return g.length === 1;
  };
  let next = fitViewBox(members, boxAspect);
  for (let i = 0; i < maxSteps && stillOne(next); i++) {
    const shrunk = zoomAt(next, cx, cy, 0.5);
    if (shrunk.w >= next.w) break; // 세계 경계에 막혀 더 못 줄인다 — 무한 루프 방지
    next = shrunk;
  }
  // 확대인데 오히려 넓어지는 경우는 없어야 한다(전체 뷰에서 시작하면 항상 좁아진다).
  return next.w < cur.w ? next : zoomAt(cur, cx, cy, 0.5);
}

/** 위경도 → 확대 박스 내 백분율(0~100). buildWorldSvg 와 동일 좌표라 점이 지도에 정확히 찍힌다. 순수. */
export function projectInBox(lat: number, lon: number, box: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: ((lon + 180 - box.x) / box.w) * 100, y: ((90 - lat - box.y) / box.h) * 100 };
}

/**
 * 표류 벡터 오버레이(캠페인 §9.2-5) — 격멸 미션마다 쌓인 소산 표류 방향을 지도 위 화살표로.
 * 3장 전에는 "조용한 이상 데이터"(짧고 옅은 선), 교점(convergence)이 열리면 진원 마커가 맥동한다.
 * 세계지도와 같은 viewBox(0 0 360 180) 전면 SVG 문자열 반환 — worldMap innerHTML 에 겹쳐 넣는다. 순수.
 */
export function driftOverlaySvg(
  vectors: readonly { x: number; z: number; dx: number; dz: number }[],
  convergence: { show: boolean; lat: number; lon: number },
  box: ViewBox = FULL_VIEW,
): string {
  if (vectors.length === 0 && !convergence.show) return "";
  // 화살표·마커 크기는 **뷰 폭에 비례**한다. 고정 °로 두면 확대할수록 화면에서 거대해져 지도를 덮는다
  // (전체 폭 360° 기준 7° = 화면의 약 2%). 선 두께도 같은 이유로 배율을 따른다.
  const k = box.w / SVG_W;
  const LEN = 7 * k; //  화살표 길이(°) — 어느 배율에서나 화면상 같은 길이로 읽힌다
  const SW = 0.45 * k, R_DOT = 0.7 * k, R_RING = 2.2 * k, R_CORE = 0.9 * k;
  let g = "";
  for (const v of vectors) {
    const x0 = v.x + 180, y0 = 90 - v.z;
    const x1 = x0 + v.dx * LEN, y1 = y0 + v.dz * LEN;
    // 짧은 꼬리 + 끝점 강조(화살촉 대신 점 — 소산 입자의 잔광)
    g += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"` +
      ` stroke="rgba(255,120,90,0.4)" stroke-width="${SW.toFixed(3)}"/>` +
      `<circle cx="${x1.toFixed(2)}" cy="${y1.toFixed(2)}" r="${R_DOT.toFixed(3)}" fill="rgba(255,140,100,0.55)"/>`;
  }
  if (convergence.show) {
    const cx = convergence.lon + 180, cy = 90 - convergence.lat;
    g += `<g class="drift-origin"><circle cx="${cx}" cy="${cy}" r="${R_RING.toFixed(3)}" fill="none" stroke="rgba(255,80,60,0.9)" stroke-width="${(0.5 * k).toFixed(3)}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${R_CORE.toFixed(3)}" fill="rgba(255,80,60,0.95)"/></g>`;
  }
  return `<svg class="drift-overlay" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="none">${g}</svg>`;
}

/**
 * 라벨 폭 추정(px) — 실제 측정 없이 배치 면을 정하기 위한 근사. 10px 모노스페이스 기준으로
 * CJK/한글은 1em, 그 외는 0.6em 으로 센다. 정확할 필요는 없고 **넘칠지 여부**만 가리면 된다.
 */
export function estLabelPx(text: string, fontPx = 10): number {
  let w = 0;
  for (const ch of text) w += /[\u1100-\u11FF\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFF60]/.test(ch) ? fontPx : fontPx * 0.6;
  return w;
}

/**
 * 라벨을 점의 어느 쪽에 둘지(순수) — "x>55% 면 왼쪽" 같은 **고정 임계값이 아니라 실제 폭**으로 정한다.
 *
 * 고정 임계값은 이름 길이를 모른다: 옛 확대창에서 `"루앙프라방 · Luang Prabang"`(추정 146px)이
 * 폭 306px 상자의 x=50% 에서도 넘쳐 잘렸다. 양쪽 다 안 들어가면 어차피 넘치므로 **넓은 쪽**을 준다.
 */
export function labelSide(xPct: number, textPx: number, mapPx: number, gapPx = 10): "r" | "l" {
  const px = (xPct / 100) * mapPx;
  const fitsRight = px + gapPx + textPx <= mapPx;
  const fitsLeft = px - gapPx - textPx >= 0;
  if (fitsRight) return "r";
  if (fitsLeft) return "l";
  return px < mapPx / 2 ? "r" : "l"; // 둘 다 불가 — 여유가 더 큰 쪽
}

/** 확대 박스 폭(°)에 어울리는 그리드 간격(약 4분할, 1·2·5·10 계열). 순수. */
export function niceGridStep(span: number): number {
  const raw = span / 4, pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}
