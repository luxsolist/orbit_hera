// 진행 시스템 MVP(TODO §7.4) — 킬 XP → 레벨 → HP/공격력/재생. 순수 모듈(테스트 전수).
// 모델: "출격 시점 스냅샷" — XP는 실시간 누적·저장(core.progress), 레벨/스탯은 다음 출격 시작 때
// 적용(런 중 재계산 없음). 드론별 레벨 독립. 저장은 xp만 — 레벨은 여기서 파생.

import { clamp } from "../core/math";

export const LEVEL_CAP = 20;
export const CLEAR_XP = 200; //   배틀필드 클리어 정액 XP
export const REGEN_DELAY = 3.5; // 피격 후 HP 재생 정지(s) — 교전 이탈해야 회복

/** 레벨 L 도달에 필요한 누적 XP — 100·(L-1)^1.6 (L1=0, L2=100, L20=11,400). */
export function totalXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.6));
}

/** 누적 XP → 현재 레벨(1..LEVEL_CAP). */
export function levelFromXp(xp: number): number {
  let lv = 1;
  while (lv < LEVEL_CAP && xp >= totalXpForLevel(lv + 1)) lv++;
  return lv;
}

/** 처치 XP — 강함 s(0..1)에 비례 10~50. */
export function xpForKill(s: number): number {
  return Math.round(10 + 40 * clamp(s, 0, 1));
}

/** 드론별 레벨 성장치 — 워커=맷집(HP/재생), 플라이어=화력(%) 우위. 미지의 드론 id 는 무성장(안전). */
export function droneGrowth(droneId: string, level: number): { hpBonus: number; dmgMult: number; hpRegen: number } {
  const n = clamp(Math.floor(level), 1, LEVEL_CAP) - 1; // 레벨 1 = 무보정
  switch (droneId) {
    case "walker": return { hpBonus: 6 * n, dmgMult: 1 + 0.02 * n, hpRegen: 0.5 * n };
    case "flyer": return { hpBonus: 3 * n, dmgMult: 1 + 0.03 * n, hpRegen: 0.3 * n };
    default: return { hpBonus: 0, dmgMult: 1, hpRegen: 0 };
  }
}

/**
 * HP 재생 1프레임 전이(순수) — 사망(hp≤0)·최근 피격(REGEN_DELAY 미경과)·재생 0 이면 불변.
 * sinceHit 는 호출부(PlayerController)가 피격 시 0 으로 리셋해 누적.
 */
export function regenStep(hp: number, maxHp: number, regenPerSec: number, sinceHit: number, dt: number): number {
  if (hp <= 0 || hp >= maxHp || regenPerSec <= 0 || sinceHit < REGEN_DELAY) return hp;
  return Math.min(maxHp, hp + regenPerSec * dt);
}
