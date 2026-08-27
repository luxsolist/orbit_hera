import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { projFns, buildingHeight, buildingHeightInfo, interpolateBuildingHeights, roadWidth, ringArea, wallSpec, areaKind, relationRings, relationPolys, dedupeConsecutive, isSelfIntersecting, convexHull, sanitizeRing, sanitizePolyline, smoothPolyline, isVehicularHighway, mergeStrokes, isUndergroundWaterway, surfaceWaterways } from "../scripts/osm.mjs";

describe("osm.projFns", () => {
  it("maps the origin to (0,0)", () => {
    const p = projFns(37.578, 126.977);
    const [x, z] = p(37.578, 126.977);
    expect(x).toBe(0);
    expect(Math.abs(z)).toBe(0); // -0 도 허용
  });

  it("north is -Z and east is +X", () => {
    const p = projFns(37.578, 126.977);
    const [, zNorth] = p(37.579, 126.977); // 더 북쪽
    const [xEast] = p(37.578, 126.978); // 더 동쪽
    expect(zNorth).toBeLessThan(0);
    expect(xEast).toBeGreaterThan(0);
  });

  it("~1 lat degree ≈ 111320m (cm 반올림)", () => {
    const p = projFns(0, 0);
    const [, z] = p(-1, 0); // 남쪽 1도 → +Z
    expect(z).toBeCloseTo(111320, 0);
  });
});

describe("osm.buildingHeight", () => {
  it("prefers explicit height, stripping units", () => {
    expect(buildingHeight({ height: "12.5 m" })).toBe(12.5);
    expect(buildingHeight({ height: "30" })).toBe(30);
  });
  it("derives from levels (min 3m floor, 3.3m/level)", () => {
    expect(buildingHeight({ "building:levels": "10" })).toBe(33);
    expect(buildingHeight({ "building:levels": "0.5" })).toBe(3); // 최소 3
  });
  it("falls back to type defaults, else 9", () => {
    expect(buildingHeight({ building: "hut" })).toBe(3);
    expect(buildingHeight({ building: "palace" })).toBe(7);
    expect(buildingHeight({ building: "house" })).toBe(6);
    expect(buildingHeight({ building: "yes" })).toBe(9);
    expect(buildingHeight({})).toBe(9);
  });
  it("비현실/가비지 높이 태그는 무시하고 폴백(바늘 건물 방지)", () => {
    // OSM 가비지 levels="12345678910111212" → 4e16m 바늘 건물이었던 케이스
    expect(buildingHeight({ building: "yes", "building:levels": "12345678910111212" })).toBe(9);
    expect(buildingHeight({ building: "yes", height: "7599" })).toBe(9); // 7599m > 830 → 폴백
    expect(buildingHeight({ building: "yes", "building:levels": "300" })).toBe(9); // 300층(가비지) → 폴백
    // 실존 초고층은 보존
    expect(buildingHeight({ height: "555" })).toBe(555); // 롯데월드타워
    expect(buildingHeight({ height: "828" })).toBe(828); // 부르즈 할리파(상한)
    expect(buildingHeight({ "building:levels": "100" })).toBe(330); // 100층 보존
  });
  it("첫 수치 토큰만(구분기호/범위/세미콜론 안전 — 자리 이어붙임 방지)", () => {
    expect(buildingHeight({ height: "12;15" })).toBe(12); // 이전엔 "1215" 로 이어붙던 버그
    expect(buildingHeight({ height: "30-40" })).toBe(30);
  });
});

describe("osm.buildingHeightInfo — 추정(estimated) 구분", () => {
  it("실측(height/levels)·명시 타입은 estimated=false, 일반 폴백(9m)만 true", () => {
    expect(buildingHeightInfo({ height: "30" })).toEqual({ h: 30, estimated: false });
    expect(buildingHeightInfo({ "building:levels": "10" })).toEqual({ h: 33, estimated: false });
    expect(buildingHeightInfo({ building: "house" })).toEqual({ h: 6, estimated: false });
    expect(buildingHeightInfo({ building: "palace" })).toEqual({ h: 7, estimated: false });
    expect(buildingHeightInfo({ building: "yes" })).toEqual({ h: 9, estimated: true }); // 미상 → 보간 대상
    expect(buildingHeightInfo({ building: "yes", "building:levels": "12345678910111212" })).toEqual({ h: 9, estimated: true }); // 가비지 → 미상
  });
});

