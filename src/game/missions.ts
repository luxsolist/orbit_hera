import type { MissionSpec } from "./mission";
import { DEFAULT_MISSIONS_V2, fromLegacy, runnableV2, type MissionSpecV2 } from "./missionV2";

// 미션 풀 로더 — public/missions/index.json(전체 명세 인라인 카탈로그, v2).
// 드론/무기/적과 달리 단건 파일이 없어 index.json 하나가 곧 풀이다(소량 데이터).
// v1 항목(goal 필드 없음)은 fromLegacy 로 수용(하위호환), 현 엔진이 못 구동하는 v2 항목은
// runnableV2 로 거른다(훅 ①③⑤⑥ 도입에 맞춰 자동 편입).

const BASE = import.meta.env.BASE_URL || "/";

/** v2/v1 혼재 배열 정규화 — goal 필드 유무로 판별. */
export function normalizeMissionPool(data: unknown): MissionSpecV2[] {
  if (!Array.isArray(data)) return [];
  return (data as (MissionSpecV2 | MissionSpec)[])
    .map((m) => ("goal" in m ? (m as MissionSpecV2) : fromLegacy(m as MissionSpec)))
    .filter(runnableV2);
}

/** 미션 풀을 받는다. 실패/빈 풀은 내장 DEFAULT_MISSIONS_V2 로 폴백(전투 진입 차단 방지). */
export async function fetchMissions(): Promise<MissionSpecV2[]> {
  try {
    const res = await fetch(`${BASE}missions/index.json`, { cache: "no-cache" });
    if (!res.ok) return DEFAULT_MISSIONS_V2;
    const pool = normalizeMissionPool(await res.json());
    return pool.length > 0 ? pool : DEFAULT_MISSIONS_V2;
  } catch {
    return DEFAULT_MISSIONS_V2;
  }
}
