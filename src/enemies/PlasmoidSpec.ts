// 플라즈모이드 스펙 — 적 개체의 체력/색/렌더크기를 데이터(JSON)로 외부화한다.
// public/enemies/<id>.json 으로 서빙. 색상은 "0xRRGGBB" 문자열(JSON 0x 리터럴 불가) → parseHexColor.
//
// "분리형" 모델(체력 ↔ 보이는 크기 디커플링):
//  (1) 체력(밸런스)  HP = basePerArea × 지름² × 색가중치   — 표면적 기반이라 크기로 폭주하지 않음
//  (2) 렌더 크기(연출) dVis = clamp(minD + k·HP^p, minD, maxD) — 큰 HP 가 극적으로 거대해짐(드라마)
//      여기서 hp 산정용 '지름'은 설계 노브(nominal)이고, 실제 화면/충돌 크기는 visualDiameter() 가 결정한다.

import { clamp, parseHexColor } from "../core/math";

/** 색 구간 기준점 — 별 표면온도(K)에 색·체력가중치를 묶는다(낮은 온도=적색·최약, 높은 온도=청백·최강). */
export interface ColorStop {
  temp: number; // 별 표면온도(K)
  color: string; // "0xRRGGBB"
  weight: number; // 체력 가중치(가장 낮은 색 = 1.0 기준)
}

/** 체력 산정(밸런스) 파라미터. */
export interface PlasmoidHpSpec {
  basePerArea: number; // 가장 낮은 색·지름 1m 기준 HP (= base × 1² × 1)
  minDiameter: number; // 체력 산정용 지름 하한(m)
  maxDiameter: number; // 체력 산정용 지름 상한(m)
}

/** 렌더 크기(연출) 파라미터 — 앵커(특정 HP에서 특정 지름)로 곡선을 역산한다. */
export interface PlasmoidVisualSpec {
  minDiameter: number; // 렌더 지름 하한(저체력 개체가 몰리는 크기)
  maxDiameter: number; // 소프트캡(아레나 이탈 방지)
  anchorHp: number; // 이 체력일 때
  anchorDiameter: number; // 이 렌더 지름(m)이 되도록 곡선 보정
  exponent: number; // 곡선 가파름(0.7~1.0 권장, 클수록 보스가 더 거대)
}

/** 스폰 분포·이동속도 파라미터 — '강함(s)' 하나로 희귀도와 속도를 함께 묶는다. (물량은 아키타입별) */
export interface PlasmoidSpawnSpec {
  tempAlpha: number; // 온도 희귀도 지수 α (f(T) ∝ T^-α). 클수록 고온(강체) 희귀.
  speedMax: number; // 가장 약한(적색) 개체 이동속도
  speedMin: number; // 가장 강한(청백/보스) 개체 이동속도
  hpFloor: number; // 강함 정규화 하한 HP (s=0)
  hpCeil: number; // 강함 정규화 상한 HP (s=1)
}

/**
 * 접촉(에너지 흡수) 피해 — 플라즈모이드가 물체에서 에너지를 빨아들여 약화시키고(인트로의 집 붕괴 원인)
 * 그만큼 자기 체력을 회복하는 설정. 흡수량 = 플레이어 HP 피해 = 플라즈모이드 회복량.
 */
export interface PlasmoidContactSpec {
  hpDamage: number; // 약체(s=0) 접촉 시 흡수 에너지(= 플레이어 HP 피해 = 적 회복량)
  strengthMul: number; // 강함 s=1 일 때 추가 배수 → ×(1+strengthMul)
}

/**
 * 아키타입 공통 — 표시명·스폰 고도 밴드·물량(매칭 드론 1인 기준)·처치 환수.
 * 행동(드론 선택)에서 분리된 개체 고유 속성. 물량은 아키타입별 독립 예산이라 거머리/모기를 따로 조절.
 */
