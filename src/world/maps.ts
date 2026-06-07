// 전장(맵) 데이터를 플레이 타임에 서버(정적 호스팅)에서 내려받는다. public/maps/<id>.json.
import type { MapCatalogEntry, NormalizedMap } from "./MapData";
import { normalizeMapData } from "./MapData";
import { makeLoader } from "../core/loader";

const loader = makeLoader<MapCatalogEntry, unknown>("maps", "전장");

/** 전장 목록(카탈로그) */
export const fetchCatalog = (): Promise<MapCatalogEntry[]> => loader.catalog();

/** 선택한 전장의 렌더 데이터(섹션형 정규화 — 평면 v1 / 섹션 v2 모두 수용). */
export const fetchMap = async (id: string): Promise<NormalizedMap> => normalizeMapData(await loader.one(id));

/**
 * 지형 하이트맵(DEM) 로드 — `terrain.heightmap.src`(Float32 raw little-endian) → Float32Array.
 * 하이트맵이 없거나 로드 실패면 null(→ TerrainField 가 절차적 폴백). 전투 차단 방지.
 */
export async function loadTerrainHeights(map: NormalizedMap): Promise<Float32Array | null> {
  const hm = map.terrain.heightmap;
  if (!hm) return null;
  const base = import.meta.env.BASE_URL || "/";
  try {
    const res = await fetch(`${base}${hm.src.replace(/^\//, "")}`, { cache: "no-cache" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const arr = new Float32Array(buf);
    return arr.length >= hm.size * hm.size ? arr : null; // 크기 불일치 → 폴백
  } catch {
    return null;
  }
}
