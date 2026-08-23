import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { classifyOsmTags as classifyRuntime, ENTANGLEMENT_CLASSES } from "../src/world/entanglement";
import {
  classifyOsmTags as classifyBuild,
  landmarkFrom,
  osmName,
  matchCuratedBuilding,
  ENTANGLEMENT_CLS,
  LANDMARK_MIN_AREA,
  landmarkMinArea,
  siteRadius,
  polyExtentRadius,
  SITE_R_DEFAULT,
  SITE_R_MAX,
} from "../scripts/osm.mjs";
import { buildChunkMesh } from "../src/world/chunkMesh";
import type { WorldChunk } from "../src/world/chunkManifest";
import { validateChunk } from "../scripts/worldValidate.mjs";
import { BuildingCombat } from "../src/world/BuildingCombat";

// 랜드마크 승격 파이프라인(빌드 → 청크 → 런타임)의 이음매를 고정한다.
// 회귀 이력: 스트리밍 맵에 registerLandmark 호출이 아예 없어 랜드마크가 0개였고(TODO "🚨 긴급 발견"),
// guard/aggro:landmark 미션이 조용히 무의미해졌다. 그 배선의 각 마디를 여기서 잠근다.

// ─────────────────────────── ① 빌드 ↔ 런타임 분류기 동치 ───────────────────────────

// scripts/osm.mjs 는 빌드(.mjs)용 미러, src/world/entanglement.ts 는 런타임 정본이다.
// 둘이 갈라지면 도시마다 다른 택소노미가 구워지므로 태그 표 전수로 묶어 둔다.
const TAG_MATRIX: Record<string, string | undefined>[] = [
  // 추모 — 가장 구체(historic=memorial 은 포괄 deep-roots 보다 먼저 걸려야 함)
  { historic: "memorial" },
  { historic: "monument" },
  { landuse: "cemetery" },
  { amenity: "grave_yard" },
  // 의례
  { amenity: "place_of_worship" },
  { building: "temple" },
  { building: "church" },
  { building: "mosque" },
  // 응축고
  { tourism: "museum" },
  { amenity: "library" },
  { amenity: "archive" },
  // 결맞음
  { place: "square" },
  { leisure: "stadium" },
  { building: "stadium" },
  { amenity: "theatre" },
  // 이음
  { man_made: "tower" },
  { man_made: "communications_tower" },
  { man_made: "lighthouse" },
  { railway: "station" },
  { aeroway: "terminal" },
  { amenity: "ferry_terminal" },
  // 오래 선 자리 — 포괄 폴백
  { historic: "yes" },
  { heritage: "2" },
  { building: "castle" },
  { building: "palace" },
  // 우선순위 충돌 — 구체가 포괄을 이겨야 함
  { historic: "memorial", building: "palace" },
  { amenity: "place_of_worship", historic: "church" },
  { tourism: "museum", heritage: "1" },
  // 미분류
  {},
  { building: "yes" },
  { building: "apartments", "building:levels": "12" },
  { highway: "residential" },
];

describe("얽힘 택소노미 — 빌드(.mjs) ↔ 런타임(.ts) 분류기 동치", () => {
  it("태그 표 전수에서 같은 결과", () => {
    for (const tags of TAG_MATRIX) {
      expect(classifyBuild(tags), `태그 ${JSON.stringify(tags)}`).toBe(classifyRuntime(tags));
    }
  });

  it("유형 집합이 런타임 6종과 일치", () => {
    expect([...ENTANGLEMENT_CLS].sort()).toEqual(Object.keys(ENTANGLEMENT_CLASSES).sort());
  });

  it("분류 결과는 항상 런타임이 아는 유형", () => {
    for (const tags of TAG_MATRIX) {
      const cls = classifyBuild(tags);
      if (cls) expect(ENTANGLEMENT_CLASSES[cls as keyof typeof ENTANGLEMENT_CLASSES]).toBeDefined();
    }
  });
});

