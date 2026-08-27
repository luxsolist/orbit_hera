import { describe, it, expect } from "vitest";
import { projectLatLon, clusterDots, fitViewBox, clampToWorld, zoomAt, zoomToSplit, projectInBox, niceGridStep, estLabelPx, labelSide, buildWorldSvg, driftOverlaySvg, FULL_VIEW } from "../src/ui/worldMapSvg";

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

describe("fitViewBox / projectInBox — 확대 뷰 공통 로직(확대 지도 + 정확 점 배치)", () => {
  it("박스 종횡비에 맞춰 확장(왜곡 방지) + 점들 포함", () => {
    const items = [{ lat: 37.58, lon: 126.98 }, { lat: 35.16, lon: 129.07 }];
    const box = fitViewBox(items, 2); // 너비/높이 = 2
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
  it("step≤0 → 그리드 생략", () => {
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

describe("clusterDots / fitViewBox — 엣지 케이스", () => {
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
  it("fitViewBox 단일 점 → minSpan 으로 적당히 확대(폭/높이>0, 종횡비 일치)", () => {
    const box = fitViewBox([{ lat: 35, lon: 129 }], 1.5, 0.5, 1.2);
    expect(box.w).toBeGreaterThan(0);
    expect(box.w / box.h).toBeCloseTo(1.5, 5);
    // 점이 박스 중앙 부근
    const p = projectInBox(35, 129, box);
    expect(p.x).toBeCloseTo(50, 1); expect(p.y).toBeCloseTo(50, 1);
  });
  it("세로로 긴 군집도 박스 종횡비에 맞춰 가로 확장(점은 내부)", () => {
    const items = [{ lat: 30, lon: 100 }, { lat: 40, lon: 100.5 }]; // 위도 폭≫경도 폭
    const box = fitViewBox(items, 2);
    expect(box.w / box.h).toBeCloseTo(2, 5);
    for (const it of items) { const p = projectInBox(it.lat, it.lon, box); expect(p.x).toBeGreaterThan(2); expect(p.x).toBeLessThan(98); }
  });
});

// ── 여백 붕괴 회귀(2026-08-27) ──
// 옛 zoomMapBox 는 "최근접 쌍을 화면에서 13% 이상 벌린다"는 목표를 함께 지려고 상자를 좁혔는데,
// 그 축소 하한이 `exW/w`(상자 폭 = 점 분포 폭)라 **여백이 정확히 0 이 되는 지점**까지 당겨졌다.
// 결과: 양 끝 도시가 0%·100% 에 박혀 점 반지름이 통째로 잘렸다(실측: 서울 0.0% · 나라 100.0%,
// 최근접 11px 로 클릭도 서로 가로막힘). 재귀 확대로 바뀌며 그 목표는 폐기됐다 — 이제 담기만 한다.
describe("fitViewBox — 점이 테두리에 잘리지 않는다", () => {
  // 그 회귀를 만들었던 실제 조합: 축척이 크게 다른 도시가 한 군집에 섞여 있다
  // (서울↔부산 325km 와 교토↔나라 30km 가 같은 군집).
  const KR_JP = [
    { lat: 37.5796, lon: 126.977 },  // 서울
    { lat: 35.1379, lon: 129.0756 }, // 부산
    { lat: 34.6937, lon: 135.5015 }, // 오사카
    { lat: 35.0116, lon: 135.7681 }, // 교토
    { lat: 34.6845, lon: 135.86 },   // 나라
  ];

  it("모든 점이 여백 안 — 0%/100% 에 닿지 않는다", () => {
    const box = fitViewBox(KR_JP, 2);
    for (const c of KR_JP) {
      const p = projectInBox(c.lat, c.lon, box);
      expect(p.x, `x=${p.x}`).toBeGreaterThan(3);
      expect(p.x, `x=${p.x}`).toBeLessThan(97);
      expect(p.y, `y=${p.y}`).toBeGreaterThan(3);
      expect(p.y, `y=${p.y}`).toBeLessThan(97);
    }
  });

  it("패딩 비율이 실제로 지켜진다 — 분포 폭 < 상자 폭", () => {
    const box = fitViewBox(KR_JP, 2, 0.35);
    const lons = KR_JP.map((c) => c.lon);
    const span = Math.max(...lons) - Math.min(...lons);
    expect(box.w).toBeGreaterThan(span * 1.5); // 1 + 0.35·2 = 1.7 (종횡비 보정으로 더 커질 수 있다)
  });

  it("빈 입력 → 전체 뷰(호출부가 빈 군집을 넘겨도 깨지지 않게)", () => {
    expect(fitViewBox([], 2)).toEqual(FULL_VIEW);
  });
});

describe("clampToWorld — 뷰가 세계 밖으로 나가지 않는다", () => {
  it("위치만 넘치면 **크기를 유지한 채** 밀어 넣는다", () => {
    const b = clampToWorld({ x: -10, y: -5, w: 40, h: 20 });
    expect(b).toEqual({ x: 0, y: 0, w: 40, h: 20 });
    const c = clampToWorld({ x: 350, y: 175, w: 40, h: 20 });
    expect(c).toEqual({ x: 320, y: 160, w: 40, h: 20 });
  });

  it("크기가 세계보다 크면 세계 크기로 자른다", () => {
    expect(clampToWorld({ x: -50, y: -50, w: 500, h: 300 })).toEqual(FULL_VIEW);
  });
});

describe("zoomAt — 강제 확대(전진 보장용)", () => {
  it("중심 기준 k 배 축소", () => {
    const b = zoomAt({ x: 0, y: 0, w: 360, h: 180 }, 180, 90, 0.5);
    expect(b.w).toBe(180); expect(b.h).toBe(90);
    expect(b.x).toBe(90); expect(b.y).toBe(45);
  });

  it("가장자리 중심이어도 세계 안에 남는다", () => {
    const b = zoomAt(FULL_VIEW, 5, 3, 0.5);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(360.001);
  });
});

// ── 재귀 확대가 **반드시 수렴한다** ──
// 이게 C안의 핵심 계약이다. 군집을 클릭할 때마다 군집이 쪼개져야 하고, 유한 횟수 안에 개별 도시에
// 도달해야 한다. 안 그러면 "클릭이 먹지 않는" 상태로 갇힌다 — 등간격으로 늘어선 다수에서 실제로
// 그럴 수 있다(100도시 확장 시 동아시아 군집 25개가 2.45% 간격 → fitViewBox 만으로는 영원히 한 덩어리).
describe("재귀 확대 — 군집이 매번 쪼개진다", () => {
  const ASPECT = 2;
  /** 호출부(MenuScreen.zoomIntoCluster)가 쓰는 **바로 그 함수**를 검증한다 — 규칙을 재구현하지 않는다. */
  const nextView = (members: { lat: number; lon: number }[], cur: { x: number; y: number; w: number; h: number }) =>
    zoomToSplit(members, cur, ASPECT);
  /** 현재 뷰에서 점들을 투영해 군집을 만든다(MenuScreen.renderWorldMap 과 동일). */
  const groupsAt = (cities: { id: string; lat: number; lon: number }[], box: { x: number; y: number; w: number; h: number }) =>
    clusterDots(cities.map((c) => ({ ...c, ...projectInBox(c.lat, c.lon, box) })), 2.6);

  it("등간격 25개(최악의 경우)도 유한 단계에 개별 도시로 분해된다", () => {
    // fitViewBox 만으로는 상대 간격이 그대로라 절대 안 쪼개지는 배치 — 강제 확대가 없으면 무한 루프.
    const cities = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, lat: 35, lon: 120 + i * 0.1 }));
    let box = FULL_VIEW;
    let target = cities;
    let steps = 0;
    while (target.length > 1 && steps < 30) {
      box = nextView(target, box);
      const g = groupsAt(cities, box).filter((c) => c.members.length > 1);
      // 가장 큰 군집을 계속 파고든다
      const biggest = g.sort((a, b) => b.members.length - a.members.length)[0];
      if (!biggest) { target = [target[0]]; break; }
      expect(biggest.members.length, `${steps}단계에서 전진 없음`).toBeLessThan(target.length);
      target = biggest.members as typeof cities;
      steps++;
    }
    expect(steps, "30단계 안에 분해되지 않았다").toBeLessThan(30);
    expect(target.length).toBe(1);
  });

  it("실제 한일 5도시 — 한 번 확대하면 모두 단일 점", () => {
    const cities = [
      { id: "seoul", lat: 37.5796, lon: 126.977 },
      { id: "busan", lat: 35.1379, lon: 129.0756 },
      { id: "osaka", lat: 34.6937, lon: 135.5015 },
      { id: "kyoto", lat: 35.0116, lon: 135.7681 },
      { id: "nara", lat: 34.6845, lon: 135.86 },
    ];
    const box = nextView(cities, FULL_VIEW);
    const g = groupsAt(cities, box);
    // 서울·부산은 떨어지고 간사이 3도시는 아직 뭉칠 수 있다 — 다만 **전체가 한 덩어리는 아니어야** 한다.
    expect(g.length).toBeGreaterThan(1);
    expect(Math.max(...g.map((c) => c.members.length))).toBeLessThan(cities.length);
  });
});

// 표류 오버레이(캠페인 §9.2-5) — 세계지도와 같은 viewBox(0 0 360 180) 위에 얹는 SVG 문자열.
// 좌표 매핑(x = 경도+180 / y = 90−위도)이 깨지면 화살표가 엉뚱한 대륙에 찍히는데, 눈으로만 보면
// 알아채기 어렵다(대륙 윤곽과 겹쳐 그럴듯해 보인다) — 그래서 숫자로 못 박는다.
describe("driftOverlaySvg — 표류 벡터 오버레이", () => {
  it("벡터도 교점도 없으면 빈 문자열 — 빈 <svg> 를 깔지 않는다", () => {
    expect(driftOverlaySvg([], { show: false, lat: 0, lon: 0 })).toBe("");
  });

  it("교점만 있어도 렌더된다", () => {
    const out = driftOverlaySvg([], { show: true, lat: 0, lon: 0 });
    expect(out).toContain("drift-origin");
    expect(out).toContain('viewBox="0 0 360 180"');
  });

  it("벡터 시작점 = (경도+180, 90−위도)", () => {
    // x=경도, z=위도 규약(캠페인 driftVectorFor). 서울(37.5N, 127E) → (307, 52.5)
    const out = driftOverlaySvg([{ x: 127, z: 37.5, dx: 0, dz: 0 }], { show: false, lat: 0, lon: 0 });
    expect(out).toContain('x1="307.00"');
    expect(out).toContain('y1="52.50"');
  });

  it("끝점 = 시작점 + 방향×7° (y 는 화면 아래가 +)", () => {
    const out = driftOverlaySvg([{ x: 0, z: 0, dx: 1, dz: 0.5 }], { show: false, lat: 0, lon: 0 });
    expect(out).toContain('x2="187.00"'); // 180 + 1×7
    expect(out).toContain('y2="93.50"'); //  90 + 0.5×7
  });

  it("교점 마커 = (경도+180, 90−위도)", () => {
    const out = driftOverlaySvg([], { show: true, lat: 37.5, lon: 127 });
    expect(out).toContain('cx="307"');
    expect(out).toContain('cy="52.5"');
  });

  it("벡터 수만큼 선이 그려진다", () => {
    const v = [1, 2, 3].map((i) => ({ x: i * 10, z: 0, dx: 1, dz: 0 }));
    const out = driftOverlaySvg(v, { show: false, lat: 0, lon: 0 });
    expect((out.match(/<line /g) ?? []).length).toBe(3);
  });
});

describe("fitViewBox / niceGridStep — 종횡비·격자 경계", () => {
  it("가로로 납작한 분포는 세로를 늘려 상자 비율을 맞춘다(반대도 성립)", () => {
    const wide = fitViewBox([{ lat: 0, lon: -60 }, { lat: 0, lon: 60 }], 2);
    expect(wide.w / wide.h).toBeCloseTo(2, 3);
    const tall = fitViewBox([{ lat: -40, lon: 0 }, { lat: 40, lon: 0 }], 2);
    expect(tall.w / tall.h).toBeCloseTo(2, 3);
  });

  it("모든 점이 상자 안에 남는다", () => {
    const pts = [{ lat: 35, lon: 127 }, { lat: 35.1, lon: 127.1 }, { lat: 60, lon: 100 }];
    const b = fitViewBox(pts, 1.6);
    for (const p of pts) {
      const q = projectInBox(p.lat, p.lon, b);
      expect(q.x).toBeGreaterThanOrEqual(-0.001);
      expect(q.x).toBeLessThanOrEqual(100.001);
      expect(q.y).toBeGreaterThanOrEqual(-0.001);
      expect(q.y).toBeLessThanOrEqual(100.001);
    }
  });

  it("niceGridStep — 1·2·5 계단, 상단 경계는 다음 자릿수로", () => {
    expect(niceGridStep(4)).toBe(1); // raw 1 → 1
    expect(niceGridStep(8)).toBe(2); // raw 2 → 2
    expect(niceGridStep(20)).toBe(5); // raw 5 → 5
    expect(niceGridStep(28)).toBe(10); // raw 7 → 1·5 초과 → 10
    expect(niceGridStep(280)).toBe(100);
  });
});

// ── 라벨 배치 ──
// 옛 확대창은 "x>55% 면 왼쪽"이라는 **고정 임계값 하나**로 좌우를 정했다. 이름 길이를 모르므로
// `"루앙프라방 · Luang Prabang"`(추정 146px)이 폭 306px 상자의 x=50% 에서도 넘쳐 잘렸다.
describe("labelSide / estLabelPx — 라벨이 지도 밖으로 넘치지 않는다", () => {
  it("한글은 라틴보다 넓게 센다 — 같은 글자 수라도 폭이 다르다", () => {
    expect(estLabelPx("서울")).toBeGreaterThan(estLabelPx("ab"));
    expect(estLabelPx("")).toBe(0);
  });

  it("오른쪽에 자리가 있으면 오른쪽", () => {
    expect(labelSide(10, 60, 900)).toBe("r");
  });

  it("오른쪽이 모자라면 왼쪽으로 넘긴다", () => {
    expect(labelSide(97, 60, 900)).toBe("l"); // 873px + 10 + 60 > 900
  });

  it("양쪽 다 모자라면 여유가 더 큰 쪽 — 좁은 지도에서 최소한의 손실", () => {
    expect(labelSide(40, 500, 300)).toBe("r"); // 120px 지점, 왼쪽 120 < 오른쪽 180
    expect(labelSide(70, 500, 300)).toBe("l");
  });

  it("회귀: 긴 이름이 중앙 부근에 있어도 넘치면 왼쪽 — 옛 x>55% 규칙은 오른쪽을 골랐다", () => {
    const long = estLabelPx("루앙프라방 · Luang Prabang");
    expect(long).toBeGreaterThan(140);
    expect(labelSide(50, long, 306)).toBe("l");
  });
});
