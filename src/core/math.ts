// 공용 순수 수학/색 유틸 — THREE 비의존. 데이터 모듈(PlasmoidSpec 등)·게임 로직 어디서나 임포트 가능.

/** 좌표 평문 타입 — THREE.Vector3 없이 순수 로직/테스트에서 사용. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** lo..hi 로 클램프. */
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** 선형 보간 a→b (t∈[0,1] 권장, 클램프 없음). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** "0xRRGGBB" 문자열 → number. JSON 은 0x 리터럴을 못 담아 색을 문자열로 보관하는 관례의 단일 파서. */
export const parseHexColor = (s: string): number => Number(s);

/**
 * 시드 고정 결정적 난수 생성기 — 0..1 반환. 재생마다 동일 결과가 필요한 곳(인트로 별/바위, 테스트의
 * 스폰 배치 재현)에서 Math.random 대신 쓴다. 원래 intro/helpers.ts 에만 있었는데, EnemyManager 를
 * 시드 주입 가능하게 바꾸며(스폰 위치가 Math.random 에 걸려 있어 진형 수렴 테스트가 간헐 실패했다)
 * 테스트에서도 필요해져 THREE 비의존 공용 유틸로 옮겼다.
 */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
}

/**
 * 수평 디스크(중심 cx,cz·반경 r) 안으로 (x,z)를 클램프 — 밖이면 경계로 투영. `out`에 기록·반환(할당 회피).
 * 작전구역(존) 경계 처리에 플레이어·플라즈모이드 공통 사용. r≤0 이면 무제한(원본). 순수.
 */
export function clampToDisk(x: number, z: number, cx: number, cz: number, r: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = x; out.z = z;
  if (r <= 0) return out;
  const dx = x - cx, dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d > r && d > 1e-9) {
    const s = r / d;
    out.x = cx + dx * s;
    out.z = cz + dz * s;
  }
  return out;
}