describe("osm.interpolateBuildingHeights — 미상 건물을 주변 실측 중앙값으로", () => {
  const sq = (x: number, z: number) => [x, z, x + 8, z, x + 8, z + 8, x, z + 8];
  it("반경 내 seed 중앙값으로 대체(이상치 강인), 외딴 미상은 기본값 유지", () => {
    const B = [
      { p: sq(0, 0), h: 30 }, { p: sq(60, 0), h: 40 }, { p: sq(0, 60), h: 50 }, // seed(실측)
      { p: sq(30, 30), h: 9 },      // 미상, 중앙 — seed 3개 반경내 → 중앙값 40
      { p: sq(9000, 9000), h: 9 },  // 미상, 외딴 — seed 없음 → 9 유지
    ];
    const est = [false, false, false, true, true];
    interpolateBuildingHeights(B, est, { radius: 220, minNeighbors: 3 });
    expect(B[3].h).toBe(40); // median(30,40,50)
    expect(B[4].h).toBe(9);
    expect(B[0].h).toBe(30); // seed 불변
  });
  it("미상끼리는 서로 seed 가 되지 않음(전파 드리프트 방지)", () => {
    const B = [{ p: sq(0, 0), h: 9 }, { p: sq(30, 0), h: 9 }, { p: sq(60, 0), h: 9 }];
    interpolateBuildingHeights(B, [true, true, true], { radius: 220, minNeighbors: 1 });
    expect(B.map((b) => b.h)).toEqual([9, 9, 9]); // seed 없음 → 전부 유지
  });
});

describe("osm.roadWidth", () => {
  it("maps known highway classes incl. 보행로, defaults to 6", () => {
    expect(roadWidth("primary")).toBe(28);
    expect(roadWidth("residential")).toBe(7);
    expect(roadWidth("footway")).toBe(2.2); // 보도(좁음)
    expect(roadWidth("steps")).toBe(2.4); // 계단
    expect(roadWidth("service")).toBe(4); // 이면도로
    expect(roadWidth("unknownclass")).toBe(6); // 미지정 기본
  });
});

describe("osm.wallSpec — barrier → 담장 사양", () => {
  it("담장/성곽/옹벽/울타리/생울타리는 {h,w} 반환", () => {
    expect(wallSpec({ barrier: "wall" })).toEqual({ h: 2.5, w: 0.4 });
    expect(wallSpec({ barrier: "city_wall" }).h).toBeGreaterThan(wallSpec({ barrier: "wall" }).h);
    expect(wallSpec({ barrier: "fence" }).w).toBeLessThan(0.2);
  });
  it("height 태그가 있으면 우선", () => {
    expect(wallSpec({ barrier: "wall", height: "4.5 m" }).h).toBe(4.5);
  });
  it("벽이 아닌 barrier(연석·볼라드·문)는 null", () => {
    expect(wallSpec({ barrier: "kerb" })).toBeNull();
    expect(wallSpec({ barrier: "bollard" })).toBeNull();
    expect(wallSpec({})).toBeNull();
  });
});

describe("osm.areaKind — 면 태그 → 지표 면 종류", () => {
  it("자연/녹지/공원/주차장 분류", () => {
    expect(areaKind({ natural: "wood" })).toBe("wood");
    expect(areaKind({ natural: "rock" })).toBe("rock");
    expect(areaKind({ leisure: "garden" })).toBe("garden");
    expect(areaKind({ leisure: "park" })).toBe("park");
    expect(areaKind({ landuse: "grass" })).toBe("grass");
    expect(areaKind({ amenity: "parking" })).toBe("pavement");
  });
  it("용도지역(commercial/residential 등)·미지정은 null", () => {
    expect(areaKind({ landuse: "commercial" })).toBeNull();
    expect(areaKind({ building: "yes" })).toBeNull();
    expect(areaKind({})).toBeNull();
  });
});

describe("osm.relationRings — 멀티폴리곤 outer 추출(inner 무시)", () => {
  const proj = projFns(0, 0);
  it("outer 멤버만 폴리곤으로, inner/노드 제외", () => {
    const el = {
      type: "relation",
      members: [
        { type: "way", role: "outer", geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, { lat: 0.001, lon: 0.001 }, { lat: 0, lon: 0 }] },
        { type: "way", role: "inner", geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.0005 }, { lat: 0.0005, lon: 0 }] },
        { type: "node", role: "admin_centre" },
      ],
    };
    const rings = relationRings(el, proj);
    expect(rings).toHaveLength(1); // outer 만
    expect(rings[0].length).toBeGreaterThanOrEqual(6);
  });
});

