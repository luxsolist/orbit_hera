import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  colorWeight, colorStrength01, colorAt, plasmoidHp, visualDiameter, lowestColor, highestColor,
  strength, speedForStrength, sampleTemp, rollAppearance, contactDamage,
  DEFAULT_PLASMOID, type PlasmoidSpec,
} from "../src/enemies/PlasmoidSpec";

// 데이터 구동 플라즈모이드 스펙 + 순수 산출 유틸 검증(분리형: 체력↔렌더크기 디커플링).
const spec = JSON.parse(readFileSync("public/enemies/plasmoid.json", "utf8")) as PlasmoidSpec;

describe("내장 기본 스펙 동기화", () => {
  it("DEFAULT_PLASMOID === public/enemies/plasmoid.json (드리프트 방지)", () => {
    expect(DEFAULT_PLASMOID).toEqual(spec);
  });
});

describe("플라즈모이드 스펙(JSON)", () => {
  it("필수 필드 + 색 stop: 온도 오름차순 / 가중치 비감소", () => {
    expect(typeof spec.id).toBe("string");
    expect(spec.hp.basePerArea).toBeGreaterThan(0);
    const s = spec.color.stops;
    expect(s.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < s.length; i++) {
      expect(s[i].temp).toBeGreaterThan(s[i - 1].temp);
      expect(s[i].weight).toBeGreaterThanOrEqual(s[i - 1].weight);
      expect(Number.isFinite(Number(s[i].color))).toBe(true);
    }
  });
  it("가장 낮은 색 = 가중치 1.0, 가장 높은 색 = 최대 가중치", () => {
    expect(lowestColor(spec).weight).toBe(1.0);
    expect(highestColor(spec).weight).toBe(Math.max(...spec.color.stops.map((s) => s.weight)));
  });
});

describe("체력 산출(HP = basePerArea × 지름² × 색가중치)", () => {
  it("기준점: 가장 낮은 색·지름 1m = basePerArea", () => {
    expect(plasmoidHp(spec, 1, lowestColor(spec).temp)).toBe(spec.hp.basePerArea);
  });
  it("크기: 지름 2배 → 체력 4배(표면적)", () => {
    const t = lowestColor(spec).temp;
    expect(plasmoidHp(spec, 2, t) / plasmoidHp(spec, 1, t)).toBeCloseTo(4, 5);
  });
  it("색가중치: 최강 색은 최약 색의 weight 배", () => {
    const hot = highestColor(spec), cold = lowestColor(spec);
    expect(plasmoidHp(spec, 2, hot.temp) / plasmoidHp(spec, 2, cold.temp)).toBeCloseTo(hot.weight / cold.weight, 5);
  });
  it("colorWeight/colorAt: 양끝 클램프", () => {
    const s = spec.color.stops, last = s.length - 1;
    expect(colorWeight(s, s[0].temp - 9999)).toBe(s[0].weight);
    expect(colorWeight(s, s[last].temp + 9999)).toBe(s[last].weight);
    expect(colorAt(s, s[0].temp)).toBe(Number(s[0].color));
    expect(colorAt(s, s[last].temp)).toBe(Number(s[last].color));
  });
  it("colorWeight: 내부 구간 보간 + 내부 stop 정확", () => {
    const s = spec.color.stops;
    expect(colorWeight(s, 7000)).toBeCloseTo(3.1, 5); // 6000(2.6)~8000(3.6) 중점
    expect(colorWeight(s, 6000)).toBeCloseTo(2.6, 5); // 내부 stop 에 정확히 안착
  });
  it("colorAt: 내부 온도 채널 보간(3750 = 적↔주황 중점)", () => {
    // 0xff3b30 ↔ 0xff8a3b, t=0.5 → R=0xff, G=round(0x3b+0x8a)/2, B=round(0x30+0x3b)/2
    expect(colorAt(spec.color.stops, 3750)).toBe(0xff6336);
  });
});

describe("rollAppearance(스폰 외형/속도 롤)", () => {
  it("rand=0(최저 롤): 최저온·최저HP·적색·최고속도(−지터)", () => {
    const r = rollAppearance(spec, 0, () => 0);
    expect(r.temp).toBeCloseTo(spec.color.stops[0].temp, 5); // tMin
    expect(r.color).toBe(Number(spec.color.stops[0].color)); // 적색
    expect(r.maxHp).toBe(plasmoidHp(spec, 0.8, spec.color.stops[0].temp)); // nominal=0.8 @wave0
    expect(r.speed).toBeCloseTo(spec.spawn.speedMax - 0.5, 5); // s=0 → speedMax, 지터 −0.5
  });
  it("결정성 + 범위", () => {
    const a = rollAppearance(spec, 3, () => 0.5);
    const b = rollAppearance(spec, 3, () => 0.5);
    expect(a).toEqual(b);
    const r = rollAppearance(spec, 5, () => 0.99);
    expect(r.temp).toBeGreaterThanOrEqual(spec.color.stops[0].temp);
    expect(r.temp).toBeLessThanOrEqual(spec.color.stops[spec.color.stops.length - 1].temp);
    expect(r.speed).toBeGreaterThanOrEqual(1.5); // SPEED_FLOOR
  });
});

