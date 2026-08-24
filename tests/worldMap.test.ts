import { describe, it, expect } from "vitest";
import { projectLatLon, clusterDots, zoomMapBox, projectInBox, niceGridStep, buildWorldSvg } from "../src/ui/worldMapSvg";

describe("projectLatLon — equirectangular 백분율 투영", () => {
  it("원점(0,0) → 중앙(50,50)", () => {
    const p = projectLatLon(0, 0);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });
  it("경도 -180/180 → x 0/100", () => {
    expect(projectLatLon(0, -180).x).toBeCloseTo(0, 6);
    expect(projectLatLon(0, 180).x).toBeCloseTo(100, 6);
  });
  it("위도 90/-90 → y 0/100", () => {
    expect(projectLatLon(90, 0).y).toBeCloseTo(0, 6);
    expect(projectLatLon(-90, 0).y).toBeCloseTo(100, 6);
  });
  it("서울(37.578, 126.977) ≈ (85.3%, 29.1%)", () => {
    const p = projectLatLon(37.578, 126.977);
    expect(p.x).toBeCloseTo(85.27, 1);
    expect(p.y).toBeCloseTo(29.12, 1);
  });
});

describe("clusterDots — 근접 점 클러스터링(2:1 종횡비)", () => {
  it("가까운 점(서울·부산)은 한 그룹, 먼 점(에베레스트)은 별도", () => {
    const seoul = { id: "seoul", ...projectLatLon(37.58, 126.98) };
    const busan = { id: "busan", ...projectLatLon(35.16, 129.07) };
    const everest = { id: "everest", ...projectLatLon(27.99, 86.92) };
    const groups = clusterDots([seoul, busan, everest], 2.6);
    expect(groups).toHaveLength(2); // {서울,부산} + {에베레스트}
    const cluster = groups.find((g) => g.members.length === 2)!;
    expect(cluster.members.map((m) => m.id).sort()).toEqual(["busan", "seoul"]);
    // 대표 위치 = 멤버 평균
    expect(cluster.x).toBeCloseTo((seoul.x + busan.x) / 2, 6);
  });
  it("연결성(transitive) — A~B, B~C 면 한 그룹", () => {
    const a = { id: "a", x: 50, y: 50 }, b = { id: "b", x: 51, y: 50 }, c = { id: "c", x: 52, y: 50 };
    expect(clusterDots([a, b, c], 1.5)).toHaveLength(1);
  });
  it("모두 멀면 각각 단일 그룹", () => {
    expect(clusterDots([{ id: "a", x: 10, y: 10 }, { id: "b", x: 80, y: 80 }], 2.6)).toHaveLength(2);
  });
});

describe("zoomMapBox / projectInBox — 확대창 공통 로직(확대 지도 + 정확 점 배치)", () => {
  it("박스 종횡비에 맞춰 확장(왜곡 방지) + 점들 포함", () => {
    const items = [{ lat: 37.58, lon: 126.98 }, { lat: 35.16, lon: 129.07 }];
    const box = zoomMapBox(items, 2); // 너비/높이 = 2
    expect(box.w / box.h).toBeCloseTo(2, 5);
    // 두 점 모두 박스 내부
    for (const it of items) {
      const p = projectInBox(it.lat, it.lon, box);
      expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(100);
      expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(100);
    }
  });
  it("projectInBox 는 buildWorldSvg 와 동일 좌표(경도→x, 위도→y 반전)", () => {
    const box = { x: 300, y: 50, w: 20, h: 20 }; // lon 120~140, lat 20~40
    expect(projectInBox(40, 120, box)).toEqual({ x: 0, y: 0 }); // 좌상(서·북)
    expect(projectInBox(20, 140, box)).toEqual({ x: 100, y: 100 }); // 우하(동·남)
  });
  it("niceGridStep — 폭에 어울리는 1·2·5·10 계열 간격", () => {
    expect(niceGridStep(4)).toBe(1); // 4/4=1
    expect(niceGridStep(40)).toBe(10);
    expect(niceGridStep(12)).toBe(5); // 12/4=3 → 5
  });
});

describe("buildWorldSvg — 전체/확대(viewBox 크롭) 공통 렌더", () => {
  it("기본값 = 전체 지도 viewBox(0 0 360 180) + 대륙 path", () => {
    const svg = buildWorldSvg();
    expect(svg).toContain('viewBox="0 0 360 180"');
    expect(svg).toContain("<path d="); // 실측 대륙 윤곽
    expect(svg).toContain("<line"); // 기본 그리드 존재
  });
  it("box 주면 그 영역으로 크롭(viewBox·배경 rect 일치)", () => {
    const svg = buildWorldSvg({ x: 300, y: 50, w: 20, h: 20 });
    expect(svg).toContain('viewBox="300 50 20 20"');
    expect(svg).toContain('<rect x="300" y="50" width="20" height="20"');
  });
  it("step≤0 → 그리드 생략(확대창)", () => {
    expect(buildWorldSvg({ x: 300, y: 50, w: 20, h: 20 }, 0)).not.toContain("<line");
    expect(buildWorldSvg({ x: 300, y: 50, w: 20, h: 20 }, 5)).toContain("<line"); // step>0 면 존재
  });
  it("landStroke 인자 → 대륙 윤곽 stroke-width 반영", () => {
    expect(buildWorldSvg({ x: 300, y: 50, w: 20, h: 20 }, 0, 0.05)).toContain('stroke-width="0.05"');
  });
  it("크롭 viewBox 안의 그리드선만 생성(범위 밖 미포함)", () => {
    // box lon 120~140(x 300~320), lat 20~40(y 50~70), step 10 → 세로선 x=300,310,320 / 가로선 y=50,60,70
    const svg = buildWorldSvg({ x: 300, y: 50, w: 20, h: 20 }, 10);
    expect(svg).toContain('x1="310"'); // 범위 내
    expect(svg).not.toContain('x1="330"'); // 범위 밖
  });
});

