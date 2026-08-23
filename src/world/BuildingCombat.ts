// 건물 전투 — 도시 건물/랜드마크에 체력을 부여하고, 플라즈모이드의 공격 대상으로 만든다.
//
// 렌더링은 성능을 위해 건물들이 단일 메시로 **병합**되어 있다(World.buildCity / chunkMesh). 병합은
// 입력 순서대로 정점을 이어붙이므로, 빌드 시 **건물별 정점 범위(vStart/vCount)**만 기록해 두면 병합을
// 유지한 채(드로우콜 1개) 개별 건물의 정점 색(점진 적색)·위치(붕괴)만 부분 갱신할 수 있다.
// 랜드마크는 두 갈래다: 손수 만든 양식화 랜드마크는 개별 Group(변환으로 처리), OSM 에서 승격된
// 랜드마크(스트리밍 도시)는 **일반 건물과 같은 병합 메시**에 들어 있다. 그래서 연출 분기는
// `isLandmark`(의미: 집계·표적 질의)가 아니라 **렌더 바인딩 유무(group 이냐 mesh 냐)**로 가른다 —
// 이 둘을 섞으면 메시 기반 랜드마크가 피격·붕괴 연출 없이 조용히 사라진다.
// 셋째 갈래는 **site 랜드마크**(해변·교량·공원 — registerSite): 렌더 바인딩이 **아예 없다**.
// 표적/체력/집계만 갖고 형상 연출은 건너뛴다(연출 함수들은 mesh/group 없으면 조용히 반환).
//
// 파괴 결과물(잔해)은 인트로 해변 집 붕괴처럼 **낮게 쌓인 각진 조각 더미**로 남기되, 조명에 무관한
// **순수 검정 단색**(MeshBasic)으로 통일해 지상/공중 어디서든 즉시 눈에 띄게 한다. 잔해는 단일
// InstancedMesh(드로우콜 1개)에 footprint 크기로 인스턴싱한다.
//
// 상태는 안정 ID(중심 좌표 해시)로 보관 → 스트리밍 청크가 언로드/재로드돼도 파괴 상태가 유지된다.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CollisionWorld } from "./CollisionWorld";
import { ENTANGLEMENT_CLASSES, type EntanglementClass } from "./entanglement";
import { RUBBLE_COLOR } from "./palette";

const DAMAGE_RED = new THREE.Color(0xff2a14); // 피격 누적 → 점점 이 붉은색으로
const FLASH_COLOR = new THREE.Color(2.0, 1.7, 1.3); // 파괴 직전 번쩍(>1 = 블룸 유발)
const RUBBLE_DARK = new THREE.Color(0x050505); // 붕괴 중 셸이 잦아드는 색(거의 검정)
const RUBBLE_BLACK = RUBBLE_COLOR; // 잔해 더미 단일 색(조명 무관) — 순수 검정이면 어두운 배경에서 사라진다
const FLASH_DUR = 0.16; // 번쩍 지속(s)
const COLLAPSE_DUR = 1.5; // 와르르 붕괴(약간 슬로우, s)
const HP_PER_M3 = 0.04; // 부피(바닥면적×높이) → 체력 계수
const HP_MIN = 40; // 일반 건물 최소 체력
const LANDMARK_HP_DEFAULT = 6000; // 랜드마크 기본 체력(고유값 미지정 시)
const GRID_CELL = 128; // 건물 탐색 공간 격자 한 변(m)
const MAX_RUBBLE = 2048; // 잔해 더미 인스턴스 상한
const SITE_RUBBLE_MAX = 40; // site 랜드마크 잔해 더미 반경 상한(m) — 해변 반경(수백 m)을 그대로 쓰면 전장을 덮는다

export type DamageResult = "none" | "hit" | "destroyed";
type BState = "intact" | "flash" | "collapsing" | "rubble" | "abducting";

// 의존성 절단(건물 납치 — 서사편 §6.3, P3 커터): 커터가 막 결합을 끊으면 건물이 뿌리째 부양해
// 균열로 떠오른다. 도달 시 소거(잔해 없음 — 소거 전 휴지통 이동), 상승 중 커터 격추 시 재안착.
const ABDUCT_LIFT_SPEED = 12; //   부양 속도(m/s)
const ABDUCT_RELEASE_MUL = 2.5; // 재안착(하강)은 부양보다 빠르게 — 격추 보상이 즉각 읽히게
const ABDUCT_HEIGHT = 200; //      이 고도 도달 시 소거
const ABDUCT_TINT = new THREE.Color(0x9fd8ff); // 막 결합이 끊긴 창백한 청백(와이어프레임화의 톤 근사)

// 링크 리와인드(물리편 §2.8.3): 발동 시 반경 내 "최근 파괴"를 되돌린다. 파괴된 항목의 전체 참조를
// 짧은 시간창 동안만 보존(무한 성장 방지) — 그보다 오래된 파괴는 잊혀 되돌릴 수 없다(정본 "수 초 전"의
// 기계적 근거). 실제 요청 창(rewindSec)은 호출부가 이보다 짧게 넘겨야 유효.
const LINK_REWIND_RETAIN = 15; // 되돌림 후보 보존 상한(s)

const _m4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _YAXIS = new THREE.Vector3(0, 1, 0);

