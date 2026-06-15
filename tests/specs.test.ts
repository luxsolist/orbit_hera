import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// 데이터 구동(JSON) 스펙 검증 — tsc 가 보지 못하는 public/*.json 의 필수 필드 + 교차참조를 고정.
// 신규 드론/무기/맵 추가 시 데이터 깨짐(필드 누락·오타·dangling 참조)을 즉시 차단.

const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const num = (v: unknown) => expect(v).toBeTypeOf("number");
const D = "public/drones", W = "public/weapons", M = "public/maps";

describe("드론 스펙(JSON)", () => {
  const cat = load(`${D}/index.json`) as Array<{ id: string; displayName: string; mode: string }>;

  it("카탈로그 형태 + 파일 존재", () => {
    expect(Array.isArray(cat)).toBe(true);
    expect(cat.length).toBeGreaterThan(0);
    for (const e of cat) {
      expect(typeof e.id).toBe("string");
      expect(typeof e.displayName).toBe("string");
      expect(["walk", "fly"]).toContain(e.mode);
      expect(existsSync(`${D}/${e.id}.json`)).toBe(true);
    }
  });

  for (const e of cat) {
    it(`${e.id}: 필수 필드 + 이동 + 동작 + 무장 교차참조`, () => {
      const d = load(`${D}/${e.id}.json`);
      expect(d.id).toBe(e.id);
      num(d.body?.eyeHeight);
      num(d.body?.radius);
      for (const k of ["maxHp", "maxFreq", "freqRegen"]) num(d.vitals?.[k]);
      num(d.view?.fov);
      num(d.view?.mouseSensitivity);

      expect(["walk", "fly"]).toContain(d.move?.mode);
      if (d.move.mode === "walk") {
        num(d.move.speed); num(d.move.groundAccel); num(d.move.airAccel);
        for (const k of ["velocity", "riseGravity", "fallGravity", "fallTerminal", "maxRiseHeight", "coyoteTime"])
          num(d.move.jump?.[k]);
      } else {
        for (const k of ["speed", "accel", "verticalSpeed", "ceiling", "rollDeg", "spawnHeight"]) num(d.move[k]);
      }

      expect(Array.isArray(d.actions)).toBe(true);
      for (const a of d.actions) {
        expect(typeof a.label).toBe("string");
        expect(typeof a.key).toBe("string");
        expect(typeof a.desc).toBe("string");
      }

      expect(existsSync(`${W}/${d.weapons.primary}.json`)).toBe(true); // dangling 참조 방지
      expect(existsSync(`${W}/${d.weapons.special}.json`)).toBe(true);

      // lockOn 필드는 선택적이지만, 있으면 followDist > band > 0 이어야 함
      if (d.lockOn != null) {
        num(d.lockOn.followDist);
        num(d.lockOn.band);
        expect(d.lockOn.followDist).toBeGreaterThan(0);
        expect(d.lockOn.band).toBeGreaterThan(0);
        expect(d.lockOn.followDist).toBeGreaterThan(d.lockOn.band); // 밴드가 followDist보다 클 수 없음
      }
    });
  }
});

describe("무기 스펙(JSON)", () => {
  const cat = load(`${W}/index.json`) as Array<{ id: string; type: string }>;

  it("카탈로그/파일 일치", () => {
    for (const e of cat) {
      expect(["beam", "barrage", "stream"]).toContain(e.type);
      expect(existsSync(`${W}/${e.id}.json`)).toBe(true);
    }
  });

  for (const e of cat) {
    it(`${e.id} (${e.type}): 필수 필드`, () => {
      const w = load(`${W}/${e.id}.json`);
      expect(w.type).toBe(e.type);
      expect(typeof w.abbr).toBe("string");
      if (w.type === "beam") {
        num(w.range); num(w.beamLifetime);
        expect(Number.isFinite(Number(w.color))).toBe(true); // "0x..." 파싱 가능
        for (const k of ["damage", "freqCost", "fireInterval", "assistConeDeg"]) num(w.manual?.[k]);
        for (const k of ["damage", "freqCost", "fireInterval", "range"]) num(w.auto?.[k]);
        for (const k of ["refDist", "maxMult", "minMult"]) num(w.falloff?.[k]);
        if (w.muzzleOffsets != null) expect(Array.isArray(w.muzzleOffsets)).toBe(true);
      } else if (w.type === "barrage") {
        for (const k of ["maxBeams", "coneDeg", "range", "cooldown", "drainRate", "salvoInterval", "salvoDamage", "beamLifetime"])
          num(w[k]);
        for (const k of ["refDist", "maxMult", "minMult"]) num(w.falloff?.[k]);
        expect(Number.isFinite(Number(w.colorBeam))).toBe(true);
        expect(Number.isFinite(Number(w.colorGlow))).toBe(true);
      } else {
        // stream(오버드라이브)
        for (const k of ["range", "cooldown", "drainRate", "fireInterval", "damage", "assistConeDeg", "beamLifetime"]) num(w[k]);
        expect(Array.isArray(w.muzzleOffsets)).toBe(true);
        for (const k of ["refDist", "maxMult", "minMult"]) num(w.falloff?.[k]);
        expect(Number.isFinite(Number(w.colorBeam))).toBe(true);
        expect(Number.isFinite(Number(w.colorGlow))).toBe(true);
      }
    });
  }
});

describe("전장 카탈로그(JSON)", () => {
  const cat = load(`${M}/index.json`) as Array<{ id: string; name: string; lat?: number; lon?: number; stream?: boolean }>;

  const hex = (v: unknown) => expect(Number.isFinite(Number(v))).toBe(true); // "0xRRGGBB" 파싱 가능

  for (const e of cat) {
    it(`${e.id}: 파일 + 세계지도 좌표(lat/lon)`, () => {
      // 스트리밍 전장은 모놀리식 <id>.json 대신 타일 디렉터리(maps/<lat>/<lon>/tiles.json)로 로드
      if (e.stream) expect(existsSync(`${M}/${Math.floor(e.lat!)}/${Math.floor(e.lon!)}/tiles.json`)).toBe(true);
      else expect(existsSync(`${M}/${e.id}.json`)).toBe(true);
      expect(typeof e.name).toBe("string");
      num(e.lat);
      num(e.lon);
    });

    it(`${e.id}: 특수 권역(precinct) 스키마 — 있으면 형태/색/경계 일관`, () => {
      if (e.stream) return; // 스트리밍 전장은 청크 분산 — 모놀리식 권역 스키마 비대상
      const m = load(`${M}/${e.id}.json`);
      // 랜드마크는 전부 data-driven structure + excludeR(코드 하드코딩 제거 회귀 가드)
      for (const l of m.landmarks ?? []) {
        expect(l.type).toBe("structure");
        num(l.excludeR);
      }
      if (!m.precinct) return; // 일반 도심 맵은 권역 없음
      const p = m.precinct;
      if (p.groundColor != null) hex(p.groundColor);
      if (p.building) {
        hex(p.building.color);
        if (p.building.roof) {
          hex(p.building.roof.color);
          num(p.building.roof.thickness);
        }
      }
      if (p.wall) {
        num(p.wall.height);
        num(p.wall.thickness);
        hex(p.wall.bodyColor);
        hex(p.wall.capColor);
        // 담장은 경계 폴리라인이 있어야 세울 수 있음
        expect(Array.isArray(m.boundary) && m.boundary.length >= 6).toBe(true);
      }
    });
  }
});
