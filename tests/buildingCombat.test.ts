import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { BuildingCombat } from "../src/world/BuildingCombat";

// 정점 색/위치 어트리뷰트를 가진 더미 병합 메시(건물 1채분 범위).
function makeMesh(vCount: number): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(vCount * 3), 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(vCount * 3).fill(0.5), 3));
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
}

// 20×20 정사각 footprint(중심 10,10), 높이 = top−base.
const SQUARE = [0, 0, 20, 0, 20, 20, 0, 20];

describe("BuildingCombat — 일반 건물", () => {
  it("부피(면적×높이) 비례 체력 + 최근접 표적 탐색", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 20); // 400㎡ × 20m × 0.04 = 320
    const t = bc.nearestTarget(0, 0, 100);
    expect(t).not.toBeNull();
    expect(t!.x).toBeCloseTo(10);
    expect(t!.z).toBeCloseTo(10);
    // 체력만큼 때려야 파괴 — 319 피해는 hit, 추가 1 피해에 destroyed
    expect(bc.damage(t!.id, 319)).toBe("hit");
    expect(bc.damage(t!.id, 1)).toBe("destroyed");
    expect(bc.destroyedBuildings).toBe(1);
  });

  it("파괴 후 표적/피해 비활성 + onDestroyed 콜백", () => {
    const bc = new BuildingCombat();
    let fired = 0;
    bc.onDestroyed = (isLm) => { if (!isLm) fired++; };
    bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 20);
    const id = bc.nearestTarget(0, 0, 100)!.id;
    bc.damage(id, 9999);
    expect(fired).toBe(1);
    expect(bc.nearestTarget(0, 0, 100)).toBeNull(); // 더 이상 표적 아님
    expect(bc.targetPos(id, new THREE.Vector3())).toBe(false);
    expect(bc.damage(id, 10)).toBe("none"); // 중복 피해 무시
  });

  it("스트리밍 재로드 — 파괴 이력 보존(재등록 시 즉시 잔해, 표적 제외)", () => {
    const bc = new BuildingCombat();
    const m1 = makeMesh(8);
    bc.registerBuilding(m1, 0, 8, SQUARE, 0, 20);
    const id = bc.nearestTarget(0, 0, 100)!.id;
    bc.damage(id, 9999); // 파괴
    bc.unregisterMesh(m1); // 청크 언로드

    const m2 = makeMesh(8); // 청크 재로드 — 같은 footprint
    bc.registerBuilding(m2, 0, 8, SQUARE, 0, 20);
    expect(bc.nearestTarget(0, 0, 100)).toBeNull(); // 부서진 건물은 다시 표적 안 됨
    expect(bc.destroyedBuildings).toBe(1); // 카운트 중복 증가 없음
  });

  it("붕괴 연출 진행 — 정점이 바닥으로 가라앉음", () => {
    const bc = new BuildingCombat();
    const m = makeMesh(8);
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < 8; k++) pos.setXYZ(k, 5, 18, 5); // 모두 높이 18
    bc.registerBuilding(m, 0, 8, SQUARE, 0, 20);
    bc.damage(bc.nearestTarget(0, 0, 100)!.id, 9999);
    for (let i = 0; i < 60; i++) bc.update(0.05); // flash + 붕괴(>1.6s) 완료
    expect(pos.getY(0)).toBeLessThan(2); // 바닥 근처로 주저앉음
  });
});

describe("BuildingCombat — 랜드마크", () => {
  it("고유 체력 사용 + 파괴 시 destroyedLandmarks 증가", () => {
    const bc = new BuildingCombat();
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    bc.registerLandmark(grp, 100, 200, 40, 5, 5, 500); // 고유 hp=500
    const t = bc.nearestTarget(100, 200, 50)!;
    expect(bc.damage(t.id, 499)).toBe("hit");
    expect(bc.damage(t.id, 1)).toBe("destroyed");
    expect(bc.destroyedLandmarks).toBe(1);
    expect(bc.destroyedBuildings).toBe(0);
  });
});
