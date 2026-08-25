import { describe, it, expect } from "vitest";
import {
  totalXpForLevel, levelFromXp, xpForKill, droneGrowth, regenStep, LEVEL_CAP, CLEAR_XP, REGEN_DELAY,
} from "../src/player/progression";
import { scaleWeaponDamage, type BeamSpec, type StreamSpec, type BarrageSpec } from "../src/weapons/WeaponSpec";

// 진행 시스템 MVP(TODO §7.4) — 킬 XP → 레벨 → HP/공격/재생. 표의 수치가 곧 계약.

describe("레벨 곡선 — totalXpForLevel/levelFromXp", () => {
  // 정본은 공식 round(100·(L-1)^1.6) — §7.4 표는 이 실제값으로 교정됨(L5=919, L20=11117).
  it("정본 공식 수치와 일치(L1=0, L2=100, L5=919, L10=3363, L15=6820, L20=11117)", () => {
    expect(totalXpForLevel(1)).toBe(0);
    expect(totalXpForLevel(2)).toBe(100);
    expect(totalXpForLevel(5)).toBe(919);
    expect(totalXpForLevel(10)).toBe(3363);
    expect(totalXpForLevel(15)).toBe(6820);
    expect(totalXpForLevel(20)).toBe(11117);
  });

  it("levelFromXp — 경계 정확·상한 L20", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(11116)).toBe(19);
    expect(levelFromXp(11117)).toBe(LEVEL_CAP);
    expect(levelFromXp(999999)).toBe(LEVEL_CAP);
  });
});

describe("XP 소스·성장치", () => {
  it("xpForKill — 강함 비례 10~50(범위 밖 클램프)", () => {
    expect(xpForKill(0)).toBe(10);
    expect(xpForKill(0.5)).toBe(30);
    expect(xpForKill(1)).toBe(50);
    expect(xpForKill(2)).toBe(50);
    expect(CLEAR_XP).toBe(200);
  });

  // hpRegen 은 **전 드론·전 레벨 0** — 회복 수단 전면 폐지(2026-08-25). 성장은 최대 HP 를 늘릴 뿐
  // 잃은 것을 되돌리지 않는다. 이 값이 0 이 아니게 되면 "숨어서 회복"이 최적해로 돌아온다.
  it("droneGrowth — L20 정본치(워커 234HP/×1.38 · 플라이어 +57HP/×1.57) · 재생은 전부 0", () => {
    const w = droneGrowth("walker", 20);
    expect(w).toEqual({ hpBonus: 114, dmgMult: 1.38, hpRegen: 0 }); // 120+114=234
    const f = droneGrowth("flyer", 20);
    expect(f.hpBonus).toBe(57); // 60+57=117
    expect(f.dmgMult).toBeCloseTo(1.57);
    expect(f.hpRegen).toBe(0);
    expect(droneGrowth("walker", 1)).toEqual({ hpBonus: 0, dmgMult: 1, hpRegen: 0 }); // L1 무보정
    expect(droneGrowth("unknown", 20)).toEqual({ hpBonus: 0, dmgMult: 1, hpRegen: 0 }); // 미지 드론 안전
  });
});

describe("HP 재생 — regenStep(피격 후 정지)", () => {
  it("딜레이 전엔 불변, 이후 초당 재생·최대치 캡·사망 불변", () => {
    expect(regenStep(50, 100, 2, REGEN_DELAY - 0.1, 1)).toBe(50); // 아직 교전 여파
    expect(regenStep(50, 100, 2, REGEN_DELAY, 1)).toBe(52);
    expect(regenStep(99.5, 100, 2, 10, 1)).toBe(100); //             캡
    expect(regenStep(0, 100, 2, 10, 1)).toBe(0); //                  사망
    expect(regenStep(50, 100, 0, 10, 1)).toBe(50); //                재생 0(L1)
  });
});

describe("scaleWeaponDamage — 무기 타입별 정확 스케일(원본 불변)", () => {
  it("beam — manual/auto 데미지만 배수", () => {
    const beam = {
      type: "beam", manual: { damage: 150, freqCost: 14, fireInterval: 0.15, assistConeDeg: 13 },
      auto: { damage: 45, freqCost: 5, fireInterval: 0.5, range: 3000 },
    } as BeamSpec;
    const s = scaleWeaponDamage(beam, 1.38);
    expect(s.manual.damage).toBeCloseTo(207);
    expect(s.auto.damage).toBeCloseTo(62.1);
    expect(beam.manual.damage).toBe(150); // 원본 캐시 불변
    expect(scaleWeaponDamage(beam, 1)).toBe(beam); // 무보정은 동일 참조(복제 생략)
  });

  it("stream/barrage — 각자의 데미지 필드만 배수", () => {
    const st = { type: "stream", damage: 100 } as StreamSpec;
    expect(scaleWeaponDamage(st, 1.5).damage).toBe(150);
    const br = { type: "barrage", salvoDamage: 40 } as BarrageSpec;
    expect(scaleWeaponDamage(br, 1.5).salvoDamage).toBe(60);
  });
});
