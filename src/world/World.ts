import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MapData, SpawnPoint } from "./MapData";
import { CollisionWorld } from "./CollisionWorld";
import { StructureBuilder } from "./StructureBuilder";
import { setUniformColor } from "./geo";

/** 미니맵 등 표현 레이어가 World 의 근처 지형/건물 형상을 (내부 구조 노출 없이) 받는 싱크. */
export interface MinimapSink {
  water(points: ReadonlyArray<number>): void;
  road(ax: number, az: number, bx: number, bz: number, width: number): void;
  building(corners: ReadonlyArray<number>): void;
  triangle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): void;
  rock(x: number, z: number, radius: number): void;
}

/**
 * 전장(맵) 렌더러 — 런타임에 서버에서 내려받은 MapData(OpenStreetMap 실측 기반)를 그린다.
 *
 * MapData: 건물 윤곽/높이, 도로망, 수역(+선택: 둘레 담 경계, 문, 양식화 랜드마크, 배경 산세)을
 * 로컬 미터 좌표(1 unit = 1m, 북 = -Z, 원점 = meta.lat0/lon0)로 투영한 데이터.
 *
 * - 건물을 실측 윤곽대로 압출(높이별 색)하여 하나의 메시로 병합(충돌은 OBB/삼각분할).
 * - 도로망을 평면 리본 + 차선, 수역을 반투명 면으로.
 * - 경계 폴리곤이 있으면 둘레 담(점프 통과) + 내부 맨땅 + 도로 제거.
 * - 랜드마크(전각/동상)·배경 산세는 데이터에 있을 때만 배치.
 */
const TERRAIN_SIZE = 6000;
export const TERRAIN_HALF = TERRAIN_SIZE / 2; // 3000 (±3km)
const SEGMENTS = 360; // 지형 격자 ~16.7m 유지(확장에도 산세 디테일 보존)
const TILE_COLOR = new THREE.Color(0x37414d); // 경복궁 권역 건물 기와 슬래브색

export class World {
  readonly group = new THREE.Group();
  /** 플레이어 스폰(맵 데이터 기준) */
  readonly spawn: SpawnPoint;
  private map: MapData;
  /** 도심 평탄 영역(건물 분포 bbox) — cityMask 산출용 */
  private cx0 = 0;
  private cx1 = 0;
  private cz0 = 0;
  private cz1 = 0;
  /** 충돌 세계 — 원기둥/건물 OBB/오목 삼각형/궁장 박스 + 격자 브로드페이즈. */
  private readonly collision = new CollisionWorld();
  /** 데이터 구동 랜드마크(parts/mats) 공통 인터프리터. */
  private readonly structures = new StructureBuilder();
  /** 태양(평행광) — 큰 맵에서 그림자가 플레이어를 따라오도록 매 프레임 이동. */
  private sun?: THREE.DirectionalLight;

  constructor(scene: THREE.Scene, map: MapData) {
    this.map = map;
    this.spawn = map.spawn ?? { x: 0, z: 0, yaw: 0 };
    this.computeCityExtent();
    this.buildTerrain();
    this.buildRoads();
    this.buildLaneMarkings();
    this.buildWater();
    this.buildCity();
    this.buildLandmarks();
    this.buildPalaceWalls();
    this.collision.finalize(); // 모든 콜라이더 등록 후 격자 공간 인덱스 구축
    this.buildLighting(scene);
    this.buildSky(scene);
    scene.add(this.group);
  }

