// 미니맵 뷰 기하 — **순수 함수만**. 고도 줌, 거리 링 눈금, 테두리 화살표 선별.
//
// 왜 분리했나: Minimap 은 캔버스 컨텍스트에 묶여 있어 테스트가 어렵다. 반면 "고도 100m 에서
// 반경이 얼마인가", "화살표가 몇 개 남는가" 같은 판단은 게임 감각을 좌우하는데 조용히 틀리기 쉽다.
// 그리기와 판단을 갈라 판단만 여기서 못박는다.

import { clamp } from "../core/math";

/** 미니맵이 담는 월드 반경(m)의 하·상한. */
export const MM_RADIUS_MIN = 45; //  저고도 — 골목 단위 식별
export const MM_RADIUS_MAX = 300; // 비행 천장(1000m) 부근 — 구역 전체 조망

// 거듭제곱 곡선의 기준점: 비행 스폰 고도(flyer.spawnHeight=100m)에서 80m.
// 지수 0.58 은 "고도 10배 → 반경 3.8배". 선형이면 저고도에서 거의 변화가 없고
// 로그면 고고도에서 상한에 못 미친다(실계산: ln 곡선은 1000m 에서 124m 에 그쳤다).
const AGL_REF = 100;
const R_REF = 80;
const EXP = 0.58;

/**
 * 고도(AGL, 지면 위 m) → 미니맵 월드 반경(m). 낮으면 확대(반경↓), 높으면 축소(반경↑).
 *
 * 지면 **상대** 고도인 이유: 절대 Y 를 쓰면 고지대 전장(에베레스트)에서 지상에 서 있어도
 * 최대 축소가 된다. PlayerController.HARD_CEILING·StreamingWorld LOD 도 같은 규약이다.
 *
 * 곡선상 반경이 하한에 닿는 지점은 약 37m — 보행 드론(eye≈1.7m)과 저공비행은 전부 최대 확대다.
 */
export function minimapRadiusFor(agl: number): number {
  const a = Math.max(1e-3, agl);
  return clamp(R_REF * Math.pow(a / AGL_REF, EXP), MM_RADIUS_MIN, MM_RADIUS_MAX);
}

/**
 * 지수 감쇠 추종 — 프레임률과 무관하게 같은 시간상수로 수렴한다(dt 를 그대로 곱하면 안 된다).
 * 고도는 비행 중 빠르게 변해 목표 반경을 그대로 쓰면 미니맵이 떨린다.
 */
export function approach(current: number, target: number, dt: number, tau = 0.35): number {
  if (!(dt > 0)) return current;
  if (Math.abs(target - current) < 0.05) return target; // 끝없는 미세 드리프트 차단
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

// 눈금 사다리 — 사람이 암산하는 수만 남긴다(30·70 같은 값은 거리감에 도움이 안 된다).
const STEPS = [5, 10, 20, 25, 50, 100, 200, 500];

/**
 * 거리 링 반경(m) 목록 — 반경이 변해도 링이 항상 **둥근 수**가 되게 한다.
 * 링을 2~4개로 유지: 하나면 척도를 못 읽고, 많으면 지형을 덮는다.
 */
export function ringRadiiFor(worldRadius: number): number[] {
  const step = STEPS.find((s) => worldRadius / s <= 4) ?? STEPS[STEPS.length - 1];
  const out: number[] = [];
  for (let r = step; r < worldRadius * 0.98; r += step) out.push(r);
  return out;
}

/** 각도 차(부호 없음, 0..π) — 경계(±π)를 넘어도 올바르게. */
export function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/** 테두리 화살표 후보 — a=미니맵 로컬 각(rad), d=거리(m). */
export interface EdgeMarker {
  a: number;
  d: number;
}

/**
 * 테두리 화살표 선별 — **가까운 것 우선**, 각도가 겹치면 버린다.
 *
 * 랜드마크는 밀집 도시에서 로드 반경 안에만 수십 개다(델리 셀 193개). 전부 그리면 테두리가
 * 화살표로 둘러싸여 방향 정보가 사라진다 — 겹침 제거가 이 기능의 핵심이지 장식이 아니다.
 * out 을 재사용해 프레임마다 배열을 새로 만들지 않는다.
 */
export function pickEdgeMarkers(
  items: ReadonlyArray<EdgeMarker>,
  out: EdgeMarker[],
  max = 4,
  minSep = 0.22, // rad ≈ 12.6°
): EdgeMarker[] {
  out.length = 0;
  const sorted = [...items].sort((p, q) => p.d - q.d);
  for (const it of sorted) {
    if (out.length >= max) break;
    if (out.some((o) => angDiff(o.a, it.a) < minSep)) continue;
    out.push(it);
  }
  return out;
}
