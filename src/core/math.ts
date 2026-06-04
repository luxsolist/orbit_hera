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
