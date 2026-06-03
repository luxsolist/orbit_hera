// 전장(맵) 데이터를 플레이 타임에 서버(정적 호스팅)에서 내려받는다. public/maps/<id>.json.
import type { MapCatalogEntry, MapData } from "./MapData";
import { makeLoader } from "../core/loader";

const loader = makeLoader<MapCatalogEntry, MapData>("maps", "전장");

/** 전장 목록(카탈로그) */
export const fetchCatalog = (): Promise<MapCatalogEntry[]> => loader.catalog();
/** 선택한 전장의 렌더 데이터 */
export const fetchMap = (id: string): Promise<MapData> => loader.one(id);
