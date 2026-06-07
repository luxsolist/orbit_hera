import * as THREE from "three";
import type { SceneCtx } from "./CinematicPlayer";
import { DEFAULT_PLASMOID, colorAt, colorWeight, sampleTemp } from "../enemies/PlasmoidSpec";
import { lerp } from "../core/math";

// 인트로 공용 헬퍼 — 순수 수학(ease/rng/lump), 카메라/회전, 메시 팩토리, 군집(InstancedMesh) 유틸.
// 씬별 로직은 scenes.ts 가 보유하고, 여기서 재사용 가능한 빌딩블록만 제공한다.

// ─────────────────────────── 순수 수학 ───────────────────────────

/** ease-in-out quadratic — [0,1] 단조 증가, 양 끝 평탄. */
export const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

/** 결정적 난수(시드 고정 — 재생마다 동일 별/바위). 0..1 반환. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** 코히런트(부드러운) 노이즈 ~[-1,1] — 인접 정점이 비슷한 값 → 누더기 스파이크 대신 완만한 굴곡. */
export function lump(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 1.7 + y * 0.6) +
    Math.sin(y * 2.1 + z * 1.2) +
    Math.sin(z * 1.5 + x * 0.9) +
    0.5 * Math.sin((x + y + z) * 3.1)
  ) / 3.5;
}

// ─────────────────────────── 공용 상수 ───────────────────────────

// 플라즈모이드 색·강함 시스템(PlasmoidSpec)과 공유하는 색 stop. 인트로의 휴면 코어/코어/군집 색을 여기서 파생.
const PLAS_STOPS = DEFAULT_PLASMOID.color.stops;
const PLAS_WMAX = PLAS_STOPS[PLAS_STOPS.length - 1].weight;
export const DORMANT_TEMP = 4500; // 휴면 코어 통일 온도(오렌지 stop)
export const CORE_TEMP = DORMANT_TEMP; // 코어 시작 색 — 휴면 코어와 동일한 밝은 오렌지(성장 시작 전 연속성)
export const DORMANT_ORANGE = colorAt(PLAS_STOPS, DORMANT_TEMP); // 외계 휴면 코어 통일 색(밝은 오렌지) — 시스템(온도→색)에서 산출. 씬2 분산~씬3 낙하/입수/침강 공통
export const PLAS_STRONG = colorAt(PLAS_STOPS, PLAS_STOPS[PLAS_STOPS.length - 1].temp); // 가장 강한 개체 색(최고 온도=청백) — 시스템 산출. 씬6 집 붕괴 플라즈모이드
export const SPACE_COL = new THREE.Color(0x04060c);
export const DEEP_COL = new THREE.Color(0x0e3a4e); // 심해(현실보다 밝게 — 배경이 보이도록)
export const SPIN_RATE = 0.55; // rad/s — 럭비공처럼 긴 축 둘레로 천천히 스크류 회전
export const FWD1 = new THREE.Vector3(1, 0, 0); // 씬1 비행/장축 방향

// ─────────────────────────── 카메라 / 회전 ───────────────────────────

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
/** 카메라를 from→to 로 이징 이동시키며 lookAt 고정. */
export function track(ctx: SceneCtx, k: number, from: number[], to: number[], look: THREE.Vector3): void {
  const e = ease(Math.min(1, Math.max(0, k)));
  ctx.camera.position.lerpVectors(_from.fromArray(from), _to.fromArray(to), e);
  ctx.camera.lookAt(look);
}

const _qAlign = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _XAXIS = new THREE.Vector3(1, 0, 0); // 지오메트리 긴 축(local +X = scale 3.4)
/** 소행성을 "긴 축(local +X)=비행 방향 fwd"으로 정렬 + 그 축 둘레로 theta 만큼 스크류 회전. */
export function spinAlong(rock: THREE.Object3D, fwd: THREE.Vector3, theta: number): void {
  _qAlign.setFromUnitVectors(_XAXIS, fwd);
  _qSpin.setFromAxisAngle(_XAXIS, theta);
  rock.quaternion.multiplyQuaternions(_qAlign, _qSpin);
}