describe("osm.relationPolys — 멀티폴리곤 outer+구멍(inner) 보존", () => {
  const proj = projFns(0, 0);
  it("outer 1개 + 그 안의 inner = 구멍으로 귀속(섬·제방=육지 도려냄)", () => {
    const el = {
      type: "relation",
      members: [
        // 큰 사각 outer(약 1.1km²)
        { type: "way", role: "outer", geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }, { lat: 0.01, lon: 0.01 }, { lat: 0.01, lon: 0 }, { lat: 0, lon: 0 }] },
        // 내부 작은 사각 inner(구멍)
        { type: "way", role: "inner", geometry: [{ lat: 0.003, lon: 0.003 }, { lat: 0.003, lon: 0.006 }, { lat: 0.006, lon: 0.006 }, { lat: 0.006, lon: 0.003 }, { lat: 0.003, lon: 0.003 }] },
        { type: "node", role: "label" },
      ],
    };
    const polys = relationPolys(el, proj);
    expect(polys).toHaveLength(1);
    expect(polys[0].outer.length).toBeGreaterThanOrEqual(8);
    expect(polys[0].holes).toHaveLength(1); // inner = 구멍
    expect(ringArea(polys[0].holes[0])).toBeGreaterThan(0);
    expect(ringArea(polys[0].outer)).toBeGreaterThan(ringArea(polys[0].holes[0])); // 구멍 < outer
  });
  it("쪼개진 outer way 들을 끝점으로 봉합해 닫힌 링 1개로", () => {
    const el = {
      type: "relation",
      members: [
        { type: "way", role: "outer", geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }] },
        { type: "way", role: "outer", geometry: [{ lat: 0, lon: 0.01 }, { lat: 0.01, lon: 0.01 }, { lat: 0.01, lon: 0 }] },
        { type: "way", role: "outer", geometry: [{ lat: 0.01, lon: 0 }, { lat: 0, lon: 0 }] },
      ],
    };
    const polys = relationPolys(el, proj);
    expect(polys).toHaveLength(1); // 3 조각 → 닫힌 링 1개(거대 가짜 사각형 아님)
    expect(ringArea(polys[0].outer)).toBeGreaterThan(0);
  });
});

describe("osm.ringArea", () => {
  it("computes polygon area regardless of winding", () => {
    const cw = [0, 0, 4, 0, 4, 3, 0, 3]; // 4×3 = 12
    const ccw = [0, 0, 0, 3, 4, 3, 4, 0];
    expect(ringArea(cw)).toBeCloseTo(12);
    expect(ringArea(ccw)).toBeCloseTo(12);
  });
});

describe("osm — 폴리곤 정리(수집 시점 dedupe/hull/selfx)", () => {
  it("dedupeConsecutive — 연속 중복 제거(+ring 닫힘 반복)", () => {
    expect(dedupeConsecutive([0, 0, 0, 0, 10, 0, 10, 10])).toEqual([0, 0, 10, 0, 10, 10]);
    expect(dedupeConsecutive([0, 0, 10, 0, 10, 10, 0, 0], 0.05, true)).toEqual([0, 0, 10, 0, 10, 10]); // 닫힘 반복 제거
  });
  it("isSelfIntersecting — bowtie/단순", () => {
    expect(isSelfIntersecting([0, 0, 10, 0, 0, 10, 10, 10])).toBe(true);
    expect(isSelfIntersecting([0, 0, 10, 0, 10, 10, 0, 10])).toBe(false);
  });
  it("convexHull — 단순 폴리곤(자기교차 아님) 반환, 일직선은 null", () => {
    const h = convexHull([0, 0, 10, 0, 0, 10, 10, 10]); // bowtie → 4모서리 사각형 hull
    expect(h.length / 2).toBeGreaterThanOrEqual(3);
    expect(isSelfIntersecting(h)).toBe(false);
    expect(ringArea(h)).toBeCloseTo(100);
    expect(convexHull([0, 0, 1, 0, 2, 0])).toBeNull(); // 일직선
  });
  it("sanitizeRing — 건물(hull 복구) vs 면(드롭)", () => {
    const bowtie = [0, 0, 10, 0, 0, 10, 10, 10];
    const repaired = sanitizeRing(bowtie, true);
    expect(repaired).not.toBeNull();
    expect(isSelfIntersecting(repaired)).toBe(false); // 복구됨
    expect(sanitizeRing(bowtie, false)).toBeNull(); // 면은 드롭
    expect(sanitizeRing([0, 0, 1, 0], true)).toBeNull(); // 점<3
    const ok = sanitizeRing([0, 0, 10, 0, 10, 10, 0, 10], false); // 정상 사각형 유지
    expect(ok.length / 2).toBe(4);
  });
  it("sanitizePolyline — 영길이 세그먼트 제거, 점<2 는 null", () => {
    expect(sanitizePolyline([0, 0, 0, 0, 10, 0])).toEqual([0, 0, 10, 0]);
    expect(sanitizePolyline([5, 5, 5, 5])).toBeNull();
  });
});