// ─────────────────────────── ② 승격 문턱 ───────────────────────────

describe("landmarkFrom — 승격 3조건(분류·이름·면적)", () => {
  const BIG = 10000;

  it("셋 다 만족하면 승격", () => {
    expect(landmarkFrom({ historic: "yes", name: "경복궁" }, BIG)).toEqual({ cls: "deep-roots", n: "경복궁" });
  });

  it("택소노미 미분류(평범한 건물)는 이름·면적이 커도 승격 안 함", () => {
    expect(landmarkFrom({ building: "yes", name: "○○빌딩" }, BIG)).toBeNull();
  });

  it("무명 유적은 승격 안 함 — 이름 없는 historic 창고까지 랜드마크가 되면 표적 문법이 무너진다", () => {
    expect(landmarkFrom({ historic: "yes" }, BIG)).toBeNull();
  });

  it("문턱 미만 면적은 승격 안 함(사당·소품 규모 배제)", () => {
    const t = landmarkMinArea("deep-roots");
    expect(landmarkFrom({ historic: "yes", name: "작은 사당" }, t - 1)).toBeNull();
    expect(landmarkFrom({ historic: "yes", name: "작은 사당" }, t)).not.toBeNull();
  });

  it("유형별 문턱 — 흔한 ritual 은 높게, 드문 memorial/relay 는 낮게", () => {
    // 실측 근거: 단일 문턱 200㎡ 로는 로마 랜드마크의 72.8%(699/960)가 동네 본당 교회였다.
    expect(landmarkMinArea("ritual")).toBeGreaterThan(landmarkMinArea("deep-roots"));
    expect(landmarkMinArea("memorial")).toBeLessThan(landmarkMinArea("deep-roots"));
    expect(landmarkMinArea("relay")).toBeLessThan(landmarkMinArea("deep-roots"));

    const CHURCH = { amenity: "place_of_worship", name: "동네 본당" };
    expect(landmarkFrom(CHURCH, 500)).toBeNull(); //          중형 교회 — 컷
    expect(landmarkFrom(CHURCH, 900)).not.toBeNull(); //      대형 성당 — 승격
    const CENOTAPH = { historic: "memorial", name: "위령비" };
    expect(landmarkFrom(CENOTAPH, 150)).not.toBeNull(); //    같은 크기여도 추모는 승격(태생적으로 작다)
  });

  it("6종 전부 문턱이 정의돼 있다 — 빠지면 그 유형만 조용히 폴백값을 쓴다", () => {
    for (const cls of ENTANGLEMENT_CLS) expect(LANDMARK_MIN_AREA[cls as string], cls as string).toBeGreaterThan(0);
  });

  it("미지 유형은 폴백 문턱 — 유형이 늘어도 승격이 폭주하지 않게", () => {
    expect(landmarkMinArea("bogus")).toBeGreaterThan(0);
  });

  it("표시명은 영문 우선(전 세계 도시 공통 표기)", () => {
    expect(osmName({ name: "경복궁", "name:en": "Gyeongbokgung" })).toBe("Gyeongbokgung");
    expect(osmName({ name: "경복궁" })).toBe("경복궁");
    expect(osmName({ name: "   " })).toBeNull();
    expect(osmName({})).toBeNull();
  });
});