export interface PlasmoidArchetypeBase {
  name: string; // 표시명 "국문 / ENGLISH" (모기 / SKEETER, 거머리 / LEECH)
  spawnAltMin: number; // 스폰 고도 하한(지면 대비 m)
  spawnAltMax: number; // 스폰 고도 상한(지면 대비 m)
  countBase: number; // 웨이브1 동시 개체 수(매칭 드론 1인 기준)
  countCap: number; // 웨이브 증가분 상한(1인 기준)
  speed: number; // 가장 빠른(약체·적색) 개체 속도
  speedMin: number; // 가장 느린(강체·청백) 개체 속도 — 색 강도 g01 로 speed↔speedMin 보간
}

/**
 * 카이터(공중 도주형) 아키타입 — keepDist 유지·도망·원거리 드레인·선회 수직 회피.
 * 높이 떠 빠르게 도망 → 주로 플라이어와 교전(자기정렬). turnRate 는 °, 런타임에 rad 변환.
 */
export interface PlasmoidKiterArchetype extends PlasmoidArchetypeBase {
  turnRateDeg: number; // 속도벡터 선회 상한(°/s)
  keepDist: number; // 유지하려는 적정 거리(m)
  keepBand: number; // 히스테리시스 반폭(m)
  strafeMix: number; // 밴드 내 거동: 1=접선 선회 / 0=도주(전진 유도)
  orbitRef: number; // 이 접선속도(m/s)에서 선회 회피 최대
  evadeGain: number; // 선회 감지 시 궤도면 이탈(주로 상승) 강도
  attackRange: number; // 원거리 드레인 사거리(m)
  drainDamage: number; // 1틱 흡수량(= 플레이어 HP 피해 = 적 성장량)
  drainInterval: number; // 드레인 틱 간격(s)
}

/** 러셔(지상 돌격형) 아키타입 — 적극 접근 + 접촉 흡수(spec.contact). 주로 워커와 교전. */
export type PlasmoidRusherArchetype = PlasmoidArchetypeBase;

/**
 * 커터(내부 id: cutter, 표시명 절단체 — 서사편 §6.3/§6.7) — 건물 상단 부착 → 절단 채널 →
 * 부양 납치. 방어 미션의 주적. 채널은 관측 고정(W1)·경직이 인터럽트, 격추 시 건물 재안착.
 */
export interface PlasmoidCutterArchetype extends PlasmoidArchetypeBase {
  attachRange: number; // 부착 판정 거리(m — 건물 상단 기준)
  severSec: number; //   절단 채널 시간(s) — 완료 시 납치 개시
  seekRange: number; //  표적 건물 탐색 반경(m)
}

/**
 * 낙인탄(내부 id: tomb — 서사편 §6.1 ① MARK) 파라미터. 낙인 자체는 무피해 —
 * 주기 스윕 파문(SweepSpec)이 지나갈 때 낙인 수만큼 sweepDamage 가 적용된다.
 */
export interface TombSpec {
  projSpeed: number; // 유도탄 속도(m/s) — 느려서 회피 가능해야 함
  projTurnRateDeg: number; // 유도탄 선회 상한(°/s) — 낮을수록 스트레이프로 흘리기 쉬움
  projTtl: number; // 유도탄 수명(s) — 소진 시 소산
  fireRange: number; // 발사 사거리(m)
  fireInterval: number; // 발사 간격(s)
  sweepDamage: number; // 파문 통과 시 낙인 1개당 피해
}

/**
 * 마커(내부 id: marker, 표시명 소인체 — 서사편 §6.7) — 중거리 유영 + 낙인 유도탄.
 * 이동은 카이터 유영(keepDist 유지)을 재사용하고, 공격은 접촉/드레인 대신 낙인탄.
 */
export interface PlasmoidMarkerArchetype extends PlasmoidArchetypeBase {
  turnRateDeg: number; // 유영 선회 상한(°/s)
  keepDist: number; // 유지 거리(m)
  keepBand: number; // 히스테리시스 반폭(m)
  tomb: TombSpec;
}

/**
 * 심판 파문(내부 id: sweep — 서사편 §6.1·§6.7) — 개체가 아닌 **전장 이벤트**. 균열(리프트 앵커)
 * 에서 주기적으로 파면이 확장되고, 낙인 붙은 대상만 통과 시 피해. 예고(warnSec)는 HUD 가 표시.
 */
