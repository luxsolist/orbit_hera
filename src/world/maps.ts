// 전장(맵) 데이터를 플레이 타임에 서버(정적 호스팅)에서 내려받는다.
// 빌드 산출물은 public/maps/ 에 있고 /maps/<id>.json 으로 서빙된다.
import type { MapCatalogEntry, MapData } from "./MapData";

const BASE = import.meta.env.BASE_URL || "/";

/** 전장 목록(카탈로그) */
export async function fetchCatalog(): Promise<MapCatalogEntry[]> {
  const res = await fetch(`${BASE}maps/index.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error("전장 목록을 불러오지 못했습니다");
  return res.json();
}

/** 선택한 전장의 렌더 데이터 */
export async function fetchMap(id: string): Promise<MapData> {
  const res = await fetch(`${BASE}maps/${encodeURIComponent(id)}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`전장 데이터를 불러오지 못했습니다: ${id}`);
  return res.json();
}