/** 건물 한 채(또는 랜드마크 하나)의 전투 상태 + 렌더 바인딩. */
interface BEntry {
  id: string;
  hp: number;
  maxHp: number;
  cx: number;
  cz: number;
  aimY: number; // 공격 조준 높이(중상단)
  rx: number; // footprint 반폭 X(잔해 더미 크기)
  rz: number; // footprint 반폭 Z
  rubbleH: number; // 잔해 더미 높이
  isLandmark: boolean;
  cls?: EntanglementClass; // 얽힘 유형(랜드마크만) — 해제 저항 배율·브리핑 어휘의 출처
  name?: string; //          표시명(랜드마크만) — 브리핑/HUD
  state: BState;
  anim: number; // 애니메이션 누적 시간
  lift?: number; //      납치 부양 고도(m) — abducting 전용
  liftDir?: 1 | -1; //   1=상승(납치 진행) / -1=재안착(커터 격추·W4 복구)
  // ── 일반 건물(병합 메시 정점 범위) ──
  mesh?: THREE.Mesh;
  vStart?: number;
  vCount?: number;
  baseY?: number;
  topY?: number;
  baseColors?: Float32Array; // 원본 정점색 스냅샷(피격 틴트 보간 기준)
  origPos?: Float32Array; // 붕괴 시작 시 정점 위치 스냅샷
  // ── site 랜드마크(해변·교량 등)는 mesh/group 둘 다 없다 — 표적/체력만 갖는다 ──
  // ── 랜드마크(Group 변환) ──
  group?: THREE.Group;
  matColors?: { mat: THREE.MeshStandardMaterial; r: number; g: number; b: number }[];
  baseScaleY?: number;
  baseGroupY?: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smooth(p: number): number {
  p = clamp01(p);
  return p * p * (3 - 2 * p);
}
/** 정점 인덱스 → 결정적 [0,1) 의사난수(잔해 흩어짐 변주). */
function hash1(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
function cellKey(x: number, z: number): string {
  return `${Math.floor(x / GRID_CELL)}:${Math.floor(z / GRID_CELL)}`;
}

/**
 * 잔해 더미 템플릿 — 단위 footprint([-0.5,0.5]²) 위에 낮게 쌓인 각진 조각 더미(인트로 집 붕괴 느낌).
 * 가운데가 높고 가장자리로 흩어지는 무더기. 인스턴싱 시 footprint 크기·높이로 비균일 스케일.
 */
function buildRubbleTemplate(): THREE.BufferGeometry {
  let seed = 0x9e3779b1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const geos: THREE.BufferGeometry[] = [];
  const CHUNKS = 22;
  for (let i = 0; i < CHUNKS; i++) {
    // 중심 편향 분포(가운데 더 높이 쌓임)
    const a = rand() * Math.PI * 2;
    const rr = Math.pow(rand(), 0.7) * 0.5;
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const pile = 1 - rr / 0.5; // 중심일수록 ↑
    const w = 0.16 + rand() * 0.26;
    const h = 0.12 + rand() * (0.5 + 0.5 * pile);
    const d = 0.16 + rand() * 0.26;
    const b = new THREE.BoxGeometry(w, h, d);
    b.deleteAttribute("uv");
    b.deleteAttribute("normal"); // MeshBasic — 노멀 불필요
    b.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler((rand() - 0.5) * 0.7, rand() * Math.PI, (rand() - 0.5) * 0.7)
    ));
    // 바닥(y=0)에 앉되 중심 무더기는 솟게
    b.translate(cx, h * 0.4 + pile * 0.35 * rand(), cz);
    geos.push(b);
  }
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

/**
 * 도시 건물/랜드마크의 체력·피격·파괴를 관리. World/StreamingWorld 가 빌드 시 건물을 등록하고,
 * EnemyManager 가 표적 질의(nearestTarget)·피해 적용(damage)을 호출하며, 매 프레임 update 로 연출 진행.
 * 잔해는 parent(월드 그룹)에 추가되는 단일 InstancedMesh 로 렌더(청크 언로드와 무관하게 영속).
 */
export class BuildingCombat {
  private byId = new Map<string, BEntry>(); // 살아있는(intact) 건물 — 표적/피해 조회
  private byMesh = new Map<THREE.Mesh, BEntry[]>(); // 청크 메시별(언로드 시 일괄 해제)
  private byOwner = new Map<string, BEntry[]>(); //  site 랜드마크의 청크별 소유(언로드 시 일괄 해제 — 메시가 없어 byMesh 를 못 쓴다)
  private grid = new Map<string, BEntry[]>(); // intact 건물 공간 격자(최근접 탐색)
  private active: BEntry[] = []; // 연출 진행 중(flash/collapsing)
  private abducting = new Map<string, BEntry>(); // 납치(부양) 진행 중 — 표적/피해 대상에서 제외
  private destroyed = new Map<string, { cx: number; cz: number; isLandmark: boolean }>(); // 파괴 이력(재로드 복원)
  private collision: CollisionWorld | null = null;
  private clock = 0; // 링크 리와인드(§2.8.3) 기준 시계 — update(dt) 가 누적
  private recentlyDestroyed: { entry: BEntry; at: number }[] = []; // 되돌림 후보(LINK_REWIND_RETAIN 창)

  // 잔해 더미 — 단일 InstancedMesh(순수 검정). slot 은 건물 id 당 1회 할당(재로드 시 재사용).
  private rubble: THREE.InstancedMesh | null = null;
  private rubbleCount = 0;
  private rubbleSlot = new Map<string, number>();

