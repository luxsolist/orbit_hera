// 중력 렌즈 왜곡(물리편 §2.7.1) — 위상 이탈 개체도 질량-에너지는 그대로라 그 위치의 배경이
// 렌즈처럼 일렁인다(화면 왜곡). 미니맵은 방향만 주므로(2026-08-24, Minimap.drawPhaseDirections)
// **정확한 위치는 이 왜곡이 유일한 채널** — 렌즈를 읽고 실체화 지점을 선점하는 예측 플레이의
// 시각 단서. §2.1(위상 이탈)과 세트.
//
// 이 파일은 순수 좌표 변환만(카메라 프로젝션은 상태 없는 행렬 연산이라 노드 환경에서도 테스트
// 가능) — 실제 셰이더 왜곡은 LensDistortPass.ts(WebGL, GPU 전용이라 헤드리스 테스트 불가).
import * as THREE from "three";

export const LENS_MAX_POINTS = 6; // 셰이더 유니폼 상한 — 동시 표시 위상 이탈 개체가 이보다 많으면 근접 우선

export interface LensPoint {
  x: number; // 화면 UV(0~1, 좌상단 원점)
  y: number;
  radius: number; // 화면 UV 단위 왜곡 반경
  strength: number; // 왜곡 강도(0~1) — 개체 강함에 비례해도 됨
}

export interface LensSource {
  x: number; y: number; z: number; // 월드 좌표
  radiusWorld: number; // 개체 시각 반경(m) — 화면상 왜곡 반경 산출에 사용
  strength: number;
}

/**
 * 월드 좌표 목록 → 화면공간(UV) 왜곡 점 목록. 카메라 뒤(z 클립 밖)·화면에서 크게 벗어난 점은 제외.
 * 상한(LENS_MAX_POINTS) 초과분은 잘림(호출부가 카메라에 가까운 순으로 정렬해 넘기는 것을 권장).
 * 순수(카메라 인자의 현재 행렬만 참조 — GPU/렌더 상태 비의존, PerspectiveCamera.project 는 행렬곱뿐).
 */
export function projectLensPoints(
  sources: readonly LensSource[],
  camera: THREE.PerspectiveCamera,
): LensPoint[] {
  const out: LensPoint[] = [];
  const proj = new THREE.Vector3();
  const worldPos = new THREE.Vector3();
  for (const s of sources) {
    if (out.length >= LENS_MAX_POINTS) break;
    worldPos.set(s.x, s.y, s.z);
    proj.copy(worldPos).project(camera);
    if (proj.z < -1 || proj.z > 1) continue; // 카메라 뒤/원거리 클립 밖
    const u = (proj.x + 1) / 2;
    const v = (1 - proj.y) / 2; // NDC(y 위 방향) → UV(y 아래 방향)
    if (u < -0.25 || u > 1.25 || v < -0.25 || v > 1.25) continue; // 화면 크게 벗어남 — 컬링
    const dist = camera.position.distanceTo(worldPos);
    const radius = Math.min(0.4, (s.radiusWorld / Math.max(1, dist)) * 0.7);
    out.push({ x: u, y: v, radius, strength: s.strength });
  }
  return out;
}
