import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  ease, rng, lump, spinAlong, makeSwarm, updateSwarm, fallFrag, track,
  oumuamua, moon, seabed, makeCore, makeSeed, beachHouse, plasmoidSwarm, type Frag,
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
    expect(allFinite(makeCore(1.2, 3200).geometry)).toBe(true);
    expect(allFinite(makeSeed(0.5, 2).geometry)).toBe(true);
  });
  it("beachHouse: 벽/지붕 조각 다수(각 10+) userData 구성", () => {
    const h = beachHouse();
    const ud = h.userData as { wallFrags: unknown[]; roofFrags: unknown[] };
    expect(ud.wallFrags.length).toBeGreaterThanOrEqual(10);
    expect(ud.roofFrags.length).toBeGreaterThanOrEqual(10);
  });
  it("plasmoidSwarm: 인스턴스 수 + 색상 버퍼 + wn∈[0,1] + 결정성", () => {
    const sw = plasmoidSwarm(100, 77);
    expect(sw.count).toBe(100);
    expect(sw.instanceColor).not.toBeNull();
    expect(allFinite(sw.geometry)).toBe(true);
    const wn = sw.userData.wn as Float32Array;
    expect(wn.length).toBe(100);
    for (const v of wn) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
    expect((plasmoidSwarm(100, 77).userData.wn as Float32Array)[0]).toBe(wn[0]); // 같은 시드 → 동일
  });
});

describe("fallFrag — 조각 낙하(수직 p²·수평 ease)", () => {
  const make = (): Frag => ({
    mesh: new THREE.Mesh(),
    home: new THREE.Vector3(0, 10, 0),
    rest: new THREE.Vector3(2, 0, 2),
    axis: new THREE.Vector3(0, 1, 0),
    spin: 0,
    delay: 0,
    fall: 1,
  });
  it("트리거 전(p≤0)=제자리, p=1=rest, p=0.5=수직 p²·수평 ease", () => {
    const f = make();
    f.mesh.position.copy(f.home);
    fallFrag(f, 0); // p=0 → 제자리
    expect(f.mesh.position.y).toBe(10);
    fallFrag(f, 1); // p=1 → rest
    expect(f.mesh.position.x).toBeCloseTo(2, 6);
    expect(f.mesh.position.y).toBeCloseTo(0, 6);
    const g = make();
    g.mesh.position.copy(g.home);
    fallFrag(g, 0.5); // 수직 y=lerp(10,0,0.25)=7.5, 수평 x=lerp(0,2,ease(0.5)=0.5)=1
    expect(g.mesh.position.y).toBeCloseTo(7.5, 6);
    expect(g.mesh.position.x).toBeCloseTo(1, 6);
  });
});

describe("track — 카메라 이징 이동", () => {
  it("k 양끝/중점/클램프", () => {
    const cam = new THREE.PerspectiveCamera();
    const ctx = { camera: cam } as unknown as Parameters<typeof track>[0];
    const look = new THREE.Vector3();
    track(ctx, 0, [0, 0, 0], [10, 0, 0], look);
    expect(cam.position.x).toBeCloseTo(0, 6);
    track(ctx, 1, [0, 0, 0], [10, 0, 0], look);
    expect(cam.position.x).toBeCloseTo(10, 6);
    track(ctx, 0.5, [0, 0, 0], [10, 0, 0], look); // ease(0.5)=0.5 → 5
    expect(cam.position.x).toBeCloseTo(5, 6);
    track(ctx, 2, [0, 0, 0], [10, 0, 0], look); // 클램프 → 10
    expect(cam.position.x).toBeCloseTo(10, 6);
  });
});