describe("matchCuratedBuilding — 큐레이션 좌표 → 건물 스냅(포함 우선)", () => {
  const B = [
    { p: [0, 0, 10, 0, 10, 10, 0, 10] }, //     A: 중심 (5,5), 100㎡
    { p: [100, 0, 110, 0, 110, 10, 100, 10] }, // B: 중심 (105,5)
  ];

  it("점을 품은 건물을 고른다", () => {
    expect(matchCuratedBuilding(B, 5, 5)).toBe(0);
    expect(matchCuratedBuilding(B, 105, 5)).toBe(1);
  });

  it("품은 건물이 여럿이면 가장 작은 것 — 궁궐 경내가 아니라 그 자리의 전각", () => {
    const nested = [
      { p: [0, 0, 200, 0, 200, 200, 0, 200] }, // 경내 전체(40,000㎡)
      { p: [90, 90, 110, 90, 110, 110, 90, 110] }, // 전각(400㎡)
    ];
    expect(matchCuratedBuilding(nested, 100, 100)).toBe(1);
  });

  it("품은 건물이 없으면 짧은 반경(기본 30m) 최근접으로 폴백", () => {
    expect(matchCuratedBuilding(B, 5, 25)).toBe(0); // 중심에서 20m
    expect(matchCuratedBuilding(B, 5, 60)).toBe(-1); // 55m — 폴백 반경 밖
  });

  it("건물 아닌 랜드마크(광장·공원)는 미매칭 — 옆 건물에 이름을 붙이지 않는다", () => {
    // 실측 회귀: 반경 90m 최근접 방식에서 "Seoul Plaza"가 옆 건물로 스냅됐다.
    expect(matchCuratedBuilding(B, 50, 50)).toBe(-1);
  });

  it("이미 배정된 건물은 건너뜀 — 한 건물이 두 랜드마크 이름을 갖지 않게", () => {
    expect(matchCuratedBuilding(B, 5, 5, 30, new Set([0]))).toBe(-1);
  });
});

// ─────────────────────────── ③ 청크 → 메시 통과 ───────────────────────────

function chunkWith(buildings: WorldChunk["objects"]["buildings"]): WorldChunk {
  return {
    cx: 0, cz: 0,
    terrain: { size: 3, seaLevel: 0, heights: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    objects: { buildings, roads: [], water: [] },
    underground: null,
  };
}

describe("buildChunkMesh — lm/n 통과", () => {
  it("승격 표식이 등록 데이터까지 전달됨", () => {
    const cb = buildChunkMesh(
      chunkWith([
        { p: [0, 0, 20, 0, 20, 20, 0, 20], h: 12, lm: "deep-roots", n: "Gyeongbokgung" },
        { p: [50, 0, 70, 0, 70, 20, 50, 20], h: 9 },
      ]),
      1024, 0, 0
    );
    expect(cb.buildings).toHaveLength(2);
    expect(cb.buildings[0].lm).toBe("deep-roots");
    expect(cb.buildings[0].n).toBe("Gyeongbokgung");
    expect(cb.buildings[1].lm).toBeUndefined(); // 일반 건물엔 필드 자체가 없어야(용량)
    expect("n" in cb.buildings[1]).toBe(false);
  });
});

// ─────────────────────────── ④ 검증 게이트 ───────────────────────────

describe("validateChunk — 랜드마크 불변식", () => {
  const codes = (c: WorldChunk) => validateChunk(c, 1024).map((i: { code: string }) => i.code);

  it("알려진 유형은 통과", () => {
    expect(codes(chunkWith([{ p: [0, 0, 20, 0, 20, 20, 0, 20], h: 12, lm: "ritual", n: "X" }])))
      .not.toContain("landmark-cls");
  });

  it("미지 유형은 error — 런타임 ENTANGLEMENT_CLASSES 조회에서 터지기 전에 빌드가 막는다", () => {
    const issues = validateChunk(chunkWith([{ p: [0, 0, 20, 0, 20, 20, 0, 20], h: 12, lm: "bogus" as never }]), 1024);
    const bad = issues.find((i: { code: string }) => i.code === "landmark-cls");
    expect(bad).toBeDefined();
    expect(bad!.level).toBe("error");
  });

  it("lm 없이 표시명만 있으면 경고(승격 누락 의심)", () => {
    expect(codes(chunkWith([{ p: [0, 0, 20, 0, 20, 20, 0, 20], h: 12, n: "X" } as never])))
      .toContain("landmark-name-orphan");
  });
});

// ─────────────────────────── ⑤ 런타임 등록 ───────────────────────────

function makeMesh(vCount: number): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(vCount * 3), 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(vCount * 3).fill(0.5), 3));
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
}
const SQUARE = [0, 0, 20, 0, 20, 20, 0, 20]; // 400㎡, 중심 (10,10)

