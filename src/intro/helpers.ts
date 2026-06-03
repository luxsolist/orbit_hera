import * as THREE from "three";
import type { SceneCtx } from "./CinematicPlayer";

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

export const SEED_ORANGE = 0xdf7a2c; // 외계 씨앗 통일 색(오렌지) — 씬2 분산·씬3 낙하 공통
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

/** 박동하는 발광 코어(유기 구체). */
export function makeCore(radius: number, hex: number): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(radius, 3);
  const pos = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(radius * (1 + lump(v.x * 2 + 2, v.y * 2, v.z * 2) * 0.12));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a0a08, emissive: hex, emissiveIntensity: 2.4, roughness: 0.5, flatShading: true }));
  mesh.name = "core";
  return mesh;
}

/** 플라즈모이드 군집 — 발광 구체(약=빨강/강=파랑), instanceColor + Basic → Bloom. */
export function plasmoidSwarm(n: number, seed: number): THREE.InstancedMesh {
  const inst = makeSwarm(new THREE.IcosahedronGeometry(0.6, 1), new THREE.MeshBasicMaterial(), n, "plasmoids");
  const r = rng(seed), red = new THREE.Color(0xff3b30), blue = new THREE.Color(0x4aa6ff), c = new THREE.Color();
  for (let i = 0; i < n; i++) inst.setColorAt(i, c.copy(r() < 0.65 ? red : blue).multiplyScalar(1.5));
  return inst;
}

/** 수중 조명(위에서 스며드는 빛). */
export function underLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x2e5c74, 2.1)); // 밝은 수중 앰비언트
  const top = new THREE.DirectionalLight(0x8ec4e2, 2.3);
  top.position.set(12, 90, 24);
  scene.add(top);
}

/** 로우폴리 해변 집(붕괴용 조각 모음) — userData 에 원위치/낙하 파라미터. */
export function beachHouse(): THREE.Group {
  const house = new THREE.Group();
  house.name = "house";
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8c9ad, roughness: 0.95, flatShading: true });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x7c3b2b, roughness: 0.95, flatShading: true });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.4, 5.6), wallMat);
  floor.position.set(0, 0.2, 0);
  house.add(floor);
  // 쓰러질 벽(밑변 피벗 그룹 — 한 번의 회전으로 바깥쪽으로 넘어감)
  const walls: { g: THREE.Group; axis: "x" | "z"; ang: number }[] = [];
  const topWall = (w: number, h: number, d: number, px: number, pz: number, axis: "x" | "z", ang: number) => {
    const g = new THREE.Group();
    g.position.set(px, 0, pz); // 밑변에 피벗
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(0, h / 2, 0);
    g.add(m);
    house.add(g);
    walls.push({ g, axis, ang });
  };
  const Q = (Math.PI / 2) * 0.96;
  topWall(6, 4, 0.3, 0, -2.5, "x", -Q); // 뒤벽 → -z
  topWall(0.3, 4, 5, -3, 0, "z", Q); // 왼벽 → -x
  topWall(0.3, 4, 5, 3, 0, "z", -Q); // 오른벽 → +x
  // 유저(카메라)에 가까운 앞벽(쓰러지지 않고 유지)
  const front = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 0.3), wallMat);
  front.position.set(0, 2, 2.5);
  house.add(front);
  // 지붕
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.5, 5.6), roofMat);
  roof.position.set(0, 4.3, 0);
  house.add(roof);
  house.userData = { walls, roof };
  return house;
}

/** 오렌지 발광 씨앗(통일 색). emis: 발광 강도. */
export function makeSeed(radius: number, emis: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 1),
    new THREE.MeshStandardMaterial({ color: SEED_ORANGE, emissive: SEED_ORANGE, emissiveIntensity: emis, roughness: 0.6 })
  );
  m.name = "seed3";
  return m;
}
