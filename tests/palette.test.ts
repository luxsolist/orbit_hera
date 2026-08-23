import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SKY_COLOR, LIGHT, EXPOSURE, WALL_COLOR, RUBBLE_COLOR, LANDMARK_COLOR, FOG_NEAR_RATIO, FOG_COLOR, WATER_COLOR } from "../src/world/palette";
import { GROUND_GREEN, SAND_TAN } from "../src/world/geo";

// 전장 팔레트의 **시인성 계약**. 값들이 서로 얽혀 있어(하늘을 어둡게 하면 바다와 붙고, 태양을 낮추면
// 그늘이 죽고, 랜드마크 색은 황토와 충돌한다) 하나를 고칠 때 다른 것이 조용히 무너진다 — 실제로 그랬다.
// 여기서 "정보를 나르는 요소가 배경에 묻히지 않는다"를 수치로 못박는다.
//
// 파이프라인 전제: 씬 → 렌더타깃(선형 HDR, 톤매핑 없음) → OutputPass(ACES + sRGB).
// 확산 반사 = albedo × irradiance / π.

const PI = Math.PI;
const aces = (x: number): number => {
  const v = x * EXPOSURE;
  return Math.min(1, (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14));
};
const lin = (hex: number): number[] => { const c = new THREE.Color().setHex(hex); return [c.r, c.g, c.b]; };
/** 채널 최대차 — 휘도만 보면 색조 차이를 놓친다(포화 구간에서 특히). */
const sep = (a: number[], b: number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

const SUN = (LIGHT.hemi + LIGHT.sun + LIGHT.fill * 0.5) / PI; // 태양 정면
const SHADE = (LIGHT.hemi * 0.5) / PI; //                        태양 차단(반구광 일부)
const litS = (albedo: number[], f: number) => albedo.map((v) => aces(v * f));
const unlit = (albedo: number[]) => albedo.map(aces);

// 게임 화면을 이루는 요소들의 **최종 화면 색**.
const SNOW = 0xeef4f7;
const BUILDING_MAX = 0xfafafa; // precinct.buildingBaseColor 의 최고층 색
const EL: Record<string, number[]> = {
  "하늘": unlit(lin(SKY_COLOR)),
  "지형": litS(lin(GROUND_GREEN), SUN),
  "수면": litS(lin(WATER_COLOR), SUN), // 강·호수(폴리곤)와 바다(표고 ≤0)가 같은 색 — 통일됨
  "포그(원경)": unlit(lin(FOG_COLOR)), // 원경은 이 색으로 수렴 — 먼 적의 배경이 된다
  "황토": litS(lin(SAND_TAN), SUN),
  "눈": litS(lin(SNOW), SUN),
  "건물(직사광)": litS(lin(BUILDING_MAX), SUN),
  "건물(그늘)": litS(lin(BUILDING_MAX), SHADE),
  "담장": litS(lin(WALL_COLOR), SUN),
  "랜드마크(직사광)": litS([LANDMARK_COLOR.r, LANDMARK_COLOR.g, LANDMARK_COLOR.b], SUN),
  "랜드마크(그늘)": litS([LANDMARK_COLOR.r, LANDMARK_COLOR.g, LANDMARK_COLOR.b], SHADE),
  "잔해": unlit(lin(RUBBLE_COLOR)),
  "적(적색·약체)": unlit(lin(0xff3b30)),
  "적(청백·강체)": unlit(lin(0x4aa6ff)),
  "빔(중주파)": unlit(lin(0x60ffff)),
};

const BACKGROUNDS = ["하늘", "지형", "수면", "포그(원경)", "황토", "눈", "건물(직사광)", "건물(그늘)", "담장"];
/**
 * 계약 대상 = **정보를 나르는 요소 ↔ 그것이 얹히는 배경**.
 * 배경끼리 붙는 것(눈↔건물, 황토↔담장)은 시각적 단조로움이지 정보 손실이 아니므로 제외한다 —
 * 모든 쌍을 동등하게 보면 정작 중요한 쌍을 놓친다.
 */
const CRITICAL: Record<string, string[]> = {
  "적(적색·약체)": BACKGROUNDS,
  "적(청백·강체)": BACKGROUNDS,
  "빔(중주파)": BACKGROUNDS,
  "랜드마크(직사광)": ["건물(직사광)", "지형", "황토", "눈"],
  "랜드마크(그늘)": ["건물(그늘)", "담장"],
  "잔해": ["지형", "건물(그늘)", "황토", "담장"],
};

/** 계약 최소치. 현 팔레트의 실측 최소는 0.245(랜드마크(그늘)↔건물(그늘)). */
const MIN_SEPARATION = 0.24;

describe("팔레트 — 정보 요소가 배경에 묻히지 않는다", () => {
  it(`모든 치명 쌍의 채널 분리 ≥ ${MIN_SEPARATION}`, () => {
    const violations: string[] = [];
    for (const [fg, bgs] of Object.entries(CRITICAL)) {
      for (const bg of bgs) {
        const d = sep(EL[fg], EL[bg]);
        if (d < MIN_SEPARATION) violations.push(`${fg} ↔ ${bg} = ${d.toFixed(3)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("청백 플라즈모이드가 하늘에 묻히지 않는다 — 강한 개체일수록 안 보이던 회귀", () => {
    // 이전 하늘(0x2f9bf2)에서는 0.058 이었다. 강체가 가장 위험한데 가장 안 보였다.
    expect(sep(EL["적(청백·강체)"], EL["하늘"])).toBeGreaterThan(0.3);
  });

  it("청백 플라즈모이드가 수면에도 묻히지 않는다 — 해안·하천 맵", () => {
    // 이전 수면(#84c0f7 연한 파랑)에서 0.188 이었다. 청록이 적 파랑과 지형 초록 사이의 빈 자리다.
    expect(sep(EL["적(청백·강체)"], EL["수면"])).toBeGreaterThan(0.24);
  });

  it("수면은 **확실한** 파랑 — 청록이면 초록 지형과 같은 계열로 읽힌다", () => {
    // 회귀: 0x4c7072 는 G 112 · B 114 로 사실상 청록이었고, 어두워지자 땅과 구분이 안 됐다.
    const [r, g, b] = lin(WATER_COLOR);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g * 1.5); // 근소한 차이가 아니라 뚜렷한 파랑
  });

  it("랜드마크가 황토 지표(해변·바위·포장) 위에서 읽힌다", () => {
    // 금색(1.5,1.1,0.42)일 때 0.120 이었다 — 해변 랜드마크가 지면에 녹았다.
    expect(sep(EL["랜드마크(직사광)"], EL["황토"])).toBeGreaterThan(0.24);
  });

  it("잔해가 어두운 배경에서 사라지지 않는다 — 순수 검정이면 그늘에 묻힌다", () => {
    expect(sep(EL["잔해"], EL["건물(그늘)"])).toBeGreaterThan(0.24);
    expect(RUBBLE_COLOR).not.toBe(0x000000);
  });
});

describe("팔레트 — 톤 구조", () => {
  const lum = (v: number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

  it("그늘이 죽지 않는다 — 태양을 낮춘 만큼 반구광이 받쳐야 한다", () => {
    // 조명을 일괄 감광하면 그늘이 먼저 무너진다. 차분한 톤 = 태양↓ + 반구광 유지.
    expect(lum(EL["건물(그늘)"])).toBeGreaterThan(0.25);
    expect(LIGHT.hemi).toBeGreaterThan(LIGHT.sun); // 흐린 날 구조(환경광 우세)
  });

  it("클리핑이 없다 — 흰색에 붙으면 음영 정보가 사라진다", () => {
    for (const [k, v] of Object.entries(EL)) expect(lum(v), k).toBeLessThan(0.9);
  });

  it("랜드마크는 어떤 일반 건물보다 밝고 파괴 번쩍임(FLASH 2.0)보다는 어둡다", () => {
    expect(LANDMARK_COLOR.r).toBeGreaterThan(1.0); // 최고층 건물 알베도 0.956 위
    expect(Math.max(LANDMARK_COLOR.r, LANDMARK_COLOR.g, LANDMARK_COLOR.b)).toBeLessThan(2.0);
  });

  it("포그가 원경을 가라앉히지 않는다 — 대기 원근은 먼 것을 밝게 만든다", () => {
    // 하늘색과 같게 두면 포그(0.221)가 지형(0.558)보다 어두워 원경이 어두워졌다.
    // (한때 |포그−수면| < 0.12 도 걸었으나 그건 감마 버그로 바다가 어둡던 시절의 근거였다.
    //  물이 하늘보다 어두운 지금은 먼 물이 밝아지는 게 정상적인 대기 원근이다.)
    expect(lum(EL["포그(원경)"])).toBeGreaterThan(lum(EL["하늘"]));
    expect(lum(EL["포그(원경)"])).toBeLessThan(lum(EL["지형"])); // 원경이 근경보다 밝아 붕 뜨지도 않게
  });

  it("건물 실루엣이 하늘에 묻히지 않는다 — 무채색 하늘의 구조적 함정", () => {
    // 건물은 무채색(그늘 0.280 ~ 직사광 0.723)이라 **무채색 하늘은 그 사이 어딘가와 반드시 부딪힌다**.
    // 실측: 하늘 0.20~0.34 → 건물(그늘) 분리 0.088 · 하늘 0.609 → 건물(직사광) 0.122.
    // 안전지대는 두 상태의 **중간**(0.498 → 0.240/0.242)뿐이다.
    expect(sep(EL["하늘"], EL["건물(그늘)"])).toBeGreaterThan(0.20);
    expect(sep(EL["하늘"], EL["건물(직사광)"])).toBeGreaterThan(0.20);
  });

  it("하늘은 저채도 — 톤을 결정하는 건 밝기가 아니라 채도다", () => {
    const c = lin(SKY_COLOR);
    const mx = Math.max(...c), mn = Math.min(...c);
    expect((mx - mn) / mx).toBeLessThan(0.2); // 구 0x2f9bf2 는 0.97 이었다
  });

  it("수면이 하늘과 수평선에서 붙지 않는다 — 비행 중 방향감", () => {
    // 함정: 하늘 휘도 바로 아래(0x3f9099)면 분리가 0.065 로 무너진다. 확실히 어둡게 가야 한다.
    expect(lum(EL["수면"])).toBeLessThan(lum(EL["하늘"])); // 물은 하늘보다 어둡다(반사+흡수)
    expect(sep(EL["수면"], EL["하늘"])).toBeGreaterThan(0.18);
  });

  it("포그와 하늘의 차이는 수평선 헤이즈로 읽히는 범위", () => {
    expect(sep(EL["포그(원경)"], EL["하늘"])).toBeLessThan(0.25); // 넘으면 경계가 띠로 드러난다
  });

  it("포그는 교전 사거리를 흐리지 않고 청크 경계에서 끝난다", () => {
    // 포그의 실질 기능은 경계 은폐 — 시작이 이르면 교전 사거리가 흐려진다(구 설정 900m: 1.5km 에서 15%).
    expect(FOG_NEAR_RATIO).toBeGreaterThan(0.6);
    expect(FOG_NEAR_RATIO).toBeLessThan(0.85);
  });
});
