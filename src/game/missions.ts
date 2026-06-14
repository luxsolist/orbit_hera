import type { MissionSpec } from "./mission";
import { DEFAULT_MISSIONS } from "./mission";

// 미션 풀 로더 — public/missions/index.json(전체 명세 인라인 카탈로그).
// 드론/무기/적과 달리 단건 파일이 없어 index.json 하나가 곧 풀이다(소량 데이터).

const BASE = import.meta.env.BASE_URL || "/";

/** 미션 풀을 받는다. 실패 시 내장 DEFAULT_MISSIONS 로 폴백(전투 진입 차단 방지). */
export async function fetchMissions(): Promise<MissionSpec[]> {
  try {
    const res = await fetch(`${BASE}missions/index.json`, { cache: "no-cache" });
    if (!res.ok) return DEFAULT_MISSIONS;
    const data = (await res.json()) as MissionSpec[];
    return Array.isArray(data) && data.length > 0 ? data : DEFAULT_MISSIONS;
  } catch {
    return DEFAULT_MISSIONS;
  }
}
