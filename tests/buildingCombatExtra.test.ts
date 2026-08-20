import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { BuildingCombat } from "../src/world/BuildingCombat";

function makeMesh(vCount: number): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(vCount * 3), 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(vCount * 3).fill(0.5), 3));
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
}

// HP_MIN=40, HP_PER_M3=0.04, GRID_CELL=128
const TINY_SQUARE = [0, 0, 1, 0, 1, 1, 0, 1]; // 1×1m footprint, area=1
const MED_SQUARE = [0, 0, 20, 0, 20, 20, 0, 20]; // 20×20m footprint

describe("BuildingCombat — HP_MIN floor(극소 건물)", () => {
  it("1m² footprint × 1m 높이 → HP_PER_M3×1=0.04 < HP_MIN(40) → 체력 40", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, TINY_SQUARE, 0, 1); // area=1, h=1
    const t = bc.nearestTarget(0.5, 0.5, 50)!;
    expect(bc.damage(t.id, 39)).toBe("hit");
    expect(bc.damage(t.id, 1)).toBe("destroyed"); // 정확히 40에 파괴
  });

  it("충분히 큰 건물은 HP_MIN 이상(부피 기준)", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, MED_SQUARE, 0, 20); // 400×20×0.04=320 > 40
    const t = bc.nearestTarget(10, 10, 100)!;
    expect(bc.damage(t.id, 40)).toBe("hit"); // 40피해여도 살아있음(maxHp=320)
    expect(bc.damage(t.id, 300)).toBe("destroyed");
  });
});

describe("BuildingCombat — hp 경계값(hp=1 → 데미지 1 → destroyed)", () => {
  it("HP_MIN 건물(maxHp=40) — 피해 39 후 hp=1, 피해 1 → destroyed(hp<=0)", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, TINY_SQUARE, 0, 1);
    const t = bc.nearestTarget(0.5, 0.5, 50)!;
    bc.damage(t.id, 39); // hp=1
    expect(bc.damage(t.id, 1)).toBe("destroyed");
  });

  it("정확히 maxHp 만큼 데미지 → destroyed(hp=0, <= 0 경계)", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, TINY_SQUARE, 0, 1); // maxHp=40
    const t = bc.nearestTarget(0.5, 0.5, 50)!;
    expect(bc.damage(t.id, 40)).toBe("destroyed");
  });
});

describe("BuildingCombat — nearestTarget 반경 경계", () => {
  it("건물이 반경 안에 있으면 찾음, 밖이면 null — d < maxR² 엄격 비교", () => {
    const bc = new BuildingCombat();
    // poly [9,0, 11,0, 11,1, 9,1] → cx=10, cz=0.5. 질의(0,0)에서 거리²=100+0.25≈100.25
    const poly = [9, 0, 11, 0, 11, 1, 9, 1];
    bc.registerBuilding(makeMesh(8), 0, 8, poly, 0, 5);
    // maxR=10 → bestD=100. d≈100.25 > 100 → null(경계 바깥)
    expect(bc.nearestTarget(0, 0, 10)).toBeNull();
    // maxR=11 → bestD=121. d≈100.25 < 121 → 찾음(반경 안)
    expect(bc.nearestTarget(0, 0, 11)).not.toBeNull();
  });

  it("반경 0 → 어떤 건물도 찾지 못함(bestD=0, d≥0 이므로 d<0 불가)", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, MED_SQUARE, 0, 5); // cx=10, cz=10
    expect(bc.nearestTarget(10, 10, 0)).toBeNull();
  });
});

describe("BuildingCombat — 랜드마크 hp 미지정 → 기본값(6000)", () => {
  it("hp 미지정 시 LANDMARK_HP_DEFAULT=6000 사용", () => {
    const bc = new BuildingCombat();
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    bc.registerLandmark(grp, 0, 0, 20, 5, 5); // hp 미지정
    const t = bc.nearestTarget(0, 0, 50)!;
    expect(bc.damage(t.id, 5999)).toBe("hit");
    expect(bc.damage(t.id, 1)).toBe("destroyed");
    expect(bc.destroyedLandmarks).toBe(1);
  });

  it("hp=0 명시 전달 → 최소 1로 보정(Math.max(1,...)) → 즉시 파괴", () => {
    // registerLandmark(hp?) — hp=0이면 maxHp = 0 ?? LANDMARK_HP_DEFAULT = 6000
    // 이유: 0은 falsy가 아닌 null/undefined만 ??: 체크. 즉 hp=0 → maxHp=0 → 즉시 destroyed?
    // 실제 코드: const maxHp = hp ?? LANDMARK_HP_DEFAULT; → hp=0이면 0 (??는 null/undefined만 폴백)
    const bc = new BuildingCombat();
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    bc.registerLandmark(grp, 10, 10, 20, 5, 5, 0); // hp=0
    const t = bc.nearestTarget(10, 10, 50)!;
    // hp=0으로 등록됐으므로 첫 피해에 destroyed
    expect(bc.damage(t.id, 1)).toBe("destroyed");
  });
});

