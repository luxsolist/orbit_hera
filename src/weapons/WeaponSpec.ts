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
  manual: { damage: number; freqCost: number; fireInterval: number; assistConeDeg: number };
  auto: { damage: number; freqCost: number; fireInterval: number; range: number }; // coneDeg 제거(360° 오토 전환으로 미사용)
  falloff: DamageFalloff;
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
}

export type WeaponSpec = BeamSpec | BarrageSpec | StreamSpec;

/** 특수무기 공통 인터페이스 — Game 이 타입에 무관하게 구동(barrage/stream). */
export interface SpecialWeapon {
  update(dt: number, triggerPressed: boolean): void;
  reset(): void;
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