describe("clusterDots / zoomMapBox — 엣지 케이스", () => {
  it("빈 배열 → 빈 결과", () => {
    expect(clusterDots([], 2.6)).toEqual([]);
  });
  it("단일 점 → 멤버 1개 그룹, 대표=그 점", () => {
    const g = clusterDots([{ id: "a", x: 30, y: 40 }], 2.6);
    expect(g).toHaveLength(1);
    expect(g[0].members).toHaveLength(1);
    expect(g[0]).toMatchObject({ x: 30, y: 40 });
  });
  it("대표 위치 = 멤버 x·y 평균(양 축)", () => {
    const g = clusterDots([{ id: "a", x: 10, y: 20 }, { id: "b", x: 12, y: 26 }], 5);
    expect(g[0].x).toBeCloseTo(11, 6);
    expect(g[0].y).toBeCloseTo(23, 6);
  });
  it("zoomMapBox 단일 점 → minSpan 으로 적당히 확대(폭/높이>0, 종횡비 일치)", () => {
    const box = zoomMapBox([{ lat: 35, lon: 129 }], 1.5, 0.5, 1.2);
    expect(box.w).toBeGreaterThan(0);
    expect(box.w / box.h).toBeCloseTo(1.5, 5);
    // 점이 박스 중앙 부근
    const p = projectInBox(35, 129, box);
    expect(p.x).toBeCloseTo(50, 1); expect(p.y).toBeCloseTo(50, 1);
  });
  it("세로로 긴 군집도 박스 종횡비에 맞춰 가로 확장(점은 내부)", () => {
    const items = [{ lat: 30, lon: 100 }, { lat: 40, lon: 100.5 }]; // 위도 폭≫경도 폭
    const box = zoomMapBox(items, 2);
    expect(box.w / box.h).toBeCloseTo(2, 5);
    for (const it of items) { const p = projectInBox(it.lat, it.lon, box); expect(p.x).toBeGreaterThan(2); expect(p.x).toBeLessThan(98); }
  });
});

// ── 확대창 최소 간격 ──
// 한 셀에 두 도시를 담게 된 뒤(오사카+나라 34/135) 간사이 3도시가 지도상 0.36° 안에 모였고,
// 확대창에서 점 간격이 40px 남짓이 되어 **클릭이 서로 가로막혔다**(e2e 실측: 나라 점이 오사카를 인터셉트).
// minSpan 하한만 있으면 가까울수록 더 뭉치는 역설이 생긴다 — 실제 간격이 좁으면 더 당겨야 한다.
describe("zoomMapBox — 최근접 쌍이 화면에서 겹치지 않는다", () => {
  const KANSAI = [
    { lat: 34.6937, lon: 135.5015 }, // 오사카
    { lat: 35.0116, lon: 135.7681 }, // 교토
    { lat: 34.6845, lon: 135.86 },   //  나라
  ];
  const sepPct = (a: { lat: number; lon: number }, b: { lat: number; lon: number }, box: { x: number; y: number; w: number; h: number }) => {
    const pa = projectInBox(a.lat, a.lon, box), pb = projectInBox(b.lat, b.lon, box);
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  };

  it("간사이 3도시가 확대창에서 13% 이상 떨어진다", () => {
    const box = zoomMapBox(KANSAI, 300 / 220);
    for (let i = 0; i < KANSAI.length; i++) for (let j = i + 1; j < KANSAI.length; j++) {
      expect(sepPct(KANSAI[i], KANSAI[j], box)).toBeGreaterThan(13);
    }
  });

  it("아주 가까운 두 도시도 벌어진다 — 가까울수록 더 당긴다", () => {
    const near = [{ lat: 34.68, lon: 135.80 }, { lat: 34.69, lon: 135.81 }];
    const box = zoomMapBox(near, 300 / 220);
    expect(sepPct(near[0], near[1], box)).toBeGreaterThan(13);
    expect(box.w).toBeLessThan(0.5); // 실제 범위(0.01°)에 맞춰 크게 당겨졌다
  });

  it("점이 하나면 최소 범위를 유지한다 — 무한 확대 방지", () => {
    const box = zoomMapBox([{ lat: 34.68, lon: 135.80 }], 300 / 220);
    expect(box.w).toBeGreaterThan(1);
  });

  it("멀리 떨어진 쌍은 종전대로 범위 기준 — 서울·부산", () => {
    const box = zoomMapBox([{ lat: 37.5796, lon: 126.977 }, { lat: 35.1379, lon: 129.0756 }], 300 / 220);
    expect(box.w).toBeGreaterThan(4); // 실제 범위(2.44°)+패딩이 지배
    expect(sepPct({ lat: 37.5796, lon: 126.977 }, { lat: 35.1379, lon: 129.0756 }, box)).toBeGreaterThan(13);
  });

  it("모든 점이 확대 박스 안에 들어온다", () => {
    const box = zoomMapBox(KANSAI, 300 / 220);
    for (const c of KANSAI) {
      const p = projectInBox(c.lat, c.lon, box);
      expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(100);
      expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(100);
    }
  });
});
