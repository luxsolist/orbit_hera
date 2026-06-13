import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { NormalizedMap, SpawnPoint } from "./MapData";
import { CollisionWorld } from "./CollisionWorld";
import { BuildingCombat } from "./BuildingCombat";
import { StructureBuilder } from "./StructureBuilder";
import { TerrainField } from "./TerrainField";
import { SkyEnvironment } from "./SkyEnvironment";
import { resolveBuildingStyle, buildingBaseColor } from "./precinct";
import { setUniformColor, elevationColor } from "./geo";
import { parseHexColor } from "../core/math";
import type { GameWorld, MinimapSink } from "./GameWorld";

export type { MinimapSink } from "./GameWorld"; // 하위호환 재노출(기존 import 경로 유지)

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

export class World implements GameWorld {
  readonly group = new THREE.Group();
  /** 플레이어 스폰(맵 데이터 기준) */
  readonly spawn: SpawnPoint;
  /** 플레이 반경(±m) — 모놀리식은 고정 지형 절반. */
  readonly bounds = TERRAIN_HALF;
  private map: NormalizedMap;
  /** 지형 높이·도심/경계 마스크 등 연속 공간 질의 계층. */
  private readonly field: TerrainField;
  /** 충돌 세계 — 원기둥/건물 OBB/오목 삼각형/궁장 박스 + 격자 브로드페이즈. */
  private readonly collision = new CollisionWorld();
  /** 건물 체력/피격/파괴 — 플라즈모이드의 2순위 표적(잔해 더미는 group 에 인스턴싱). */
  readonly buildings = new BuildingCombat(this.group);
  /** 데이터 구동 랜드마크(parts/mats) 공통 인터프리터. */
  private readonly structures = new StructureBuilder();
  /** 대기/조명(태양 그림자 추종 포함). */
  private readonly sky: SkyEnvironment;

