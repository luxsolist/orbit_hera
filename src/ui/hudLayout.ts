import { clamp } from "../core/math";

// 전투 HUD 위젯(후방화면·미니맵·게이지·우하단 버튼·코너 텍스트)의 화면 비례 기하 — 단일 출처(순수).
// 위젯 크기는 화면 짧은 변(vmin)에 비례하되, 가로가 좁은 비율(정사각·4:3 등)에서 상단 행이 겹치지
// 않도록 가로 폭에 맞춰 축소한다. JS(GL 뷰포트·캔버스 해상도·DOM 배치)와 CSS fallback 이 같은 공식을 쓴다.

const WIDGET_SEP = 16; // 상단 위젯(후방/미니맵)과 중앙 게이지 사이 최소 간격(px, 축소 전 기준)
const GAUGE_H = 34; // 게이지 묶음 높이(라벨+트랙, 겹침 검사용 근사)

export interface HudSizes {
  minimap: number; // 미니맵 정사각 한 변(px)
  rearW: number; // 후방화면 너비(px)
  rearH: number; // 후방화면 높이(px)
  margin: number; // 화면 가장자리 여백(px)
}

export interface HudComponents {
  bar: number; // 게이지 바 하나 폭(px)
  gaugeGap: number; // 두 게이지 사이 간격(px)
  gaugeTop: number; // 게이지 묶음 상단 여백(px)
  gaugesW: number; // 게이지 묶음 전체 폭(2*bar + gaugeGap)
  btn: number; // 우하단 버튼 한 변(px)
  btnGap: number; // 버튼 사이 간격(px)
  btnInset: number; // 버튼 클러스터 화면 가장자리 여백(px)
  clusterW: number; // 버튼 2x2 클러스터 폭/높이(2*btn + btnGap)
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudLayout {
  screen: { w: number; h: number };
  scale: number; // 상단 행 축소 배율(<=1, 1=미축소)
  rear: Rect; // 좌상단 후방화면
  minimap: Rect; // 우상단 미니맵
  gauges: Rect; // 상단 중앙 게이지 묶음
  buttons: Rect; // 우하단 터치 버튼 클러스터
  cornerTL: Rect; // 후방 아래 텍스트(좌, w/h=0 — 위치만)
  cornerTR: Rect; // 미니맵 아래 텍스트(우)
}

/** vmin·clamp 한 줄(짧은변 비례 + 상·하한). CSS clamp(min, f·vmin, max) 와 동일 의미. */
const vc = (shortSide: number, f: number, lo: number, hi: number): number => clamp(shortSide * f, lo, hi);

/** 위젯(후방/미니맵/여백) 기본 크기 — 짧은 변 비례, 축소 전. */
export function hudSizes(shortSide: number): HudSizes {
  const minimap = Math.round(vc(shortSide, 0.25, 100, 210));
  return {
    minimap,
    rearW: Math.round(minimap * 1.4),
    rearH: Math.round(minimap * 0.82),
    margin: Math.round(vc(shortSide, 0.02, 10, 18)),
  };
}

/** 게이지·버튼 컴포넌트 기본 크기 — 짧은 변 비례, 축소 전. */
function baseComponents(shortSide: number): HudComponents {
  const bar = Math.round(vc(shortSide, 0.22, 116, 240));
  const gaugeGap = Math.round(vc(shortSide, 0.03, 14, 28));
  const btn = Math.round(vc(shortSide, 0.13, 76, 104));
  const btnGap = Math.round(vc(shortSide, 0.024, 14, 22));
  return {
    bar,
    gaugeGap,
    gaugeTop: Math.round(vc(shortSide, 0.02, 10, 18)),
    gaugesW: 2 * bar + gaugeGap,
    btn,
    btnGap,
    btnInset: Math.round(vc(shortSide, 0.03, 20, 36)),
    clusterW: 2 * btn + btnGap,
  };
}

/**
 * 상단 행(중앙 게이지 + 양쪽 위젯)이 화면 폭에 들어가는 축소 배율(<=1).
 * 게이지가 중앙정렬이라 **더 넓은 코너 위젯**(보통 rearW)이 먼저 닿는다 → maxSide 기준.
 * 필요 폭 = 게이지 + 2·(maxSide + margin + 간격). 폭이 모자라면 비율만큼 축소.
 */
function topRowScale(w: number, base: HudSizes, comps: HudComponents): number {
  const maxSide = Math.max(base.rearW, base.minimap);
  const needed = comps.gaugesW + 2 * (maxSide + base.margin + WIDGET_SEP);
  return needed <= w ? 1 : w / needed;
}

/** 화면 크기 → 위젯 크기(가로 폭에 맞춰 축소 반영). RearView·Minimap·applyHudLayout 공용. */
export function hudSizesFor(w: number, h: number): HudSizes {
  const s = Math.min(w, h);
  const base = hudSizes(s);
  const k = topRowScale(w, base, baseComponents(s));
  if (k === 1) return base;
  return {
    minimap: Math.round(base.minimap * k),
    rearW: Math.round(base.rearW * k),
    rearH: Math.round(base.rearH * k),
    margin: Math.round(base.margin * k),
  };
}

/** 화면 크기 → 컴포넌트 크기. 상단 게이지는 같은 배율로 축소(버튼은 하단이라 미축소). */
export function hudComponentsFor(w: number, h: number): HudComponents {
  const s = Math.min(w, h);
  const base = hudSizes(s);
  const c = baseComponents(s);
  const k = topRowScale(w, base, c);
  if (k === 1) return c;
  const bar = Math.round(c.bar * k);
  const gaugeGap = Math.round(c.gaugeGap * k);
  return { ...c, bar, gaugeGap, gaugesW: 2 * bar + gaugeGap };
}

/**
 * 모든 전투 HUD 컴포넌트의 화면상 사각형(겹침/이탈 검증용·배치용). 순수.
 * 좌표계: 좌상단 원점, px. 게이지는 가로 중앙정렬.
 */
export function hudLayoutRects(w: number, h: number): HudLayout {
  const sz = hudSizesFor(w, h);
  const c = hudComponentsFor(w, h);
  const s = Math.min(w, h);
  const k = topRowScale(w, hudSizes(s), baseComponents(s));
  return {
    screen: { w, h },
    scale: k,
    rear: { x: sz.margin, y: sz.margin, w: sz.rearW, h: sz.rearH },
    minimap: { x: w - sz.margin - sz.minimap, y: sz.margin, w: sz.minimap, h: sz.minimap },
    gauges: { x: Math.round((w - c.gaugesW) / 2), y: c.gaugeTop, w: c.gaugesW, h: GAUGE_H },
    buttons: { x: w - c.btnInset - c.clusterW, y: h - c.btnInset - c.clusterW, w: c.clusterW, h: c.clusterW },
    cornerTL: { x: sz.margin, y: sz.margin + sz.rearH + 22, w: 0, h: 0 },
    cornerTR: { x: w - sz.margin - sz.minimap, y: sz.margin + sz.minimap + 10, w: 0, h: 0 },
  };
}
