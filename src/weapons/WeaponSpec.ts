// 무기 스펙 — 데미지·사거리·연사·쿨다운 등 전투 수치를 데이터(JSON)로 외부화한다.
// public/weapons/<id>.json 으로 서빙되고, 드론 스펙(DroneSpec.weapons)이 id 로 참조한다.
// 색상은 "0xRRGGBB" 문자열(JSON 0x 리터럴 불가) → Number() 로 파싱.

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
  manual: { damage: number; freqCost: number; fireInterval: number; assistConeDeg: number };
  auto: { damage: number; freqCost: number; fireInterval: number; range: number; coneDeg: number };
  falloff: DamageFalloff;
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
}

export type WeaponSpec = BeamSpec | BarrageSpec;

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
