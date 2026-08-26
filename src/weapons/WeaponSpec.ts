// 무기 스펙 — 데미지·사거리·연사·쿨다운 등 전투 수치를 데이터(JSON)로 외부화한다.
// public/weapons/<id>.json 으로 서빙되고, 드론 스펙(DroneSpec.weapons)이 id 로 참조한다.
// 색상은 "0xRRGGBB" 문자열(JSON 0x 리터럴 불가) → Number() 로 파싱.

import { clamp } from "../core/math";

/** 거리 반비례 위력 파라미터. */
export interface DamageFalloff {
  refDist: number; // 이 거리에서 배수 1.0
  maxMult: number; // 초근접 상한
  minMult: number; // 원거리 하한
}

/**
 * 관측 고정(내부 id: zeno, 서사편 §7.2 W1) — 같은 대상을 지속 조사하면 행동이 감속되다 동결된다.
 * 노출(연속 피관측 시간)이 freezeAfter 에 닿으면 완전 정지(이동·공격·발사 게이트). 물리 독해:
 * 연속 측정의 전이 동결(§1.6 결어긋남 유도의 지속 조사 극한). 적용/감쇠 규칙은 CoreEnemy 쪽.
 */
export interface ZenoSpec {
  slowPerSec: number; // 노출 1초당 감속량(속도 배수 1 → 1−slowPerSec·노출)
  freezeAfter: number; // 이 노출(s) 이상이면 동결(완전 정지)
  graceSec?: number; // 히트 간 이 간격(s) 이내면 "지속 조사"로 간주(기본 CoreEnemy ZENO_GRACE)
}

/** 기본무기(히트스캔 빔) — 자동발사 + 수동발사(에임 어시스트). */
export interface BeamSpec {
  id: string;
  name: string; // 표시명(목록용)
  abbr: string; // 모바일 발사 버튼 짧은 라벨
  type: "beam";
  range: number; // 최대 사거리/빔 길이
  color: string; // 빔 색("0xRRGGBB")
  beamLifetime: number; // 빔 잔상 지속(초)
  muzzleOffsets?: number[]; // 발사관 측면 오프셋(m) — 없으면 단일[0], [-x,x]면 듀얼 발사관. damage 는 발사관당 적용.
  manual: {
    damage: number; freqCost: number; fireInterval: number; assistConeDeg: number;
    decohere?: boolean; // 관측 펄스(§2.2) — 수동 명중이 위상 이탈 개체를 강제 실체화(중주파=대위상 앵커)
    pinSec?: number; //    W2 관측 계류 — 수동 명중 후 이 시간 동안 재이탈 봉쇄(중주파=하드 핀/경주파=소프트 핀)
  };
  auto: {
    damage: number; freqCost: number; fireInterval: number; range: number; // coneDeg 제거(360° 오토 전환으로 미사용)
    freqFloor?: number; // 오토 사격 바닥(maxFreq 대비 0..1). 미지정 시 DEFAULT_AUTO_FREQ_FLOOR
  };
  falloff: DamageFalloff;
  zeno?: ZenoSpec; // 관측 고정(W1) — 지속 조사 감속→동결. 없으면 순수 피해 무기
}

/**
 * 오토 사격 바닥 기본값(maxFreq 대비). 오토파이어는 발사 입력과 무관하게 사거리 내 적이 있으면 상시
 * 소모하므로, 바닥이 없으면 **회복이 소모를 못 이기는 순간 게이지가 0 에 고착**된다(2026-08-25 버그 —
 * freqRegenMul 0.5 인 "옅은 장"에서 재현). 오토는 어디까지나 배경 관측 스레드이지 플레이어의 수동·특수
 * 예산을 굶겨선 안 된다: 바닥 아래로는 쉬게 해 회복이 항상 이기도록 보장한다. 특수 발동 하한(freq 5)보다
 * 넉넉해 이 바닥에서도 특수는 언제나 쓸 수 있다.
 */
export const DEFAULT_AUTO_FREQ_FLOOR = 0.25;

/**
 * 오토 사격 허용 여부(순수) — 게이지가 바닥 이상일 때만. 수동 사격은 이 게이트를 받지 않는다
 * (게이지를 0 까지 쓰는 건 플레이어의 선택이고, 그건 손을 떼면 회복된다).
 */
export function autoFireAllowed(freq: number, maxFreq: number, floor: number = DEFAULT_AUTO_FREQ_FLOOR): boolean {
  return freq >= maxFreq * floor;
}