  /** 건물 분포 bbox 계산(도심 평탄 마스크/배경산 경계용) */
  private computeCityExtent() {
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const b of this.map.buildings) {
      for (let i = 0; i < b.p.length; i += 2) {
        const x = b.p[i],
          z = b.p[i + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
    if (!isFinite(x0)) {
      x0 = -100;
      x1 = 100;
      z0 = -100;
      z1 = 100;
    }
    this.cx0 = x0;
    this.cx1 = x1;
    this.cz0 = z0;
    this.cz1 = z1;
  }

  // ─────────────────────────── 충돌/지표 API (CollisionWorld 위임) ───────────────────────────

  resolveCollision(x: number, z: number, radius: number, feetY: number): { x: number; z: number } {
    return this.collision.resolveCollision(x, z, radius, feetY);
  }

  topAt(x: number, z: number): number {
    return this.collision.topAt(x, z);
  }

  /** 미니맵 등 표현 레이어: 시야 반경 내 지형/건물/콜라이더를 (내부 노출 없이) 싱크로 방문. */
  queryMinimap(cx: number, cz: number, radius: number, sink: MinimapSink): void {
    // 수역(폴리곤) — 개수 적어 선형 + 중심 컬링
    for (const w of this.map.water) {
      const q = w.p;
      const m = q.length / 2;
      if (m < 3) continue;
      let mx = 0, mz = 0;
      for (let i = 0; i < m; i++) { mx += q[i * 2]; mz += q[i * 2 + 1]; }
      if (Math.hypot(mx / m - cx, mz / m - cz) > radius + 250) continue;
      sink.water(q);
    }
    // 도로(세그먼트) — 중점 컬링
    for (const r of this.map.roads) {
      const q = r.p;
      const n = q.length / 2;
      if (n < 2) continue;
      const w = r.w ?? 6;
      for (let i = 0; i < n - 1; i++) {
        const ax = q[i * 2], az = q[i * 2 + 1], bx = q[i * 2 + 2], bz = q[i * 2 + 3];
        if (Math.hypot((ax + bx) / 2 - cx, (az + bz) / 2 - cz) > radius + 20) continue;
        sink.road(ax, az, bx, bz, w);
      }
    }
    // 건물(격자 브로드페이즈)
    const minX = cx - radius, minZ = cz - radius, maxX = cx + radius, maxZ = cz + radius;
    this.collision.forEachBuildingNear(minX, minZ, maxX, maxZ, (c) => sink.building(c));
    this.collision.forEachTriNear(minX, minZ, maxX, maxZ, (ax, az, bx, bz, tx, tz) =>
      sink.triangle(ax, az, bx, bz, tx, tz)
    );
    // 전각/동상 콜라이더(점)
    this.collision.forEachCircleNear(cx, cz, radius, (x, z, r) => sink.rock(x, z, r));
  }

  // ─────────────────────────────── 지형 높이 ───────────────────────────────

  private peak(x: number, z: number, cx: number, cz: number, height: number, radius: number): number {
    const dx = x - cx;
    const dz = z - cz;
    return height * Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
  }

  /** 도심 평탄 영역 마스크(건물 분포 bbox 안=1 → 가장자리 산지=0) */
  private cityMask(x: number, z: number): number {
    const mx = (this.cx0 + this.cx1) / 2,
      mz = (this.cz0 + this.cz1) / 2;
    const hx = (this.cx1 - this.cx0) / 2,
      hz = (this.cz1 - this.cz0) / 2;
    const dx = Math.max(0, Math.abs(x - mx) - hx);
    const dz = Math.max(0, Math.abs(z - mz) - hz);
    const d = Math.sqrt(dx * dx + dz * dz);
    return 1 - THREE.MathUtils.smoothstep(d, 0, 220);
  }

  /** 맵 경계 폴리곤(있으면) 내부 판정 — 레이캐스팅. 없으면 false. */
  private inPalace(x: number, z: number): boolean {
    const b = this.map.boundary;
    if (!b || b.length < 6) return false;
    const n = b.length / 2;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = b[i * 2],
        zi = b[i * 2 + 1];
      const xj = b[j * 2],
        zj = b[j * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  heightAt(x: number, z: number): number {
    let h = 0;
    for (const m of this.map.mountains ?? []) h += this.peak(x, z, m.x, m.z, m.h, m.r);
    h += Math.sin(x * 0.012 + 1) * Math.cos(z * 0.011 - 2) * 3.0; // 완만한 기복
    return h * (1 - this.cityMask(x, z));
  }

  private buildTerrain() {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const color = new THREE.Color();
    const colors: number[] = [];

    const lawn = new THREE.Color(0x79a541);
    const forest = new THREE.Color(0x47742e);
    const granite = new THREE.Color(0x8c8c8c);
    const urban = new THREE.Color(0x9a978d); // 도심 지표(보도/포장 콘크리트)
    const bareEarth = new THREE.Color(0xb09360); // 경복궁 내부 맨땅(마사토)
    const m = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      m.copy(lawn).lerp(forest, THREE.MathUtils.smoothstep(y, 8, 60));
      m.lerp(granite, THREE.MathUtils.smoothstep(y, 120, 230));
      color.copy(m).lerp(urban, this.cityMask(x, z));
      // 경복궁 경계 안쪽은 포장/도로 대신 맨땅(마사토)으로
      if (this.map.bare && this.inPalace(x, z)) color.copy(bareEarth);
      colors.push(color.r, color.g, color.b);
    }

    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    // 비인덱스화 + 면별 노멀 → 각진(저폴리) 룩 유지하되 flatShading 의 화면공간 미분 노멀을
    // 쓰지 않는다. (평평한 지형을 지평선까지 보는 grazing 각도에서 미분 노멀이 NaN 이 되어
    // 블룸을 통해 화면 전체가 검게 변하던 문제 방지.)
    const tgeo = geo.toNonIndexed();
    tgeo.computeVertexNormals();
    geo.dispose();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 0.97,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(tgeo, mat);
    mesh.receiveShadow = true;
    mesh.name = "terrain";
    this.group.add(mesh);

    this.scatterRocks();
  }

  /** 배경 산지의 화강암 바위(도심 평지에는 두지 않음) */
  private scatterRocks() {
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, flatShading: true, roughness: 0.95 });
    let seed = 20240601;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 0xffffffff;
      return seed / 0xffffffff;
    };
    let placed = 0;
    for (let i = 0; i < 800 && placed < 90; i++) {
      const x = (rand() - 0.5) * TERRAIN_SIZE * 0.96;
      const z = (rand() - 0.5) * TERRAIN_SIZE * 0.96;
      const elev = this.heightAt(x, z);
      if (elev < 50) continue;
      placed++;
      const s = 6 + rand() * 16;
      const mesh = new THREE.Mesh(rockGeo, rockMat);
      mesh.scale.set(s * (0.7 + rand() * 0.6), s * (1 + rand()), s * (0.7 + rand() * 0.6));
      mesh.position.set(x, elev + s * 0.2, z);
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  // ─────────────────────────────── 도심(실측) ───────────────────────────────

  /** 랜드마크 타입별 OSM 건물 제외 반경(여기 안의 OSM 건물은 생략하고 양식화 메시로 대체) */
  private static readonly LANDMARK_R: Record<string, number> = {
    geunjeongjeon: 30,
    gwanghwamun: 24,
    gyeonghoeru: 30,
    "statue-sejong": 11,
    "statue-yi": 9,
    "eiffel-tower": 75,
    "pont-iena": 28,
    "pont-bir-hakeim": 28,
    "quai-branly": 50,
    "palais-tokyo": 60,
    "blue-house": 45,
    "folk-museum": 30,
    mmca: 55,
    "sejong-center": 50,
    dongsipjagak: 14,
    jogyesa: 40,
  };

  private inLandmark(x: number, z: number): boolean {
    for (const l of this.map.landmarks ?? []) {
      const r = l.excludeR ?? World.LANDMARK_R[l.type] ?? 0;
      if ((x - l.x) ** 2 + (z - l.z) ** 2 < r * r) return true;
    }
    return false;
  }

  /** 담장 개구부(문) — 맵 데이터 기준 */
  private get gates() {
    return this.map.gates ?? [];
  }

  /** (x,z) 가 어느 문 개구부 안인가(여유 margin 포함) */
  private nearGate(x: number, z: number, margin = 0): boolean {
    return this.gates.some((g) => (x - g.x) ** 2 + (z - g.z) ** 2 < (g.r + margin) ** 2);
  }

  /** 건물 높이별/권역별 색 */
  private buildingColor(h: number, palace: number, jitter: number, out: THREE.Color) {
    if (palace > 0.5) {
      // 경복궁 전통 건물: 전돌/목조 톤
      out.setHex(0x9e5b3a);
    } else if (h < 9) out.setHex(0xbdb38f); // 저층 주택/한옥가
    else if (h < 22) out.setHex(0x969aa0); // 중층 상가/빌딩
    else if (h < 45) out.setHex(0x7090ab); // 고층 오피스
    else out.setHex(0x79b4c9); // 마천루(유리)
    // 동별 미세 변주
    const j = (jitter - 0.5) * 0.12;
    out.offsetHSL(0, 0, j);
  }

  private buildCity() {
    const buildings = this.map.buildings;
    const geos: THREE.BufferGeometry[] = [];
    const tileGeos: THREE.BufferGeometry[] = []; // 경복궁 권역 지붕(기와색)
    const col = new THREE.Color();

    for (const b of buildings) {
      const p = b.p;
      const n = p.length / 2;
      if (n < 3) continue;
      // 중심 + 축정렬 경계
      let cx = 0,
        cz = 0,
        x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const px = p[i * 2],
          pz = p[i * 2 + 1];
        cx += px;
        cz += pz;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (pz < z0) z0 = pz;
        if (pz > z1) z1 = pz;
      }
      cx /= n;
      cz /= n;
      if (this.inLandmark(cx, cz)) continue;

      // 실제 경복궁 경계(폴리곤)로 판정 — 사각형 마스크는 궁보다 좁아 동/북 가장자리를 놓침
      const palace = this.inPalace(cx, cz) ? 1 : 0;
      // 경복궁 권역의 대형 인클로저(행각/마당 외곽이 통짜 폴리곤으로 매핑됨)는 마당 전체를
      // 솔리드로 막으므로 생략 → 근정전 등 마당을 열어 둔다.
      if (palace > 0.5 && (x1 - x0) * (z1 - z0) > 2000) continue;

      // 렌더되는 건물(도심·궁 권역 전각/행각 모두)에 충돌 박스 부여. 단 대형 인클로저는
      // 위에서 이미 제외(마당 솔리드 방지)했고, 문(門) 개구부 안 건물(문루 등)만 통과 허용.
      if (!this.nearGate(cx, cz, 6)) {
        this.collision.addFootprintBox(p, 0.3); // 실제 외곽에 밀착한 OBB(오목 footprint 는 삼각 콜라이더)
      }

      let h = b.h ?? 9;
      if (palace > 0.5) h = Math.min(h, 8); // 권역 내는 저층으로

      const shape = new THREE.Shape();
      shape.moveTo(p[0], -p[1]);
      for (let i = 1; i < n; i++) shape.lineTo(p[i * 2], -p[i * 2 + 1]);
      shape.closePath();

      let geo: THREE.ExtrudeGeometry;
      try {
        geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
      } catch {
        continue;
      }
      geo.rotateX(-Math.PI / 2); // 압출 방향(+Z) → +Y 로 세움

      const jitter = ((Math.abs(Math.round(cx * 7 + cz * 13)) % 100) / 100) || 0.5;
      this.buildingColor(h, palace, jitter, col);
      setUniformColor(geo, col);
      geo.deleteAttribute("uv"); // 병합 일관성(uv 불필요)
      geos.push(geo);

      // 경복궁 권역 건물엔 짙은 기와색 지붕 슬래브를 살짝 얹어 전통 지붕 느낌
      if (palace > 0.5) {
        const roof = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false, steps: 1 });
        roof.rotateX(-Math.PI / 2);
        roof.translate(0, h, 0);
        roof.deleteAttribute("uv");
        setUniformColor(roof, TILE_COLOR);
        tileGeos.push(roof);
      }
    }

