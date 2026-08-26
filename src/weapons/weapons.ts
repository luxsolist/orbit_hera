// 무기 스펙을 플레이 타임에 서버에서 내려받는다. public/weapons/<id>.json.
import type { WeaponSpec, WeaponCatalogEntry } from "./WeaponSpec";
import { makeLoader } from "../core/loader";

const loader = makeLoader<WeaponCatalogEntry, WeaponSpec>("weapons", "무기");

/** 선택한 무기의 스펙 */
export const fetchWeapon = (id: string): Promise<WeaponSpec> => loader.one(id);
