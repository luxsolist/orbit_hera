// 도감(§8.3 명칭 갱신의 시각화) — 인식 Ⅰ 동안은 습성별 카드 5장, 인식 Ⅱ(6장 재독) 확립 후엔
// "적색체/청색체/거머리형/모기형" 구분이 한 장으로 접혀 합쳐진다: 항목명 "그것(투영체)".
// 규칙(명칭 갱신, missionV2.deployRoleName)을 도감이라는 화면으로 보여주는 장치.
//
// 순수 — 이미 로드된 PlasmoidSpec(런타임 기본값 포함) 하나만 참조, 비동기 로드 불필요.
// 표면 어휘(§8.1): brief 문자열은 전부 spoilerGuard 스캔 대상(tests/spoilerGuard.test.ts).
import type { PlasmoidSpec, PlasmoidArchetype } from "../enemies/PlasmoidSpec";

export interface BestiaryCard {
  id: string;
  name: string; // 표시명(스펙에서 파생 — 데이터 갱신에 자동 추종)
  brief: string; // 관측 기록 한 줄
  merged: boolean; // 병합 카드(계시 후 단일 항목)인가 — UI 접힘 연출 트리거
  /** 삽화용 아키타입(SHELL_GEOS 키). 병합 카드는 null — 다섯 형태가 하나로 접힌 뒤엔 형상이 없다. */
  shape: PlasmoidArchetype | null;
}

const ARCHETYPE_ORDER: readonly PlasmoidArchetype[] = ["rusher", "kiter", "marker"];

const ARCHETYPE_BRIEFS: Record<PlasmoidArchetype, string> = {
  rusher: "접촉으로 흡수한다. 밀도 높은 것이면 무엇이든 파고든다.",
  kiter: "원거리에서 끌어당긴다. 붙잡으려 하면 먼저 멀어진다.",
  marker: "낙인을 남긴다. 낙인 자체는 무해하나, 파문이 오면 이야기가 다르다.",
};

const MERGED_CARD: BestiaryCard = {
  id: "unified",
  name: "그것 (투영체)",
  brief: "다섯이 아니었다. 하나가 다섯 자리에서 동시에 손을 뻗었을 뿐이다.",
  merged: true,
  shape: null,
};

/**
 * 도감 카드 목록 — revealed=false 면 스펙에 정의된 아키타입별 카드(구 스펙 하위호환 — 미탑재
 * 아키타입은 생략), revealed=true 면 병합 카드 1장만. 순수.
 */
export function bestiaryCards(spec: PlasmoidSpec, revealed: boolean): BestiaryCard[] {
  if (revealed) return [MERGED_CARD];
  const out: BestiaryCard[] = [];
  for (const id of ARCHETYPE_ORDER) {
    const a = spec.archetypes[id];
    if (!a) continue;
    out.push({ id, name: a.name, brief: ARCHETYPE_BRIEFS[id], merged: false, shape: id });
  }
  return out;
}
