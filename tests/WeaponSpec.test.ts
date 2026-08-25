import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  damageForDistance, cooldownReadyFrac, withAutoBoost, autoFireAllowed, DEFAULT_AUTO_FREQ_FLOOR,
  type BeamSpec,
} from "../src/weapons/WeaponSpec";

// frequency-beam.json 의 falloff 기준
const F = { refDist: 26, maxMult: 2.5, minMult: 0.5 };

describe("damageForDistance — 거리 반비례 위력", () => {
  it("기준 거리(refDist)에서 배수 1.0", () => {
    expect(damageForDistance(26, 40, F)).toBeCloseTo(40, 6);
  });
  it("근접은 상한(maxMult)으로 클램프", () => {
    expect(damageForDistance(1, 40, F)).toBeCloseTo(40 * 2.5, 6); // refDist/1=26 → 상한 2.5
    expect(damageForDistance(0, 40, F)).toBeCloseTo(40 * 2.5, 6); // dist<1 → max(dist,1)
  });
  it("원거리는 하한(minMult)으로 클램프", () => {
    expect(damageForDistance(1000, 40, F)).toBeCloseTo(40 * 0.5, 6);
  });
  it("중간 거리는 거리에 반비례", () => {
    expect(damageForDistance(52, 40, F)).toBeCloseTo(40 * (26 / 52), 6); // 0.5 배
  });
});

describe("cooldownReadyFrac — 쿨다운 진행률(0=발동, 1=준비완료)", () => {
  it("막 발동=0, 절반=0.5, 완료=1", () => {
    expect(cooldownReadyFrac(60, 60)).toBe(0);
    expect(cooldownReadyFrac(30, 60)).toBeCloseTo(0.5, 6);
    expect(cooldownReadyFrac(0, 60)).toBe(1);
  });
  it("음수/초과는 [0,1] 클램프", () => {
    expect(cooldownReadyFrac(-5, 60)).toBe(1);
    expect(cooldownReadyFrac(90, 60)).toBe(0);
  });
});

describe("withAutoBoost — 자동조준/사격 강화(모바일 플라이어)", () => {
  const base: BeamSpec = {
    id: "b", name: "n", abbr: "빔", type: "beam", range: 400, color: "0x90ffff", beamLifetime: 0.08,
    manual: { damage: 13, freqCost: 7, fireInterval: 0.085, assistConeDeg: 28 },
    auto: { damage: 5, freqCost: 2, fireInterval: 0.13, range: 50 },
    falloff: { refDist: 26, maxMult: 2.5, minMult: 0.75 },
  };
  it("auto.range·assistConeDeg 만 배수 적용", () => {
    const b = withAutoBoost(base, 2);
    expect(b.auto.range).toBe(100);
    expect(b.manual.assistConeDeg).toBe(56);
  });
  it("rangeMul 생략 시 coneMul 과 동일(하위호환)", () => {
    const b = withAutoBoost(base, 3);
    expect(b.auto.range).toBe(150); // 50×3
    expect(b.manual.assistConeDeg).toBe(84); // 28×3
  });
  it("콘/사거리 배수 분리 — 모바일(콘 2×, 사거리 1× = 데스크탑 동일)", () => {
    const b = withAutoBoost(base, 2, 1);
    expect(b.manual.assistConeDeg).toBe(56); // 콘만 2배(터치 조준 보정)
    expect(b.auto.range).toBe(50);           // 사거리는 원본 유지(1배)
  });
  it("그 외 수치는 불변(damage·freqCost·range 등)", () => {
    const b = withAutoBoost(base, 2);
    expect(b.auto.damage).toBe(5);
    expect(b.manual.damage).toBe(13);
    expect(b.range).toBe(400);
  });
  it("원본 스펙을 변형하지 않음(캐시 보호)", () => {
    withAutoBoost(base, 2);
    expect(base.auto.range).toBe(50);
    expect(base.manual.assistConeDeg).toBe(28);
  });
});

