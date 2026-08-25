import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SHELL_GEOS } from "../src/enemies/CoreEnemy";
import { silhouetteSvg } from "../src/ui/shapeSvg";
import type { PlasmoidArchetype } from "../src/enemies/PlasmoidSpec";

// 형태 언어(§6.7) — 색=강함 / **형태=직무**. 코어가 강하게 발광해 원거리에서는 면·각이 뭉개지므로,
// 빠른 화면에서 살아남는 채널은 **실루엣 종횡비**와 **구멍** 둘뿐이다. 다섯 직무가 종횡비 축에
// 충분히 흩어져 있는지가 이 스위트의 계약이다(개편 전엔 거머리 1.04 / 소인체 0.98 로 겹쳤다).

/** 시선 dir 에서 본 실루엣 종횡비(가로/세로). 직교 투영 — 원근 왜곡 없이 비례만 본다. */
function aspect(geo: THREE.BufferGeometry, dir: THREE.Vector3): number {
  const pos = geo.getAttribute("position");
  const n = dir.clone().normalize();
  let u = new THREE.Vector3(0, 1, 0).cross(n);
  if (u.lengthSq() < 1e-6) u = new THREE.Vector3(1, 0, 0).cross(n);
  u.normalize();
  const v = n.clone().cross(u).normalize();
  let xn = Infinity, xx = -Infinity, yn = Infinity, yx = -Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const a = p.dot(u), b = p.dot(v);
    if (a < xn) xn = a; if (a > xx) xx = a;
    if (b < yn) yn = b; if (b > yx) yx = b;
  }
  return (xx - xn) / (yx - yn);
}

/** 플레이어 실사용 시선(수평 ±35°) 표본. 위/아래 극단은 실제로 거의 보지 않는다. */
function viewDirs(n = 400): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  let x = 99;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const m = Math.sin((35 * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const y = (rnd() * 2 - 1) * m, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    out.push(new THREE.Vector3(r * Math.cos(t), y, r * Math.sin(t)));
  }
  return out;
}

const DIRS = viewDirs();
const pct = (a: number[], p: number) => [...a].sort((m, n) => m - n)[Math.floor(a.length * p)];
const band = (role: PlasmoidArchetype) => {
  const a = DIRS.map((d) => aspect(SHELL_GEOS[role], d));
  return { lo: pct(a, 0.05), md: pct(a, 0.5), hi: pct(a, 0.95) };
};

describe("실루엣 종횡비 — 직무 구분 채널", () => {
  it("설계 의도대로 정렬된다: 모기 < 절단체 < 역행체 < 소인체 < 거머리", () => {
    const order: PlasmoidArchetype[] = ["kiter", "cutter", "rewinder", "marker", "rusher"];
    const mds = order.map((r) => band(r).md);
    for (let i = 1; i < mds.length; i++) expect(mds[i]).toBeGreaterThan(mds[i - 1]);
  });

  it("인접 직무 간 종횡비가 최소 1.25배 벌어진다 — 개편 전 최악은 1.01배(구분 불가)였다", () => {
    const mds = (["kiter", "cutter", "rewinder", "marker", "rusher"] as PlasmoidArchetype[])
      .map((r) => band(r).md).sort((a, b) => a - b);
    for (let i = 1; i < mds.length; i++) expect(mds[i] / mds[i - 1]).toBeGreaterThan(1.25);
  });

  it("세로형/가로형이 시선과 무관하게 유지된다 — 회전으로 정체가 뒤집히지 않게", () => {
    expect(band("kiter").hi).toBeLessThan(0.4); //   항상 세로로 길다(바늘)
    expect(band("cutter").hi).toBeLessThan(0.8); //  항상 세로로 길다(쐐기)
    expect(band("rusher").lo).toBeGreaterThan(1.2); // 항상 가로로 넓다(원반)
  });

  it("역행체 고리는 회전에 흔들리지 않는다 — 단일 토러스면 0.29~1.14 로 정체가 무너진다", () => {
    const b = band("rewinder");
    expect(b.hi / b.lo).toBeLessThan(1.5); // 직교 이중 고리라 어느 각도에서도 링이 남는다
    const single = new THREE.TorusGeometry(1.15, 0.2, 6, 12); // 대조군
    const s = DIRS.map((d) => aspect(single, d));
    expect(pct(s, 0.95) / pct(s, 0.05)).toBeGreaterThan(3); // 단일은 3배 이상 요동
  });
});