    const allGeos = geos.concat(tileGeos);
    if (allGeos.length) {
      const merged = mergeGeometries(allGeos, false);
      allGeos.forEach((g) => g.dispose());
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.82,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = "city";
      this.group.add(mesh);
    }
  }

  private buildRoads() {
    const roads = this.map.roads;
    const geos: THREE.BufferGeometry[] = [];
    const Y = 0.25;
    for (const r of roads) {
      const p = r.p;
      const half = (r.w ?? 6) / 2;
      const verts: number[] = [];
      for (let i = 0; i < p.length / 2 - 1; i++) {
        const x0 = p[i * 2],
          z0 = p[i * 2 + 1];
        const x1 = p[i * 2 + 2],
          z1 = p[i * 2 + 3];
        // 경복궁 경계 안쪽에는 아스팔트 도로를 두지 않음(맨땅)
        if (this.inPalace((x0 + x1) / 2, (z0 + z1) / 2)) continue;
        let nx = z1 - z0,
          nz = -(x1 - x0);
        const len = Math.hypot(nx, nz) || 1;
        nx = (nx / len) * half;
        nz = (nz / len) * half;
        // 두 삼각형(네 모서리)
        const ax = x0 + nx,
          az = z0 + nz;
        const bx = x0 - nx,
          bz = z0 - nz;
        const cxp = x1 + nx,
          czp = z1 + nz;
        const dx = x1 - nx,
          dz = z1 - nz;
        verts.push(ax, Y, az, cxp, Y, czp, bx, Y, bz);
        verts.push(bx, Y, bz, cxp, Y, czp, dx, Y, dz);
      }
      if (!verts.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geos.push(g);
    }
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    merged.computeVertexNormals();
    // 진한 회색 아스팔트(밝은 보도/마당 지표와 또렷이 대비). 리본 법선 방향과 무관하게
    // 위에서 보이도록 양면 렌더.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2b2d30,
      roughness: 1.0,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    mesh.name = "roads";
    this.group.add(mesh);
  }

  /**
   * 차선 표시 — 도로 중심선(노란 중앙선, 연속)만. 흰색 차로선은 표시하지 않음.
   * 아스팔트 위(y=0.32)에 얇은 리본으로 깐다.
   */
  private buildLaneMarkings() {
    const roads = this.map.roads;
    const Y = 0.32;
    const MARK = 0.12; // 차선 폭(m) — 더 가늘게

    const yellow: number[] = [];

    // (x0,z0)-(x1,z1) 중심선을 수직(nx,nz)으로 off 만큼 평행이동 + 폭 MARK 리본 quad 추가
    const quad = (
      arr: number[],
      x0: number,
      z0: number,
      x1: number,
      z1: number,
      nx: number,
      nz: number,
      off: number
    ) => {
      const h = MARK / 2;
      const ex0 = x0 + nx * off,
        ez0 = z0 + nz * off;
      const ex1 = x1 + nx * off,
        ez1 = z1 + nz * off;
      const ax = ex0 + nx * h,
        az = ez0 + nz * h,
        bx = ex0 - nx * h,
        bz = ez0 - nz * h;
      const cx = ex1 + nx * h,
        cz = ez1 + nz * h,
        dx = ex1 - nx * h,
        dz = ez1 - nz * h;
      arr.push(ax, Y, az, cx, Y, cz, bx, Y, bz);
      arr.push(bx, Y, bz, cx, Y, cz, dx, Y, dz);
    };

    for (const r of roads) {
      const p = r.p;
      for (let i = 0; i < p.length / 2 - 1; i++) {
        const x0 = p[i * 2],
          z0 = p[i * 2 + 1];
        const x1 = p[i * 2 + 2],
          z1 = p[i * 2 + 3];
        const dx = x1 - x0,
          dz = z1 - z0;
        const L = Math.hypot(dx, dz);
        if (L < 0.01) continue;
        // 궁 내부 구간은 도로가 없으므로 차선도 그리지 않음
        if (this.inPalace((x0 + x1) / 2, (z0 + z1) / 2)) continue;
        const ux = dx / L,
          uz = dz / L;
        const nx = -uz,
          nz = ux; // 단위 수직

        // 중앙선(노랑, 연속)만
        quad(yellow, x0, z0, x1, z1, nx, nz, 0);
      }
    }

    const add = (verts: number[], color: number) => {
      if (!verts.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      g.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = "lane-markings";
      this.group.add(mesh);
    };
    add(yellow, 0xa1894a); // 중앙선(바랜 노랑)
  }

  private buildWater() {
    const water = this.map.water;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3f76e4,
      transparent: true,
      opacity: 0.85,
      roughness: 0.2,
      metalness: 0.4,
    });
    for (const w of water) {
      const p = w.p;
      const n = p.length / 2;
      if (n < 3) continue;
      // 강 중심선(waterway=river) 등 선형/퇴화 폴리곤은 닫힌 면으로 채우면 거대 퇴화
      // 삼각형/NaN 이 되어 블룸을 통해 화면을 검게 만든다 → 거대+얇으면 건너뜀.
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, a = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const px = p[i * 2], pz = p[i * 2 + 1];
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (pz < z0) z0 = pz;
        if (pz > z1) z1 = pz;
        a += p[j * 2] * pz - px * p[j * 2 + 1];
      }
      a = Math.abs(a) / 2;
      const bb = (x1 - x0) * (z1 - z0) || 1;
      if ((x1 - x0 > 1500 || z1 - z0 > 1500) && a / bb < 0.1) continue;
      const shape = new THREE.Shape();
      shape.moveTo(p[0], -p[1]);
      for (let i = 1; i < n; i++) shape.lineTo(p[i * 2], -p[i * 2 + 1]);
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.3, 0);
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  // ─────────────────────── 데이터 구동 랜드마크(StructureBuilder 위임) ───────────────────────

  /** 맵 데이터의 landmarks 를 배치 — 전부 데이터 구동(structure) 공통 렌더. */
  private buildLandmarks() {
    for (const lm of this.map.landmarks ?? [])
      if (lm.type === "structure") this.structures.build(lm, this.group, this.collision);
  }

  // ─────────────────────────── 경복궁 궁장(담장, 실측 폴리라인) ───────────────────────────

  /**
   * 경복궁 둘레 담장 — OSM 경복궁 경계 폴리곤(rel/5501517) 외곽을 따라 완전한 궁장을 세운다.
   * (barrier=wall 데이터는 서·북이 누락돼 있어 경계 폴리곤으로 사방을 모두 두름)
   * 실제 높이 4m. 발이 윗면 이상이면 통과(wallBoxes 의 top 판정) → 점프(정점 ~5m)로
   * 뛰어넘기/담장 위 올라서기 가능. 광화문 개구부는 비움.
   */
  private buildPalaceWalls() {
    const WALL_H = 4;
    const THICK = 0.9;
    const HALF = THICK / 2;
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8d897d, flatShading: true, roughness: 0.95 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x37414d, flatShading: true, roughness: 0.85 });

    const bodyGeos: THREE.BufferGeometry[] = [];
    const capGeos: THREE.BufferGeometry[] = [];

    // 사대문 개구부 — 담장을 비워 통과 가능하게(광화문·신무문·건춘문·영추문)
    const gateGap = (x: number, z: number) => this.nearGate(x, z);

    const B = this.map.boundary;
    if (!B || B.length < 6) return; // 경계 없으면 담장 없음
    for (let i = 0; i < B.length / 2 - 1; i++) {
      {
        const ax = B[i * 2],
          az = B[i * 2 + 1];
        const bx = B[i * 2 + 2],
          bz = B[i * 2 + 3];
        const dx = bx - ax,
          dz = bz - az;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.1) continue;
        const pieces = Math.max(1, Math.ceil(segLen / 4)); // 콜라이더 정확도를 위해 ~4m 분할
        for (let k = 0; k < pieces; k++) {
          const t0 = k / pieces,
            t1 = (k + 1) / pieces;
          const x0 = ax + dx * t0,
            z0 = az + dz * t0;
          const x1 = ax + dx * t1,
            z1 = az + dz * t1;
          const mx = (x0 + x1) / 2,
            mz = (z0 + z1) / 2;
          if (gateGap(mx, mz)) continue;
          const len = Math.hypot(x1 - x0, z1 - z0);
          const ang = Math.atan2(z1 - z0, x1 - x0);

          const bg = new THREE.BoxGeometry(len + 0.06, WALL_H, THICK);
          bg.applyMatrix4(new THREE.Matrix4().makeRotationY(-ang).setPosition(mx, WALL_H / 2, mz));
          bodyGeos.push(bg);
          const cg = new THREE.BoxGeometry(len + 0.12, 0.4, THICK + 0.3);
          cg.applyMatrix4(new THREE.Matrix4().makeRotationY(-ang).setPosition(mx, WALL_H + 0.2, mz));
          capGeos.push(cg);

          // 콜라이더 AABB(가는 담장의 회전 사각형을 감싸는 축정렬 박스)
          const ux = (x1 - x0) / len,
            uz = (z1 - z0) / len;
          const px = -uz * HALF,
            pz = ux * HALF;
          const X0 = Math.min(x0 + px, x0 - px, x1 + px, x1 - px);
          const X1 = Math.max(x0 + px, x0 - px, x1 + px, x1 - px);
          const Z0 = Math.min(z0 + pz, z0 - pz, z1 + pz, z1 - pz);
          const Z1 = Math.max(z0 + pz, z0 - pz, z1 + pz, z1 - pz);
          this.collision.addWallBox(X0, X1, Z0, Z1, WALL_H);
        }
      }
    }

    if (bodyGeos.length) {
      const body = new THREE.Mesh(mergeGeometries(bodyGeos, false), stoneMat);
      bodyGeos.forEach((g) => g.dispose());
      body.castShadow = body.receiveShadow = true;
      body.name = "palace-walls";
      this.group.add(body);
    }
    if (capGeos.length) {
      const cap = new THREE.Mesh(mergeGeometries(capGeos, false), capMat);
      capGeos.forEach((g) => g.dispose());
      cap.castShadow = cap.receiveShadow = true;
      this.group.add(cap);
    }
  }

  // ─────────────────────────────── 라이팅/하늘 ───────────────────────────────

  private buildLighting(scene: THREE.Scene) {
    const hemi = new THREE.HemisphereLight(0xbfdcff, 0x6f7a4a, 1.18);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3da, 2.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 1400;
    const s = 420; // 플레이어 주변을 덮는 그림자 범위(매 프레임 추종)
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0006;
    scene.add(sun.target);
    scene.add(sun);
    this.sun = sun;
    this.updateSun(this.spawn.x, this.spawn.z); // 초기 위치

    const fill = new THREE.DirectionalLight(0xaecbe6, 0.4);
    fill.position.set(-200, 160, -300);
    scene.add(fill);
  }

  /** 태양(그림자 프러스텀)을 플레이어 위치로 평행이동 — 광원 방향은 유지. */
  private updateSun(px: number, pz: number) {
    if (!this.sun) return;
    this.sun.position.set(px + 300, 520, pz + 360); // 남동 오전 햇살(상대 방향 고정)
    this.sun.target.position.set(px, 0, pz);
  }

  /** 매 프레임 호출 — 큰 맵에서도 플레이어 주변에 그림자가 유지되도록 태양 추종. */
  update(px: number, pz: number) {
    this.updateSun(px, pz);
  }

  private buildSky(scene: THREE.Scene) {
    scene.background = new THREE.Color(0x80aef0);
    scene.fog = new THREE.Fog(0xa9c8f2, 900, 5000);
  }
}