describe("BuildingCombat — unregisterMesh 후 표적 제외", () => {
  it("청크 언로드 후 nearestTarget → null", () => {
    const bc = new BuildingCombat();
    const m = makeMesh(8);
    bc.registerBuilding(m, 0, 8, MED_SQUARE, 0, 20);
    expect(bc.nearestTarget(10, 10, 100)).not.toBeNull();
    bc.unregisterMesh(m);
    expect(bc.nearestTarget(10, 10, 100)).toBeNull();
  });

  it("파괴 후 unregisterMesh + 재등록 → 표적 제외 유지, 카운트 중복 없음", () => {
    const bc = new BuildingCombat();
    const m1 = makeMesh(8);
    bc.registerBuilding(m1, 0, 8, MED_SQUARE, 0, 20);
    bc.damage(bc.nearestTarget(10, 10, 100)!.id, 9999);
    expect(bc.destroyedBuildings).toBe(1);
    bc.unregisterMesh(m1);

    const m2 = makeMesh(8);
    bc.registerBuilding(m2, 0, 8, MED_SQUARE, 0, 20); // 같은 footprint 재등록
    expect(bc.nearestTarget(10, 10, 100)).toBeNull(); // 파괴 이력 → 표적 제외
    expect(bc.destroyedBuildings).toBe(1); // 카운트 중복 증가 없음
  });
});

describe("BuildingCombat — 건물 없을 때 nearestTarget → null", () => {
  it("빈 상태에서 nearestTarget → null", () => {
    const bc = new BuildingCombat();
    expect(bc.nearestTarget(0, 0, 1000)).toBeNull();
  });

  it("damage: 없는 id → 'none'", () => {
    const bc = new BuildingCombat();
    expect(bc.damage("nonexistent", 100)).toBe("none");
  });

  it("targetPos: 없는 id → false", () => {
    const bc = new BuildingCombat();
    expect(bc.targetPos("nonexistent", new THREE.Vector3())).toBe(false);
  });
});

describe("BuildingCombat — destroyedBuildings / destroyedLandmarks 집계", () => {
  it("건물 파괴만: destroyedBuildings++, destroyedLandmarks 불변", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, MED_SQUARE, 0, 20);
    bc.damage(bc.nearestTarget(10, 10, 100)!.id, 9999);
    expect(bc.destroyedBuildings).toBe(1);
    expect(bc.destroyedLandmarks).toBe(0);
  });

  it("여러 건물 파괴: 각각 +1씩", () => {
    const bc = new BuildingCombat();
    const m = makeMesh(16);
    // 두 건물 — footprint 위치 달리해서 id 충돌 방지
    const poly1 = [0, 0, 10, 0, 10, 10, 0, 10];
    const poly2 = [100, 100, 110, 100, 110, 110, 100, 110];
    bc.registerBuilding(m, 0, 8, poly1, 0, 10);
    bc.registerBuilding(m, 8, 8, poly2, 0, 10);
    bc.damage(bc.nearestTarget(5, 5, 50)!.id, 9999);
    bc.damage(bc.nearestTarget(105, 105, 50)!.id, 9999);
    expect(bc.destroyedBuildings).toBe(2);
  });
});

describe("nearestLandmark — 어그로 변조(aggro: landmark)용 최근접 랜드마크(훅 ④)", () => {
  it("반경 무제한 최근접 선택, 파괴된 랜드마크는 제외", () => {
    const bc = new BuildingCombat();
    bc.registerLandmark(new THREE.Group(), 100, 0, 30, 10, 10, 500);
    bc.registerLandmark(new THREE.Group(), 3000, 0, 30, 10, 10, 500); // 아주 멀어도 후보
    const near = bc.nearestLandmark(0, 0)!;
    expect(near.id).toBe("l100_0");
    // 가까운 쪽 파괴 → 먼 쪽으로 전환
    bc.damage("l100_0", 9999);
    expect(bc.nearestLandmark(0, 0)!.id).toBe("l3000_0");
  });

  it("랜드마크가 없으면 null(호출부는 일반 건물 폴백)", () => {
    expect(new BuildingCombat().nearestLandmark(0, 0)).toBeNull();
  });
});