// ─────────────────────────── 군집(InstancedMesh) ───────────────────────────

/** 인트로 군집 생성(공통 설정: frustumCulled off + name). */
export function makeSwarm(
  geom: THREE.BufferGeometry,
  mat: THREE.Material,
  count: number,
  name: string
): THREE.InstancedMesh {
  const inst = new THREE.InstancedMesh(geom, mat, count);
  inst.name = name;
  inst.frustumCulled = false;
  return inst;
}

/** Object3D.userData 를 타입 T 로 쓰기/읽기 — 군집 상태(병렬 Float32Array 등) 캐스트를 한 곳으로. */
export const setState = <T extends object>(o: THREE.Object3D, state: T): T => ((o.userData = state), state);
export const getState = <T>(o: THREE.Object3D): T => o.userData as T;

const _swarmM4 = new THREE.Matrix4();
/** 군집의 각 인스턴스를 place(i, m4)로 배치 → setMatrixAt + needsUpdate(매 프레임 Matrix4 재사용). */
export function updateSwarm(
  inst: THREE.InstancedMesh,
  place: (i: number, m4: THREE.Matrix4) => void
): void {
  for (let i = 0; i < inst.count; i++) {
    place(i, _swarmM4);
    inst.setMatrixAt(i, _swarmM4);
  }
  inst.instanceMatrix.needsUpdate = true;
}

// ─────────────────────────── 메시 / 텍스처 팩토리 ───────────────────────────

export function starfield(count: number, seed: number): THREE.Points {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const rad = 600 + r() * 1600;
    const th = r() * Math.PI * 2;
    const ph = Math.acos(2 * r() - 1);
    pos[i * 3] = rad * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = rad * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = rad * Math.cos(ph);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xcfe2ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.9 });
  const p = new THREE.Points(g, m);
  p.name = "stars";
  return p;
}

export function sun(): THREE.Mesh {
  // MeshBasic(밝은 흰노랑) → Bloom 임계 초과로 발광
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(26, 2), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
  mesh.position.set(-420, 70, -780);
  return mesh;
}

export function oumuamua(): THREE.Mesh {
  // 세분화 ↑(누더기 방지) + 구면에 코히런트 변위(완만한 굴곡, 면 뒤집힘/내부 비침 없음).
  const g = new THREE.IcosahedronGeometry(2.4, 4);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const d = 1 + lump(v.x * 2.6, v.y * 2.6, v.z * 2.6) * 0.085; // 완만한 굴곡
    v.multiplyScalar(2.4 * d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(3.4, 0.92, 1.15); // 시가/팬케이크형
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ color: 0x9a8f7e, roughness: 0.95, metalness: 0, flatShading: true })
  );
  mesh.name = "rock";
  return mesh;
}

export function lights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x3a4a64, 1.7)); // 어두운 면도 보이도록 앰비언트 ↑
  const key = new THREE.DirectionalLight(0xfff0d2, 3.2); // 태양 키라이트(역광 림)
  key.position.set(-420, 70, -780);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88a6cc, 1.7); // 카메라 쪽 푸른 필 → 정면도 보이게
  fill.position.set(300, 60, 240);
  scene.add(fill);
}