  destroyedBuildings = 0;
  destroyedLandmarks = 0;
  /** 파괴 통지 — x/z/aimY 는 방향 피드백(HUD 웨지 등)이 참조할 파괴 위치(월드 좌표). */
  onDestroyed?: (isLandmark: boolean, x: number, y: number, z: number) => void;

  /** parent(월드 group/scene)를 주면 잔해 InstancedMesh 를 거기에 추가. 미지정 시 잔해 비주얼 생략(테스트). */
  constructor(parent?: THREE.Object3D) {
    if (parent) {
      const mat = new THREE.MeshBasicMaterial({ color: RUBBLE_BLACK }); // 조명 무관 순수 검정 단색
      this.rubble = new THREE.InstancedMesh(buildRubbleTemplate(), mat, MAX_RUBBLE);
      this.rubble.frustumCulled = false;
      this.rubble.count = 0;
      this.rubble.name = "rubble";
      parent.add(this.rubble);
    }
  }

  /** 현재 충돌 세계 연결(스트리밍은 재구축마다 갱신). 파괴 건물 콜라이더 개방에 사용. */
  attachCollision(c: CollisionWorld): void {
    this.collision = c;
  }

  // ─────────────────────────── 등록 ───────────────────────────

  /**
   * 건물 등록 — 병합 메시(mesh)의 정점 범위(vStart/vCount)로 개별 갱신을 바인딩.
   * poly = 월드(=로컬 프레임) footprint [x0,z0,...]. 체력 = 바닥면적×높이×계수.
   * 이미 파괴 이력이 있으면 즉시 잔해 상태로 복원(스트리밍 재로드).
   *
   * lm 을 주면 **랜드마크로 승격**된다(빌드가 청크에 실어 보낸 얽힘 택소노미 — scripts/osm.mjs landmarkFrom).
   * 승격된 건물은 렌더는 그대로(병합 메시) 두고 전투 의미만 바뀐다: 고유 체력(부피 체력과 기본값 중
   * 큰 쪽 × 유형별 해제 저항 resistMul) · 랜드마크 집계 · `aggro:landmark` 직행 표적.
   */
  registerBuilding(
    mesh: THREE.Mesh, vStart: number, vCount: number, poly: number[], baseY: number, topY: number,
    lm?: { cls: EntanglementClass; name?: string }
  ): void {
    const n = poly.length / 2;
    if (n < 3) return;
    let cx = 0, cz = 0, area2 = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const px = poly[i * 2], pz = poly[i * 2 + 1];
      cx += px; cz += pz;
      area2 += poly[j * 2] * pz - px * poly[j * 2 + 1];
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
    }
    cx /= n;
    cz /= n;
    const area = Math.abs(area2) / 2;
    const height = Math.max(1, topY - baseY);
    const volumeHp = Math.max(HP_MIN, area * height * HP_PER_M3);
    // 랜드마크는 부피 체력과 기본값 중 큰 쪽에 유형별 해제 저항(resistMul)을 곱한다 —
    // 작은 사당이 종잇장이 되지도, 거대 유적이 일반 건물과 같지도 않게.
    const maxHp = lm
      ? Math.max(volumeHp, LANDMARK_HP_DEFAULT) * ENTANGLEMENT_CLASSES[lm.cls].resistMul
      : volumeHp;
    // id 접두는 랜드마크 여부를 따른다 — 파괴 이력(destroyed)이 승격 전후로 섞이지 않게.
    const id = `${lm ? "l" : "b"}${Math.round(cx)}_${Math.round(cz)}`;
    const e: BEntry = {
      id, hp: maxHp, maxHp, cx, cz, aimY: baseY + (topY - baseY) * 0.6,
      rx: Math.max(1.5, (maxX - minX) / 2), rz: Math.max(1.5, (maxZ - minZ) / 2),
      rubbleH: Math.min(9, 2.5 + height * 0.06),
      isLandmark: !!lm, ...(lm ? { cls: lm.cls, ...(lm.name ? { name: lm.name } : {}) } : {}),
      state: "intact", anim: 0, mesh, vStart, vCount, baseY, topY,
    };
    this.addToMesh(mesh, e);
    if (this.destroyed.has(id)) this.restoreRubbleBuilding(e);
    else this.addIntact(e);
  }

  /**
   * 랜드마크 등록 — 개별 Group 변환으로 처리. hp 미지정 시 기본 고유 체력.
   * topY = 대략 높이, halfX/halfZ = 대략 바닥 반폭(잔해 더미 크기).
   */
  registerLandmark(group: THREE.Group, cx: number, cz: number, topY: number, halfX: number, halfZ: number, hp?: number, cls?: EntanglementClass): void {
    const maxHp = hp ?? LANDMARK_HP_DEFAULT * (cls ? ENTANGLEMENT_CLASSES[cls].resistMul : 1);
    const id = `l${Math.round(cx)}_${Math.round(cz)}`;
    const e: BEntry = {
      id, hp: maxHp, maxHp, cx, cz, aimY: topY * 0.55,
      rx: Math.max(3, halfX), rz: Math.max(3, halfZ), rubbleH: Math.min(12, Math.max(3, topY * 0.25)),
      isLandmark: true, ...(cls ? { cls } : {}), state: "intact", anim: 0, group,
      baseScaleY: group.scale.y, baseGroupY: group.position.y,
    };
    if (this.destroyed.has(id)) this.restoreRubbleLandmark(e);
    else this.addIntact(e);
  }

