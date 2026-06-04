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

/** 스폰 분포·이동속도 파라미터 — '강함(s)' 하나로 희귀도와 속도를 함께 묶는다. */
export interface PlasmoidSpawnSpec {
  tempAlpha: number; // 온도 희귀도 지수 α (f(T) ∝ T^-α). 클수록 고온(강체) 희귀.
  speedMax: number; // 가장 약한(적색) 개체 이동속도
  speedMin: number; // 가장 강한(청백/보스) 개체 이동속도
  hpFloor: number; // 강함 정규화 하한 HP (s=0)
  hpCeil: number; // 강함 정규화 상한 HP (s=1)
}

/** 고도(지면 대비) 속도 가중 — 영역별(수중/지표/공중) 드론과의 추격 균형용. */
export interface PlasmoidAltitudeSpec {
  airRef: number; // 이 고도(m, 지면 위)에서 공중 가속이 상한에 도달
  depthRef: number; // 이 깊이(m, 지면 아래)에서 감속이 하한에 도달
  airBoostMax: number; // 공중 최대 가속 비율(예 1.6 = +160%)
  depthSlowMax: number; // 수중/지하 최대 감속 비율(예 0.6 = -60%)
}

/**
 * 접촉(에너지 흡수) 피해 — 플라즈모이드가 물체에서 에너지를 빨아들여 약화시키고(인트로의 집 붕괴 원인)
 * 그만큼 자기 체력을 회복하는 설정. 흡수량 = 플레이어 HP 피해 = 플라즈모이드 회복량.
 */
export interface PlasmoidContactSpec {
  hpDamage: number; // 약체(s=0)·지표 접촉 시 흡수 에너지(= 플레이어 HP 피해 = 적 회복량)
  strengthMul: number; // 강함 s=1 일 때 추가 배수 → ×(1+strengthMul)
  altWeakRef: number; // 이 고도(m)에서 약화가 하한에 도달
  altWeakMin: number; // 고고도 피해 하한 배수(고공일수록 약해져 빠른 공중전 유도)
}

/** 플라즈모이드 1종 스펙. */
export interface PlasmoidSpec {
  id: string;
  name: string;
  hp: PlasmoidHpSpec;
  color: { stops: ColorStop[] };
  visual: PlasmoidVisualSpec;
  spawn: PlasmoidSpawnSpec;
  altitude: PlasmoidAltitudeSpec;
  contact: PlasmoidContactSpec;
}

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

/**
 * 고도(지면 대비 m) → 이동속도 배수. 지표=1.0, 공중↑(+, 상한 1+airBoostMax),
 * 지하/수중↓(−, 하한 1−depthSlowMax). airRef/depthRef 에서 가중이 포화(상·하한 클램프).
 */
export function altitudeSpeedMult(spec: PlasmoidSpec, altitude: number): number {
  const a = spec.altitude;
  if (altitude >= 0) return 1 + a.airBoostMax * Math.min(1, altitude / a.airRef);
  return 1 - a.depthSlowMax * Math.min(1, -altitude / a.depthRef);
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
  speed: number; // 기본 이동속도(고도 가중 전)
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

/** 고도 약화 배수(접촉 피해용) — 지표=1, 고고도일수록 ↓(altWeakRef 에서 altWeakMin 도달). */
function contactAltWeaken(c: PlasmoidContactSpec, altitude: number): number {
  if (altitude <= 0) return 1;
  return 1 - (1 - c.altWeakMin) * Math.min(1, altitude / c.altWeakRef);
}

/**
 * 접촉 흡수 에너지 — 강함(s)에 비례·고도가 높을수록 약화. 이 값이 곧 플레이어 HP 피해이자 적의 회복량.
 * 강체일수록 크게(×(1+strengthMul·s)), 고공일수록 약하게(×altWeaken) → 저공=묵직/고공=경쾌.
 */
export function contactDamage(spec: PlasmoidSpec, hp: number, altitude: number): number {
  const c = spec.contact;
  return c.hpDamage * (1 + c.strengthMul * strength(spec, hp)) * contactAltWeaken(c, altitude);
}

/** 가장 낮은(가장 차가운·최약) 색 stop. */
export const lowestColor = (spec: PlasmoidSpec): ColorStop => spec.color.stops[0];
/** 가장 높은(가장 뜨거운·최강) 색 stop. */
export const highestColor = (spec: PlasmoidSpec): ColorStop => spec.color.stops[spec.color.stops.length - 1];

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
  visual: { minDiameter: 1.0, maxDiameter: 300, anchorHp: 200000, anchorDiameter: 250, exponent: 0.82 },
  spawn: { tempAlpha: 2, speedMax: 13.5, speedMin: 3.75, hpFloor: 100, hpCeil: 200000 },
  altitude: { airRef: 220, depthRef: 50, airBoostMax: 4.52, depthSlowMax: 0.6 },
  contact: { hpDamage: 9, strengthMul: 2.0, altWeakRef: 250, altWeakMin: 0.3 },
};