/** 태평양 중심의 지구 표면 텍스처(캔버스 equirectangular — 가로 중앙 = 태평양). */
export function earthTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  // 바다
  g.fillStyle = "#0f4a78";
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1200; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 8 + Math.random() * 38;
    g.fillStyle = `rgba(${(18 + Math.random() * 28) | 0},${(78 + Math.random() * 40) | 0},${(128 + Math.random() * 40) | 0},0.06)`;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  }
  const blob = (x: number, y: number, rx: number, ry: number, rot: number, col: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(0, 0, rx, ry, 0, 0, 7);
    g.fill();
    g.restore();
  };
  const LAND = "#3f6e3a", LAND2 = "#56823f", DESERT = "#b09a5e", FOREST = "#2f5e30";
  // 유라시아(크게, 왼쪽~중앙 좌)
  blob(190, 150, 210, 122, -0.18, LAND); blob(118, 130, 96, 72, 0.1, DESERT); blob(300, 205, 120, 70, 0.2, FOREST); blob(360, 162, 72, 52, -0.1, LAND);
  // 호주
  blob(300, 330, 96, 62, 0.1, DESERT); blob(330, 345, 52, 36, 0, LAND2);
  // 북미(크게, 오른쪽~중앙 우)
  blob(810, 150, 166, 122, 0.12, LAND); blob(748, 108, 92, 64, -0.1, FOREST); blob(882, 210, 76, 56, 0, DESERT); blob(700, 175, 60, 44, 0.1, LAND);
  // 남미 / 아프리카(가장자리)
  blob(836, 330, 78, 122, -0.14, FOREST); blob(810, 285, 52, 60, 0, LAND);
  blob(8, 250, 86, 112, 0, DESERT); blob(1016, 250, 86, 112, 0, DESERT);
  g.fillStyle = "#e8eef2";
  g.fillRect(0, 0, W, 28); // 북극
  g.fillRect(0, H - 32, W, 32); // 남극
  blob(762, 70, 40, 22, 0, "#dfeaf0"); // 그린란드
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 실감형 지구(텍스처 + 대기 림). 태평양이 +Z(카메라)를 향함. earth 라는 이름의 Group. */
export function earth(radius: number): THREE.Group {
  const grp = new THREE.Group();
  grp.name = "earth";
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.92, metalness: 0 })
  );
  globe.rotation.y = -Math.PI / 2; // 텍스처 중앙(태평양)을 +Z 로
  grp.add(globe);
  // 대기 림(뒤집힌 면 + 가산 블렌딩) — 거의 보일락말락 희미하게(색상 유지)
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.02, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x6aa6e0, transparent: true, opacity: 0.07, side: THREE.BackSide, blending: THREE.AdditiveBlending })
  );
  grp.add(atmo);
  return grp;
}

/** 멀리 보이는 달 — 흰/회색, 매끈한 원(변위 없음 + 스무스 셰이딩). */
export function moon(radius: number): THREE.Mesh {
  const g = new THREE.SphereGeometry(radius, 44, 32); // 매끈한 구
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color(0xdadad3), dark = new THREE.Color(0x9a9ca4);
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = lump(v.x * 3 + 2, v.y * 3, v.z * 3); // 옅은 회색 바다 패치(요철 없음)
    c.copy(base).lerp(dark, n > 0.1 ? 0.38 : 0.05);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false }));
}

/** 해저 지형(변위 평면) — 어둡고 군데군데 해구. */
export function seabed(): THREE.Mesh {
  const g = new THREE.PlaneGeometry(240, 240, 44, 44);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = lump(x * 0.06, 0, z * 0.06) * 6 + lump(x * 0.18 + 3, 0, z * 0.18) * 2 - Math.abs(lump(x * 0.03, 7, z * 0.03)) * 9;
    pos.setY(i, h);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x16242c, roughness: 1, flatShading: true }));
}

/** 박동하는 발광 코어(유기 구체). 발광색은 온도(temp)→colorAt 시스템에서 파생. */
export function makeCore(radius: number, temp: number, emis = 2.4): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(radius, 3);
  const pos = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(radius * (1 + lump(v.x * 2 + 2, v.y * 2, v.z * 2) * 0.12));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a0a08, emissive: colorAt(PLAS_STOPS, temp), emissiveIntensity: emis, roughness: 0.5, flatShading: true }));
  mesh.name = "core";
  return mesh;
}

/**
 * 플라즈모이드 군집 — 색·강함을 PlasmoidSpec 시스템에서 산출(약=적색/강=청백).
 * 인스턴스마다 온도를 저온(약체) 편향으로 뽑아 colorAt 으로 발광색을 정하고,
 * 정규화 가중치 wn(0=적색~1=청백)을 userData 에 실어 씬이 크기에 반영(강할수록 크게)한다.
 */