  /**
   * 비건물 랜드마크(site) 등록 — 해변·교량·공원·하천·곶처럼 **건물 footprint 가 없는** 랜드마크.
   * 렌더 바인딩이 없어 형상 연출(틴트/붕괴)은 건너뛰고 표적·체력·집계만 갖는다.
   *
   * owner = 이 site 를 실어온 청크 키. 언로드 시 unregisterSites(owner) 로 일괄 해제한다
   * (메시가 없어 byMesh 경로를 쓸 수 없다).
   *
   * r 은 하부 지형(해변/공원)의 대표 반경이라 킬로미터급이 될 수 있다 — 잔해 더미 크기로 그대로 쓰면
   * 전장을 뒤덮으므로 SITE_RUBBLE_MAX 로 자른다. 표적 판정·기록에는 원래 반경을 쓴다.
   */
  registerSite(
    owner: string, x: number, y: number, z: number, r: number,
    cls: EntanglementClass, name?: string, hp?: number
  ): void {
    const maxHp = hp ?? LANDMARK_HP_DEFAULT * ENTANGLEMENT_CLASSES[cls].resistMul;
    const id = `s${Math.round(x)}_${Math.round(z)}`;
    const rubbleR = Math.min(SITE_RUBBLE_MAX, Math.max(3, r));
    const e: BEntry = {
      id, hp: maxHp, maxHp, cx: x, cz: z,
      aimY: y + Math.min(40, Math.max(6, r * 0.15)), // 지표 위 — 넓은 site 일수록 높게(멀리서도 조준선이 잡히게)
      rx: rubbleR, rz: rubbleR, rubbleH: Math.min(12, Math.max(3, rubbleR * 0.25)),
      isLandmark: true, cls, ...(name ? { name } : {}),
      state: "intact", anim: 0, baseY: y, topY: y,
    };
    const list = this.byOwner.get(owner);
    if (list) list.push(e);
    else this.byOwner.set(owner, [e]);
    if (this.destroyed.has(id)) { e.state = "rubble"; this.placeRubble(e, 1); }
    else this.addIntact(e);
  }

  /** 청크 언로드 — 그 청크가 실어온 site 랜드마크 등록 해제(파괴 이력·잔해는 유지). */
  unregisterSites(owner: string): void {
    const list = this.byOwner.get(owner);
    if (!list) return;
    for (const e of list) {
      this.removeIntact(e);
      const ai = this.active.indexOf(e);
      if (ai >= 0) this.active.splice(ai, 1);
      this.abducting.delete(e.id);
      this.recentlyDestroyed = this.recentlyDestroyed.filter((r) => r.entry !== e);
    }
    this.byOwner.delete(owner);
  }

  private addToMesh(mesh: THREE.Mesh, e: BEntry): void {
    const list = this.byMesh.get(mesh);
    if (list) list.push(e);
    else this.byMesh.set(mesh, [e]);
  }

  private addIntact(e: BEntry): void {
    this.byId.set(e.id, e);
    const key = cellKey(e.cx, e.cz);
    const cell = this.grid.get(key);
    if (cell) cell.push(e);
    else this.grid.set(key, [e]);
  }

  private removeIntact(e: BEntry): void {
    this.byId.delete(e.id);
    const cell = this.grid.get(cellKey(e.cx, e.cz));
    if (cell) {
      const i = cell.indexOf(e);
      if (i >= 0) cell.splice(i, 1);
    }
  }

  /** 청크 언로드 — 그 메시에 속한 건물 등록 해제(파괴 이력·잔해 더미는 유지). */
  unregisterMesh(mesh: THREE.Mesh): void {
    const list = this.byMesh.get(mesh);
    if (!list) return;
    for (const e of list) {
      this.removeIntact(e);
      const ai = this.active.indexOf(e);
      if (ai >= 0) this.active.splice(ai, 1);
      this.abducting.delete(e.id); // 언로드된 청크의 납치 진행분 정리(커터는 anchor null 로 해제 인지)
    }
    // 언로드된 청크 소속 파괴 이력은 되돌림 후보에서 제외(지오메트리 참조가 더 이상 유효하지 않음)
    this.recentlyDestroyed = this.recentlyDestroyed.filter((r) => r.entry.mesh !== mesh);
    this.byMesh.delete(mesh);
  }

  // ─────────────────────────── 표적 질의(EnemyManager) ───────────────────────────

