// 차원도약(§6.7 확장) — 인식 중인 플라즈모이드가 텔레그래프 후 플레이어 기준 무작위 지점으로 순간이동.
// 두 아키타입이 정반대 목적을 갖는다:
//   스키터(카이터) = **원거리 도약**. 관측 고정(W1)의 노출 누적을 끊고 빠져나간다 — 붙들고만 있으면
//     이기는 고정 교전을 깬다. 플레이어는 재조준·재누적을 강요받는다.
//   리치(러셔)   = **근접 도약**. 속도 17 대 워커 19.44 라 뒷걸음질만으로 영구 회피가 성립하는데,
//     그 안정 상태를 깬다. 착지 후 짧은 경직으로 "읽고 피할 수 있는" 회피 창을 남긴다.
//
// 이 파일은 순수 산술만(THREE/DOM 비의존) — 표본 추출과 게이트 판정. 실제 좌표 적용·시각은 EnemyManager.
// 난수는 주입(rand) — 결정적 테스트를 위해 Math.random 을 직접 부르지 않는다.

import { clamp } from "../core/math";

/** 도약 스펙 — 아키타입별(plasmoid.json). 미지정 = 그 아키타입은 도약하지 않음(하위호환). */
export interface PlasmoidLeapSpec {
  telegraphSec: number; // 텔레그래프(시전) 시간 — 이 동안 취소 가능
  cd: number; //          도약 쿨다운(s)
  chance: number; //      쿨다운 도래 시 실제 개시 확률(0..1)
  minDist: number; //     착지 **수평** 거리 하한(m)
  maxDist: number; //     착지 수평 거리 상한(m)
  // 착지 고도는 **플레이어 기준 수직 오프셋**이다(지면 기준이 아니다). 지면 기준으로 두면 비행
  // 중인 플레이어 상대로 완전히 무너진다 — 실측: 플레이어 300m 상공일 때 리치가 299m **아래**에
  // 착지해 "회피 강제"가 0% 달성이었다. 러셔의 일반 이동은 이미 3D 추격이므로(플레이어 y=300 →
  // 러셔 y 평균 300) 도약만 2D 이던 것이 시스템 내 예외였다. 호출부가 지면 하한으로 클램프한다.
  dyMin: number; //       착지 수직 오프셋 하한(플레이어 대비 m, 음수 = 아래)
  dyMax: number; //       착지 수직 오프셋 상한(플레이어 대비 m)
  recoverSec: number; //  착지 후 공격 불가 시간(s) — 0 이면 즉시 행동
  concurrentCap: number; // 같은 아키타입이 동시에 텔레그래프할 수 있는 최대 수(포위 폭주 방지)
}

/** 착지 오프셋 — 전부 **플레이어 기준** 변위(수평 dx/dz + 수직 dy). */
export interface LeapOffset {
  dx: number;
  dz: number;
  dy: number;
}

/**
 * 착지 오프셋 표본(순수). 방위각 균등 + 수평거리 **면적 균등**(도넛) + 고도 균등.
 *
 * 면적 균등인 이유: 반지름을 균등 추출하면 안쪽 링에 표본이 몰린다(둘레가 r 에 비례하므로).
 * d = √lerp(min², max², u) 로 뽑아야 도넛 위에 고르게 흩어진다.
 *
 * 구(球) 표면 균등을 쓰지 않는 이유: 구면 위 균등 분포는 y 좌표가 [−r, +r] 균등이라(아르키메데스)
 * **절반이 플레이어보다 아래** — r=1000 이면 1000m 지하다. 수평 도넛 + 좁은 수직 밴드가 정본이다:
 * 수평 거리와 고도차를 따로 통제해야 "얼마나 떨어져서, 얼마나 위에" 를 각각 설계할 수 있다.
 */
export function sampleLeapOffset(spec: PlasmoidLeapSpec, rand: () => number): LeapOffset {
  const theta = rand() * Math.PI * 2;
  const lo = Math.max(0, spec.minDist);
  const hi = Math.max(lo, spec.maxDist);
  const d = Math.sqrt(lo * lo + (hi * hi - lo * lo) * rand()); // 면적 균등
  return {
    dx: Math.cos(theta) * d,
    dz: Math.sin(theta) * d,
    dy: spec.dyMin + (spec.dyMax - spec.dyMin) * rand(),
  };
}

/**
 * 텔레그래프 인터럽트(순수) — 역행체 시전과 **같은 목록**이다(EnemyManager.rewinderCast).
 *
 * "피해를 입으면 취소"가 아닌 이유: 360° 오토파이어가 발사 입력과 무관하게 사거리 안의 적을
 * 0.13~0.2초마다 자동 타격한다. 3초 창이면 오토만으로 15~23 발이 들어가 **플레이어가 아무것도
 * 하지 않아도 100% 취소**된다 — 메커닉이 존재하지 않게 된다. 취소의 실체는 수동 조준 사격이다:
 * pinned(W2 참조 핀)는 수동 명중 전용이고(FrequencyBeam 이 observe 를 manual 일 때만 전달),
 * zenoFrozen(W1)·staggered(동료 처치)·phased 도 같은 문법을 공유한다.
 */
export function leapInterrupted(
  zenoFrozen: boolean, staggered: boolean, pinned: boolean, phased: boolean,
): boolean {
  return zenoFrozen || staggered || pinned || phased;
}

/**
 * 도약 개시 가능 여부(순수) — 쿨다운 도래 + 인터럽트 상태 아님 + 동시 상한 미달.
 * 확률(chance) 판정은 호출부가 rand 로(개시 시점 1회) — 여기선 게이트만 본다.
 */
export function canBeginLeap(
  cooldownLeft: number, interrupted: boolean, castingNow: number, cap: number,
): boolean {
  return cooldownLeft <= 0 && !interrupted && castingNow < cap;
}

/** 배틀필드 난이도 배수 적용 — 확률은 [0,1] 클램프, 쿨다운은 하한 1s(0 이하 = 매 프레임 도약 방지). */
export function leapChanceWith(spec: PlasmoidLeapSpec, chanceMul: number): number {
  return clamp(spec.chance * chanceMul, 0, 1);
}

/** 쿨다운 배수 적용 — 하한 1s. */
export function leapCooldownWith(spec: PlasmoidLeapSpec, cdMul: number): number {
  return Math.max(1, spec.cd * cdMul);
}