// 실제 무기 JSON 의 거리 감쇠 — 3km 에서 1/3 + 워커=완만/플라이어=급감 정체성(refDist=1000 공통).
describe("에너지빔 JSON — 3km 1/3 감쇠 + 워커/플라이어 정체성", () => {
  const loadW = (id: string) => JSON.parse(readFileSync(`public/weapons/${id}.json`, "utf8"));
  const heavy = loadW("frequency-beam-heavy"); // 워커(중주파)
  const light = loadW("frequency-beam-light"); // 플라이어(경주파)

  it("중주파(워커): 3km 에서 기본의 1/3, 빔 사거리 2km·자동발사 1km", () => {
    expect(heavy.falloff.refDist).toBe(1000);
    expect(damageForDistance(3000, 150, heavy.falloff)).toBeCloseTo(50, 5); // 150/3
    expect(heavy.range).toBe(2000);
    expect(heavy.auto.range).toBe(1000);
  });

  it("경주파(플라이어): 3km 에서 기본의 1/3, 빔 사거리 2km·자동발사 1km", () => {
    expect(light.falloff.refDist).toBe(1000);
    const effBase = 39 * 2; // 듀얼 발사관(muzzleOffsets 길이 2)
    expect(light.muzzleOffsets).toHaveLength(2);
    expect(damageForDistance(3000, effBase, light.falloff)).toBeCloseTo(26, 5); // 78/3
    expect(light.range).toBe(2000);
    expect(light.auto.range).toBe(1000);
  });

  it("워커=완만(낮은 근접 스파이크·높은 원거리 바닥) / 플라이어=급감(높은 스파이크·낮은 바닥)", () => {
    expect(heavy.falloff.maxMult).toBeLessThan(light.falloff.maxMult);   // 1.5 < 4.0(근접)
    expect(heavy.falloff.minMult).toBeGreaterThan(light.falloff.minMult); // 0.3 > 0.1(원거리 바닥)
  });

  it("근접 상한 클램프: 워커 1.5×·플라이어 4.0×", () => {
    expect(damageForDistance(100, 100, heavy.falloff)).toBeCloseTo(150, 5); // 1.5x cap
    expect(damageForDistance(100, 100, light.falloff)).toBeCloseTo(400, 5); // 4.0x cap
  });

  it("1km 기준 거리에서는 두 빔 모두 배수 1.0(refDist=1000)", () => {
    expect(damageForDistance(1000, 100, heavy.falloff)).toBeCloseTo(100, 5);
    expect(damageForDistance(1000, 100, light.falloff)).toBeCloseTo(100, 5);
  });
});

// 오토 사격 바닥(2026-08-25 회귀) — 오토파이어는 발사 입력과 무관하게 사거리 내 적이 있으면 상시
// 소모한다. 바닥이 없으면 회복이 소모를 못 이기는 구간(옅은 장 = freqRegenMul 0.5)에서 게이지가
// 0 에 고착돼 "줄어든 채 다시 차오르지 않는" 증상이 된다. 바닥 아래선 오토가 쉬어 회복이 항상 이긴다.
describe("autoFireAllowed — 오토 사격 바닥", () => {
  it("바닥 이상이면 허용, 미만이면 차단(경계는 포함)", () => {
    expect(autoFireAllowed(30, 120, 0.25)).toBe(true); // 정확히 바닥 = 허용
    expect(autoFireAllowed(29.9, 120, 0.25)).toBe(false);
    expect(autoFireAllowed(120, 120, 0.25)).toBe(true);
    expect(autoFireAllowed(0, 120, 0.25)).toBe(false);
  });

  it("floor 미지정 시 기본값 적용", () => {
    expect(autoFireAllowed(120 * DEFAULT_AUTO_FREQ_FLOOR, 120)).toBe(true);
    expect(autoFireAllowed(120 * DEFAULT_AUTO_FREQ_FLOOR - 0.01, 120)).toBe(false);
  });

  it("기본 바닥은 특수 발동 하한(freq 5)보다 넉넉 — 바닥에서도 특수는 쓸 수 있다", () => {
    for (const maxFreq of [90, 120]) expect(maxFreq * DEFAULT_AUTO_FREQ_FLOOR).toBeGreaterThan(5);
  });

  it("바닥 0 이면 항상 허용(게이트 해제 — 구 동작 재현 경로)", () => {
    expect(autoFireAllowed(0, 120, 0)).toBe(true);
  });

  it("옅은 장 수지 회귀 — 바닥이 있으면 게이지가 0 에 고착되지 않는다", () => {
    // 워커+중빔: maxFreq 120, 회복 28/s × 0.5, 오토 4 freq / 0.2s. 60fps 로 60 초.
    const step = (floor: number | null) => {
      let freq = 120, autoCd = 0, lo = Infinity;
      const dt = 1 / 60;
      for (let t = 0; t < 60; t += dt) {
        freq = Math.min(120, freq + 28 * 0.5 * dt);
        autoCd -= dt;
        if (autoCd <= 0 && (floor === null || autoFireAllowed(freq, 120, floor))) {
          if (freq >= 4) freq -= 4;
          autoCd = 0.2;
        }
        if (t > 5) lo = Math.min(lo, freq);
      }
      return lo / 120;
    };
    expect(step(null)).toBeLessThan(0.01); // 게이트 없으면 0 고착(수정 전 동작)
    expect(step(DEFAULT_AUTO_FREQ_FLOOR)).toBeGreaterThan(0.2); // 바닥 근처에서 유지
  });
});

describe("BeamSpec JSON — 오토 바닥이 데이터로 명시돼 있다", () => {
  for (const id of ["frequency-beam-light", "frequency-beam-heavy"]) {
    it(`${id}.auto.freqFloor 가 (0,1) 범위`, () => {
      const spec = JSON.parse(readFileSync(`public/weapons/${id}.json`, "utf8")) as BeamSpec;
      expect(spec.auto.freqFloor).toBeGreaterThan(0);
      expect(spec.auto.freqFloor).toBeLessThan(1);
    });
  }
});
