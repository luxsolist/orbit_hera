import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  ease, rng, lump, spinAlong, makeSwarm, updateSwarm,
  oumuamua, moon, seabed, makeCore, makeSeed, beachHouse, plasmoidSwarm,
} from "../src/intro/helpers";

/** 지오메트리의 모든 정점 좌표가 유한한지(NaN/Infinity 없음) — 블랙스크린 회귀 가드. */
function allFinite(geo: THREE.BufferGeometry): boolean {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) return false;
  return true;
}

describe("ease", () => {
  it("끝점/중점 고정", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 6);
  });
  it("[0,1] 구간 단조 증가", () => {
    let prev = -1;
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const v = ease(k);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("rng", () => {
  it("같은 시드 → 동일 시퀀스(결정적)", () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });
  it("다른 시드 → 다른 시퀀스", () => {
    expect(rng(1)()).not.toBe(rng(2)());
  });
  it("출력은 [0,1] 범위", () => {
    const r = rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("lump", () => {
  it("[-1,1] 범위 내", () => {
    const r = rng(99);
    for (let i = 0; i < 2000; i++) {
      const v = lump((r() - 0.5) * 40, (r() - 0.5) * 40, (r() - 0.5) * 40);
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });
  it("연속적(인접 입력 → 인접 출력)", () => {
    const r = rng(5);
    for (let i = 0; i < 500; i++) {
      const x = (r() - 0.5) * 20, y = (r() - 0.5) * 20, z = (r() - 0.5) * 20;
      expect(Math.abs(lump(x + 0.01, y, z) - lump(x, y, z))).toBeLessThan(0.05);
    }
  });
});

describe("spinAlong", () => {
  it("장축(local +X)을 비행 방향 fwd 로 정렬", () => {
    const cases = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0.3, 0.5, -0.2).normalize(),
      new THREE.Vector3(-0.7, 0.1, 0.6).normalize(),
    ];
    for (const fwd of cases) {
      const o = new THREE.Object3D();
      spinAlong(o, fwd, 1.234);
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion);
      expect(x.x).toBeCloseTo(fwd.x, 5);
      expect(x.y).toBeCloseTo(fwd.y, 5);
      expect(x.z).toBeCloseTo(fwd.z, 5);
    }
  });
  it("theta 는 장축 방향에 영향 없음(스크류 회전만)", () => {
    const fwd = new THREE.Vector3(0.2, 0.9, -0.3).normalize();
    const a = new THREE.Object3D(), b = new THREE.Object3D();
    spinAlong(a, fwd, 0);
    spinAlong(b, fwd, 2.5);
    const xa = new THREE.Vector3(1, 0, 0).applyQuaternion(a.quaternion);
    const xb = new THREE.Vector3(1, 0, 0).applyQuaternion(b.quaternion);
    expect(xa.distanceTo(xb)).toBeLessThan(1e-5); // 장축 동일
    expect(a.quaternion.angleTo(b.quaternion)).toBeGreaterThan(0.1); // 전체 방향은 다름
  });
});

describe("makeSwarm / updateSwarm", () => {
  it("makeSwarm: count·name·frustumCulled 설정", () => {
    const inst = makeSwarm(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 8, "x");
    expect(inst.count).toBe(8);
    expect(inst.name).toBe("x");
    expect(inst.frustumCulled).toBe(false);
  });
  it("updateSwarm: 모든 인스턴스 배치 + needsUpdate", () => {
    const inst = makeSwarm(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 4, "x");
    const v0 = inst.instanceMatrix.version; // needsUpdate 는 set 전용 → version 증가로 검증
    updateSwarm(inst, (i, m4) => m4.makeScale(1, 1, 1).setPosition(i, 0, 0));
    expect(inst.instanceMatrix.version).toBeGreaterThan(v0);
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      inst.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBe(i);
    }
  });
});

describe("지오메트리 팩토리 — NaN 없음(블랙스크린 회귀 가드)", () => {
  it("oumuamua/moon/seabed/makeCore/makeSeed 정점 유한", () => {
    expect(allFinite(oumuamua().geometry)).toBe(true);
    expect(allFinite(moon(6).geometry)).toBe(true);
    expect(allFinite(seabed().geometry)).toBe(true);
    expect(allFinite(makeCore(1.2, 0xff4a1e).geometry)).toBe(true);
    expect(allFinite(makeSeed(0.5, 2).geometry)).toBe(true);
  });
  it("beachHouse: walls 3 + roof userData 구성", () => {
    const h = beachHouse();
    const ud = h.userData as { walls: unknown[]; roof: THREE.Mesh };
    expect(ud.walls).toHaveLength(3);
    expect(ud.roof).toBeInstanceOf(THREE.Mesh);
  });
  it("plasmoidSwarm: 인스턴스 수 + 색상 버퍼", () => {
    const sw = plasmoidSwarm(100, 77);
    expect(sw.count).toBe(100);
    expect(sw.instanceColor).not.toBeNull();
    expect(allFinite(sw.geometry)).toBe(true);
  });
});
