// 전방 콘(원뿔) 조준 — 에임 어시스트·자동발사·일제사격이 공유하는 순수 타깃 선별.
// origin 에서 aimDir 을 축으로 하는 콘(코사인 ≥ coneCos) + 사거리(range) 안의 적을 고른다.
// THREE 비의존(plain {x,y,z}) → 부수효과 없이 테스트 가능. 호출부가 좌표만 넘긴다.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ConeTarget {
  /** origin→타깃 정규화 방향 */
  dir: Vec3;
  dist: number;
  /** aimDir 과의 코사인(정렬도, 1=정면) */
  cos: number;
  /** positions 내 원본 인덱스(호출부가 메시 등 역참조에 사용) */
  index: number;
}

/**
 * 콘+사거리 안의 타깃 후보 수집. 등 뒤(cos ≤ 0)·동일점·사거리 밖·콘 밖은 제외.
 * 정렬/캡은 용도별 헬퍼(bestAlignedDir·nearestInCone)에서 처리.
 */
export function coneTargets(
  origin: Vec3,
  aimDir: Vec3,
  positions: ReadonlyArray<Vec3>,
  range: number,
  coneCos: number
): ConeTarget[] {
  const out: ConeTarget[] = [];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const dx = p.x - origin.x,
      dy = p.y - origin.y,
      dz = p.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-3 || dist > range) continue;
    const inv = 1 / dist;
    const dir = { x: dx * inv, y: dy * inv, z: dz * inv };
    const cos = dir.x * aimDir.x + dir.y * aimDir.y + dir.z * aimDir.z;
    if (cos <= 0 || cos < coneCos) continue;
    out.push({ dir, dist, cos, index: i });
  }
  return out;
}

/**
 * 콘 안에서 가장 정렬된(코사인 최대) 단일 타깃 방향. 없으면 null.
 * 에임 어시스트(조준 보정)·근거리 자동발사 조준에 사용.
 */
export function bestAlignedDir(
  origin: Vec3,
  aimDir: Vec3,
  positions: ReadonlyArray<Vec3>,
  range: number,
  coneCos: number
): Vec3 | null {
  let best: ConeTarget | null = null;
  for (const t of coneTargets(origin, aimDir, positions, range, coneCos)) {
    if (!best || t.cos > best.cos) best = t;
  }
  return best ? best.dir : null;
}

/** 콘 안 타깃을 거리 오름차순 최대 max 개(일제사격). */
export function nearestInCone(
  origin: Vec3,
  aimDir: Vec3,
  positions: ReadonlyArray<Vec3>,
  range: number,
  coneCos: number,
  max: number
): ConeTarget[] {
  return coneTargets(origin, aimDir, positions, range, coneCos)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, max);
}