/** 자동조준/사격 강화 — 에임어시스트 콘(manual.assistConeDeg)·자동사격 사거리(auto.range)에 각각 배수 적용한 새 스펙.
 *  rangeMul 미지정 시 coneMul 과 동일(하위호환). 원본 불변. 순수. */
export function withAutoBoost(spec: BeamSpec, coneMul: number, rangeMul: number = coneMul): BeamSpec {
  return {
    ...spec,
    manual: { ...spec.manual, assistConeDeg: spec.manual.assistConeDeg * coneMul },
    auto: { ...spec.auto, range: spec.auto.range * rangeMul },
  };
}

/** 특수무기(다중 빔 살포). */
export interface BarrageSpec {
  id: string;
  name: string; // 표시명(목록용)
  abbr: string; // 모바일 특수 버튼 짧은 라벨
  type: "barrage";
  maxBeams: number; // 동시 락온 최대 타깃
  coneDeg: number; // 전방 콘 반각(도)
  range: number;
  cooldown: number; // 발동 쿨다운(초)
  drainRate: number; // 발동 중 초당 freq 소진
  salvoInterval: number; // 살포 간격(초)
  salvoDamage: number; // 발당 위력
  beamLifetime: number;
  colorBeam: string;
  colorGlow: string;
  falloff: DamageFalloff; // 거리 반비례 위력(특수는 일반보다 완만하게)
}

/** 특수무기(오버드라이브 스트림) — 발동 시 게이지가 닳을 때까지 듀얼 발사관으로 전방 연속 사격. */
export interface StreamSpec {
  id: string;
  name: string;
  abbr: string;
  type: "stream";
  range: number;
  cooldown: number; // 발동 쿨다운(초)
  drainRate: number; // 발동 중 초당 freq 소진
  fireInterval: number; // 사격 간격(초)
  damage: number; // 발사관당 타격(거리 falloff 적용) — 중주파 빔 수준
  assistConeDeg: number; // 에임 어시스트 콘
  muzzleOffsets: number[]; // 발사관 측면 오프셋(듀얼)
  beamLifetime: number;
  colorBeam: string;
  colorGlow: string;
  falloff: DamageFalloff;
  zeno?: ZenoSpec; // 관측 고정(W1) — 풀 스로틀 단일 관측(제논 극대화, 서사편 §7.3)
}

export type WeaponSpec = BeamSpec | BarrageSpec | StreamSpec;

/** 진행 성장(§7.4) — 데미지 필드에 배수를 적용한 사본(원본·캐시 불변). 타입별 필드만 정확히 스케일. */
export function scaleWeaponDamage<T extends WeaponSpec>(spec: T, mul: number): T {
  if (mul === 1) return spec;
  switch (spec.type) {
    case "beam":
      return { ...spec, manual: { ...spec.manual, damage: spec.manual.damage * mul }, auto: { ...spec.auto, damage: spec.auto.damage * mul } };
    case "barrage":
      return { ...spec, salvoDamage: spec.salvoDamage * mul };
    case "stream":
      return { ...spec, damage: spec.damage * mul };
  }
}

/** 특수무기 공통 인터페이스 — Game 이 타입에 무관하게 구동(barrage/stream). */
export interface SpecialWeapon {
  update(dt: number, triggerPressed: boolean): void;
  reset(): void; // 출격 시작 — 활성/쿨다운 모두 초기화
  abort(): void; // 발동 중 사망 — 활성만 해제, 쿨다운은 정상 소모(환급 없음)
  readonly cooldownReady: number; // 0..1 진행률
  readonly cooldownRemainingSec: number;
  readonly isActive: boolean;
  onFired?: () => void;
}

/** 무기 카탈로그(관리/선택용) 항목. */
export interface WeaponCatalogEntry {
  id: string;
  name: string;
  type: WeaponSpec["type"];
}

/** 적중 거리에 반비례한 위력(가까울수록 강함). 상·하한 클램프. 순수 함수(테스트용 분리). */
export function damageForDistance(dist: number, base: number, f: DamageFalloff): number {
  const mult = Math.min(f.maxMult, Math.max(f.minMult, f.refDist / Math.max(dist, 1)));
  return base * mult;
}

/** 쿨다운 진행률(0=막 발동, 1=준비완료) — 남은 쿨다운/최대. HUD 링 표시용. 순수. */
export function cooldownReadyFrac(cooldown: number, max: number): number {
  return clamp(1 - cooldown / max, 0, 1);
}