export interface SweepSpec {
  period: number; // 파문 주기(s) — 종료 후 다음 파문까지
  speed: number; // 파면 확장 속도(m/s)
  warnSec: number; // 도래 전 HUD 예고 시간(s)
  maxRadius: number; // 파면 소멸 반경(m)
}

/**
 * 위상 이탈(물리편 §2.1) — 강한 개체가 주기적으로 막에서 벌크로 회전해 나갔다 돌아온다.
 * 보유 여부는 스폰 롤에서 결정(phaseRoll), 주기는 강함 s 로 보간(phaseTimings — 강할수록 자주·오래).
 * 이탈 중: 반투명·발광 감소, 일반 무기 무효, 공격 불가, 자동발사/에임 어시스트 제외. 이동은 계속.
 * 카운터: 수동 관측 펄스(§2.2 decohere — 강제 실체화) + W2 관측 계류(pin — 재이탈 봉쇄).
 */
export interface PhaseSpec {
  minStrength: number; // 보유 자격 강함 하한(s)
  chance: number; //      자격 개체 중 보유 확률(0..1)
  cooldownMax: number; // 실체 유지(s) — s=minStrength 일 때(약할수록 드물게)
  cooldownMin: number; // 실체 유지(s) — s=1 일 때(강할수록 자주)
  durationMin: number; // 이탈 지속(s) — s=minStrength
  durationMax: number; // 이탈 지속(s) — s=1(강할수록 오래)
}

/** 스폰 롤 — 이 개체가 위상 이탈을 보유하는가. u∈[0,1). 순수. */
export function phaseRoll(phase: PhaseSpec, s: number, u: number): boolean {
  return s >= phase.minStrength && u < phase.chance;
}

/** 강함 s → 실체 유지/이탈 지속 보간(선형). 순수. */
export function phaseTimings(phase: PhaseSpec, s: number): { cooldown: number; duration: number } {
  const t = clamp((s - phase.minStrength) / Math.max(1e-6, 1 - phase.minStrength), 0, 1);
  return {
    cooldown: phase.cooldownMax + (phase.cooldownMin - phase.cooldownMax) * t,
    duration: phase.durationMin + (phase.durationMax - phase.durationMin) * t,
  };
}

/**
 * 리와인더(내부 id: rewinder, 표시명 역행체 — 서사편 §6.6/§6.7) — 후방에서 역행 시전(미니보스 슬롯).
 * 시전 완료 시 반경 내 최근 격파가 되살아나고 플레이어 위치가 되감긴다. 카운터: 시전 중 격파,
 * W1 동결(시전 인터럽트), W2 관측 계류(계류로 잠근 대상에서 일어난 사건은 되감기지 않는다 — §9.2).
 */
export interface PlasmoidRewinderArchetype extends PlasmoidArchetypeBase {
  turnRateDeg: number; // 유영 선회 상한(°/s) — 후방 유지
  keepDist: number; //   유지 거리(m)
  keepBand: number;
  rollback: {
    castSec: number; //   시전 시간(s) — 예지 HUD 카운트다운
    castCd: number; //    시전 쿨다운(s)
    castRange: number; // 시전 개시 거리(m)
    radius: number; //    역행 반경(m) — 이 안의 격파·플레이어만 되감김
    rewindSec: number; // 몇 초 전으로 되감는가
  };
}

/** 개체 고유 아키타입 묶음 — 어느 드론이 플레이하든 무관(MP 혼합 전장 대응). */
export interface PlasmoidArchetypesSpec {
  rusher: PlasmoidRusherArchetype;
  kiter: PlasmoidKiterArchetype;
  marker: PlasmoidMarkerArchetype;
  cutter?: PlasmoidCutterArchetype; //     P3 — 미지정 시 커터 미출현(구 JSON 하위호환)
  rewinder?: PlasmoidRewinderArchetype; // P3 — 미지정 시 역행체 미출현
}