  constructor(scene: THREE.Scene, map: NormalizedMap, terrainHeights: Float32Array | null = null) {
    this.map = map;
    this.spawn = map.spawn ?? { x: 0, z: 0, yaw: 0 };
    this.field = new TerrainField(map, terrainHeights);
    this.buildTerrain();
    this.buildRoads();
    this.buildLaneMarkings();
    this.buildWater();
    this.buildCity();
    this.buildLandmarks();
    this.buildPrecinctWalls();
    this.collision.finalize(); // 모든 콜라이더 등록 후 격자 공간 인덱스 구축
    this.buildings.attachCollision(this.collision); // 파괴 시 콜라이더 개방
    this.sky = new SkyEnvironment(scene, this.spawn);
    scene.add(this.group);
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
    for (const w of this.map.terrain.water ?? []) {
      const q = w.p;
      const m = q.length / 2;
      if (m < 3) continue;
      let mx = 0, mz = 0;
      for (let i = 0; i < m; i++) { mx += q[i * 2]; mz += q[i * 2 + 1]; }
      if (Math.hypot(mx / m - cx, mz / m - cz) > radius + 250) continue;
      sink.water(q);
    }
    // 도로(세그먼트) — 중점 컬링
    for (const r of this.map.objects.roads) {
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

  // ─────────────────────────────── 지형 높이(TerrainField 위임) ───────────────────────────────

  heightAt(x: number, z: number): number {
    return this.field.heightAt(x, z);
  }

  private buildTerrain() {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const color = new THREE.Color();
    const colors: number[] = [];

    const urban = new THREE.Color(0xc2bdb0); // 도심 지표(밝은 포장 콘크리트)
    // 특수 권역(경계 내부) 바닥색 — 데이터 구동. 없으면 권역 맨땅 처리 안 함.
    const bareGround = this.map.objects.precinct?.groundColor ? new THREE.Color(Number(this.map.objects.precinct.groundColor)) : null;
    const m = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      elevationColor(y, m); // 표고별 잔디→숲→화강암(공유 헬퍼)
      color.copy(m).lerp(urban, this.field.cityMask(x, z));
      // 특수 권역 경계 안쪽은 포장 대신 데이터 지정 바닥색(예: 경복궁 마사토)
      if (bareGround && this.field.inPalace(x, z)) color.copy(bareGround);
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
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xaab0ba, flatShading: true, roughness: 0.95 });
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
      const sx = s * (0.7 + rand() * 0.6),
        sy = s * (1 + rand()),
        sz = s * (0.7 + rand() * 0.6);
      const baseY = elev + s * 0.2;
      const mesh = new THREE.Mesh(rockGeo, rockMat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, baseY, z);
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      // 통과 불가 + 디딜 수 있는 바위 콜라이더(수평 반경 ≈ 평균 가로 스케일, 윗면 ≈ 정점 근처)
      this.collision.addCircle(x, z, (sx + sz) / 2, baseY + sy * 0.8);
    }
  }

  // ─────────────────────────────── 도심(실측) ───────────────────────────────

  /** 랜드마크 제외 반경(excludeR) 안의 OSM 건물은 생략하고 양식화 메시로 대체 — 전부 데이터 구동. */
  private inLandmark(x: number, z: number): boolean {
    for (const l of this.map.objects.landmarks ?? []) {
      const r = l.excludeR ?? 0;
      if ((x - l.x) ** 2 + (z - l.z) ** 2 < r * r) return true;
    }
    return false;
  }

  /** 담장 개구부(문) — 맵 데이터 기준 */
  private get gates() {
    return this.map.objects.gates ?? [];
  }

  /** (x,z) 가 어느 문 개구부 안인가(여유 margin 포함) */
  private nearGate(x: number, z: number, margin = 0): boolean {
    return this.gates.some((g) => (x - g.x) ** 2 + (z - g.z) ** 2 < (g.r + margin) ** 2);
  }

  /** 건물 색 — 특수 권역(precinctColor 지정)이면 그 양식색, 아니면 높이별 도심 팔레트. */
  private buildingColor(h: number, precinctColor: number | null, jitter: number, out: THREE.Color) {
    out.setHex(buildingBaseColor(h, precinctColor));
    out.offsetHSL(0, 0, (jitter - 0.5) * 0.12); // 동별 미세 명도 변주
  }

  private buildCity() {
    const buildings = this.map.objects.buildings;
    const geos: THREE.BufferGeometry[] = [];
    const roofGeos: THREE.BufferGeometry[] = []; // 특수 권역 지붕 슬래브(예: 경복궁 기와)
    // 건물 전투 바인딩 — 병합(geos 가 먼저) 내 정점 범위. 압출 base=0, top=style.height.
    const buildMeta: { poly: number[]; topY: number; vStart: number; vCount: number }[] = [];
    let bVtx = 0;
    const col = new THREE.Color();
    // 특수 권역 건물 양식(데이터 구동). boundary 내부 건물에만 적용.
    const pb = this.map.objects.precinct?.building;
    const precinctColor = pb ? parseHexColor(pb.color) : null;
    const roofColor = pb?.roof ? new THREE.Color(parseHexColor(pb.roof.color)) : null;

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

      // 경계 폴리곤으로 특수 권역(경내) 판정 → 권역 양식(높이 상한·지붕·색·인클로저 생략) 해석.
      const inPrecinct = pb != null && this.field.inPalace(cx, cz);
      const style = resolveBuildingStyle(inPrecinct, b.h ?? 9, (x1 - x0) * (z1 - z0), pb);
      // 권역의 대형 인클로저(마당 외곽 통짜 폴리곤)는 마당 전체를 솔리드로 막으므로 생략.
      if (style.skip) continue;
      const h = style.height;
      const roofTop = style.roofTop; // 옥상(디딤면) 높이 — 권역은 지붕 슬래브 두께 포함

      // 렌더되는 건물(도심·궁 권역 전각/행각 모두)에 충돌 박스 부여. 단 대형 인클로저는
      // 위에서 이미 제외(마당 솔리드 방지)했고, 문(門) 개구부 안 건물(문루 등)만 통과 허용.
      // 발이 옥상(roofTop) 이상이면 통과 → 옥상에 올라설 수 있음.
      if (!this.nearGate(cx, cz, 6)) {
        this.collision.addFootprintBox(p, 0.3, roofTop); // 실제 외곽에 밀착한 OBB(오목 footprint 는 삼각 콜라이더)
      }

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
      this.buildingColor(h, style.usePrecinctColor ? precinctColor : null, jitter, col);
      setUniformColor(geo, col);
      geo.deleteAttribute("uv"); // 병합 일관성(uv 불필요)
      const vCount = geo.getAttribute("position").count;
      buildMeta.push({ poly: p, topY: h, vStart: bVtx, vCount });
      bVtx += vCount;
      geos.push(geo);

      // 권역 건물엔 지정 색 지붕 슬래브를 살짝 얹어 전통 지붕 느낌(예: 경복궁 기와)
      if (style.roofThick > 0 && roofColor) {
        const roof = new THREE.ExtrudeGeometry(shape, { depth: style.roofThick, bevelEnabled: false, steps: 1 });
        roof.rotateX(-Math.PI / 2);
        roof.translate(0, h, 0);
        roof.deleteAttribute("uv");
        setUniformColor(roof, roofColor);
        roofGeos.push(roof);
      }
    }

    const allGeos = geos.concat(roofGeos);
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
      // 건물 전투 등록 — 병합 메시 정점 범위로 개별 갱신(체력/틴트/붕괴). base=0.
      for (const m of buildMeta) this.buildings.registerBuilding(mesh, m.vStart, m.vCount, m.poly, 0, m.topY);
    }
  }

  private buildRoads() {
    const roads = this.map.objects.roads;
    const geos: THREE.BufferGeometry[] = [];
    const Y = 0.25;
    const suppressInPrecinct = this.map.objects.precinct?.suppressRoads ?? false;
    for (const r of roads) {
      const p = r.p;
      const half = (r.w ?? 6) / 2;
      const verts: number[] = [];
      for (let i = 0; i < p.length / 2 - 1; i++) {
        const x0 = p[i * 2],
          z0 = p[i * 2 + 1];
        const x1 = p[i * 2 + 2],
          z1 = p[i * 2 + 3];
        // 특수 권역(suppressRoads)이면 경계 안쪽엔 아스팔트 도로를 두지 않음(맨땅)
        if (suppressInPrecinct && this.field.inPalace((x0 + x1) / 2, (z0 + z1) / 2)) continue;
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
      color: 0x44484f,
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
    const roads = this.map.objects.roads;
    const Y = 0.32;
    const MARK = 0.12; // 차선 폭(m) — 더 가늘게
    const suppressInPrecinct = this.map.objects.precinct?.suppressRoads ?? false;

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
        // 도로를 없앤 권역 내부 구간은 차선도 그리지 않음
        if (suppressInPrecinct && this.field.inPalace((x0 + x1) / 2, (z0 + z1) / 2)) continue;
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
    add(yellow, 0xf2cf1f); // 중앙선(선명한 원색 노랑)
  }

  private buildWater() {
    const water = this.map.terrain.water ?? [];
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1f8cf0,
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
    const box = new THREE.Box3();
    for (const lm of this.map.objects.landmarks ?? []) {
      if (lm.type !== "structure") continue;
      const grp = this.structures.build(lm, this.group, this.collision);
      box.setFromObject(grp); // 대략 높이/바닥 반폭(조준·잔해 더미 크기)
      const topY = isFinite(box.max.y) ? box.max.y : 30;
      const halfX = isFinite(box.max.x) ? (box.max.x - box.min.x) / 2 : 8;
      const halfZ = isFinite(box.max.z) ? (box.max.z - box.min.z) / 2 : 8;
      this.buildings.registerLandmark(grp, lm.x, lm.z, topY, halfX, halfZ, lm.hp);
    }
  }

  // ─────────────────────────── 특수 권역 둘레 담장(경계 폴리라인) ───────────────────────────

  /**
   * 경계(boundary) 폴리곤 외곽을 따라 두르는 둘레 담장 — 치수·색은 precinct.wall(데이터)에서 주입.
   * 발이 윗면 이상이면 통과(wallBoxes 의 top 판정) → 점프로 뛰어넘기/담장 위 올라서기 가능.
   * gates 개구부는 비운다. (예: 경복궁 궁장 — 사대문 광화문·신무문·건춘문·영추문)
   */
  private buildPrecinctWalls() {
    const wall = this.map.objects.precinct?.wall;
    const B = this.map.objects.boundary;
    if (!wall || !B || B.length < 6) return; // 담장 양식 또는 경계 없으면 담장 없음

    const WALL_H = wall.height;
    const THICK = wall.thickness;
    const HALF = THICK / 2;
    const stoneMat = new THREE.MeshStandardMaterial({ color: Number(wall.bodyColor), flatShading: true, roughness: 0.95 });
    const capMat = new THREE.MeshStandardMaterial({ color: Number(wall.capColor), flatShading: true, roughness: 0.85 });

    const bodyGeos: THREE.BufferGeometry[] = [];
    const capGeos: THREE.BufferGeometry[] = [];

    // 문 개구부 — 담장을 비워 통과 가능하게
    const gateGap = (x: number, z: number) => this.nearGate(x, z);
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

  /** 매 프레임 호출 — 큰 맵에서도 플레이어 주변에 그림자가 유지되도록 태양 추종(SkyEnvironment 위임). */
  update(px: number, pz: number) {
    this.sky.update(px, pz);
  }
}