describe("BuildingCombat — 병합 메시 기반 랜드마크(OSM 승격)", () => {
  it("승격 건물은 랜드마크로 집계되고 aggro:landmark 표적이 된다", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 20, { cls: "deep-roots", name: "Colosseum" });
    const lm = bc.nearestLandmark(0, 0);
    expect(lm).not.toBeNull();
    expect(lm!.cls).toBe("deep-roots");
    expect(lm!.name).toBe("Colosseum");
    bc.damage(lm!.id, 1e9);
    expect(bc.destroyedLandmarks).toBe(1);
    expect(bc.destroyedBuildings).toBe(0); // 일반 건물 집계로 새지 않음
  });

  it("일반 건물은 랜드마크 질의에 잡히지 않는다", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 20);
    expect(bc.nearestLandmark(0, 0)).toBeNull();
  });

  it("체력 = max(부피 체력, 기본값) × 유형별 해제 저항", () => {
    const bc = new BuildingCombat();
    // 400㎡ × 20m × 0.04 = 320 → 기본값(6000)이 더 큼. ritual resistMul=1.6 → 9600.
    bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 20, { cls: "ritual" });
    const id = bc.nearestLandmark(0, 0)!.id;
    const expected = 6000 * ENTANGLEMENT_CLASSES.ritual.resistMul;
    expect(bc.damage(id, expected - 1)).toBe("hit");
    expect(bc.damage(id, 1)).toBe("destroyed");
  });

  it("같은 자리라도 승격 여부에 따라 id 가 갈린다 — 파괴 이력이 섞이지 않게", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 20, { cls: "archive" });
    const lmId = bc.nearestLandmark(0, 0)!.id;
    expect(lmId.startsWith("l")).toBe(true);

    const bc2 = new BuildingCombat();
    bc2.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 20);
    expect(bc2.nearestTarget(0, 0, 100)!.id.startsWith("b")).toBe(true);
  });

  it("붕괴 연출이 정점에 적용된다 — Group 이 없다고 조용히 사라지면 안 된다", () => {
    const bc = new BuildingCombat();
    const mesh = makeMesh(8);
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < 8; i++) pos.setXYZ(i, i, 10 + i, i); // 붕괴로 내려앉을 초기 높이
    bc.registerBuilding(mesh, 0, 8, SQUARE, 0, 20, { cls: "resonance" });
    const id = bc.nearestLandmark(0, 0)!.id;
    const before = (pos.array as Float32Array).slice();

    bc.damage(id, 1e9);
    bc.update(0.2); // flash(0.16s) 종료 → collapsing 진입
    bc.update(0.8); // 붕괴 진행

    const after = pos.array as Float32Array;
    expect(Array.from(after)).not.toEqual(Array.from(before)); // 정점이 실제로 움직였다
  });

  it("스트리밍 재로드 — 랜드마크도 파괴 이력을 유지한다", () => {
    const bc = new BuildingCombat();
    const m1 = makeMesh(8);
    bc.registerBuilding(m1, 0, 8, SQUARE, 0, 20, { cls: "memorial" });
    const id = bc.nearestLandmark(0, 0)!.id;
    bc.damage(id, 1e9);
    bc.unregisterMesh(m1); // 청크 언로드

    bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 20, { cls: "memorial" }); // 재로드
    expect(bc.nearestLandmark(0, 0)).toBeNull(); // 잔해 상태로 복원 — 다시 표적이 되지 않음
  });
});


// ─────────────────────────── ⑥ 비건물(site) 랜드마크 ───────────────────────────

// 큐레이션 카탈로그의 상당수는 건물이 아니다(실측: 부산 21개 중 8개 — 해운대·광안대교·태종대 류).
// 건물 승격 경로로는 표현할 수 없어 `guard`/`aggro:landmark` 에서 도시의 대표 표적이 통째로 빠졌다.

