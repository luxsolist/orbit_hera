// 정적 JSON 카탈로그/단건 로더 팩토리 — 맵/드론/무기 로더의 공통 패턴을 한 곳으로.
// public/<dir>/index.json(카탈로그) + public/<dir>/<id>.json(단건)을 BASE_URL 기준으로 fetch.

const BASE = import.meta.env.BASE_URL || "/";

export interface Loader<Catalog, Item> {
  /** 목록(public/<dir>/index.json) */
  catalog(): Promise<Catalog[]>;
  /** 단건(public/<dir>/<id>.json) */
  one(id: string): Promise<Item>;
}

/** dir 디렉터리의 카탈로그/단건 JSON 로더 생성. label 은 오류 메시지용. */
export function makeLoader<Catalog, Item>(dir: string, label: string): Loader<Catalog, Item> {
  return {
    async catalog() {
      const res = await fetch(`${BASE}${dir}/index.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`${label} 목록을 불러오지 못했습니다`);
      return res.json();
    },
    async one(id: string) {
      const res = await fetch(`${BASE}${dir}/${encodeURIComponent(id)}.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`${label} 데이터를 불러오지 못했습니다: ${id}`);
      return res.json();
    },
  };
}
