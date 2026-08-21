// LLM Director 파일럿(TODO §10 단계 1) — 싱글플레이 클라이언트가 인스턴스 집계 스냅샷을
// 클라우드 Director API 에 POST 하고, 받은 행동을 검증 게이트(director.ts) 통과분만 적용한다.
// 서버 없이 "AI 가 조종하는 침공"을 검증하는 단계 — 엔드포인트 미설정이면 감독 자체가 없고,
// 타임아웃/오류/형식 위반은 전부 "개입 없음"으로 강등된다(우아한 강등 — 게임은 완전 동작).
//
// 엔드포인트 설정: URL ?director=<https url> (1회 지정 시 저장) 또는 localStorage
// "core.director.endpoint". 값 "off" 는 저장을 지우고 비활성.

import type { Director, DirectorAction, DirectorSnapshot } from "./director";

export const DIRECTOR_ENDPOINT_KEY = "core.director.endpoint";
export const DIRECTOR_INTERVAL_SEC = 45; // 개입 주기 — 파문(30s)·증원 경계와 어긋나게 두어 겹침 완화
const DECIDE_TIMEOUT_MS = 8000;

/**
 * 엔드포인트 결정(순수) — ?director= 쿼리가 우선(저장), 없으면 저장값. "off" 는 해제.
 * read/write 는 호출부가 주입(localStorage try/catch 격리 — 테스트 가능).
 */
export function resolveDirectorEndpoint(
  search: string,
  read: (k: string) => string | null,
  write: (k: string, v: string) => void,
  remove: (k: string) => void,
): string | null {
  const q = new URLSearchParams(search).get("director");
  if (q === "off") {
    remove(DIRECTOR_ENDPOINT_KEY);
    return null;
  }
  if (q && /^https?:\/\//.test(q)) {
    write(DIRECTOR_ENDPOINT_KEY, q);
    return q;
  }
  const stored = read(DIRECTOR_ENDPOINT_KEY);
  return stored && /^https?:\/\//.test(stored) ? stored : null;
}

/** 응답 파싱(순수) — { actions: [...] } 형태만 수용, 형식 밖은 전부 버림(검증 게이트 전 1차 방어). */
export function parseDirectorResponse(json: unknown): DirectorAction[] {
  if (!json || typeof json !== "object") return [];
  const arr = (json as { actions?: unknown }).actions;
  if (!Array.isArray(arr)) return [];
  return arr.filter((a): a is DirectorAction =>
    !!a && typeof a === "object" && typeof (a as DirectorAction).type === "string"
  );
}

/**
 * 원격 감독 — Director 인터페이스의 LLM 파일럿 구현. decide 는 절대 던지지 않는다:
 * 네트워크/타임아웃/형식 오류 → [](개입 없음). 검증(validateDirectorActions)은 적용부(Game) 몫.
 */
export class RemoteDirector implements Director {
  constructor(
    private endpoint: string,
    private fetchFn: typeof fetch = fetch.bind(globalThis),
    private timeoutMs = DECIDE_TIMEOUT_MS,
  ) {}

  async decide(snapshot: DirectorSnapshot): Promise<DirectorAction[]> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ v: 1, snapshot }),
        signal: ctl.signal,
      });
      if (!res.ok) return [];
      return parseDirectorResponse(await res.json());
    } catch {
      return []; // 우아한 강등 — 감독 지연/부재는 "개입 없음"과 동일
    } finally {
      clearTimeout(timer);
    }
  }
}