describe("siteRadius — 하부 지형에서 반경 추정", () => {
  const BEACH = { p: [0, 0, 1000, 0, 1000, 200, 0, 200] }; //   1000×200m 해변
  const KIOSK = { p: [400, 80, 460, 80, 460, 120, 400, 120] }; // 그 안의 작은 면

  it("좌표를 품은 면의 크기에서 가져온다", () => {
    // 반대각선 절반 = hypot(1000,200)/2 ≈ 510
    expect(siteRadius(100, 100, [BEACH])).toBe(510);
  });

  it("겹치는 면이 여럿이면 가장 작은 것 — 태종대가 아니라 그 안의 전망대", () => {
    const r = siteRadius(430, 100, [BEACH, KIOSK]);
    expect(r).toBeLessThan(siteRadius(100, 100, [BEACH]));
  });

  it("품은 면이 없으면 기본값 — 교량·소규모 유적", () => {
    expect(siteRadius(5000, 5000, [BEACH])).toBe(SITE_R_DEFAULT);
    expect(siteRadius(0, 0, [])).toBe(SITE_R_DEFAULT);
  });

  it("상한으로 자른다 — 광역 지형이 전장을 뒤덮지 않게", () => {
    const HUGE = { p: [0, 0, 40000, 0, 40000, 40000, 0, 40000] };
    expect(siteRadius(100, 100, [HUGE])).toBe(SITE_R_MAX);
  });

  it("퇴화 폴리곤은 무시(정점 3 미만)", () => {
    expect(siteRadius(0, 0, [{ p: [0, 0, 1, 1] }])).toBe(SITE_R_DEFAULT);
    expect(polyExtentRadius([])).toBe(SITE_R_DEFAULT);
  });
});

