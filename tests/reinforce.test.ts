import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { pyramidHp, DEFAULT_PLASMOID } from "../src/enemies/PlasmoidSpec";

// 위상 이탈(§2.1)은 확률 거동이라 투입/개체수 검증을 흔든다 — 본 스위트는 비활성 스펙 사용.
const NO_PHASE = { ...DEFAULT_PLASMOID, phase: undefined };
import { EnemyManager, formationPos } from "../src/enemies/EnemyManager";

// 미션 점진 투입 — 피라미드 체력 배분(잡몹→중견→정예→보스 순 증원 큐) + 균열 증원(동시 상한).
// "일괄 100기" 모델 폐기의 근거였던 도시 붕괴 속도·압력 곡선 문제를 시스템으로 고정한다.

describe("pyramidHp — 강도 피라미드 배분(순수)", () => {
  const rnd = () => 0.5; // 지터 중립(가중치 그대로)

  it("합계 = total, 마지막 = 보스(bossHp)", () => {
    const hps = pyramidHp(70000, 10000, 45, rnd);
    expect(hps.length).toBe(45);
    expect(hps.reduce((a, b) => a + b, 0)).toBe(70000);
    expect(hps[hps.length - 1]).toBe(10000);
  });

  it("강도 오름차순 압력 곡선 — 앞(잡몹) 평균 < 중간(중견) 평균 < 뒤(정예) 평균", () => {
    const hps = pyramidHp(70000, 10000, 45, rnd);
    const rest = hps.slice(0, -1); // 보스 제외 44
    const grunt = rest.slice(0, 26); // 60%
    const mid = rest.slice(26, 39); // 30%
    const elite = rest.slice(39); // 10%
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(grunt)).toBeLessThan(avg(mid));
    expect(avg(mid)).toBeLessThan(avg(elite));
    expect(avg(elite)).toBeGreaterThan(avg(grunt) * 8); // 티어 가중 1↔13 반영(지터 중립 기준)
  });

  it("경계 — count 0/1, 보스 없음(bossHp 0)", () => {
    expect(pyramidHp(5000, 1000, 0, rnd)).toEqual([]);
    expect(pyramidHp(5000, 1000, 1, rnd)).toEqual([5000]);
    const noBoss = pyramidHp(30000, 0, 10, rnd);
    expect(noBoss.length).toBe(10);
    expect(noBoss.reduce((a, b) => a + b, 0)).toBe(30000);
  });

  it("소수 count 에서도 합·개수 정확(티어 잔여 흡수)", () => {
    const hps = pyramidHp(9000, 3000, 4, () => 0.9);
    expect(hps.length).toBe(4);
    expect(hps.reduce((a, b) => a + b, 0)).toBe(9000);
    expect(hps[3]).toBe(3000); // 보스 마지막
  });
});