describe("강함(s)·속도·스폰 희귀도", () => {
  const sp = spec.spawn;
  it("strength: HP_floor→0, HP_ceil→1, 단조 증가, 클램프", () => {
    expect(strength(spec, sp.hpFloor)).toBeCloseTo(0, 5);
    expect(strength(spec, sp.hpCeil)).toBeCloseTo(1, 5);
    expect(strength(spec, 4500)).toBeGreaterThan(strength(spec, 900));
    expect(strength(spec, sp.hpFloor / 10)).toBe(0); // 하한 클램프
    expect(strength(spec, sp.hpCeil * 10)).toBe(1); // 상한 클램프
  });
  it("speedForStrength: 약체=speedMax, 강체=speedMin, 선형 감소", () => {
    expect(speedForStrength(spec, 0)).toBeCloseTo(sp.speedMax, 5);
    expect(speedForStrength(spec, 1)).toBeCloseTo(sp.speedMin, 5);
    expect(speedForStrength(spec, 0.5)).toBeCloseTo((sp.speedMax + sp.speedMin) / 2, 5);
  });
  it("sampleTemp: 경계(u=0→tMin, u=1→tCap) + 단조 + 고온 희귀(α=2)", () => {
    const tMin = 3000, tCap = 12000, a = sp.tempAlpha;
    expect(sampleTemp(tMin, tCap, a, 0)).toBeCloseTo(tMin, 5);
    expect(sampleTemp(tMin, tCap, a, 1)).toBeCloseTo(tCap, 5);
    expect(sampleTemp(tMin, tCap, a, 0.7)).toBeGreaterThan(sampleTemp(tMin, tCap, a, 0.3));
    // f(T)∝T^-2 → 중앙값(u=0.5)이 산술중앙보다 저온 쪽으로 치우침
    expect(sampleTemp(tMin, tCap, a, 0.5)).toBeLessThan((tMin + tCap) / 2);
    expect(sampleTemp(tMin, tMin, a, 0.5)).toBe(tMin); // 폭 0 가드
  });
});

describe("접촉 흡수 에너지 — 강함 비례(= HP 피해 = 적 회복)", () => {
  const c = spec.contact;
  const floor = spec.spawn.hpFloor, ceil = spec.spawn.hpCeil;
  it("약체 = 기본값(hpDamage)", () => {
    expect(contactDamage(spec, floor)).toBeCloseTo(c.hpDamage, 5);
  });
  it("강체일수록 큼 = ×(1+strengthMul)", () => {
    expect(contactDamage(spec, ceil)).toBeCloseTo(c.hpDamage * (1 + c.strengthMul), 5);
  });
});

describe("렌더 크기(분리형: dVis = clamp(minD + k·HP^p, minD, maxD))", () => {
  it("앵커 체력 → 앵커 지름", () => {
    expect(visualDiameter(spec, spec.visual.anchorHp)).toBeCloseTo(spec.visual.anchorDiameter, 0);
  });
  it("저체력 → 하한 근처(잡몹은 작게)", () => {
    const d = visualDiameter(spec, plasmoidHp(spec, 1, lowestColor(spec).temp));
    expect(d).toBeGreaterThanOrEqual(spec.visual.minDiameter);
    expect(d).toBeLessThan(spec.visual.minDiameter + 2);
  });
  it("단조 증가 + 소프트캡", () => {
    expect(visualDiameter(spec, 1000)).toBeGreaterThan(visualDiameter(spec, 100));
    expect(visualDiameter(spec, 1e12)).toBeLessThanOrEqual(spec.visual.maxDiameter);
  });
});

describe("colorStrength01 — 색 강도 정규화(적색 0 → 청백 1, 속도·발광 노브)", () => {
  const stops = spec.color.stops;
  it("최저 색(적색) → 0, 최고 색(청백) → 1", () => {
    expect(colorStrength01(stops, lowestColor(spec).temp)).toBeCloseTo(0, 6);
    expect(colorStrength01(stops, highestColor(spec).temp)).toBeCloseTo(1, 6);
  });
  it("중간 온도는 0~1 사이 + 온도에 단조 증가", () => {
    const mid = colorStrength01(stops, (lowestColor(spec).temp + highestColor(spec).temp) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(colorStrength01(stops, 8000)).toBeGreaterThan(colorStrength01(stops, 4000));
  });
  it("범위 밖 온도는 [0,1] 클램프", () => {
    expect(colorStrength01(stops, -1000)).toBe(0);
    expect(colorStrength01(stops, 1e9)).toBe(1);
  });
});
