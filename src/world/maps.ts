// 전장 카탈로그(public/maps/index.json)를 플레이 타임에 내려받는다. 지형·건물은 StreamingWorld 가 청크로 받는다.
import type { MapCatalogEntry } from "./MapData";
import { makeLoader } from "../core/loader";

const loader = makeLoader<MapCatalogEntry, unknown>("maps", "전장");

/** 전장 목록(카탈로그) */
export const fetchCatalog = (): Promise<MapCatalogEntry[]> => loader.catalog();