/** 플라즈모이드 1종 스펙. */
export interface PlasmoidSpec {
  id: string;
  name: string;
  hp: PlasmoidHpSpec;
  color: { stops: ColorStop[] };
  visual: PlasmoidVisualSpec;
  spawn: PlasmoidSpawnSpec;
  contact: PlasmoidContactSpec;
  archetypes: PlasmoidArchetypesSpec;
  sweep: SweepSpec; // 심판 파문(전장 이벤트) — 마커 낙인과 한 세트
  phase?: PhaseSpec; // 위상 이탈(§2.1) — 미지정 시 비활성(구 JSON 하위호환)
}

/** 플라즈모이드 아키타입 식별자. */
export type PlasmoidArchetype = "rusher" | "kiter" | "marker" | "cutter" | "rewinder";

// ─────────────────────────── 순수 산출 유틸(테스트 분리) ───────────────────────────

/** stops 에서 temp 의 위치 — [하단 stop 인덱스 i, 구간 내 보간계수 t(0..1)]. 양끝은 클램프. */
function locate(stops: ColorStop[], temp: number): { i: number; t: number } {
  const last = stops.length - 1;
  if (temp <= stops[0].temp) return { i: 0, t: 0 };
  if (temp >= stops[last].temp) return { i: last - 1, t: 1 };
  let i = 0;
  while (i < last - 1 && temp >= stops[i + 1].temp) i++;
  const a = stops[i], b = stops[i + 1];
  return { i, t: (temp - a.temp) / (b.temp - a.temp) };
}

/** 온도 → 체력 가중치(구간 선형보간, 양끝 클램프). */
export function colorWeight(stops: ColorStop[], temp: number): number {
  const { i, t } = locate(stops, temp);
  return stops[i].weight + (stops[i + 1].weight - stops[i].weight) * t;
}

/** 색 강도 0..1 — 색가중치를 [최소,최대] 가중치로 정규화(적색 0 → 청백 1). 속도(감속)·발광 공통 지표. 순수. */
export function colorStrength01(stops: ColorStop[], temp: number): number {
  const wmin = stops[0].weight, wmax = stops[stops.length - 1].weight;
  return clamp((colorWeight(stops, temp) - wmin) / Math.max(1e-6, wmax - wmin), 0, 1);
}

