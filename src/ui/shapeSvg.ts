// 지오메트리 → 실루엣 SVG(도감 §8.3 카드 삽화). **게임에서 쓰는 SHELL_GEOS 를 그대로 투영**하므로
// 형태를 바꾸면 도감이 자동으로 따라온다 — 손으로 그린 아이콘과 달리 어긋날 수가 없다.
//
// 볼록껍질이 아니라 **삼각형을 그대로 채워** 그린다: 역행체(직교 이중 고리)처럼 구멍이 정체인 형태는
// 껍질로 감싸면 원반이 되어 버린다. 삼각형이 없는 자리는 비어 남으므로 구멍이 그대로 보인다.
//
// 순수(THREE 타입만 참조 — DOM 비의존) → 노드 환경에서 문자열로 검증 가능.
import type * as THREE from "three";

export interface ShapeSvgOpts {
  size?: number; //   뷰박스 한 변(px)
  pad?: number; //    여백 비율(0..0.4) — 실루엣이 상자에 닿지 않게
  fill?: string; //   채움색
  yawDeg?: number; // 좌우 회전(°) — 3/4 시점으로 입체감을 준다
  tiltDeg?: number; // 상하 기울기(°)
}

const DEF: Required<ShapeSvgOpts> = {
  size: 64, pad: 0.12, fill: "currentColor",
  // 정면(0,0)이면 대칭 형태가 납작한 도형으로 보인다 — 살짝 돌려 3D 임을 읽히게.
  yawDeg: 28, tiltDeg: 18,
};

/** 회전 적용된 정점을 화면 평면(x=가로, y=세로↓)으로 투영. 직교 투영 — 원근 왜곡 없이 비례를 보존. */
function project(px: number, py: number, pz: number, yaw: number, tilt: number): [number, number] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x1 = px * cy + pz * sy;
  const z1 = -px * sy + pz * cy;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const y2 = py * ct - z1 * st;
  return [x1, -y2]; // SVG 는 y 가 아래로 증가
}

/**
 * 실루엣 SVG 문자열. 뒷면 삼각형도 함께 그려 채우므로(면 방향 무시) 속이 빈 형태의 구멍만 남는다.
 * 좌표는 실루엣 바운딩박스를 뷰박스에 꽉 맞춰 정규화 — 개체마다 크기가 달라도 카드에서 같은 크기로 보인다.
 */
export function silhouetteSvg(geo: THREE.BufferGeometry, opts: ShapeSvgOpts = {}): string {
  const o = { ...DEF, ...opts };
  const pos = geo.getAttribute("position");
  const idx = geo.getIndex();
  const yaw = (o.yawDeg * Math.PI) / 180;
  const tilt = (o.tiltDeg * Math.PI) / 180;

  const n = pos.count;
  const px: number[] = new Array(n);
  const py: number[] = new Array(n);
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const [a, b] = project(pos.getX(i), pos.getY(i), pos.getZ(i), yaw, tilt);
    px[i] = a; py[i] = b;
    if (a < xMin) xMin = a; if (a > xMax) xMax = a;
    if (b < yMin) yMin = b; if (b > yMax) yMax = b;
  }
  const w = xMax - xMin, h = yMax - yMin;
  const span = Math.max(w, h) || 1;
  const inner = o.size * (1 - o.pad * 2);
  const k = inner / span;
  // 가운데 정렬 — 긴 축을 채우고 짧은 축은 남는 만큼 양쪽에 나눈다.
  const ox = o.size * o.pad + (inner - w * k) / 2;
  const oy = o.size * o.pad + (inner - h * k) / 2;
  const X = (i: number) => (px[i] - xMin) * k + ox;
  const Y = (i: number) => (py[i] - yMin) * k + oy;

  // 감김 방향을 **전부 같게** 맞춘다. 안 맞추면 앞면·뒷면 삼각형이 화면에서 반대로 감겨
  // fill-rule="nonzero" 가 겹친 부분을 상쇄해 **투명해진다**(원기둥·구는 통째로 사라진다).
  const tri = (a: number, b: number, c: number) => {
    const ax = X(a), ay = Y(a), bx = X(b), by = Y(b), cx = X(c), cy = Y(c);
    const area2 = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    const [p1x, p1y, p2x, p2y] = area2 < 0 ? [cx, cy, bx, by] : [bx, by, cx, cy]; // 음수면 뒤집어 CCW 통일
    return `M${ax.toFixed(1)} ${ay.toFixed(1)}L${p1x.toFixed(1)} ${p1y.toFixed(1)}L${p2x.toFixed(1)} ${p2y.toFixed(1)}Z`;
  };
  let d = "";
  if (idx) for (let i = 0; i < idx.count; i += 3) d += tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  else for (let i = 0; i < n; i += 3) d += tri(i, i + 1, i + 2);

  return `<svg viewBox="0 0 ${o.size} ${o.size}" width="${o.size}" height="${o.size}" aria-hidden="true">`
    + `<path d="${d}" fill="${o.fill}" fill-rule="nonzero"/></svg>`;
}