// ── 도감 삽화 ───────────────────────────────────────────────────────────────
/**
 * SVG 를 N×N 그리드에 래스터화 — 브라우저와 같은 **nonzero 감김수** 규칙으로 판정한다.
 * "삼각형 안에 있나"로만 보면 앞면·뒷면이 반대로 감겨 상쇄되는 경우(= 화면에서 투명해짐)를 놓친다.
 */
function raster(svg: string, N = 32): boolean[] {
  const size = Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
  const tris = [...svg.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)Z/g)]
    .map((m) => m.slice(1).map(Number));
  /** 점 기준 삼각형 변들의 감김수 기여 합(양수/음수 상쇄 포함). */
  const winding = (px: number, py: number, t: number[]) => {
    const pts: [number, number][] = [[t[0], t[1]], [t[2], t[3]], [t[4], t[5]]];
    let w = 0;
    for (let i = 0; i < 3; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % 3];
      if (y1 <= py) { if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) w++; }
      else if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) w--;
    }
    return w;
  };
  const grid: boolean[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const px = ((i + 0.5) / N) * size, py = ((j + 0.5) / N) * size;
    grid.push(tris.reduce((a, t) => a + winding(px, py, t), 0) !== 0); // nonzero
  }
  return grid;
}

describe("silhouetteSvg — 도감 삽화", () => {
  const ALL = Object.keys(SHELL_GEOS) as PlasmoidArchetype[];

  it("모든 직무가 유효한 SVG 를 낸다", () => {
    for (const r of ALL) {
      const svg = silhouetteSvg(SHELL_GEOS[r]);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain('viewBox="0 0 64 64"');
      expect(/M[\d.]+ [\d.]+L/.test(svg)).toBe(true); // 삼각형이 실제로 들어 있다
    }
  });

  it("뷰박스를 넘지 않고 여백이 남는다 — 카드에서 잘리지 않게", () => {
    for (const r of ALL) {
      const nums = [...silhouetteSvg(SHELL_GEOS[r], { size: 64, pad: 0.12 })
        .matchAll(/[ML]([\d.]+) ([\d.]+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(-0.05);
      expect(Math.max(...nums)).toBeLessThanOrEqual(64.05);
    }
  });

  it("긴 축이 상자를 채운다 — 개체마다 크기가 달라도 카드에서 같은 크기로 보인다", () => {
    for (const r of ALL) {
      const svg = silhouetteSvg(SHELL_GEOS[r], { size: 64, pad: 0.12 });
      const xs = [...svg.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const w = Math.max(...xs.map((q) => q[0])) - Math.min(...xs.map((q) => q[0]));
      const h = Math.max(...xs.map((q) => q[1])) - Math.min(...xs.map((q) => q[1]));
      expect(Math.max(w, h)).toBeCloseTo(64 * (1 - 0.12 * 2), 1);
    }
  });

  it("역행체 삽화는 가운데가 비어 있다 — 구멍이 곧 정체", () => {
    const N = 32;
    const g = raster(silhouetteSvg(SHELL_GEOS.rewinder), N);
    let center = 0;
    for (let j = N / 2 - 2; j < N / 2 + 2; j++) for (let i = N / 2 - 2; i < N / 2 + 2; i++) if (g[j * N + i]) center++;
    expect(center).toBe(0);
  });

  it("다른 직무 삽화는 속이 차 있다 — 구멍이 역행체 전용 신호로 남게", () => {
    const N = 32;
    for (const r of ["rusher", "kiter", "marker", "cutter"] as PlasmoidArchetype[]) {
      const g = raster(silhouetteSvg(SHELL_GEOS[r]), N);
      expect(g[(N / 2) * N + N / 2]).toBe(true); // 중심 픽셀이 채워져 있다
    }
  });

  it("삽화 종횡비가 게임 안 실루엣과 같은 방향 — 도감과 전장이 어긋나지 않게", () => {
    const shape = (r: PlasmoidArchetype) => {
      const svg = silhouetteSvg(SHELL_GEOS[r]);
      const xs = [...svg.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const w = Math.max(...xs.map((q) => q[0])) - Math.min(...xs.map((q) => q[0]));
      const h = Math.max(...xs.map((q) => q[1])) - Math.min(...xs.map((q) => q[1]));
      return w / h;
    };
    expect(shape("kiter")).toBeLessThan(0.5); //     삽화도 세로로 길다
    expect(shape("rusher")).toBeGreaterThan(1.5); // 삽화도 가로로 넓다
  });
});