/** 온도 → 색(0xRRGGBB number; 채널별 구간 선형보간). 렌더/발광용. */
export function colorAt(stops: ColorStop[], temp: number): number {
  const { i, t } = locate(stops, temp);
  const a = parseHexColor(stops[i].color), b = parseHexColor(stops[i + 1].color);
  const ch = (sh: number) => {
    const ca = (a >> sh) & 0xff, cb = (b >> sh) & 0xff;
    return Math.round(ca + (cb - ca) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** 체력 = basePerArea × 지름² × 색가중치. (가장 낮은 색·1m → basePerArea) 지름은 hp.min/max 로 클램프. */
export function plasmoidHp(spec: PlasmoidSpec, diameter: number, temp: number): number {
  const d = clamp(diameter, spec.hp.minDiameter, spec.hp.maxDiameter);
  return Math.round(spec.hp.basePerArea * d * d * colorWeight(spec.color.stops, temp));
}

/** 보이는 지름 = clamp(minD + k·HP^p, minD, maxD). k 는 (anchorHp, anchorDiameter)로 역산 → 체력↑ 시 극적 거대화. */
export function visualDiameter(spec: PlasmoidSpec, hp: number): number {
  const v = spec.visual;
  const k = (v.anchorDiameter - v.minDiameter) / Math.pow(v.anchorHp, v.exponent);
  return clamp(v.minDiameter + k * Math.pow(Math.max(0, hp), v.exponent), v.minDiameter, v.maxDiameter);
}

/** 로그 정규화 '강함' s∈[0,1] — HP_floor(약) ~ HP_ceil(강). 속도/희귀도 공통 지표. */
export function strength(spec: PlasmoidSpec, hp: number): number {
  const { hpFloor, hpCeil } = spec.spawn;
  return clamp(Math.log(Math.max(1, hp) / hpFloor) / Math.log(hpCeil / hpFloor), 0, 1);
}

/** 강함 → 이동속도(질량 모델: 강할수록 둔함). v = speedMax − (speedMax−speedMin)·s. */
export function speedForStrength(spec: PlasmoidSpec, s: number): number {
  const { speedMax, speedMin } = spec.spawn;
  return speedMax - (speedMax - speedMin) * clamp(s, 0, 1);
}

/**
 * 온도 희귀도 f(T)∝T^-α 의 역CDF 샘플 — u∈[0,1) → T∈[tMin, tCap]. 고온(강체)일수록 드물게.
 * α=1 은 로그(스케일 불변) 분포로 특수 처리.
 */
export function sampleTemp(tMin: number, tCap: number, alpha: number, u: number): number {
  if (tCap <= tMin) return tMin;
  if (Math.abs(alpha - 1) < 1e-6) return tMin * Math.pow(tCap / tMin, u);
  const a = 1 - alpha;
  const lo = Math.pow(tMin, a), hi = Math.pow(tCap, a);
  return Math.pow(lo + u * (hi - lo), 1 / a);
}

// ─────────────────────────── 준위 강등(P3 — 물리편 §2.3 · overview §7) ───────────────────────────
// 정예·보스급의 연속 strength 를 이산 준위 n=1..4 로 계단화 — HP 가 경계(75/50/25%)를 하향
// 통과할 때 색이 적색 쪽으로 강등 + 짧은 경직(준위 붕괴의 방출). 고체력화의 스폰지 방지 짝:
// "깎이는 게 색으로 보인다". 잡몹(저체력)은 단일 준위(강등 없음).

export const KK_LEVELS = 4;
export const KK_DEMOTE_STAGGER = 0.35; // 강등 경직(s) — 처치 동시 경직(KILL_STAGGER)과 같은 문법
export const KK_MIN_HP = 3000; //         이 체력 이상만 계단화(정예·보스급)

/** 현재 준위(1..KK_LEVELS) — HP 비율 계단. 순수. */
export function kkLevelOf(hp: number, maxHp: number): number {
  const f = maxHp > 0 ? hp / maxHp : 0;
  return f > 0.75 ? 4 : f > 0.5 ? 3 : f > 0.25 ? 2 : 1;
}

/** 준위별 표시색(index = level-1) — 최저온(적색)→스폰 온도(본색)를 준위 수로 내림보간. 순수. */
export function kkLevelColors(spec: PlasmoidSpec, spawnTemp: number): number[] {
  const lowT = spec.color.stops[0].temp;
  return Array.from({ length: KK_LEVELS }, (_, i) =>
    colorAt(spec.color.stops, lowT + (spawnTemp - lowT) * (i / (KK_LEVELS - 1))));
}

// 스폰 롤 튜닝 상수(밸런스) — 외형/속도 산출에만 쓰임. 변형별 데이터가 아니라 모듈 상수로 둠.
const WAVE_TEMP_STEP = 900; // 웨이브당 해금되는 최고 온도 상승폭(K) — 점점 강한 청백 개체 등장
const NOMINAL_MIN = 0.8, NOMINAL_SPAN = 0.8, NOMINAL_WAVE_GROW = 0.04; // 체력 산정용 노미널 지름(m)
const NOMINAL_WAVE_CAP = 1.0; // 웨이브 보너스 상한 — 무한 증가 차단(플레이어 데미지는 고정이므로 불사화 방지)
const SPEED_JITTER = 1.0, SPEED_FLOOR = 1.5; // 속도 ±변주 폭 / 하한

/** 한 마리 스폰 외형·속도 롤 결과. */
export interface SpawnRoll {
  temp: number;
  maxHp: number;
  diameter: number; // 렌더 지름
  color: number; // 0xRRGGBB
  speed: number; // 기본 이동속도
}

/**
 * 한 마리 스폰 외형/속도 롤 — 온도(웨이브별 상한·저온 편향) → 체력 → 렌더크기·색·속도(강함 반비례).
 * rand: ()=>[0,1) 주입(테스트 결정성). 순수 함수.
 */
export function rollAppearance(spec: PlasmoidSpec, wave: number, rand: () => number): SpawnRoll {
  const stops = spec.color.stops;
  const tMin = stops[0].temp, tMax = stops[stops.length - 1].temp;
  const tCap = Math.min(tMax, tMin + wave * WAVE_TEMP_STEP);
  const temp = sampleTemp(tMin, tCap, spec.spawn.tempAlpha, rand());
  const nominal = NOMINAL_MIN + rand() * NOMINAL_SPAN + Math.min(NOMINAL_WAVE_CAP, wave * NOMINAL_WAVE_GROW);
  const maxHp = plasmoidHp(spec, nominal, temp);
  const diameter = visualDiameter(spec, maxHp);
  const color = colorAt(stops, temp);
  const speed = Math.max(SPEED_FLOOR, speedForStrength(spec, strength(spec, maxHp)) + (rand() - 0.5) * SPEED_JITTER);
  return { temp, maxHp, diameter, color, speed };
}

/**
 * 접촉 흡수 에너지 — 강함(s)에 비례. 이 값이 곧 플레이어 HP 피해이자 적의 회복량.
 * 강체일수록 크게(×(1+strengthMul·s)).
 */
export function contactDamage(spec: PlasmoidSpec, hp: number): number {
  const c = spec.contact;
  return c.hpDamage * (1 + c.strengthMul * strength(spec, hp));
}

/**
 * 아키타입별 웨이브 동시 개체 수 — (기본 + 2웨이브당 +1, countCap 상한) × 매칭 드론 수.
 * 매칭 드론(러셔=워커/카이터=플라이어)이 0이면 0 → 단일 구성은 자기 타입만(자기정렬·언윈너블 방지). 순수.
 */
export function archetypeCount(arche: PlasmoidArchetypeBase, wave: number, matchingPlayers: number): number {
  if (matchingPlayers <= 0) return 0;
  const per = Math.min(arche.countCap, arche.countBase + Math.floor(Math.max(0, wave - 1) / 2));
  return per * matchingPlayers;
}

/**
 * 잔여 예산에서 이번에 스폰할 아키타입 — 남은 수에 비례한 가중 추첨(예산 0 인 종은 자연 배제,
 * 전부 0 이면 null). 세 예산이 웨이브 내내 잔여 비율대로 섞여 투입되게 한다. rand: ()=>[0,1). 순수.
 */
export function pickSpawnType(
  pendingRusher: number, pendingKiter: number, pendingMarker: number, rand: () => number
): PlasmoidArchetype | null {
  const total = pendingRusher + pendingKiter + pendingMarker;
  if (total <= 0) return null;
  const u = rand() * total;
  if (u < pendingRusher) return "rusher";
  if (u < pendingRusher + pendingKiter) return "kiter";
  return "marker";
}

/**
 * 일괄 스폰 1마리의 아키타입 — 전장 드론 구성에 비례(워커↔러셔/지표, 플라이어↔카이터/상공).
 * 단일 구성은 자기 매칭 타입만(자기정렬 — 이길 수 없는 미스매치 차단). 둘 다 없으면 50:50. rand: ()=>[0,1). 순수.
 */
export function pickBurstType(walkers: number, flyers: number, rand: () => number): PlasmoidArchetype {
  const total = walkers + flyers;
  if (total <= 0) return rand() < 0.5 ? "rusher" : "kiter";
  return rand() * total < walkers ? "rusher" : "kiter";
}

/** 가장 낮은(가장 차가운·최약) 색 stop. */
export const lowestColor = (spec: PlasmoidSpec): ColorStop => spec.color.stops[0];
/** 가장 높은(가장 뜨거운·최강) 색 stop. */
export const highestColor = (spec: PlasmoidSpec): ColorStop => spec.color.stops[spec.color.stops.length - 1];

/**
 * 일괄 스폰의 **HP 예산 배분**(순수) — 합계 = total. index 0 = 중간보스(bossHp), 나머지 count-1 마리는
 * total−bossHp 를 무작위 가중(0.5~1.5)으로 나눠 갖되 합이 정확히 맞도록 마지막이 잔여를 흡수.
 * rand: ()=>[0,1). count≤0 → 빈 배열, count==1 → [total].
 */
export function distributeHp(total: number, bossHp: number, count: number, rand: () => number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [Math.max(1, Math.round(total))];
  const boss = Math.max(1, Math.min(Math.round(bossHp), Math.round(total)));
  const rest = Math.max(0, Math.round(total) - boss);
  const n = count - 1;
  const w: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = 0.5 + rand(); w.push(v); sum += v; }
  const out = new Array<number>(count);
  out[0] = boss; // 중간보스
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const h = i < n - 1 ? Math.max(1, Math.round((rest * w[i]) / sum)) : Math.max(1, rest - acc); // 마지막이 잔여 흡수(합 정확)
    out[i + 1] = h;
    acc += h;
  }
  return out;
}

// 강도 피라미드 — 잡몹(적색)·중견·정예(청백)의 개체수 비율과 체력 가중치. 개체수는 아래로 넓고
// 체력은 위로 무겁다. 증원 큐가 이 순서(잡몹→중견→정예→보스)로 소비되어 압력 상승 곡선을 만든다.
const PYRAMID_TIERS = [
  { frac: 0.6, weight: 1 }, // 잡몹 — 떼(핵앤슬래시 텍스처)
  { frac: 0.3, weight: 5 }, // 중견
  { frac: 0.1, weight: 13 }, // 정예 — 느리고 크고 밝음(청백)
] as const;
const PYRAMID_JITTER = 0.5; // 개체별 체력 ±변주(가중치 ×(1−j/2 .. 1+j/2)) — 같은 티어도 균일하지 않게

/**
 * 점진 투입의 **피라미드 체력 배분**(순수) — 합계 = total. 배열 순서가 곧 증원 순서:
 * 잡몹(60%) → 중견(30%) → 정예(10%) → **보스(마지막 1기, bossHp)** — 뒤로 갈수록 강해지는
 * 압력 상승 곡선 + 보스 등장이 클라이맥스가 된다. rand: ()=>[0,1). count≤0 → 빈 배열,
 * count==1 → [total]. bossHp≤0 이면 보스 없이 전량 티어 배분.
 */
export function pyramidHp(total: number, bossHp: number, count: number, rand: () => number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [Math.max(1, Math.round(total))];
  const boss = bossHp > 0 ? Math.max(1, Math.min(Math.round(bossHp), Math.round(total))) : 0;
  const n = boss > 0 ? count - 1 : count;
  const rest = Math.max(0, Math.round(total) - boss);
  // 티어별 개체수 — 마지막(정예)이 잔여를 흡수해 합 = n. 각 티어 최소 0.
  const counts = PYRAMID_TIERS.map((t) => Math.floor(n * t.frac));
  counts[counts.length - 1] += n - counts.reduce((a, b) => a + b, 0);
  // 개체별 가중치(티어 가중 × 지터) → rest 를 비례 배분(마지막이 잔여 흡수 — 합 정확).
  const w: number[] = [];
  let sum = 0;
  for (let ti = 0; ti < counts.length; ti++) {
    for (let i = 0; i < counts[ti]; i++) {
      const v = PYRAMID_TIERS[ti].weight * (1 - PYRAMID_JITTER / 2 + rand() * PYRAMID_JITTER);
      w.push(v);
      sum += v;
    }
  }
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    const h = i < w.length - 1 ? Math.max(1, Math.round((rest * w[i]) / sum)) : Math.max(1, rest - acc);
    out.push(h);
    acc += h;
  }
  if (boss > 0) out.push(boss); // 클라이맥스 — 증원 큐의 마지막
  return out;
}

