import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { projectLensPoints, LENS_MAX_POINTS, type LensSource } from "../src/fx/lensDistort";

// 중력 렌즈 왜곡(P3 잔여 — 물리편 §2.7.1): 위상 이탈 개체의 월드 좌표 → 화면공간 왜곡 점.
// 순수 좌표 변환(카메라 프로젝션 행렬곱)이라 GPU 없이도 THREE.PerspectiveCamera 로 검증 가능.

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 2000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

const src = (over: Partial<LensSource> = {}): LensSource =>
  ({ x: 0, y: 0, z: 0, radiusWorld: 3, strength: 1, ...over });

describe("projectLensPoints — 화면공간 투영(순수)", () => {
  it("카메라 정면 원점 → 화면 중앙(0.5, 0.5) 근방", () => {
    const cam = makeCamera();
    const [p] = projectLensPoints([src({ x: 0, y: 0, z: 0 })], cam);
    expect(p.x).toBeCloseTo(0.5, 3);
    expect(p.y).toBeCloseTo(0.5, 3);
  });

  it("카메라 뒤에 있는 점은 제외(z 클립 밖)", () => {
    const cam = makeCamera();
    const out = projectLensPoints([src({ x: 0, y: 0, z: 20 })], cam); // 카메라(z=10) 뒤
    expect(out).toHaveLength(0);
  });

  it("화면에서 크게 벗어난 점은 컬링", () => {
    const cam = makeCamera();
    const out = projectLensPoints([src({ x: 5000, y: 0, z: 0 })], cam);
    expect(out).toHaveLength(0);
  });

  it("가까울수록 화면상 왜곡 반경이 크다(원근)", () => {
    const cam = makeCamera();
    const [near] = projectLensPoints([src({ x: 1, y: 0, z: 8 })], cam); // 카메라에서 2m
    const [far] = projectLensPoints([src({ x: 1, y: 0, z: -50 })], cam); // 카메라에서 60m
    expect(near.radius).toBeGreaterThan(far.radius);
    expect(near.radius).toBeLessThanOrEqual(0.4); // 상한 클램프
  });

  it("LENS_MAX_POINTS 초과분은 잘림", () => {
    const cam = makeCamera();
    const many = Array.from({ length: LENS_MAX_POINTS + 5 }, (_, i) => src({ x: i * 0.01, z: 0 }));
    expect(projectLensPoints(many, cam)).toHaveLength(LENS_MAX_POINTS);
  });

  it("strength 는 입력값을 그대로 통과", () => {
    const cam = makeCamera();
    const [p] = projectLensPoints([src({ strength: 0.42 })], cam);
    expect(p.strength).toBe(0.42);
  });

  it("빈 입력 → 빈 출력", () => {
    expect(projectLensPoints([], makeCamera())).toEqual([]);
  });
});