describe("EnemyManager — 균열 증원(동시 상한) 통합", () => {
  const makeManager = () => {
    const scene = new THREE.Scene();
    const world = {
      heightAt: () => 0, bounds: 5000, topAt: () => -Infinity,
      resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
    } as any;
    const player = {
      worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as any;
    return new EnemyManager(scene, world, [player], NO_PHASE);
  };
  const tick = (em: EnemyManager, frames: number) => { for (let i = 0; i < frames; i++) em.update(1 / 60); };
  // 실제 무기 경로와 동일 — applyFrequencyHit 가 true(처치 크레딧)일 때만 registerKill(공유 풀은 1회만)
  const killAllAlive = (em: EnemyManager) => {
    for (const e of em.aliveEnemies) {
      if (e.applyFrequencyHit(1e9)) em.registerKill(e);
    }
  };

  it("초기 투입 = 상한×0.6(올림), 증원은 상한까지만 차오른다", () => {
    const em = makeManager();
    em.startBurst(20, 500, 20000, 5000, { concurrentCap: 8, reinforceInterval: 0.2 });
    expect(em.aliveMarkers.length).toBe(5); // ceil(8×0.6)
    tick(em, 600); // 10s — 증원 간격 0.2s 면 충분히 채움
    expect(em.aliveMarkers.length).toBe(8); // 상한 도달, 초과 없음
    tick(em, 300);
    expect(em.aliveMarkers.length).toBe(8);
  });

  it("처치가 곧 증원 유입 — 총 투입 수가 결국 count 에 도달하고 보스(최대 HP)는 마지막", () => {
    const em = makeManager();
    em.startBurst(12, 500, 20000, 6000, { concurrentCap: 4, reinforceInterval: 0.1 });
    let spawnedMaxHp = 0;
    let bossSeenAtKill = -1;
    for (let round = 0; round < 40 && em.killCount < 12; round++) {
      tick(em, 60); // 1s — 증원 유입
      for (const e of em.aliveEnemies) {
        if (e.maxHp > spawnedMaxHp) { spawnedMaxHp = e.maxHp; bossSeenAtKill = em.killCount; }
      }
      killAllAlive(em);
      tick(em, 90); // 디졸브 정리
    }
    expect(em.killCount).toBe(12); // 전량 투입·격멸 완료
    expect(spawnedMaxHp).toBe(6000); // 보스 등장
    expect(bossSeenAtKill).toBeGreaterThanOrEqual(6); // 보스는 큐 후반(잡몹·중견 소진 후)
  });

  it("concurrentCap 없으면 레거시 일괄(전량 즉시 — 보스는 다중 투영 3기로 +2)", () => {
    const em = makeManager();
    em.startBurst(20, 500, 20000, 5000);
    expect(em.aliveMarkers.length).toBe(22); // 19 + 보스 투영 3
  });

  it("점진 투입의 균열 앵커는 전장 중심에서 이격된다(위협 방향)", () => {
    const em = makeManager();
    em.startBurst(20, 1000, 20000, 5000, { concurrentCap: 8, reinforceInterval: 0.2 });
    const a = (em as any).riftAnchor;
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(500, 0); // burstLim 1000 × RIFT_OFFSET_FRAC 0.5
  });
});

describe("deploy 모델(훅 ①) — roster/horde 투입기", () => {
  const makeManager = () => {
    const scene = new THREE.Scene();
    const world = {
      heightAt: () => 0, bounds: 5000, topAt: () => -Infinity,
      resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
    } as any;
    const player = {
      worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as any;
    return new EnemyManager(scene, world, [player], NO_PHASE);
  };
  const tick = (em: EnemyManager, frames: number) => { for (let i = 0; i < frames; i++) em.update(1 / 60); };

  it("roster — 전량 즉시·증원 없음·유닛별 역할/체력 정확(elite=고체력 러셔)", () => {
    const em = makeManager();
    em.startRoster([
      { role: "marker", count: 4, hp: 1500 },
      { role: "elite", count: 6, hp: 3500 },
      { role: "kiter", count: 8, hp: 900 },
    ], 1000);
    const alive = em.aliveEnemies;
    expect(alive.length).toBe(18);
    expect(alive.filter((e) => e.role === "marker" && e.maxHp === 1500).length).toBe(4);
    expect(alive.filter((e) => e.role === "rusher" && e.maxHp === 3500).length).toBe(6); // elite → 러셔 행동
    expect(alive.filter((e) => e.role === "kiter" && e.maxHp === 900).length).toBe(8);
    tick(em, 300); // 증원 없음 — 수 불변(웨이브 자동 재시작도 없음)
    expect(em.aliveEnemies.length).toBe(18);
  });

  it("horde — 균일 체력, 동시 상한까지만, 큐 소진까지 증원", () => {
    const em = makeManager();
    em.startHorde(30, 350, 1000, { concurrentCap: 10, reinforceInterval: 0.1 });
    expect(em.aliveMarkers.length).toBe(6); // 초기 = ceil(10×0.6)
    tick(em, 600);
    expect(em.aliveMarkers.length).toBe(10); // 상한 유지
    expect(em.aliveEnemies.every((e) => e.maxHp === 350)).toBe(true); // 균일(성장 전) — 보스 없음
    expect(em.aliveEnemies.every((e) => !e.sharedPool)).toBe(true);
  });
});

describe("엣지 가드 — 낙인탄 시야·분출 상한·랜드마크 폴백·소유 파문·MP 스케일", () => {
  const makeWorld = (seg: number, bc?: any) => ({
    heightAt: () => 0, bounds: 5000, topAt: () => -Infinity,
    resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => seg,
    buildings: bc,
  }) as any;
  const makePlayer = (mode: "walk" | "fly" = "walk") => ({
    worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
    spec: { move: { mode } }, takeDamage: () => false, heal: () => {},
  }) as any;
  const tick = (em: EnemyManager, frames: number) => { for (let i = 0; i < frames; i++) em.update(1 / 60); };

  it("마커 낙인탄은 건물에 시야가 막히면 발사하지 않는다(LOS 게이트)", () => {
    const blocked = new EnemyManager(new THREE.Scene(), makeWorld(0.5), [makePlayer()], NO_PHASE);
    blocked.startRoster([{ role: "marker", count: 2, hp: 1000 }], 100);
    tick(blocked, 60 * 12); // 12s — 발사 간격(7s)을 넘겨도
    expect(blocked.brandCount(0)).toBe(0); // 차폐 — 낙인 없음

    const clear = new EnemyManager(new THREE.Scene(), makeWorld(Infinity), [makePlayer()], NO_PHASE);
    clear.startRoster([{ role: "marker", count: 2, hp: 1000 }], 100);
    tick(clear, 60 * 12); // 유도탄 비행(22m/s·≤220m) 포함
    expect(clear.brandCount(0)).toBeGreaterThan(0); // 시야 확보 — 낙인 부착
  });

  it("잡몹 분출은 전장 생존 상한(40)에서 멈춘다(무한 팽창 방지)", () => {
    const em = new EnemyManager(new THREE.Scene(), makeWorld(Infinity), [makePlayer()], NO_PHASE);
    em.startBossDeploy({ bossHp: 1e9, projections: 1, emit: { role: "rusher", hp: 100, count: 5, interval: 0.05 } }, 300);
    tick(em, 60 * 10); // 10s — 상한 없으면 ~1000기
    const alive = em.aliveEnemies.length;
    expect(alive).toBeLessThanOrEqual(45); // 게이트 통과 후 배치(count 5)까지 허용
    tick(em, 60 * 3);
    expect(em.aliveEnemies.length).toBeLessThanOrEqual(45); // 정체 유지
  });

  it("aggro=landmark 인데 로드된 랜드마크가 없으면 일반 건물로 폴백", () => {
    const bc = {
      update: () => {},
      nearestTarget: () => ({ id: "b1", x: 300, y: 5, z: 0 }),
      nearestLandmark: () => null, // 미로드
      targetPos: (_id: string, out: THREE.Vector3) => { out.set(300, 5, 0); return true; },
      damage: () => "none",
    };
    const em = new EnemyManager(new THREE.Scene(), makeWorld(Infinity, bc), [makePlayer()], NO_PHASE);
    em.startRoster([{ role: "rusher", count: 1, hp: 1000 }], 100);
    em.setAggro("landmark");
    tick(em, 30);
    expect(em.aliveEnemies[0].buildingId).toBe("b1"); // 폴백
  });

  it("소유 파문(ownSweep) — 파문 앵커가 살아있는 보스 위치, 소산 후 균열로 폴백", () => {
    const em = new EnemyManager(new THREE.Scene(), makeWorld(Infinity), [makePlayer()], NO_PHASE);
    em.startBossDeploy({ bossHp: 5000, projections: 1, ownSweep: true }, 300);
    const boss = em.aliveEnemies.find((e) => e.sharedPool)!;
    const a1 = (em as any).sweepAnchor();
    expect(a1.x).toBeCloseTo(boss.group.position.x, 6);
    expect(a1.z).toBeCloseTo(boss.group.position.z, 6);
    if (boss.applyFrequencyHit(1e9)) em.registerKill(boss);
    tick(em, 60); // 소산 정리
    const a2 = (em as any).sweepAnchor();
    expect(a2).toBe((em as any).riftAnchor); // 균열 폴백
  });

  it("MP 스케일(2인) — horde 물량·상한 ×2, roster 비보스 ×2·보스 그룹은 팀 공유 1", () => {
    const players = [makePlayer("walk"), makePlayer("fly")];
    const h = new EnemyManager(new THREE.Scene(), makeWorld(Infinity), players, NO_PHASE);
    h.startHorde(10, 200, 500, { concurrentCap: 4, reinforceInterval: 0.1 });
    expect(h.aliveMarkers.length).toBe(5); // 초기 = ceil(4×2×0.6)
    tick(h, 60 * 5);
    expect(h.aliveMarkers.length).toBe(8); // 상한 4×2

    const r = new EnemyManager(new THREE.Scene(), makeWorld(Infinity), players, NO_PHASE);
    r.startRoster([{ role: "rusher", count: 3, hp: 500 }, { role: "boss", count: 1, hp: 3000 }], 500);
    expect(r.aliveEnemies.filter((e) => !e.sharedPool).length).toBe(6); // 3×2
    expect(r.aliveEnemies.filter((e) => e.sharedPool).length).toBe(3); // 투영 3 — 그룹 1 유지
  });
});

describe("어그로 성향(훅 ④) — building/landmark 직행, provoked 만 플레이어 교전", () => {
  const makeBc = () => ({
    update: () => {},
    nearestTarget: () => ({ id: "b1", x: 300, y: 5, z: 0 }),
    nearestLandmark: () => ({ id: "lm1", x: 600, y: 8, z: 0 }),
    targetPos: (id: string, out: THREE.Vector3) => { out.set(id === "lm1" ? 600 : 300, 5, 0); return true; },
    damage: () => "none",
  });
  const makeManager = (bc: any) => {
    const scene = new THREE.Scene();
    const world = {
      heightAt: () => 0, bounds: 5000, topAt: () => -Infinity,
      resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
      buildings: bc,
    } as any;
    const player = {
      worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as any;
    return new EnemyManager(scene, world, [player], NO_PHASE);
  };
  const tick = (em: EnemyManager, frames: number) => { for (let i = 0; i < frames; i++) em.update(1 / 60); };

  it("aggro=building: 인식 반경 안 플레이어를 무시하고 건물 직행, 피격(provoked) 시에만 교전", () => {
    const em = makeManager(makeBc());
    em.startRoster([{ role: "rusher", count: 1, hp: 1000 }], 100); // 플레이어 반경 100m 내 스폰
    em.setAggro("building");
    tick(em, 30);
    const e = em.aliveEnemies[0];
    expect(e.targetIndex).toBe(-1); // 플레이어 미교전(인식 0)
    expect(e.buildingId).toBe("b1");
    em.provokeNear(e); // 피격 유발 — 이제 어그로가 끌린다
    tick(em, 5);
    expect(e.targetIndex).toBe(0);
  });

  it("aggro=landmark: 랜드마크 직행(거리 무제한 우선), 기본(player)은 인식 반경 내 플레이어 교전", () => {
    const em = makeManager(makeBc());
    em.startRoster([{ role: "rusher", count: 1, hp: 1000 }], 100);
    em.setAggro("landmark");
    tick(em, 30);
    expect(em.aliveEnemies[0].buildingId).toBe("lm1"); // 600m 랜드마크 > 300m 건물

    const em2 = makeManager(makeBc());
    em2.startRoster([{ role: "rusher", count: 1, hp: 1000 }], 100); // 기본 aggro=player
    tick(em2, 30);
    expect(em2.aliveEnemies[0].targetIndex).toBe(0); // 인식 반경(500) 안 → 플레이어 교전
  });

  // 체감 분화 보정(2026-08-23) — 유발이 영구 래치였을 때 어그로 변조가 도입부에만 살아있다 사라졌다.
  // 주무기가 360° 자동사격이고 유발이 100m 로 전파돼 첫 교전 뒤 전장 전체가 플레이어만 쫓았고,
  // 그래서 사수/생존/격멸이 전부 "사냥" 하나로 느껴졌다. 감쇠가 그 수렴을 끊는지 여기서 고정한다.
  it("유발 감쇠: 피격 시 플레이어 추격 → 지속시간 후 랜드마크로 복귀(어그로 변조가 되살아난다)", () => {
    const em = makeManager(makeBc());
    em.startRoster([{ role: "rusher", count: 1, hp: 100000 }], 100); // 죽지 않게 고체력
    em.setAggro("landmark");
    tick(em, 30);
    const e = em.aliveEnemies[0];
    expect(e.buildingId).toBe("lm1"); // 본래 임무 = 랜드마크 직행

    em.provokeNear(e);
    tick(em, 5);
    expect(e.targetIndex).toBe(0);    // 때리면 나를 쫓는다
    expect(e.provoked).toBe(true);

    tick(em, 60 * 11);                 // 11초 — 유발 지속(10s) 경과
    expect(e.provoked).toBe(false);
    expect(e.targetIndex).toBe(-1);   // 플레이어 어그로 해제
    expect(e.buildingId).toBe("lm1"); // **랜드마크로 복귀** — 이게 사수 미션의 성립 조건
  });

  it("계속 피격당하는 적은 감쇠하지 않는다(교전 중 어그로가 풀리면 그게 더 이상하다)", () => {
    const em = makeManager(makeBc());
    em.startRoster([{ role: "rusher", count: 1, hp: 100000 }], 100);
    em.setAggro("landmark");
    tick(em, 30);
    const e = em.aliveEnemies[0];
    for (let i = 0; i < 15; i++) { em.provokeNear(e); tick(em, 60); } // 1초마다 재피격 × 15초
    expect(e.provoked).toBe(true);  // 지속시간(10s)을 넘겨도 갱신되어 유지
    expect(e.targetIndex).toBe(0);
  });
});

describe("진형/행동(조합 정립) — formationPos·hold/patrol/escort", () => {
  const rnd = () => 0.5;
  const fieldC = { x: 0, z: 0 };

  it("formationPos — ring: 전장 중심 반경 lim×0.45 위 균등각, line: 중심을 바라보는 가로 전선, cluster: 산개 반경 내", () => {
    const lim = 1000;
    for (let i = 0; i < 6; i++) {
      const p = formationPos("ring", i, 6, fieldC, { x: 999, z: 999 }, lim, rnd);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(450, 6); // unitC 무관 — 중심 포위
    }
    const a = formationPos("ring", 0, 6, fieldC, fieldC, lim, rnd);
    const b = formationPos("ring", 3, 6, fieldC, fieldC, lim, rnd); // 반대편(180°)
    expect(Math.hypot(a.x + b.x, a.z + b.z)).toBeLessThan(1); // 대칭

    // line — unitC(500,0): 축은 중심→unitC 의 수직(z축) → x 고정·z 로 전개, 간격 28m
    const l0 = formationPos("line", 0, 4, fieldC, { x: 500, z: 0 }, lim, rnd);
    const l3 = formationPos("line", 3, 4, fieldC, { x: 500, z: 0 }, lim, rnd);
    expect(l0.x).toBeCloseTo(500, 6);
    expect(l3.x).toBeCloseTo(500, 6);
    expect(Math.abs(l3.z - l0.z)).toBeCloseTo(28 * 3, 6);

    const c = formationPos("cluster", 0, 10, fieldC, { x: 100, z: 100 }, lim, rnd);
    expect(Math.hypot(c.x - 100, c.z - 100)).toBeLessThanOrEqual(70);
  });

  const makeManager = () => {
    const scene = new THREE.Scene();
    const world = {
      heightAt: () => 0, bounds: 5000, topAt: () => -Infinity,
      resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
    } as any;
    const player = {
      worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as any;
    return new EnemyManager(scene, world, [player], NO_PHASE);
  };
  const tick = (em: EnemyManager, frames: number) => { for (let i = 0; i < frames; i++) em.update(1 / 60); };

  it("hold — 인식 반경 안 플레이어를 무시하고 배치 지점을 지키다, 피격(provoked) 시 hunt 전환", () => {
    const em = makeManager();
    em.startRoster([{ role: "rusher", count: 1, hp: 5000, behavior: "hold" }], 400);
    const e = em.aliveEnemies[0];
    const home = e.group.position.clone();
    tick(em, 120); // 2s — 플레이어(원점)는 인식 반경(500) 안이지만
    expect(e.targetIndex).toBe(-1); // 미교전
    expect(e.group.position.distanceTo(home)).toBeLessThan(15); // 지점 고수(분리·부유 미세 이동만)
    em.provokeNear(e); // 피격 — 진형 해제
    tick(em, 30);
    expect(e.targetIndex).toBe(0); // hunt 전환
  });

  it("patrol — 유닛 중심 반경을 순회한다(시간에 따라 위치 변화, 반경 유지)", () => {
    const em = makeManager();
    em.startRoster([{ role: "rusher", count: 1, hp: 5000, formation: "ring", behavior: "patrol" }], 800);
    const e = em.aliveEnemies[0];
    tick(em, 60 * 8); // 순회 안착
    const p1 = e.group.position.clone();
    const st = e.station!;
    tick(em, 60 * 6); // 각속도 0.25rad/s × 6s = 86° 이동
    const p2 = e.group.position.clone();
    expect(p1.distanceTo(p2)).toBeGreaterThan(20); // 움직인다
    const r2d = Math.hypot(p2.x - st.x, p2.z - st.z);
    expect(r2d).toBeGreaterThan(30); // 중심 주위 궤도(반경 60 부근)
    expect(r2d).toBeLessThan(90);
  });

  it("escort — 앵커 개체를 추종하고, 앵커 유닛 전멸 시 hunt 폴백", () => {
    const em = makeManager();
    em.startRoster([
      { role: "elite", count: 2, hp: 3000, behavior: "hold" },
      { role: "kiter", count: 2, hp: 500, behavior: "escort", anchor: 0 },
    ], 900);
    const anchors = em.aliveEnemies.filter((e) => e.deployRole === "elite");
    const guards = em.aliveEnemies.filter((e) => e.deployRole === "kiter");
    tick(em, 60 * 4);
    for (const g of guards) {
      const nearest = Math.min(...anchors.map((a) => g.group.position.distanceTo(a.group.position)));
      expect(nearest).toBeLessThan(120); // 앵커 곁 유지(keepDist 35 + 분리 여유)
    }
    // 앵커 전멸 → hunt 폴백
    for (const a of anchors) { if (a.applyFrequencyHit(1e9)) em.registerKill(a); }
    tick(em, 90);
    for (const g of guards) expect(g.behavior).toBe("hunt");
  });

  it("진형 중에도 기회 공격 — hold 마커가 사거리 내 플레이어에게 낙인탄을 쏜다", () => {
    const em = makeManager();
    em.startRoster([{ role: "marker", count: 2, hp: 1000, behavior: "hold" }], 150);
    tick(em, 60 * 12); // 발사(7s 간격) + 유도탄 비행
    expect(em.brandCount(0)).toBeGreaterThan(0);
  });
});

describe("보스 행동(훅 ⑤) — 호위 방패·잡몹 분출·회복 링크", () => {
  const makeManager = () => {
    const scene = new THREE.Scene();
    const world = {
      heightAt: () => 0, bounds: 5000, topAt: () => -Infinity,
      resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
    } as any;
    const player = {
      worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as any;
    return new EnemyManager(scene, world, [player], NO_PHASE);
  };
  const tick = (em: EnemyManager, frames: number) => { for (let i = 0; i < frames; i++) em.update(1 / 60); };

  it("호위 방패 — 호위 생존 중 피해 30%, 호위 전멸 시 원복(호위 붕괴)", () => {
    const em = makeManager();
    em.startRoster([
      { role: "elite", count: 1, hp: 10000, shield: 0.3 },
      { role: "rusher", count: 2, hp: 100 },
    ], 800);
    const elite = em.aliveEnemies.find((e) => e.deployRole === "elite")!;
    elite.applyFrequencyHit(1000); // ×0.3 = 300
    expect(elite.hp).toBe(9700);
    for (const e of em.aliveEnemies) {
      if (e.deployRole === "rusher" && e.applyFrequencyHit(1e9)) em.registerKill(e);
    }
    tick(em, 1); // 방패 해제 판정
    elite.applyFrequencyHit(1000); // 원복 — 풀피해
    expect(elite.hp).toBe(8700);
  });

  it("잡몹 분출(성숙체) — 보스 생존 중 주기 분출, 보스 소산 후 정지", () => {
    const em = makeManager();
    em.startBossDeploy({ bossHp: 5000, projections: 1, emit: { role: "rusher", hp: 200, count: 2, interval: 0.5 } }, 500);
    expect(em.aliveEnemies.length).toBe(1); // 보스 투영 1
    tick(em, 60 * 2); // 2s — 분출 ~4회(0.5s 간격)
    const minions = em.aliveEnemies.filter((e) => !e.sharedPool);
    expect(minions.length).toBeGreaterThanOrEqual(4);
    expect(minions.every((e) => e.maxHp === 200)).toBe(true);
    // 보스 격파 → 분출 정지
    const boss = em.aliveEnemies.find((e) => e.sharedPool)!;
    if (boss.applyFrequencyHit(1e9)) em.registerKill(boss);
    tick(em, 30); // 소산 정리
    const count = em.aliveEnemies.length;
    tick(em, 120);
    expect(em.aliveEnemies.length).toBe(count); // 더 이상 늘지 않음
  });

  it("회복 링크(쌍생) — range 안이면 두 풀이 회복, range 밖(극소)이면 회복 없음", () => {
    const near = makeManager();
    near.startBossDeploy({ bossHp: 10000, projections: 1, groups: 2, healLink: { range: 1e5, rate: 600 } }, 500);
    const pools = [...new Set(near.aliveEnemies.map((e) => e.sharedPool!))];
    expect(pools.length).toBe(2);
    pools[0].hp = 5000;
    pools[1].hp = 5000;
    tick(near, 60); // 1s — +600
    expect(pools[0].hp).toBeGreaterThan(5400);
    expect(pools[1].hp).toBeGreaterThan(5400);

    const far = makeManager();
    far.startBossDeploy({ bossHp: 10000, projections: 1, groups: 2, healLink: { range: 0.001, rate: 600 } }, 500);
    const fpools = [...new Set(far.aliveEnemies.map((e) => e.sharedPool!))];
    fpools[0].hp = 5000;
    tick(far, 60);
    expect(fpools[0].hp).toBe(5000); // 링크 밖 — 회복 없음
  });

  it("fieldCleared — 생존·증원 큐 모두 0 일 때만(페이즈 전환 트리거)", () => {
    const em = makeManager();
    em.startHorde(6, 200, 500, { concurrentCap: 3, reinforceInterval: 0.1 });
    expect(em.fieldCleared).toBe(false); // 초기 투입 생존
    for (let r = 0; r < 10 && !em.fieldCleared; r++) {
      for (const e of em.aliveEnemies) {
        if (e.applyFrequencyHit(1e9)) em.registerKill(e);
      }
      tick(em, 90); // 소산 + 증원 소진
    }
    expect(em.fieldCleared).toBe(true);
    expect(em.killCount).toBe(6);
  });
});

describe("다중 투영 보스(§2.6) — HP 공유·동반 소산·처치 크레딧 1회", () => {
  const makeManager = () => {
    const scene = new THREE.Scene();
    const world = {
      heightAt: () => 0, bounds: 5000, topAt: () => -Infinity,
      resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
    } as any;
    const player = {
      worldPosition: new THREE.Vector3(0, 2, 0), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as any;
    return new EnemyManager(scene, world, [player], NO_PHASE);
  };
  const tick = (em: EnemyManager, frames: number) => { for (let i = 0; i < frames; i++) em.update(1 / 60); };

  it("보스 예산 1기 = 투영 3기, 어느 구를 때려도 같은 풀이 줄고 소진 시 전원 소산·킬 1회", () => {
    const em = makeManager();
    // count 1 + bossHp = totalHp → 큐 [보스]만. 초기 투입에 포함되어 즉시 투영 3기.
    em.startBurst(1, 500, 6000, 6000, { concurrentCap: 8, reinforceInterval: 0.2 });
    const boss = em.aliveEnemies.filter((e) => e.sharedPool);
    expect(boss.length).toBe(3);
    expect(boss[0].sharedPool).toBe(boss[1].sharedPool); // 같은 풀 공유
    // 한 구에 절반 피해 → 다른 구의 표시 HP 도 함께 준다(매니저 미러)
    expect(boss[0].applyFrequencyHit(3000)).toBe(false);
    tick(em, 1);
    expect(boss[1].hp).toBe(3000);
    // 남은 절반을 다른 구에 — 처치 크레딧은 이 한 번만 true
    expect(boss[1].applyFrequencyHit(3001)).toBe(true);
    em.registerKill(boss[1]);
    expect(boss[2].applyFrequencyHit(1)).toBe(false); // 이미 소진 — 중복 크레딧 없음
    tick(em, 1); // 형제 투영 동반 소산(forceDissolve)
    expect(em.aliveEnemies.length).toBe(0);
    expect(em.killCount).toBe(1); // 보스 = 1킬(미션 격멸 수 계약 유지)
  });

  it("직무별 처치 집계(훅 ③) — deployRole 태깅과 roleKills(보스 = 그룹당 1)", () => {
    const em = makeManager();
    em.startRoster([
      { role: "marker", count: 2, hp: 100 },
      { role: "elite", count: 2, hp: 100 },
      { role: "boss", count: 1, hp: 300 },
    ], 800);
    // elite 는 행동상 러셔지만 투입 직무는 elite 로 태깅된다
    expect(em.aliveEnemies.filter((e) => e.deployRole === "elite" && e.role === "rusher").length).toBe(2);
    expect(em.aliveEnemies.filter((e) => e.deployRole === "boss").length).toBe(3); // 투영 3
    for (const e of em.aliveEnemies) {
      if (e.applyFrequencyHit(1e9)) em.registerKill(e);
    }
    expect(em.roleKills.marker).toBe(2);
    expect(em.roleKills.elite).toBe(2);
    expect(em.roleKills.boss).toBe(1); // 투영 3기지만 크레딧 1(purge-role 목표치와 동일 계약)
    expect(em.roleKills.rusher).toBe(0);
  });

  it("roster 로 보스 그룹 수·투영 수를 지정할 수 있다(boss deploy 경로)", () => {
    const em = makeManager();
    em.startRoster([{ role: "boss", count: 1, hp: 30000 }, { role: "kiter", count: 4, hp: 800 }], 800, 4);
    const boss = em.aliveEnemies.filter((e) => e.sharedPool);
    expect(boss.length).toBe(4); // projections 오버라이드
    expect(em.aliveEnemies.length).toBe(8); // 투영 4 + 호위 4
  });

  it("파문 통과 콜백/집계 — 낙인 없으면 무상 통과로 집계된다", () => {
    const em = makeManager();
    em.startBurst(1, 500, 6000, 6000, { concurrentCap: 8, reinforceInterval: 0.2 });
    let passes = 0;
    em.onSweepPass = (branded) => { if (!branded) passes++; };
    tick(em, 60 * 40); // 파문 주기(30s) + 파면 통과까지
    expect(passes).toBeGreaterThan(0);
    expect(em.stats.sweepCleanPasses).toBe(passes);
    expect(em.stats.sweepHits).toBe(0);
  });
});