describe("osm.smoothPolyline — 도로 곡선 스무딩(Chaikin)", () => {
  it("끝점 고정 + 내부 모서리 커팅으로 점 증가", () => {
    const s = smoothPolyline([0, 0, 10, 0, 10, 10], 2);
    expect(s.length / 2).toBeGreaterThan(3); // 조밀화
    expect(s.slice(0, 2)).toEqual([0, 0]); // 첫점 고정
    expect(s.slice(-2)).toEqual([10, 10]); // 끝점 고정
  });
  it("직선(2점)은 그대로", () => {
    expect(smoothPolyline([0, 0, 5, 5], 2)).toEqual([0, 0, 5, 5]);
  });
  it("코너가 둥글려져 원래 꼭짓점에서 멀어짐(부드러움)", () => {
    const s = smoothPolyline([0, 0, 10, 0, 10, 10], 1); // 1회: 모서리 (10,0) 주변 2점으로 대체
    // 결과에 정확한 (10,0) 꼭짓점이 남지 않음(커팅됨)
    let hasCorner = false;
    for (let i = 0; i < s.length; i += 2) if (s[i] === 10 && s[i + 1] === 0) hasCorner = true;
    expect(hasCorner).toBe(false);
  });
});

describe("osm.isVehicularHighway — 차도/보행로 구분(보도 수집 제외)", () => {
  it("차도는 true", () => {
    for (const hw of ["motorway", "primary", "residential", "service", "unclassified", "living_street"]) expect(isVehicularHighway(hw)).toBe(true);
  });
  it("보행로/오솔길/계단/자전거도로/보행자전용은 false(수집 제외)", () => {
    for (const hw of ["footway", "path", "steps", "cycleway", "pedestrian", "bridleway", "corridor", "track"]) expect(isVehicularHighway(hw)).toBe(false);
  });
});

describe("osm.mergeStrokes — 연결 같은-폭 도로 직선 병합(교차로 관통 연속화)", () => {
  it("일직선 연결(같은 폭) → 하나로 병합", () => {
    const m = mergeStrokes([{ p: [0, 0, 10, 0], w: 16 }, { p: [10, 0, 20, 0], w: 16 }]);
    expect(m).toHaveLength(1);
    expect(m[0].p.length / 2).toBe(3); // 0,0 / 10,0 / 20,0
  });
  it("급굴절(90°)은 병합 안 함", () => {
    const m = mergeStrokes([{ p: [0, 0, 10, 0], w: 16 }, { p: [10, 0, 10, 10], w: 16 }]);
    expect(m).toHaveLength(2);
  });
  it("폭이 다르면 병합 안 함", () => {
    const m = mergeStrokes([{ p: [0, 0, 10, 0], w: 16 }, { p: [10, 0, 20, 0], w: 7 }]);
    expect(m).toHaveLength(2);
  });
});

describe("osm.isUndergroundWaterway — 복개/지하 하천 판별(수집 제외)", () => {
  it("tunnel·layer<0·covered 는 지하(true)", () => {
    expect(isUndergroundWaterway({ tunnel: "culvert" })).toBe(true);
    expect(isUndergroundWaterway({ layer: "-1" })).toBe(true);
    expect(isUndergroundWaterway({ covered: "yes" })).toBe(true);
  });
  it("지표 하천은 false", () => {
    expect(isUndergroundWaterway({ waterway: "stream" })).toBe(false);
    expect(isUndergroundWaterway({ layer: "0" })).toBe(false);
  });
});

describe("osm.surfaceWaterways — 지표 노출 하천만(복개 수계 태그누락 보정)", () => {
  it("하천계에 복개 구간이 있으면 전체 제외(태그 누락 지표 구간 포함)", () => {
    const segs = [
      { p: [0, 0, 10, 0], culverted: false, stream: true },  // 지표(태그 누락)
      { p: [10, 0, 20, 0], culverted: true, stream: true },  // 복개
      { p: [20, 0, 30, 0], culverted: false, stream: true },  // 지표(태그 누락)
    ];
    expect(surfaceWaterways(segs)).toHaveLength(0);
  });
  it("복개 없는 순수 지표 하천은 유지", () => {
    const surf = [{ p: [0, 0, 10, 0], culverted: false, stream: true }, { p: [10, 0, 20, 0], culverted: false, stream: true }];
    expect(surfaceWaterways(surf)).toHaveLength(2);
  });
  it("강(stream 아님)은 복개 구간만 제외, 지표부 유지", () => {
    const river = [{ p: [0, 0, 10, 0], culverted: false, stream: false }, { p: [10, 0, 20, 0], culverted: true, stream: false }];
    expect(surfaceWaterways(river)).toHaveLength(1);
  });
});
