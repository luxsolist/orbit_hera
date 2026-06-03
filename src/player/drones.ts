// 전투 드론 스펙을 플레이 타임에 서버에서 내려받는다. public/drones/<id>.json.
import type { DroneSpec, DroneCatalogEntry } from "./DroneSpec";
import { makeLoader } from "../core/loader";

const loader = makeLoader<DroneCatalogEntry, DroneSpec>("drones", "드론");

/** 드론 카탈로그(선택/관리용 목록) */
export const fetchDroneCatalog = (): Promise<DroneCatalogEntry[]> => loader.catalog();
/** 선택한 드론의 스펙 */
export const fetchDrone = (id: string): Promise<DroneSpec> => loader.one(id);
