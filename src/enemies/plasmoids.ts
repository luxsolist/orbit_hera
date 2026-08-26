import { makeLoader } from "../core/loader";
import type { PlasmoidSpec } from "./PlasmoidSpec";

// 플라즈모이드(적) 스펙 로더 — public/enemies/index.json(카탈로그) + <id>.json(단건).

export interface PlasmoidCatalogEntry {
  id: string;
  name: string;
}

const loader = makeLoader<PlasmoidCatalogEntry, PlasmoidSpec>("enemies", "적");

export const fetchPlasmoid = (id: string): Promise<PlasmoidSpec> => loader.one(id);