/**
 * 예산 지정 HP → 외형(온도·색·렌더 지름). HP가 클수록 고온(청백)·대형 — 색=강함 메타포 유지.
 * `temp = lowT + strength(hp)·(highT−lowT)`, color/지름은 기존 시스템 재사용. 순수.
 */
export function appearanceForHp(spec: PlasmoidSpec, hp: number): { temp: number; color: number; diameter: number } {
  const lowT = spec.color.stops[0].temp;
  const highT = spec.color.stops[spec.color.stops.length - 1].temp;
  const temp = lowT + strength(spec, hp) * (highT - lowT);
  return { temp, color: colorAt(spec.color.stops, temp), diameter: visualDiameter(spec, hp) };
}

/**
 * 내장 기본 스펙 — public/enemies/plasmoid.json 과 동일(테스트가 동치 검증).
 * 비동기 로드가 어려운 곳(인트로 연출, EnemyManager 기본값)이 동일 시스템을 동기적으로 쓰도록 제공한다.
 */
export const DEFAULT_PLASMOID: PlasmoidSpec = {
  id: "plasmoid",
  name: "플라즈모이드 / PLASMOID",
  hp: { basePerArea: 100, minDiameter: 0.5, maxDiameter: 60 },
  color: {
    stops: [
      { temp: 3000, color: "0xff3b30", weight: 1.0 },
      { temp: 4500, color: "0xff8a3b", weight: 1.6 },
      { temp: 6000, color: "0xfff2c8", weight: 2.6 },
      { temp: 8000, color: "0xcfe2ff", weight: 3.6 },
      { temp: 12000, color: "0x4aa6ff", weight: 5.0 },
    ],
  },
  visual: { minDiameter: 2.0, maxDiameter: 600, anchorHp: 200000, anchorDiameter: 500, exponent: 0.82 },
  spawn: { tempAlpha: 2, speedMax: 13.5, speedMin: 3.75, hpFloor: 100, hpCeil: 200000 },
  contact: { hpDamage: 10, strengthMul: 2.0 },
  archetypes: {
    rusher: {
      name: "거머리 플라즈모이드 / LEECH",
      spawnAltMin: 0, spawnAltMax: 60, countBase: 6, countCap: 12, speed: 17, speedMin: 12,
    },
    kiter: {
      name: "모기 플라즈모이드 / SKEETER",
      spawnAltMin: 80, spawnAltMax: 300, countBase: 3, countCap: 5, speed: 89, speedMin: 67,
      turnRateDeg: 100, keepDist: 35, keepBand: 12, strafeMix: 0, orbitRef: 35, evadeGain: 0.85,
      attackRange: 95, drainDamage: 1.4, drainInterval: 1.5,
    },
    marker: {
      name: "소인체 플라즈모이드 / BRANDER",
      spawnAltMin: 40, spawnAltMax: 160, countBase: 2, countCap: 4, speed: 30, speedMin: 22,
      turnRateDeg: 90, keepDist: 70, keepBand: 18,
      tomb: { projSpeed: 22, projTurnRateDeg: 70, projTtl: 14, fireRange: 220, fireInterval: 7, sweepDamage: 18 },
    },
    cutter: {
      // 절단체(§6.3) — 웨이브 물량 0(로스터/미션 전용). 방어 미션의 주적 — 격추 시 건물 재안착.
      name: "절단체 플라즈모이드 / SEVERER",
      spawnAltMin: 30, spawnAltMax: 120, countBase: 0, countCap: 0, speed: 26, speedMin: 18,
      attachRange: 22, severSec: 5, seekRange: 900,
    },
    rewinder: {
      // 역행체(§6.6) — 웨이브 물량 0(미니보스 슬롯). 최우선 표적 — 시전을 끊지 못하면 전과가 되감긴다.
      name: "역행체 플라즈모이드 / RETROGRADE",
      spawnAltMin: 60, spawnAltMax: 200, countBase: 0, countCap: 0, speed: 24, speedMin: 16,
      turnRateDeg: 70, keepDist: 160, keepBand: 30,
      rollback: { castSec: 4, castCd: 14, castRange: 360, radius: 300, rewindSec: 5 },
    },
  },
  sweep: { period: 30, speed: 250, warnSec: 5, maxRadius: 1600 },
  phase: { minStrength: 0.35, chance: 0.7, cooldownMax: 16, cooldownMin: 9, durationMin: 2.5, durationMax: 5 },
};
