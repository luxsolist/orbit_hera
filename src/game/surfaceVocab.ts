// 표면 어휘 가드(서사편 §8.1)의 단일 출처 — 플레이어 노출 문자열(표시명·브리핑·HUD·감독 메시지)에
// 실리면 서사 반전이 누설되는 금지 어휘. 테스트([tests/spoilerGuard.test.ts])와 런타임 필터
// (Director 출력 게이트 — director.ts)가 같은 목록을 공유한다. 내부 id(영문 키)는 검사 대상이 아니다.

/** L4/시스템 운영 어휘 — 표면 노출 금지. 판별 기준: 개발자가 GC/시스템 운영을 연상하는가(§8.1). */
export const FORBIDDEN_SURFACE_TERMS: readonly string[] = [
  "삭제", "프로세스", "시뮬레이션", "데이터", "컴팩션", "롤백", "리와인드", "재시도",
  "스냅샷", "아카이브", "백업", "직렬화", "버퍼", "tombstone", "sweep", "rollback",
  "marker", "compactor", "rewinder", "fork",
];

/** 문자열이 표면 어휘 규칙을 통과하는가(대소문자 무시 부분 일치). */
export function surfaceClean(s: string): boolean {
  const low = s.toLowerCase();
  return FORBIDDEN_SURFACE_TERMS.every((bad) => !low.includes(bad.toLowerCase()));
}