describe("buildChunkMesh — site 통과", () => {
  it("셀-로컬 → 청크 로컬 프레임으로 옮겨 전달", () => {
    const chunk = {
      cx: 0, cz: 0,
      terrain: { size: 3, seaLevel: 0, heights: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
      objects: {
        buildings: [], roads: [], water: [],
        sites: [{ x: 500, z: 700, y: 12, r: 300, lm: "resonance", n: "Haeundae Beach" }],
      },
      underground: null,
    } as unknown as WorldChunk;
    const cb = buildChunkMesh(chunk, 1024, 100, 200);
    expect(cb.sites).toHaveLength(1);
    expect(cb.sites[0]).toMatchObject({ x: 400, z: 500, y: 12, r: 300, lm: "resonance", n: "Haeundae Beach" });
  });

  it("site 없는 청크는 빈 배열", () => {
    expect(buildChunkMesh(chunkWith([]), 1024, 0, 0).sites).toEqual([]);
  });
});

describe("validateChunk — site 불변식", () => {
  const withSites = (sites: unknown[]) => ({
    cx: 0, cz: 0,
    terrain: { size: 3, seaLevel: 0, heights: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    objects: { buildings: [], roads: [], water: [], sites },
    underground: null,
  }) as unknown as WorldChunk;
  const codes = (c: WorldChunk) => validateChunk(c, 1024).map((i: { code: string }) => i.code);

  it("정상 site 는 통과", () => {
    expect(codes(withSites([{ x: 500, z: 500, y: 3, r: 300, lm: "resonance", n: "X" }]))).toHaveLength(0);
  });

  it("중심이 자기 청크 밖이면 error — 배분 버그(통째로 엉뚱한 청크에 실림)", () => {
    const issues = validateChunk(withSites([{ x: 5000, z: 500, y: 3, r: 100, lm: "relay" }]), 1024);
    expect(issues.find((i: { code: string }) => i.code === "site-bounds")?.level).toBe("error");
  });

  it("미지 택소노미·비정상 반경은 error", () => {
    expect(codes(withSites([{ x: 1, z: 1, y: 0, r: 100, lm: "bogus" }]))).toContain("site-cls");
    expect(codes(withSites([{ x: 1, z: 1, y: 0, r: 0, lm: "relay" }]))).toContain("site-r");
  });
});

describe("BuildingCombat — site 랜드마크(렌더 바인딩 없음)", () => {
  it("표적이 되고 랜드마크로 집계된다", () => {
    const bc = new BuildingCombat();
    bc.registerSite("c0", 100, 5, 200, 400, "resonance", "Haeundae Beach");
    const lm = bc.nearestLandmark(0, 0);
    expect(lm).not.toBeNull();
    expect(lm!.name).toBe("Haeundae Beach");
    expect(lm!.cls).toBe("resonance");
    bc.damage(lm!.id, 1e9);
    expect(bc.destroyedLandmarks).toBe(1);
    expect(bc.destroyedBuildings).toBe(0);
  });

  it("메시도 Group 도 없이 파괴 연출을 통과한다 — 연출 함수가 터지면 안 된다", () => {
    const bc = new BuildingCombat();
    bc.registerSite("c0", 0, 0, 0, 300, "relay", "Gwangan Bridge");
    const id = bc.nearestLandmark(0, 0)!.id;
    expect(() => {
      bc.damage(id, 10); //   피격 틴트 경로
      bc.damage(id, 1e9); //  파괴 → flash
      bc.update(0.2); //      flash → collapsing
      bc.update(0.8); //      붕괴 진행
      bc.update(1.0); //      rubble 전이
    }).not.toThrow();
    expect(bc.nearestLandmark(0, 0)).toBeNull(); // 파괴 후 표적 제외
  });

  it("청크 언로드 시 소유 단위로 해제 — 메시가 없어 unregisterMesh 로는 못 푼다", () => {
    const bc = new BuildingCombat();
    bc.registerSite("c0", 0, 0, 0, 100, "relay", "A");
    bc.registerSite("c1", 900, 0, 0, 100, "relay", "B");
    bc.unregisterSites("c0");
    const left = bc.nearestLandmark(0, 0);
    expect(left!.name).toBe("B"); // c0 만 빠짐
    bc.unregisterSites("c1");
    expect(bc.nearestLandmark(0, 0)).toBeNull();
    expect(() => bc.unregisterSites("없는키")).not.toThrow();
  });

  it("스트리밍 재로드 — 파괴 이력 유지(다시 표적이 되지 않는다)", () => {
    const bc = new BuildingCombat();
    bc.registerSite("c0", 0, 0, 0, 100, "memorial", "A");
    bc.damage(bc.nearestLandmark(0, 0)!.id, 1e9);
    bc.unregisterSites("c0");
    bc.registerSite("c0", 0, 0, 0, 100, "memorial", "A"); // 재로드
    expect(bc.nearestLandmark(0, 0)).toBeNull();
  });

  it("체력은 유형별 해제 저항을 따른다", () => {
    const bc = new BuildingCombat();
    bc.registerSite("c0", 0, 0, 0, 100, "ritual", "R");
    const id = bc.nearestLandmark(0, 0)!.id;
    const expected = 6000 * ENTANGLEMENT_CLASSES.ritual.resistMul;
    expect(bc.damage(id, expected - 1)).toBe("hit");
    expect(bc.damage(id, 1)).toBe("destroyed");
  });

  it("승격 건물과 id 가 겹치지 않는다 — 같은 자리에 둘 다 있어도", () => {
    const bc = new BuildingCombat();
    bc.registerBuilding(makeMesh(8), 0, 8, SQUARE, 0, 20, { cls: "deep-roots", name: "건물" });
    bc.registerSite("c0", 10, 0, 10, 100, "resonance", "광장");
    const ids = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const lm = bc.nearestLandmark(0, 0)!;
      ids.add(lm.id);
      bc.damage(lm.id, 1e9);
    }
    expect(ids.size).toBe(2);
    expect(bc.destroyedLandmarks).toBe(2);
  });
});