export function plasmoidSwarm(n: number, seed: number): THREE.InstancedMesh {
  const inst = makeSwarm(new THREE.IcosahedronGeometry(0.6, 1), new THREE.MeshBasicMaterial(), n, "plasmoids");
  const r = rng(seed), c = new THREE.Color();
  const tMin = PLAS_STOPS[0].temp, tMax = PLAS_STOPS[PLAS_STOPS.length - 1].temp;
  const alpha = DEFAULT_PLASMOID.spawn.tempAlpha;
  const wn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const temp = sampleTemp(tMin, tMax, alpha, r()); // f(T)∝T^-α — 저온(약체·적색) 다수, 고온(청백) 희귀
    c.set(colorAt(PLAS_STOPS, temp)).multiplyScalar(1.5); // Bloom 발광
    inst.setColorAt(i, c);
    wn[i] = (colorWeight(PLAS_STOPS, temp) - 1) / (PLAS_WMAX - 1); // 0..1
  }
  inst.userData = { wn };
  return inst;
}

/** 수중 조명(위에서 스며드는 빛). */
export function underLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x2e5c74, 2.1)); // 밝은 수중 앰비언트
  const top = new THREE.DirectionalLight(0x8ec4e2, 2.3);
  top.position.set(12, 90, 24);
  scene.add(top);
}

/** 붕괴 조각 1개 — 원위치(home)에서 잔해위치(rest)로 중력 낙하 + 텀블. 결정적 파라미터. */
export interface Frag {
  mesh: THREE.Mesh;
  home: THREE.Vector3; // 무너지기 전 제자리
  rest: THREE.Vector3; // 다 무너진 뒤 잔해 더미 위치
  axis: THREE.Vector3; // 텀블 회전축
  spin: number; // 총 회전량(rad)
  delay: number; // 붕괴 트리거 후 시작 지연(조각마다 어긋나게 → "와르르")
  fall: number; // 낙하 소요 시간
}

/**
 * 박스 영역을 nx×ny×nz 격자 조각으로 쪼개 group 에 추가하고 Frag[] 반환.
 * 각 조각은 제자리에서 중력으로 떨어져(수직 가속) 약간 흩어지며 잔해 더미로 쌓인다(선물상자식 회전 ✗).
 */
export function shatterBox(
  group: THREE.Group,
  mat: THREE.Material,
  center: [number, number, number],
  size: [number, number, number],
  grid: [number, number, number],
  r: () => number,
  opts: { scatter: number; rubbleY: number; spin: number; stagger: number; fallMin: number; fallMax: number }
): Frag[] {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size;
  const [nx, ny, nz] = grid;
  const fx = sx / nx, fy = sy / ny, fz = sz / nz;
  const frags: Frag[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        // 격자에 빈틈없이 딱 맞는 크기 → 무너지기 전엔 매끈한 한 면으로 보이고, 붕괴 시에만 갈라짐
        const m = new THREE.Mesh(new THREE.BoxGeometry(fx, fy, fz), mat);
        const hx = cx - sx / 2 + fx * (i + 0.5);
        const hy = cy - sy / 2 + fy * (j + 0.5);
        const hz = cz - sz / 2 + fz * (k + 0.5);
        m.position.set(hx, hy, hz);
        group.add(m);
        frags.push({
          mesh: m,
          home: new THREE.Vector3(hx, hy, hz),
          rest: new THREE.Vector3(
            hx + (r() * 2 - 1) * opts.scatter, // 좌우로 약간 흩어지며
            opts.rubbleY * (0.35 + r() * 1.0), // 바닥 잔해 더미 높이
            hz + (r() * 2 - 1) * opts.scatter
          ),
          axis: new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(),
          spin: opts.spin * (0.4 + r() * 1.0),
          // 높은 조각일수록 살짝 먼저 떨어지게(윗부분부터 무너져 내림)
          delay: r() * opts.stagger * (1 - 0.4 * (hy / Math.max(0.001, cy + sy / 2))),
          fall: opts.fallMin + r() * (opts.fallMax - opts.fallMin),
        });
      }
  return frags;
}