  /** (x,z) 에서 maxR 안의 가장 가까운 살아있는 건물/랜드마크. 없으면 null. */
  nearestTarget(x: number, z: number, maxR: number): { id: string; x: number; y: number; z: number } | null {
    const cr = Math.ceil(maxR / GRID_CELL);
    const cx0 = Math.floor(x / GRID_CELL), cz0 = Math.floor(z / GRID_CELL);
    let best: BEntry | null = null, bestD = maxR * maxR;
    for (let dz = -cr; dz <= cr; dz++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const cell = this.grid.get(`${cx0 + dx}:${cz0 + dz}`);
        if (!cell) continue;
        for (const e of cell) {
          const d = (e.cx - x) ** 2 + (e.cz - z) ** 2;
          if (d < bestD) { bestD = d; best = e; }
        }
      }
    }
    return best ? { id: best.id, x: best.cx, y: best.aimY, z: best.cz } : null;
  }

  /**
   * 최근접 랜드마크(intact) — 어그로 변조(`aggro: "landmark"`, 06-missions 훅 ④)용.
   * 랜드마크는 소수라 반경 제한 없이 전수 탐색(전장 반대편이라도 직행 표적이 된다).
   */
  nearestLandmark(x: number, z: number): { id: string; x: number; y: number; z: number; cls?: EntanglementClass; name?: string } | null {
    let best: BEntry | null = null, bestD = Infinity;
    for (const e of this.byId.values()) {
      if (!e.isLandmark || e.state !== "intact") continue;
      const d = (e.cx - x) ** 2 + (e.cz - z) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best
      ? { id: best.id, x: best.cx, y: best.aimY, z: best.cz, ...(best.cls ? { cls: best.cls } : {}), ...(best.name ? { name: best.name } : {}) }
      : null;
  }

  /**
   * 랜드마크 전수 순회(미니맵 마커용) — 승격 건물과 **site 랜드마크를 함께** 준다.
   * site(해변·가트·교량)는 렌더 바인딩이 없어 footprint 경로(MinimapSink.landmark)로는
   * 영영 안 보인다 — 바라나시는 큐레이션 11개 중 5개가 site 다.
   * 파괴분도 넘긴다(사수 미션에서 "무엇이 무너졌나"가 정보다). 할당 없이 콜백.
   */
  forEachLandmark(fn: (x: number, z: number, intact: boolean, cls?: EntanglementClass, name?: string) => void): void {
    for (const e of this.byId.values()) {
      if (!e.isLandmark) continue;
      fn(e.cx, e.cz, e.state === "intact", e.cls, e.name);
    }
  }

  /** 표적 좌표를 out 에 채움 — 살아있는(intact) 건물이면 true. */
  targetPos(id: string, out: THREE.Vector3): boolean {
    const e = this.byId.get(id);
    if (!e || e.state !== "intact") return false;
    out.set(e.cx, e.aimY, e.cz);
    return true;
  }

  // ─────────────────────────── 의존성 절단(납치 — 커터/W4) ───────────────────────────

  /** 커터 부착 지점(건물 상단) — 살아있는 건물이면 true. */
  targetTop(id: string, out: THREE.Vector3): boolean {
    const e = this.byId.get(id);
    if (!e || e.state !== "intact") return false;
    out.set(e.cx, (e.topY ?? e.aimY) + 4, e.cz); // 메시 건물은 옥상, Group 랜드마크(topY 없음)는 조준 높이
    return true;
  }

  /** 납치 개시 — 표적/피해 대상에서 제외되고 부양 시작. 커터의 절단 채널 완료가 호출. */
  beginAbduct(id: string): boolean {
    const e = this.byId.get(id);
    if (!e || e.state !== "intact") return false;
    this.removeIntact(e);
    e.state = "abducting";
    e.lift = 0;
    e.liftDir = 1;
    if (e.mesh) this.snapshotPositions(e); // 병합 메시 바인딩만 정점 스냅샷 필요(Group 은 변환으로 처리)
    this.abducting.set(id, e);
    return true;
  }

  /** 납치 해제(커터 격추) — 재안착 하강으로 전환. lift 0 도달 시 intact 복원. */
  releaseAbduct(id: string): void {
    const e = this.abducting.get(id);
    if (e) e.liftDir = -1;
  }

  /** 납치 중 건물의 현재 상단 좌표 — 커터가 얹혀 상승을 동반하는 기준점. 없으면 null(소거/복원됨). */
  abductAnchor(id: string): { x: number; y: number; z: number } | null {
    const e = this.abducting.get(id);
    if (!e) return null;
    return { x: e.cx, y: (e.topY ?? e.aimY) + (e.lift ?? 0), z: e.cz };
  }

  /**
   * W4 복구 사격(mend) — 수동 빔이 납치 중 건물에 닿으면 부양 고도를 깎는다(재안착 가속).
   * "관측이 존재를 막 위에 다시 고정한다". 적중한 납치 건물이 있으면 true.
   */
  mendAt(x: number, z: number, power: number): boolean {
    for (const e of this.abducting.values()) {
      const r = Math.max(e.rx, e.rz) + 6;
      if ((e.cx - x) ** 2 + (e.cz - z) ** 2 <= r * r) {
        e.lift = Math.max(0, (e.lift ?? 0) - power);
        if (e.lift <= 0) e.liftDir = -1; // 바닥 도달 — 다음 update 가 intact 복원
        return true;
      }
    }
    return false;
  }

  /** 납치 진행 수(HUD/미션/테스트). */
  get abductingCount(): number {
    return this.abducting.size;
  }

  /** 납치 부양 1프레임 — 상승/재안착, 소거·복원 전이. update() 에서 호출. */
  private tickAbduct(dt: number): void {
    if (this.abducting.size === 0) return;
    for (const e of [...this.abducting.values()]) {
      e.lift = (e.lift ?? 0) + (e.liftDir === -1 ? -ABDUCT_LIFT_SPEED * ABDUCT_RELEASE_MUL : ABDUCT_LIFT_SPEED) * dt;
      if (e.liftDir === -1 && e.lift <= 0) { this.reanchor(e); continue; }
      if (e.lift >= ABDUCT_HEIGHT) { this.finishAbduct(e); continue; }
      const t01 = clamp01(e.lift / ABDUCT_HEIGHT);
      if (e.group) {
        e.group.position.y = (e.baseGroupY ?? 0) + e.lift;
        this.tintLandmark(e, 0.2 + t01 * 0.6, ABDUCT_TINT);
      } else {
        this.liftBuilding(e, t01); // 승격 랜드마크 포함 — 병합 메시는 정점 이동으로 부양
      }
    }
  }

  /** 병합 메시 정점 범위를 lift 만큼 수직 이동 + 창백한 틴트(막 결합이 끊긴 빛). */
  private liftBuilding(e: BEntry, t01: number): void {
    if (!e.mesh || !e.origPos) return;
    const pos = e.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const o = e.origPos, v = e.vStart!, n = e.vCount!;
    const lift = e.lift ?? 0;
    for (let k = 0; k < n; k++) pos.setXYZ(v + k, o[k * 3], o[k * 3 + 1] + lift, o[k * 3 + 2]);
    pos.needsUpdate = true;
    this.tint(e, 0.2 + t01 * 0.65, ABDUCT_TINT);
  }

  /** 재안착 — 원위치·원색 복원 후 intact 재등록(표적/피해 대상 복귀). */
  private reanchor(e: BEntry): void {
    this.abducting.delete(e.id);
    if (e.group) {
      e.group.position.y = e.baseGroupY ?? 0;
      this.tintLandmark(e, clamp01(1 - e.hp / e.maxHp) * 0.9);
    } else if (e.mesh && e.origPos) {
      const pos = e.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const o = e.origPos, v = e.vStart!, n = e.vCount!;
      for (let k = 0; k < n; k++) pos.setXYZ(v + k, o[k * 3], o[k * 3 + 1], o[k * 3 + 2]);
      pos.needsUpdate = true;
      this.tint(e, clamp01(1 - e.hp / e.maxHp) * 0.9);
    }
    e.state = "intact";
    e.lift = 0;
    this.byId.set(e.id, e);
    const key = cellKey(e.cx, e.cz);
    const cell = this.grid.get(key);
    if (cell) cell.push(e);
    else this.grid.set(key, [e]);
  }

  /** 소거 — 균열 도달. 잔해 없음(붕괴가 아니라 반출) — 셸만 매장하고 파괴 집계·이력 기록. */
  private finishAbduct(e: BEntry): void {
    this.abducting.delete(e.id);
    e.state = "rubble";
    this.destroyed.set(e.id, { cx: e.cx, cz: e.cz, isLandmark: e.isLandmark });
    if (e.group) e.group.visible = false;
    else this.buryShell(e); // 병합 메시(승격 랜드마크 포함) — 셸 매장
    if (e.isLandmark) this.destroyedLandmarks++;
    else this.destroyedBuildings++;
    this.collision?.openBuildingAt(e.cx, e.cz);
    this.onDestroyed?.(e.isLandmark, e.cx, e.aimY, e.cz);
  }

  // ─────────────────────────── 피해/파괴 ───────────────────────────

  /** 건물에 피해 — 점진 적색 틴트, 체력 0 이면 파괴(번쩍 + 슬로우 붕괴) 개시. */
  damage(id: string, amount: number): DamageResult {
    const e = this.byId.get(id);
    if (!e || e.state !== "intact") return "none";
    e.hp -= amount;
    if (e.hp <= 0) {
      e.hp = 0;
      this.beginDestroy(e);
      return "destroyed";
    }
    const t = clamp01(1 - e.hp / e.maxHp) * 0.9;
    if (e.group) this.tintLandmark(e, t);
    else this.tint(e, t);
    return "hit";
  }

  /**
   * 링크 리와인드(물리편 §2.8.3) — (x,z) 반경 안에서 maxAgeSec 이내(≤LINK_REWIND_RETAIN)에 파괴된
   * 건물/랜드마크를 원상 복구한다(체력·형상·틴트·충돌·파괴 집계 전부 원복). 되돌린 개수를 반환.
   * "얽힘 업링크는 벌크 경유라 막의 시간 순서에 엄격히 안 묶인다" — 무회복 게임의 억울사 완충 장치.
   */
  undoDestructionNear(x: number, z: number, radius: number, maxAgeSec: number): number {
    const rsq = radius * radius;
    let n = 0;
    for (let i = this.recentlyDestroyed.length - 1; i >= 0; i--) {
      const rec = this.recentlyDestroyed[i];
      if (this.clock - rec.at > maxAgeSec) continue; // 요청 창보다 오래됨(단, 보존 자체는 계속)
      const e = rec.entry;
      if ((e.cx - x) ** 2 + (e.cz - z) ** 2 > rsq) continue;
      this.restoreIntact(e);
      this.recentlyDestroyed.splice(i, 1); // 소모 — 중복 복원 방지
      n++;
    }
    return n;
  }

  /** beginDestroy 의 역 — 형상·틴트·충돌·집계를 전부 원상태로. 붕괴 애니메이션 도중이어도 즉시 복원(스냅). */
  private restoreIntact(e: BEntry): void {
    const ai = this.active.indexOf(e);
    if (ai >= 0) this.active.splice(ai, 1); // 진행 중이던 flash/collapsing 연출 중단
    if (e.group) {
      e.group.visible = true;
      e.group.position.y = e.baseGroupY ?? e.group.position.y;
      if (e.baseScaleY !== undefined) e.group.scale.y = e.baseScaleY;
      this.tintLandmark(e, 0); // t=0 → 원색 복원
    } else if (e.mesh && e.origPos) {
      const pos = e.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const o = e.origPos, v = e.vStart!, n = e.vCount!;
      for (let k = 0; k < n; k++) pos.setXYZ(v + k, o[k * 3], o[k * 3 + 1], o[k * 3 + 2]);
      pos.needsUpdate = true;
      this.tint(e, 0);
    }
    if (e.isLandmark) this.destroyedLandmarks = Math.max(0, this.destroyedLandmarks - 1);
    else this.destroyedBuildings = Math.max(0, this.destroyedBuildings - 1);
    e.hp = e.maxHp;
    e.state = "intact";
    e.anim = 0;
    this.placeRubble(e, 0); // 잔해 더미 축소(id 슬롯은 유지 — 재파괴 시 재사용)
    this.destroyed.delete(e.id); // 재로드 시 다시 잔해로 복원되지 않도록
    this.collision?.closeBuildingAt(e.cx, e.cz);
    this.addIntact(e);
  }

  private beginDestroy(e: BEntry): void {
    this.removeIntact(e);
    this.destroyed.set(e.id, { cx: e.cx, cz: e.cz, isLandmark: e.isLandmark });
    e.state = "flash";
    e.anim = 0;
    this.active.push(e);
    if (e.group) this.flashLandmark(e);
    else this.tint(e, 1, FLASH_COLOR); // 즉시 번쩍(병합 메시 — 승격 랜드마크 포함)
    if (e.isLandmark) this.destroyedLandmarks++;
    else this.destroyedBuildings++;
    this.placeRubble(e, 0); // 잔해 더미 슬롯 확보(스케일 0 → 붕괴와 함께 자라남)
    this.collision?.openBuildingAt(e.cx, e.cz); // 잔해 위 통과 가능
    this.onDestroyed?.(e.isLandmark, e.cx, e.aimY, e.cz);
    this.recentlyDestroyed.push({ entry: e, at: this.clock }); // 링크 리와인드(§2.8.3) 되돌림 후보
  }

  // ── 잔해 더미(InstancedMesh) ──

  /** 건물 id 의 잔해 더미를 s01(0~1) 스케일로 배치. 슬롯은 id 당 1회 할당(재로드 재사용). */
  private placeRubble(e: BEntry, s01: number): void {
    if (!this.rubble) return;
    let slot = this.rubbleSlot.get(e.id);
    if (slot === undefined) {
      if (this.rubbleCount >= MAX_RUBBLE) return; // 상한 — 비주얼 생략(집계는 유지)
      slot = this.rubbleCount++;
      this.rubbleSlot.set(e.id, slot);
      this.rubble.count = this.rubbleCount;
    }
    const baseY = e.group ? (e.baseGroupY ?? 0) : (e.baseY ?? 0);
    const s = Math.max(1e-3, s01);
    _pos.set(e.cx, baseY, e.cz);
    _quat.setFromAxisAngle(_YAXIS, hash1(slot) * Math.PI * 2);
    _scl.set(e.rx * 2 * s, e.rubbleH * s, e.rz * 2 * s);
    _m4.compose(_pos, _quat, _scl);
    this.rubble.setMatrixAt(slot, _m4);
    this.rubble.instanceMatrix.needsUpdate = true;
  }

  // ── 일반 건물 정점 갱신 ──

  private ensureBaseColors(e: BEntry): void {
    if (e.baseColors || !e.mesh) return;
    const col = e.mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!col) return;
    const v = e.vStart!, n = e.vCount!;
    const buf = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      buf[k * 3] = col.getX(v + k);
      buf[k * 3 + 1] = col.getY(v + k);
      buf[k * 3 + 2] = col.getZ(v + k);
    }
    e.baseColors = buf;
  }

  /** 건물 정점색을 원본→target 으로 t 만큼 보간(target 기본 = 붉은색). */
  private tint(e: BEntry, t: number, target = DAMAGE_RED): void {
    if (!e.mesh) return;
    this.ensureBaseColors(e);
    const base = e.baseColors;
    if (!base) return;
    const col = e.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const v = e.vStart!, n = e.vCount!;
    for (let k = 0; k < n; k++) {
      col.setXYZ(
        v + k,
        base[k * 3] + (target.r - base[k * 3]) * t,
        base[k * 3 + 1] + (target.g - base[k * 3 + 1]) * t,
        base[k * 3 + 2] + (target.b - base[k * 3 + 2]) * t
      );
    }
    col.needsUpdate = true;
  }

  private snapshotPositions(e: BEntry): void {
    if (e.origPos || !e.mesh) return;
    const pos = e.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const v = e.vStart!, n = e.vCount!;
    const buf = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      buf[k * 3] = pos.getX(v + k);
      buf[k * 3 + 1] = pos.getY(v + k);
      buf[k * 3 + 2] = pos.getZ(v + k);
    }
    e.origPos = buf;
  }

  /** 붕괴 진행 — 윗부분이 더 크게 흩어지며 바닥으로 가라앉음(와르르). 셸은 잦아들어 잔해 더미 아래로 사라짐. */
  private collapseBuilding(e: BEntry, p: number): void {
    if (!e.mesh || !e.origPos) return;
    const eased = smooth(p);
    const pos = e.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const o = e.origPos, v = e.vStart!, n = e.vCount!;
    const base = e.baseY!, span = Math.max(1, e.topY! - e.baseY!);
    for (let k = 0; k < n; k++) {
      const ox = o[k * 3], oy = o[k * 3 + 1], oz = o[k * 3 + 2];
      const h01 = clamp01((oy - base) / span); // 높을수록 더 무너짐
      const r = hash1(v + k);
      const spread = h01 * 1.6 * eased;
      const ang = r * Math.PI * 2;
      const ny = base + (oy - base) * (1 - eased) * (0.82 + 0.18 * r);
      pos.setXYZ(v + k, ox + Math.cos(ang) * spread, ny, oz + Math.sin(ang) * spread);
    }
    pos.needsUpdate = true;
    this.tint(e, 1, new THREE.Color().lerpColors(DAMAGE_RED, RUBBLE_DARK, eased)); // 붉은색 → 거의 검정
  }

  /** 셸(병합 정점)을 지하로 묻어 가림 — 잔해 더미(순수 검정)만 보이게. */
  private buryShell(e: BEntry): void {
    if (!e.mesh) return;
    this.snapshotPositions(e);
    const pos = e.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const o = e.origPos!, v = e.vStart!, n = e.vCount!;
    const y = (e.baseY ?? 0) - 4;
    for (let k = 0; k < n; k++) pos.setXYZ(v + k, o[k * 3], y, o[k * 3 + 2]);
    pos.needsUpdate = true;
  }

  /** 재로드된 청크의 이미 파괴된 건물 — 셸은 즉시 지하로 묻고 잔해 더미만 표시. */
  private restoreRubbleBuilding(e: BEntry): void {
    e.state = "rubble";
    this.buryShell(e);
    this.placeRubble(e, 1);
    this.collision?.openBuildingAt(e.cx, e.cz);
  }

  // ── 랜드마크 Group 변환 ──

  private ensureMatColors(e: BEntry): void {
    if (e.matColors || !e.group) return;
    const out: BEntry["matColors"] = [];
    e.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.color) out!.push({ mat: m, r: m.color.r, g: m.color.g, b: m.color.b });
    });
    e.matColors = out;
  }

  private tintLandmark(e: BEntry, t: number, target = DAMAGE_RED): void {
    this.ensureMatColors(e);
    for (const mc of e.matColors ?? []) {
      mc.mat.color.setRGB(
        mc.r + (target.r - mc.r) * t,
        mc.g + (target.g - mc.g) * t,
        mc.b + (target.b - mc.b) * t
      );
    }
  }

  private flashLandmark(e: BEntry): void {
    this.ensureMatColors(e);
    for (const mc of e.matColors ?? []) {
      mc.mat.emissive.copy(FLASH_COLOR);
      mc.mat.emissiveIntensity = 1;
    }
  }

  private collapseLandmark(e: BEntry, p: number): void {
    if (!e.group) return;
    const eased = smooth(p);
    e.group.scale.y = (e.baseScaleY ?? 1) * (1 - 0.92 * eased); // 주저앉음
    e.group.scale.x = e.group.scale.z = 1 + 0.15 * eased;
    e.group.position.y = (e.baseGroupY ?? 0) - eased * 1.5;
    for (const mc of e.matColors ?? []) mc.mat.emissiveIntensity = 1 - eased;
    this.tintLandmark(e, 1, new THREE.Color().lerpColors(DAMAGE_RED, RUBBLE_DARK, eased));
  }

  private restoreRubbleLandmark(e: BEntry): void {
    e.state = "rubble";
    if (e.group) e.group.visible = false; // 원형 숨기고 잔해 더미만
    this.placeRubble(e, 1);
    this.collision?.openBuildingAt(e.cx, e.cz);
  }

  /** 스트리밍 충돌 재구축 후 — 파괴된 건물 콜라이더를 다시 개방(통과 유지). */
  reopenDestroyed(): void {
    if (!this.collision) return;
    for (const d of this.destroyed.values()) this.collision.openBuildingAt(d.cx, d.cz);
  }

  // ─────────────────────────── 매 프레임 연출 ───────────────────────────

  update(dt: number): void {
    this.clock += dt;
    while (this.recentlyDestroyed.length && this.clock - this.recentlyDestroyed[0].at > LINK_REWIND_RETAIN) {
      this.recentlyDestroyed.shift();
    }
    this.tickAbduct(dt); // 납치 부양/재안착(커터·W4)
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.anim += dt;
      if (e.state === "flash") {
        if (e.anim >= FLASH_DUR) {
          e.state = "collapsing";
          e.anim = 0;
          if (e.mesh) this.snapshotPositions(e);
        }
        continue;
      }
      if (e.state === "collapsing") {
        const p = e.anim / COLLAPSE_DUR;
        if (e.group) this.collapseLandmark(e, p);
        else this.collapseBuilding(e, p); // 승격 랜드마크도 병합 메시라 정점 붕괴
        this.placeRubble(e, smooth(p)); // 잔해 더미가 붕괴와 함께 쌓여 오름
        if (p >= 1) {
          e.state = "rubble";
          if (e.group) e.group.visible = false;
          else this.buryShell(e); // 셸 매장 → 순수 검정 잔해 더미만 남김
          this.placeRubble(e, 1);
          this.active.splice(i, 1);
        }
      }
    }
  }
}
