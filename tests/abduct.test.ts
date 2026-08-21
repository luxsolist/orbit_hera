import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { BuildingCombat } from "../src/world/BuildingCombat";

// 의존성 절단 — 건물 납치(P3 커터, 서사편 §6.3) + W4 복구 사격(mend).
// 계약: 납치 중 표적/피해 제외 → 고도 200 도달 시 소거(잔해 없음) / 해제·mend 시 재안착(완전 복원).

function makeMesh(vCount: number): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(vCount * 3), 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(vCount * 3).fill(0.5), 3));
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
}
const SQUARE = [0, 0, 10, 0, 10, 10, 0, 10]; // 10×10m footprint

const setup = () => {
  const bc = new BuildingCombat();
  bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 30);
  const id = bc.nearestTarget(5, 5, 50)!.id;
  return { bc, id };
};

describe("beginAbduct — 개시·표적 제외", () => {
  it("intact 건물만 개시되고, 납치 중엔 표적/피해에서 빠진다", () => {
    const { bc, id } = setup();
    expect(bc.beginAbduct(id)).toBe(true);
    expect(bc.abductingCount).toBe(1);
    expect(bc.beginAbduct(id)).toBe(false); //          중복 개시 불가
    expect(bc.nearestTarget(5, 5, 50)).toBeNull(); //   표적 제외
    expect(bc.damage(id, 100)).toBe("none"); //         피해 무효(벌크로 떠오르는 중)
  });

  it("부양 상단(anchor)이 시간에 따라 상승한다", () => {
    const { bc, id } = setup();
    bc.beginAbduct(id);
    const y0 = bc.abductAnchor(id)!.y;
    bc.update(2); // 12m/s × 2s
    expect(bc.abductAnchor(id)!.y).toBeCloseTo(y0 + 24, 5);
  });
});

describe("소거·재안착·W4 mend", () => {
  it("고도 200 도달 → 소거(파괴 집계·onDestroyed, anchor 소멸)", () => {
    const { bc, id } = setup();
    let destroyed = 0;
    bc.onDestroyed = () => destroyed++;
    bc.beginAbduct(id);
    for (let i = 0; i < 20; i++) bc.update(1); // 12m/s × 20s = 240 > 200
    expect(bc.abductingCount).toBe(0);
    expect(bc.abductAnchor(id)).toBeNull();
    expect(bc.destroyedBuildings).toBe(1);
    expect(destroyed).toBe(1);
  });

  it("releaseAbduct(커터 격추) → 하강 후 intact 완전 복원(표적/피해 복귀)", () => {
    const { bc, id } = setup();
    bc.beginAbduct(id);
    bc.update(3); // 36m 상승
    bc.releaseAbduct(id);
    for (let i = 0; i < 5; i++) bc.update(1); // 하강 30m/s — 2초면 바닥
    expect(bc.abductingCount).toBe(0);
    expect(bc.destroyedBuildings).toBe(0); // 소거 아님
    const t = bc.nearestTarget(5, 5, 50);
    expect(t?.id).toBe(id); //             표적 복귀
    expect(bc.damage(id, 10)).toBe("hit"); // 피해 복귀
  });

  it("커터 통합 — 접근→부착→절단 채널→납치 개시, 격추 시 재안착(EnemyManager)", async () => {
    const { EnemyManager } = await import("../src/enemies/EnemyManager");
    const { DEFAULT_PLASMOID } = await import("../src/enemies/PlasmoidSpec");
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 30);
    const world = {
      heightAt: () => 0, bounds: 5000, topAt: () => -Infinity, buildings: bc,
      resolveCollision: (x: number, z: number) => ({ x, z }), segmentHitsBuilding: () => Infinity,
    } as never;
    const player = {
      worldPosition: new THREE.Vector3(400, 2, 400), isDead: false,
      spec: { move: { mode: "walk" } }, takeDamage: () => false, heal: () => {},
    } as never;
    const em = new EnemyManager(new THREE.Scene(), world, [player], { ...DEFAULT_PLASMOID, phase: undefined });
    em.startRoster([{ role: "cutter", count: 1, hp: 2000 }], 60);
    // 접근+부착+절단(severSec 5s) — 충분히 돌리면 납치가 개시된다
    for (let i = 0; i < 1200 && bc.abductingCount === 0; i++) em.update(1 / 30);
    expect(bc.abductingCount).toBe(1);
    // 격추 → 재안착 전환(다음 프레임 사망 분기에서 releaseAbduct)
    const cutter = em.aliveEnemies.find((e) => e.role === "cutter")!;
    cutter.applyFrequencyHit(99999);
    em.update(1 / 30);
    for (let i = 0; i < 300 && bc.abductingCount > 0; i++) bc.update(0.1);
    expect(bc.abductingCount).toBe(0);
    expect(bc.destroyedBuildings).toBe(0); // 소거 아님 — 재안착 성공
  });

  it("mendAt(복구 사격) — footprint 명중 시 부양 고도를 깎고, 바닥까지 깎이면 재안착", () => {
    const { bc, id } = setup();
    bc.beginAbduct(id);
    bc.update(2); // lift 24
    expect(bc.mendAt(5, 5, 10)).toBe(true); //   lift 14
    expect(bc.mendAt(500, 500, 10)).toBe(false); // 다른 위치 — 무효
    expect(bc.mendAt(5, 5, 999)).toBe(true); //  바닥 도달 — 재안착 전환
    bc.update(0.1);
    expect(bc.abductingCount).toBe(0);
    expect(bc.nearestTarget(5, 5, 50)?.id).toBe(id); // intact 복원
  });
});
