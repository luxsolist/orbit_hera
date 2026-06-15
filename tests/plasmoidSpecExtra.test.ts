import { describe, it, expect } from "vitest";
import {
  sampleTemp, plasmoidHp, visualDiameter, distributeHp, archetypeCount,
  rollAppearance, appearanceForHp,
  DEFAULT_PLASMOID, lowestColor, highestColor,
} from "../src/enemies/PlasmoidSpec";

const spec = DEFAULT_PLASMOID;

// ─────────────────────────────────────────────────────────────────────────────
describe("sampleTemp — alpha=1 로그분포 특수 처리", () => {
  const tMin = 3000, tCap = 12000;

  it("alpha=1: u=0 → tMin, u=1 → tCap", () => {
    expect(sampleTemp(tMin, tCap, 1, 0)).toBeCloseTo(tMin, 3);
    expect(sampleTemp(tMin, tCap, 1, 1)).toBeCloseTo(tCap, 3);
  });

  it("alpha=1: u=0.5 → 기하평균(√(tMin×tCap))", () => {
    const gm = Math.sqrt(tMin * tCap);
    expect(sampleTemp(tMin, tCap, 1, 0.5)).toBeCloseTo(gm, 3);
  });

  it("alpha=1 vs alpha=0.999/1.001 — 불연속 없음(±1% 이내)", () => {
    const v1 = sampleTemp(tMin, tCap, 1, 0.5);
    const vLo = sampleTemp(tMin, tCap, 0.999, 0.5);
    const vHi = sampleTemp(tMin, tCap, 1.001, 0.5);
    expect(Math.abs(v1 - vLo) / v1).toBeLessThan(0.01);
    expect(Math.abs(v1 - vHi) / v1).toBeLessThan(0.01);
  });

  it("tCap === tMin(폭 0) → 항상 tMin 반환(NaN/Infinity 없음)", () => {
    const v = sampleTemp(5000, 5000, 2, 0.5);
    expect(v).toBe(5000);
    expect(Number.isFinite(v)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("plasmoidHp — 지름 클램프 경계", () => {
  const lowT = lowestColor(spec).temp;

  it("diameter=0 → minDiameter로 클램프 → basePerArea × minD² × 1", () => {
    const minD = spec.hp.minDiameter;
    const expected = Math.round(spec.hp.basePerArea * minD * minD * 1.0);
    expect(plasmoidHp(spec, 0, lowT)).toBe(expected);
  });

  it("diameter 음수 → minDiameter 클램프(0 동일)", () => {
    expect(plasmoidHp(spec, -100, lowT)).toBe(plasmoidHp(spec, 0, lowT));
  });

  it("diameter 매우 큰 값 → maxDiameter로 클램프", () => {
    const maxD = spec.hp.maxDiameter;
    const expected = plasmoidHp(spec, maxD, lowestColor(spec).temp);
    expect(plasmoidHp(spec, 1e9, lowestColor(spec).temp)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("visualDiameter — hp 경계", () => {
  it("hp=0 → 최소 지름(minDiameter) 반환(Math.pow(0, exp)=0 → minD+k×0=minD)", () => {
    expect(visualDiameter(spec, 0)).toBe(spec.visual.minDiameter);
  });

  it("hp 음수 → 최소 지름(max(0, hp)^p = 0)", () => {
    expect(visualDiameter(spec, -999)).toBe(spec.visual.minDiameter);
  });

  it("hp 매우 큰 값 → maxDiameter 소프트캡", () => {
    expect(visualDiameter(spec, 1e15)).toBeLessThanOrEqual(spec.visual.maxDiameter);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("distributeHp — 합산 정확성 (대 count)", () => {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  it("count=1000: 합계 = totalHp, 모든 개체 HP≥1", () => {
    const hps = distributeHp(70000, 10000, 1000, rnd);
    expect(hps).toHaveLength(1000);
    expect(hps.reduce((a, b) => a + b, 0)).toBe(70000);
    for (const h of hps) expect(h).toBeGreaterThanOrEqual(1);
  });

  it("bossHp > totalHp → boss = min(round(bossHp), round(total)) = total, 나머지 n마리는 각 최소 1(Math.max(1,…))", () => {
    // boss=5000, rest=0, 나머지 9마리가 max(1, 0-acc) 씩 최소 1 → 합=5000+9=5009
    const hps = distributeHp(5000, 9999, 10, rnd);
    expect(hps[0]).toBe(5000); // boss = min(9999, 5000) = 5000
    // 나머지 개체가 각 최소 1을 가져가므로 합 = 5000 + (count-1)×1
    expect(hps.reduce((a, b) => a + b, 0)).toBe(5000 + 9); // 5009
    for (const h of hps) expect(h).toBeGreaterThanOrEqual(1);
  });

  it("bossHp=totalHp → 보스 슬롯이 모두 가져감, 나머지는 최소(1)", () => {
    const hps = distributeHp(1000, 1000, 5, rnd);
    expect(hps[0]).toBe(1000);
    for (const h of hps.slice(1)) expect(h).toBeGreaterThanOrEqual(1);
  });

  it("count=2: [boss, 나머지 1마리] — 나머지=totalHp-boss", () => {
    const hps = distributeHp(10000, 3000, 2, rnd);
    expect(hps[0]).toBe(3000);
    expect(hps[1]).toBe(7000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("archetypeCount — 웨이브 경계값", () => {
  const arche = spec.archetypes.rusher; // countBase=6, countCap=12

  it("wave=1: floor((1-1)/2)=0 → countBase 그대로", () => {
    expect(archetypeCount(arche, 1, 1)).toBe(arche.countBase);
  });

  it("wave=2: floor((2-1)/2)=0 → 여전히 countBase", () => {
    expect(archetypeCount(arche, 2, 1)).toBe(arche.countBase);
  });

  it("wave=3: floor((3-1)/2)=1 → countBase+1", () => {
    expect(archetypeCount(arche, 3, 1)).toBe(arche.countBase + 1);
  });

  it("wave=4: floor((4-1)/2)=1 → countBase+1", () => {
    expect(archetypeCount(arche, 4, 1)).toBe(arche.countBase + 1);
  });

  it("wave=5: floor((5-1)/2)=2 → countBase+2", () => {
    expect(archetypeCount(arche, 5, 1)).toBe(arche.countBase + 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("rollAppearance — 웨이브 온도 상한", () => {
  const stops = spec.color.stops;
  const tMin = stops[0].temp, tMax = stops[stops.length - 1].temp;

  it("wave=0: tCap=tMin → 모든 롤이 tMin 온도만(rand 무관)", () => {
    for (let u = 0; u <= 1; u += 0.1) {
      const r = rollAppearance(spec, 0, () => u);
      expect(r.temp).toBeCloseTo(tMin, 3);
    }
  });

  it("wave=9999: tCap은 tMax를 초과하지 않음", () => {
    const r = rollAppearance(spec, 9999, () => 0.99);
    expect(r.temp).toBeLessThanOrEqual(tMax + 1e-3);
  });

  it("웨이브 오를수록 높은 온도 해금(wave 증가 → 최대 가능 온도 증가)", () => {
    // wave=1: tCap = tMin+900. wave=10: tCap = tMin+9000 (혹은 tMax 클램프)
    const r1 = rollAppearance(spec, 1, () => 0.99);
    const r10 = rollAppearance(spec, 10, () => 0.99);
    expect(r10.temp).toBeGreaterThanOrEqual(r1.temp);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("appearanceForHp — HP → 온도 단조 증가", () => {
  it("아주 낮은 HP → tMin 근처 온도", () => {
    const lowT = lowestColor(spec).temp;
    const a = appearanceForHp(spec, 1);
    // strength(1) ≈ 0(hpFloor보다 낮음) → temp ≈ tMin
    expect(a.temp).toBeCloseTo(lowT, 0);
  });

  it("아주 높은 HP → tMax 근처 온도", () => {
    const highT = highestColor(spec).temp;
    const a = appearanceForHp(spec, 1e9);
    expect(a.temp).toBeCloseTo(highT, 0);
  });

  it("HP 증가할수록 온도·지름 모두 단조 증가", () => {
    const hps = [100, 1000, 5000, 20000, 100000];
    for (let i = 1; i < hps.length; i++) {
      const prev = appearanceForHp(spec, hps[i - 1]);
      const cur = appearanceForHp(spec, hps[i]);
      expect(cur.temp).toBeGreaterThanOrEqual(prev.temp);
      expect(cur.diameter).toBeGreaterThanOrEqual(prev.diameter);
    }
  });
});
