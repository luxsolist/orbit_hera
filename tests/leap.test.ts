import { describe, it, expect } from "vitest";
import {
  sampleLeapOffset, leapInterrupted, canBeginLeap, inLeapRange, leapChanceWith, leapCooldownWith,
  type PlasmoidLeapSpec,
} from "../src/enemies/leap";
import { DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";

// 차원도약(§6.7) 순수 가드. 표본 추출은 난수 주입이라 결정적으로 검증한다.
const SKEETER = DEFAULT_PLASMOID.archetypes.kiter.leap!;
const LEECH = DEFAULT_PLASMOID.archetypes.rusher.leap!;

/** 선형 합동 난수 — 시드 고정 재현(테스트 전용). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe("sampleLeapOffset — 착지 오프셋 표본", () => {
  it("수평거리가 항상 [minDist, maxDist] 안", () => {
    const r = lcg(7);
    for (let i = 0; i < 5000; i++) {
      const o = sampleLeapOffset(SKEETER, r);
      const d = Math.hypot(o.dx, o.dz);
      expect(d).toBeGreaterThanOrEqual(SKEETER.minDist - 1e-6);
      expect(d).toBeLessThanOrEqual(SKEETER.maxDist + 1e-6);
    }
  });

  it("수직 오프셋이 항상 [dyMin, dyMax] 안", () => {
    const r = lcg(11);
    for (const spec of [SKEETER, LEECH]) {
      for (let i = 0; i < 2000; i++) {
        const o = sampleLeapOffset(spec, r);
        expect(o.dy).toBeGreaterThanOrEqual(spec.dyMin);
        expect(o.dy).toBeLessThanOrEqual(spec.dyMax);
      }
    }
  });

  it("스키터는 항상 플레이어보다 위 — 모기는 내려다본다", () => {
    const r = lcg(3);
    for (let i = 0; i < 1000; i++) expect(sampleLeapOffset(SKEETER, r).dy).toBeGreaterThan(0);
  });

  it("리치는 플레이어 고도 근처(±10m) — 비행 중에도 같은 거리에 붙는다", () => {
    const r = lcg(17);
    for (let i = 0; i < 1000; i++) expect(Math.abs(sampleLeapOffset(LEECH, r).dy)).toBeLessThanOrEqual(10);
  });

  it("수직 밴드가 수평 거리와 독립 — 구면 균등이면 절반이 플레이어 아래로 간다", () => {
    // 구면 균등의 y 는 [−r,+r] 균등(아르키메데스)이라 표본의 절반이 아래이고, 스키터라면
    // 최대 450m 아래에 떨어진다(공격 사거리 95m 밖). 밴드를 따로 뽑으면 그 결합이 끊긴다.
    const r = lcg(23);
    let worse = 0;
    for (let i = 0; i < 3000; i++) {
      const o = sampleLeapOffset(SKEETER, r);
      if (o.dy < -Math.hypot(o.dx, o.dz)) worse++; // 구면이었다면 흔했을 조합
    }
    expect(worse).toBe(0);
  });

  it("면적 균등 — 도넛을 반으로 가르는 반지름 기준 안/밖이 대략 반반", () => {
    // 면적 균등이면 √((min²+max²)/2) 를 경계로 안쪽·바깥쪽 넓이가 같다. 반지름 균등이면 안쪽에 몰린다.
    const mid = Math.sqrt((SKEETER.minDist ** 2 + SKEETER.maxDist ** 2) / 2);
    const r = lcg(101);
    let inner = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const o = sampleLeapOffset(SKEETER, r);
      if (Math.hypot(o.dx, o.dz) < mid) inner++;
    }
    expect(inner / N).toBeGreaterThan(0.47);
    expect(inner / N).toBeLessThan(0.53);
  });

  it("방위각이 네 사분면에 고르게 흩어진다", () => {
    const r = lcg(55);
    const quad = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) {
      const o = sampleLeapOffset(SKEETER, r);
      quad[(o.dx >= 0 ? 0 : 2) + (o.dz >= 0 ? 0 : 1)]++;
    }
    for (const q of quad) expect(q / 8000).toBeGreaterThan(0.2);
  });

  it("minDist=maxDist 면 정확히 그 반지름(퇴화 케이스에서 NaN 없음)", () => {
    const fixed: PlasmoidLeapSpec = { ...LEECH, minDist: 20, maxDist: 20 };
    const o = sampleLeapOffset(fixed, lcg(9));
    expect(Math.hypot(o.dx, o.dz)).toBeCloseTo(20, 6);
  });
});

// 취소는 "피해"가 아니라 상태다. 오토파이어가 3초에 15~23발을 입력 없이 넣으므로 "맞으면 취소"면
// 플레이어 개입 없이 100% 취소돼 메커닉이 죽는다 — 역행체 시전과 같은 인터럽트 목록을 쓴다.
describe("leapInterrupted — 텔레그래프 취소 조건", () => {
  it("동결·경직·계류·위상 중 하나라도 참이면 취소", () => {
    expect(leapInterrupted(true, false, false, false)).toBe(true); // W1 동결
    expect(leapInterrupted(false, true, false, false)).toBe(true); // 동료 처치 경직
    expect(leapInterrupted(false, false, true, false)).toBe(true); // W2 계류(수동 명중)
    expect(leapInterrupted(false, false, false, true)).toBe(true); // 위상 이탈
  });

  it("아무 상태도 아니면 취소되지 않는다 — 단순 피격만으로는 안 끊긴다", () => {
    expect(leapInterrupted(false, false, false, false)).toBe(false);
  });
});

describe("canBeginLeap — 개시 게이트", () => {
  it("쿨다운이 남으면 불가", () => {
    expect(canBeginLeap(0.1, false, 0, 2)).toBe(false);
    expect(canBeginLeap(0, false, 0, 2)).toBe(true);
  });

  it("인터럽트 상태면 불가", () => {
    expect(canBeginLeap(0, true, 0, 2)).toBe(false);
  });

  it("동시 상한에 도달하면 불가 — 포위 폭주 방지", () => {
    expect(canBeginLeap(0, false, 1, 2)).toBe(true);
    expect(canBeginLeap(0, false, 2, 2)).toBe(false);
    expect(canBeginLeap(0, false, 3, 2)).toBe(false);
  });
});

describe("난이도 배수", () => {
  it("확률은 [0,1] 로 클램프", () => {
    expect(leapChanceWith(SKEETER, 2)).toBe(1); // 0.6 × 2 = 1.2 → 1
    expect(leapChanceWith(SKEETER, 0)).toBe(0);
    expect(leapChanceWith(SKEETER, 1)).toBeCloseTo(SKEETER.chance, 9);
  });

  it("쿨다운 하한 1초 — 배수가 0 이어도 매 프레임 도약이 되지 않는다", () => {
    expect(leapCooldownWith(SKEETER, 0)).toBe(1);
    expect(leapCooldownWith(SKEETER, 1)).toBe(SKEETER.cd);
    expect(leapCooldownWith(SKEETER, 2)).toBe(SKEETER.cd * 2);
  });
});

// 검토에서 확정한 수치 계약 — 어그로 해제 반경 900m 와 복귀 시간이 근거다.
describe("스펙 값 계약", () => {
  it("스키터 도약 상한이 어그로 해제 반경(900m)보다 충분히 작다", () => {
    expect(SKEETER.maxDist).toBeLessThanOrEqual(450);
    // 복귀 시간 = (거리 − attackRange) / speed. 4초 이내여야 무행동 구간이 짧다.
    const k = DEFAULT_PLASMOID.archetypes.kiter;
    expect((SKEETER.maxDist - k.attackRange) / k.speed).toBeLessThan(4.5);
  });

  it("리치 도약은 링이라 착지 즉시 접촉이 아니다 — 최악에도 0.75초 회피 창", () => {
    expect(LEECH.minDist).toBeGreaterThanOrEqual(12);
    const r = DEFAULT_PLASMOID.archetypes.rusher;
    // 첫 접촉까지의 실제 여유 = max(이동시간, 착지 경직). 둘 중 늦게 끝나는 쪽이 병목이다.
    // 최단 12m 에서는 이동 0.71초 < 경직 0.8초라 **경직이** 창을 만들고, 25m 에서는 이동이 만든다.
    const window = (d: number) => Math.max(d / r.speed, LEECH.recoverSec);
    expect(window(LEECH.minDist)).toBeGreaterThanOrEqual(0.75);
    expect(window(LEECH.maxDist)).toBeGreaterThan(1.4);
  });

  it("워커가 리치보다 빠르다 — 착지 후에도 회피가 성립한다", () => {
    // 회피 "강제"이지 회피 "불가"가 아니어야 한다. 워커 19.44 > 리치 17.
    expect(DEFAULT_PLASMOID.archetypes.rusher.speed).toBeLessThan(19.44);
  });

  it("lockSec 이 회피 창의 길이 — 텔레그래프보다 짧아야 예고가 성립한다", () => {
    for (const spec of [SKEETER, LEECH]) {
      expect(spec.lockSec).toBeGreaterThan(0); // 0 이면 예고 없이 정확히 덮친다
      expect(spec.lockSec).toBeLessThan(spec.telegraphSec); // 같거나 크면 개시 즉시 확정 = 추적 없음
    }
  });

  it("도약 주기가 텔레그래프보다 충분히 길다 — 시전이 끊이지 않는 상태가 되지 않게", () => {
    for (const spec of [SKEETER, LEECH]) {
      expect(spec.cd / spec.chance).toBeGreaterThan(spec.telegraphSec);
    }
  });

  it("동시 도약 상한이 유한 — 12기 포위가 나오지 않는다", () => {
    expect(LEECH.concurrentCap).toBeLessThan(DEFAULT_PLASMOID.archetypes.rusher.countCap);
    expect(SKEETER.concurrentCap).toBeGreaterThan(0);
  });
});

// 발동 거리 창 — 도약이 **상황을 실제로 바꿀 때만** 일어나게 하는 게이트.
// 없으면 정반대 동작이 나온다(2026-08-25 실측): 리치가 접촉 거리(평균 3m)에서 도약해 12~25m 링으로
// 물러났다 — 접근이 아니라 후퇴였고, 그래서 "아무 일도 일어나지 않는" 느낌이 났다.
describe("inLeapRange — 발동 거리 창", () => {
  it("리치는 벌어졌을 때만 — 붙어 있으면 도약하지 않는다(후퇴 방지)", () => {
    expect(LEECH.triggerMin).toBeGreaterThan(LEECH.maxDist); // 착지 링보다 멀어야 접근이 성립
    expect(inLeapRange(LEECH, 3)).toBe(false); //  접촉 거리 — 도약할 이유가 없다
    expect(inLeapRange(LEECH, 25)).toBe(false); // 링 안쪽 — 도약해도 제자리
    expect(inLeapRange(LEECH, LEECH.triggerMin)).toBe(true);
    expect(inLeapRange(LEECH, 300)).toBe(true); // 상한 없음(triggerMax 0)
  });

  it("스키터는 가까울 때만 — 이미 멀면 더 멀어질 이유가 없다", () => {
    expect(inLeapRange(SKEETER, 35)).toBe(true); // keepDist 부근 = 붙들린 상태
    expect(inLeapRange(SKEETER, SKEETER.triggerMax)).toBe(true);
    expect(inLeapRange(SKEETER, SKEETER.triggerMax + 1)).toBe(false);
    expect(inLeapRange(SKEETER, 0)).toBe(true); // 하한 없음(triggerMin 0)
  });

  it("스키터 도약 거리는 시야 안 — 완전히 사라지면 도약이 아니라 소멸로 읽힌다", () => {
    expect(SKEETER.maxDist).toBeLessThanOrEqual(250);
    expect(SKEETER.minDist).toBeGreaterThan(SKEETER.triggerMax * 0.5); // 발동 거리보다 확실히 멀리
  });

  it("경계값 0 은 '제한 없음'", () => {
    const free = { ...LEECH, triggerMin: 0, triggerMax: 0 };
    for (const d of [0, 50, 5000]) expect(inLeapRange(free, d)).toBe(true);
  });
});
