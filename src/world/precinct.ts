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
 * precinctColor 가 있으면 권역 양식색, 없으면 높이별 도심 팔레트(저층→마천루).
 */
export function buildingBaseColor(h: number, precinctColor: number | null): number {
  if (precinctColor != null) return precinctColor; // 권역 양식색(예: 경복궁 단청)
  if (h < 9) return 0xe6c23a; // 저층 — 황금/베이지
  if (h < 22) return 0x3fb56a; // 중층 — 녹색
  if (h < 45) return 0x3a82e0; // 고층 — 파랑
  return 0x2fcadf; // 마천루(유리) — 시안
}
