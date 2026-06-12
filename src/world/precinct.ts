import type { PrecinctBuilding } from "./MapData";

/** 건물 1동의 최종 양식 — 특수 권역(precinct) 데이터로 높이·지붕·색·생략을 결정. */
export interface BuildingStyle {
  /** 대형 인클로저(마당 솔리드) → 렌더/충돌 생략 */
  skip: boolean;
  /** 최종 높이(권역 층고 상한 반영) */
  height: number;
  /** 옥상 지붕 슬래브 두께(0=없음) */
  roofThick: number;
  /** 옥상 디딤면 높이(= height + roofThick) */
  roofTop: number;
  /** 권역 양식색 사용 여부(false=높이별 도심 팔레트) */
  usePrecinctColor: boolean;
}

/**
 * 경계 내부(inPrecinct) + 권역 건물 양식(pb)으로 건물 1동의 양식을 해석 — 순수 함수.
 * 권역 밖이거나 양식이 없으면 baseH 그대로(일반 도심 건물).
 *
 * @param inPrecinct 경계 폴리곤 내부 여부
 * @param baseH      OSM 원본 높이
 * @param area       footprint 면적(축정렬 bbox) — 대형 인클로저 생략 판정용
 * @param pb         권역 건물 양식(없으면 일반 도심)
 */
export function resolveBuildingStyle(
  inPrecinct: boolean,
  baseH: number,
  area: number,
  pb?: PrecinctBuilding
): BuildingStyle {
  const active = inPrecinct && pb != null;
  if (active && pb.skipEnclosuresOver != null && area > pb.skipEnclosuresOver) {
    return { skip: true, height: 0, roofThick: 0, roofTop: 0, usePrecinctColor: false };
  }
  let height = baseH;
  if (active && pb.maxHeight != null) height = Math.min(height, pb.maxHeight);
  const roofThick = active && pb.roof ? pb.roof.thickness : 0;
  return { skip: false, height, roofThick, roofTop: height + roofThick, usePrecinctColor: active };
}

/**
 * 건물 기본색(HSL 동별 변주 전) — 순수 hex.
 * precinctColor 가 있으면 권역 양식색, 없으면 **높이별 회색 그라데이션**(저층=짙은 회색 → 마천루=밝은 회색, 연속).
 * 채도 0 이라 호출측 명도 jitter(offsetHSL) 후에도 회색 유지.
 */
export function buildingBaseColor(h: number, precinctColor: number | null): number {
  if (precinctColor != null) return precinctColor; // 권역 양식색(예: 경복궁 단청)
  const t = Math.max(0, Math.min(1, (h - 6) / (100 - 6))); // 6m → 100m 구간 정규화
  const v = Math.round(0xa6 + (0xf8 - 0xa6) * t); // 166(밝은 회색) → 248(거의 흰 회색)
  return (v << 16) | (v << 8) | v;
}