/** 한 조각을 경과시간 te(초)에 맞춰 배치 — 수직은 중력 가속(p²), 수평/회전은 부드럽게 정착(ease). */
export function fallFrag(f: Frag, te: number): void {
  const p = Math.min(1, Math.max(0, (te - f.delay) / f.fall));
  if (p <= 0) return; // 트리거 전 — 제자리 유지
  const pv = p * p; // 중력 가속 낙하
  const ph = ease(p); // 수평 산포·텀블은 정착감 있게
  f.mesh.position.set(lerp(f.home.x, f.rest.x, ph), lerp(f.home.y, f.rest.y, pv), lerp(f.home.z, f.rest.z, ph));
  f.mesh.quaternion.setFromAxisAngle(f.axis, f.spin * ph);
}

/**
 * 비스듬한 사각/삼각 지붕면(네 꼭짓점 c00·c10·c01·c11 의 쌍선형 패치)을 nu×nv 슬래브 조각으로 쪼갠다.
 * 각 조각의 외곽면이 이상적 지붕면 위에 정확히 놓여 인접 셀과 매끈히 맞물림 → 무너지기 전엔 한 장의 경사면.
 * (c01==c11 이면 위 모서리가 한 점으로 모이는 삼각면 = 모임지붕 측면.)
 */
function roofFace(
  group: THREE.Group,
  mat: THREE.Material,
  c00: THREE.Vector3,
  c10: THREE.Vector3,
  c01: THREE.Vector3,
  c11: THREE.Vector3,
  nu: number,
  nv: number,
  thick: number,
  r: () => number,
  opts: { scatter: number; rubbleY: number; spin: number; stagger: number; fallMin: number; fallMax: number }
): Frag[] {
  const frags: Frag[] = [];
  const P = (u: number, v: number) => {
    const ax = c00.x + (c10.x - c00.x) * u, ay = c00.y + (c10.y - c00.y) * u, az = c00.z + (c10.z - c00.z) * u;
    const bx = c01.x + (c11.x - c01.x) * u, by = c01.y + (c11.y - c01.y) * u, bz = c01.z + (c11.z - c01.z) * u;
    return new THREE.Vector3(ax + (bx - ax) * v, ay + (by - ay) * v, az + (bz - az) * v);
  };
  const IDX = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const o0 = P(i / nu, j / nv), o1 = P((i + 1) / nu, j / nv);
      const o2 = P((i + 1) / nu, (j + 1) / nv), o3 = P(i / nu, (j + 1) / nv);
      const n = new THREE.Vector3().subVectors(o1, o0).cross(new THREE.Vector3().subVectors(o3, o0));
      if (n.lengthSq() < 1e-8) continue; // 퇴화 셀(꼭짓점) 건너뜀
      n.normalize().multiplyScalar(-thick); // 두께를 안쪽(지붕면 아래)으로
      const pts = [o0, o1, o2, o3, o0.clone().add(n), o1.clone().add(n), o2.clone().add(n), o3.clone().add(n)];
      const C = new THREE.Vector3();
      for (const p of pts) C.add(p);
      C.multiplyScalar(1 / 8); // 조각 중심 → mesh.position(텀블 회전축의 원점)
      const pos = new Float32Array(24);
      for (let k = 0; k < 8; k++) {
        pos[k * 3] = pts[k].x - C.x;
        pos[k * 3 + 1] = pts[k].y - C.y;
        pos[k * 3 + 2] = pts[k].z - C.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setIndex(IDX);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.position.copy(C);
      group.add(m);
      frags.push({
        mesh: m,
        home: C.clone(),
        rest: new THREE.Vector3(C.x + (r() * 2 - 1) * opts.scatter, opts.rubbleY * (0.35 + r() * 1.0), C.z + (r() * 2 - 1) * opts.scatter),
        axis: new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(),
        spin: opts.spin * (0.4 + r() * 1.0),
        delay: r() * opts.stagger,
        fall: opts.fallMin + r() * (opts.fallMax - opts.fallMin),
      });
    }
  return frags;
}

