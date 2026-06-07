// 조준선(크로스헤어) 둘레 방향 화살표 — 비행 중 적이 "어느 방향"에 있는지 식별.
// 카메라-로컬 좌표(오른쪽 +x, 위 +y, 정면 -z)에서 화면상 둘레 각도를 산출한다(순수, 테스트 분리).

export interface ArrowPlacement {
  angle: number; // 12시(위) 기준 시계방향 라디안 — 화살표가 가리킬 방향
  hidden: boolean; // 정면 중앙(조준선 안)이면 숨김(이미 보이므로)
}

/**
 * 카메라-로컬 좌표 → 둘레 화살표 배치.
 * angle = atan2(x, y): 위(y+)=0, 오른쪽(x+)=+π/2 (화면 시계방향과 일치).
 * 정면(z<0)이면서 전방 거리(-z) 대비 화면 이탈이 데드콘(tan) 이내면 중앙으로 간주해 숨긴다.
 * 후방(z≥0)은 항상 표시(화면 밖이라 식별이 가장 필요).
 */
export function aimArrow(lx: number, ly: number, lz: number, deadConeTan: number): ArrowPlacement {
  const angle = Math.atan2(lx, ly);
  const radial = Math.hypot(lx, ly);
  const hidden = lz < 0 && radial < -lz * deadConeTan; // 정면 중앙 콘 안 → 숨김
  return { angle, hidden };
}

/** 둘레 각도 → 화면 오프셋(중심 기준 px). 위=(0,-R), 오른쪽=(+R,0). y 는 화면 좌표(아래 +). */
export function arrowOffset(angle: number, radius: number): { x: number; y: number } {
  return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius };
}