/** 로우폴리 해변 집(붕괴용 조각 모음) — userData 에 벽/지붕 조각 배열(Frag[]). */
export function beachHouse(): THREE.Group {
  const house = new THREE.Group();
  house.name = "house";
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8c9ad, roughness: 0.95, flatShading: true });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x7c3b2b, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  const r = rng(0x5eed6); // 재생마다 동일한 붕괴 패턴
  const floor = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.4, 5.6), wallMat);
  floor.position.set(0, 0.2, 0);
  house.add(floor);

  // 4면 벽 — 각 면을 10조각 이상으로 쪼개 제자리에서 와르르 무너지게
  const wallOpt = { scatter: 0.7, rubbleY: 0.45, spin: 2.6, stagger: 0.45, fallMin: 0.5, fallMax: 0.95 };
  const wallFrags: Frag[] = [
    ...shatterBox(house, wallMat, [0, 2, -2.5], [6, 4, 0.3], [5, 3, 1], r, wallOpt), // 뒤벽 15
    ...shatterBox(house, wallMat, [-3, 2, 0], [0.3, 4, 5], [1, 3, 5], r, wallOpt), // 왼벽 15
    ...shatterBox(house, wallMat, [3, 2, 0], [0.3, 4, 5], [1, 3, 5], r, wallOpt), // 오른벽 15
    ...shatterBox(house, wallMat, [0, 2, 2.5], [6, 4, 0.3], [5, 3, 1], r, wallOpt), // 앞벽 15
  ];

  // 지붕 — 모임지붕(4면이 비스듬히 능선으로 모임). 각 면을 슬래브 조각으로 쪼개 파사삭 부서져 내림.
  const eaveY = 4.0, ridgeY = 5.7, hx = 3.4, hz = 2.8, rx = hx - hz; // 처마/능선 높이·지붕 반폭(능선은 x로 ±rx)
  const A = new THREE.Vector3(-hx, eaveY, hz), B = new THREE.Vector3(hx, eaveY, hz); // 앞 처마 모서리(좌·우)
  const Cc = new THREE.Vector3(hx, eaveY, -hz), D = new THREE.Vector3(-hx, eaveY, -hz); // 뒤 처마 모서리(우·좌)
  const RL = new THREE.Vector3(-rx, ridgeY, 0), RR = new THREE.Vector3(rx, ridgeY, 0); // 능선 양끝
  const roofOpt = { scatter: 0.5, rubbleY: 0.55, spin: 3.2, stagger: 0.4, fallMin: 0.35, fallMax: 0.7 };
  const roofFrags: Frag[] = [
    ...roofFace(house, roofMat, A, B, RL, RR, 4, 2, 0.18, r, roofOpt), // 앞면(+z) 사다리꼴 8
    ...roofFace(house, roofMat, Cc, D, RR, RL, 4, 2, 0.18, r, roofOpt), // 뒷면(-z) 사다리꼴 8
    ...roofFace(house, roofMat, D, A, RL, RL, 3, 2, 0.18, r, roofOpt), // 왼면(-x) 삼각 6
    ...roofFace(house, roofMat, B, Cc, RR, RR, 3, 2, 0.18, r, roofOpt), // 오른면(+x) 삼각 6
  ];

  house.userData = { wallFrags, roofFrags };
  return house;
}

/** 오렌지 발광 휴면 코어(통일 색). emis: 발광 강도. */
export function makeDormantCore(radius: number, emis: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 1),
    new THREE.MeshStandardMaterial({ color: DORMANT_ORANGE, emissive: DORMANT_ORANGE, emissiveIntensity: emis, roughness: 0.6 })
  );
  m.name = "core3";
  return m;
}
