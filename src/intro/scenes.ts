import * as THREE from "three";
import type { CutScene, SceneCtx } from "./CinematicPlayer";

// 인트로 PoC — 씬1: 오무아무아 태양계 횡단 / 씬2: 씨앗 흩어짐.
// 전부 실시간 로우폴리 + Bloom(발광 태양·씨앗). 스펙 4장 1~2번 장면.

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

const SEED_ORANGE = 0xdf7a2c; // 외계 씨앗 통일 색(오렌지) — 씬2 분산·씬3 낙하 공통

/** 결정적 난수(시드 고정 — 재생마다 동일 별/바위). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** 코히런트(부드러운) 노이즈 ~[-1,1] — 인접 정점이 비슷한 값 → 누더기 스파이크 대신 완만한 굴곡. */
function lump(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 1.7 + y * 0.6) +
    Math.sin(y * 2.1 + z * 1.2) +
    Math.sin(z * 1.5 + x * 0.9) +
    0.5 * Math.sin((x + y + z) * 3.1)
  ) / 3.5;
}

function starfield(count: number, seed: number): THREE.Points {
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

function sun(): THREE.Mesh {
  // MeshBasic(밝은 흰노랑) → Bloom 임계 초과로 발광
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(26, 2), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
  mesh.position.set(-420, 70, -780);
  return mesh;
}

function oumuamua(): THREE.Mesh {
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

function lights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x3a4a64, 1.7)); // 어두운 면도 보이도록 앰비언트 ↑
  const key = new THREE.DirectionalLight(0xfff0d2, 3.2); // 태양 키라이트(역광 림)
  key.position.set(-420, 70, -780);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88a6cc, 1.7); // 카메라 쪽 푸른 필 → 정면도 보이게
  fill.position.set(300, 60, 240);
  scene.add(fill);
}

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
/** 카메라를 from→to 로 이징 이동시키며 lookAt 고정. */
function track(ctx: SceneCtx, k: number, from: number[], to: number[], look: THREE.Vector3): void {
  const e = ease(Math.min(1, Math.max(0, k)));
  ctx.camera.position.lerpVectors(_from.fromArray(from), _to.fromArray(to), e);
  ctx.camera.lookAt(look);
}

const _qAlign = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _XAXIS = new THREE.Vector3(1, 0, 0); // 지오메트리 긴 축(local +X = scale 3.4)
const SPIN_RATE = 0.55; // rad/s — 럭비공처럼 긴 축 둘레로 천천히 스크류 회전
const FWD1 = new THREE.Vector3(1, 0, 0); // 씬1 비행/장축 방향

/** 소행성을 "긴 축(local +X)=비행 방향 fwd"으로 정렬 + 그 축 둘레로 theta 만큼 스크류 회전. */
function spinAlong(rock: THREE.Object3D, fwd: THREE.Vector3, theta: number): void {
  _qAlign.setFromUnitVectors(_XAXIS, fwd);
  _qSpin.setFromAxisAngle(_XAXIS, theta);
  rock.quaternion.multiplyQuaternions(_qAlign, _qSpin);
}

// ─────────────── 씬 1: 오무아무아 횡단 ───────────────
const DUR1 = 6.5;
export const sceneOumuamua: CutScene = {
  name: "oumuamua",
  duration: DUR1,
  build(ctx) {
    ctx.scene.background = new THREE.Color(0x04060c);
    ctx.scene.add(starfield(1200, 11));
    ctx.scene.add(sun());
    lights(ctx.scene);
    ctx.scene.add(oumuamua());
  },
  update(t, dt, ctx) {
    const k = t / DUR1;
    const rock = ctx.scene.getObjectByName("rock")!;
    spinAlong(rock, FWD1, SPIN_RATE * t); // 긴 축(+X) = 비행 방향, 그 축 둘레로 스크류 회전
    rock.position.set(-5 + k * 10, Math.sin(k * Math.PI) * 1.1, 0); // 천천히 횡단
    const stars = ctx.scene.getObjectByName("stars");
    if (stars) stars.rotation.y += dt * 0.01;
    track(ctx, k, [13, 4, 16], [-7, -1.5, 9], rock.position); // 가까이서 또렷이 곁을 스침
  },
};

// ─────────────── 씬 2: 씨앗 흩어짐 ───────────────
const DUR2 = 6.5;
const SEEDS = 15; // 소수(열몇 개)만
const START2 = new THREE.Vector3(-7, 0, 1.5); // 씬2 시작 위치
const FWD = new THREE.Vector3(1, 0.05, -0.16).normalize(); // 비행 방향(한쪽으로 쭉)
const ASPD = 1.5; // 소행성 속도
const RIGHT = new THREE.Vector3().crossVectors(FWD, new THREE.Vector3(0, 1, 0)).normalize();
const UP = new THREE.Vector3().crossVectors(RIGHT, FWD).normalize();
const _emit = new THREE.Vector3();
/** 씬2 소행성 위치(시간 time) — FWD 로 비행 + 진행 수직(UP)으로 완만한 아치(씬1과 유사). */
function rock2Pos(out: THREE.Vector3, time: number): THREE.Vector3 {
  const d = ASPD * time;
  const arc = Math.sin((time / DUR2) * Math.PI) * 1.0;
  return out.set(
    START2.x + FWD.x * d + UP.x * arc,
    START2.y + FWD.y * d + UP.y * arc,
    START2.z + FWD.z * d + UP.z * arc
  );
}

export const sceneDispersal: CutScene = {
  name: "dispersal",
  duration: DUR2,
  build(ctx) {
    ctx.scene.background = new THREE.Color(0x04060c);
    ctx.scene.add(starfield(900, 23));
    lights(ctx.scene); // 씬1과 동일 조명(카메라/피사체 무빙도 유사, 보는 각도만 다름)
    const rock = oumuamua();
    rock.position.copy(START2);
    ctx.scene.add(rock);

    // 매우 작고 빛나지 않는 소수의 씨앗(오렌지). 회전 결을 따라 나선으로 방출 → 서서히 멀어짐.
    const mat = new THREE.MeshStandardMaterial({ color: SEED_ORANGE, roughness: 1, metalness: 0 });
    const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.03, 0), mat, SEEDS); // 씨앗 10cm급 — 미세 먼지 크기(최소 가시)
    inst.name = "seeds";
    inst.frustumCulled = false;
    const birth = new Float32Array(SEEDS);
    const vel = new Float32Array(SEEDS * 3); // 전진(같은 방향) + 반경(서서히 멀어짐) + 접선(회전 결)
    const off = new Float32Array(SEEDS * 3); // 방출점: 긴 축 둘레 표면(각도 phi)
    const r = rng(7);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SEEDS; i++) {
      birth[i] = 0.6 + r() * 4.2; // 비행 내내 회전 결을 따라 하나씩
      // 방출 각도 = 그 순간의 스핀 각도(회전 결) + 약간 분산 → 씨앗들이 나선으로 배열됨
      const phi = SPIN_RATE * birth[i] + (r() - 0.5) * 0.5;
      const c = Math.cos(phi), s = Math.sin(phi);
      // 긴 축(FWD) 둘레의 반경 방향 r̂ / 접선 방향 t̂(스핀 결)
      const rdx = RIGHT.x * c + UP.x * s, rdy = RIGHT.y * c + UP.y * s, rdz = RIGHT.z * c + UP.z * s;
      const tdx = -RIGHT.x * s + UP.x * c, tdy = -RIGHT.y * s + UP.y * c, tdz = -RIGHT.z * s + UP.z * c;
      const radSp = 0.22 + r() * 0.24; // 서서히 멀어지는 반경 속도(느림)
      const tanSp = 0.32 + r() * 0.24; // 회전 결을 따라가는 접선 속도
      const fwdF = 0.92 + r() * 0.06; // 거의 같은 전진(살짝 느림)
      vel[i * 3] = FWD.x * ASPD * fwdF + rdx * radSp + tdx * tanSp;
      vel[i * 3 + 1] = FWD.y * ASPD * fwdF + rdy * radSp + tdy * tanSp;
      vel[i * 3 + 2] = FWD.z * ASPD * fwdF + rdz * radSp + tdz * tanSp;
      off[i * 3] = rdx * 0.9; // 긴 축 둘레 표면에서 방출
      off[i * 3 + 1] = rdy * 0.9;
      off[i * 3 + 2] = rdz * 0.9;
      inst.setMatrixAt(i, hidden);
    }
    inst.userData.birth = birth;
    inst.userData.vel = vel;
    inst.userData.off = off;
    ctx.scene.add(inst);
  },
  update(t, _dt, ctx) {
    const rock = ctx.scene.getObjectByName("rock")!;
    rock2Pos(rock.position, t); // 아치를 그리며 비행(씬1과 유사)
    spinAlong(rock, FWD, SPIN_RATE * t); // 긴 축 = 비행 방향, 그 축 둘레로 천천히 스크류 회전

    const inst = ctx.scene.getObjectByName("seeds") as THREE.InstancedMesh;
    const birth = inst.userData.birth as Float32Array;
    const vel = inst.userData.vel as Float32Array;
    const off = inst.userData.off as Float32Array;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < SEEDS; i++) {
      const age = t - birth[i];
      if (age <= 0) {
        m4.makeScale(0, 0, 0); // 아직 방출 전
      } else {
        const grow = Math.min(1, age * 3);
        // 방출점 = 그때 소행성 위치(아치) + 회전 결 표면 오프셋, 이후 자기 속도로 비행
        rock2Pos(_emit, birth[i]);
        m4.makeScale(grow, grow, grow).setPosition(
          _emit.x + off[i * 3] + vel[i * 3] * age,
          _emit.y + off[i * 3 + 1] + vel[i * 3 + 1] * age,
          _emit.z + off[i * 3 + 2] + vel[i * 3 + 2] * age
        );
      }
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    // 카메라 무빙(씬1식 이징 트랙) — 보는 각도만 다르게(왼쪽-약간아래 → 오른쪽-위 크레인)
    track(ctx, t / DUR2, [-15, 1, 12], [7, 6.5, 11], rock.position);
  },
};

// ─────────────────────────── 씬 3~6 공용 ───────────────────────────
const SPACE_COL = new THREE.Color(0x04060c);
const DEEP_COL = new THREE.Color(0x0e3a4e); // 심해(현실보다 밝게 — 배경이 보이도록)
const _look = new THREE.Vector3();

/** 로우폴리 지구 — 대륙(초록)/바다(파랑)/극관(흰) 정점색. */
/** 태평양 중심의 지구 표면 텍스처(캔버스 equirectangular — 가로 중앙 = 태평양). */
function earthTexture(): THREE.CanvasTexture {
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
function earth(radius: number): THREE.Group {
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
function moon(radius: number): THREE.Mesh {
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
function seabed(): THREE.Mesh {
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
function makeCore(radius: number, hex: number): THREE.Mesh {
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
function plasmoidSwarm(n: number, seed: number): THREE.InstancedMesh {
  const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6, 1), new THREE.MeshBasicMaterial(), n);
  inst.frustumCulled = false;
  inst.name = "plasmoids";
  const r = rng(seed), red = new THREE.Color(0xff3b30), blue = new THREE.Color(0x4aa6ff), c = new THREE.Color();
  for (let i = 0; i < n; i++) inst.setColorAt(i, c.copy(r() < 0.65 ? red : blue).multiplyScalar(1.5));
  return inst;
}

/** 수중 조명(위에서 스며드는 빛). */
function underLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x2e5c74, 2.1)); // 밝은 수중 앰비언트
  const top = new THREE.DirectionalLight(0x8ec4e2, 2.3);
  top.position.set(12, 90, 24);
  scene.add(top);
}

/** 로우폴리 해변 집(붕괴용 조각 모음) — userData 에 원위치/낙하 파라미터. */
function beachHouse(): THREE.Group {
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

// ─────────────── 씬 3: 바다 낙하(3분할) — 공용 ───────────────
const FALL_DIR = new THREE.Vector3(0, -0.12, -1).normalize(); // 씬3a 비행 방향(지구 쪽)
/** 오렌지 발광 씨앗(통일 색). emis: 발광 강도. */
function makeSeed(radius: number, emis: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 1),
    new THREE.MeshStandardMaterial({ color: SEED_ORANGE, emissive: SEED_ORANGE, emissiveIntensity: emis, roughness: 0.6 })
  );
  m.name = "seed3";
  return m;
}

// 씬 3a — 멀리 지구 절반이 보이고, 카메라가 씨앗 바로 뒤를 추적하며 지구로 비행
const DUR3A = 5;
export const sceneFall: CutScene = {
  name: "fall",
  duration: DUR3A,
  build(ctx) {
    ctx.scene.background = SPACE_COL.clone();
    ctx.scene.fog = null;
    ctx.scene.add(starfield(900, 31));
    ctx.scene.add(new THREE.AmbientLight(0x2a3a52, 1.25));
    const sun = new THREE.DirectionalLight(0xfff4e2, 3.0);
    sun.position.set(40, 55, 120); // 카메라(+Z) 쪽 → 태평양 면이 환하게 보이도록
    ctx.scene.add(sun);
    const e = earth(125); // 크게(태평양 중심) + 깊이 아래로 → 상부 반원만, 북반구 대륙 일부 노출
    e.position.set(0, -132, -150);
    ctx.scene.add(e);
    const m = moon(6); // 매끈한 달 — 더 크게, 오른쪽·위
    m.position.set(78, 20, -150);
    ctx.scene.add(m);
    ctx.scene.add(makeSeed(0.5, 2.0)); // 블룸 과다로 지구가 씻기지 않게 약간 낮춤
  },
  update(t, dt, ctx) {
    const e = ctx.scene.getObjectByName("earth");
    if (e) e.rotation.y += dt * 0.03;
    const seed = ctx.scene.getObjectByName("seed3")!;
    const d = 6 * t; // 지구 쪽으로 비행
    seed.position.set(FALL_DIR.x * d, 6 + FALL_DIR.y * d, 30 + FALL_DIR.z * d);
    seed.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
    // 카메라: 씨앗 바로 뒤(근접) — 지구가 정면 멀리
    ctx.camera.position.set(seed.position.x - FALL_DIR.x * 7, seed.position.y - FALL_DIR.y * 7 + 2, seed.position.z - FALL_DIR.z * 7);
    ctx.camera.lookAt(seed.position);
  },
};

// 씬 3b — 망망대해 수평선 배경, 씨앗이 바닷물로 첨벙 입수
const DUR3B = 4;
const SPL = 44;
export const sceneSplash: CutScene = {
  name: "splash",
  duration: DUR3B,
  build(ctx) {
    ctx.scene.background = new THREE.Color(0x8fb4d6); // 낮 하늘
    ctx.scene.fog = new THREE.Fog(0x8fb4d6, 130, 800); // 수평선 헤이즈
    ctx.scene.add(new THREE.AmbientLight(0x9fb8cc, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(40, 70, 30);
    ctx.scene.add(sun);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x2f6f97, roughness: 0.45, metalness: 0.1 }));
    sea.rotation.x = -Math.PI / 2;
    ctx.scene.add(sea);
    ctx.scene.add(makeSeed(0.45, 2.0));
    const sp = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0xe3f1ff, roughness: 0.3 }), SPL);
    sp.name = "splash";
    sp.frustumCulled = false;
    const vel = new Float32Array(SPL * 3), r = rng(61), hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SPL; i++) {
      const a = r() * Math.PI * 2, out = 1.2 + r() * 2.4;
      vel[i * 3] = Math.cos(a) * out;
      vel[i * 3 + 1] = 4.5 + r() * 4; // 위로 솟구침
      vel[i * 3 + 2] = Math.sin(a) * out;
      sp.setMatrixAt(i, hidden);
    }
    sp.userData = { vel };
    ctx.scene.add(sp);
  },
  update(t, _dt, ctx) {
    const seed = ctx.scene.getObjectByName("seed3") as THREE.Mesh;
    const splashT = 2.2;
    const sy = t < splashT ? 28 * (1 - t / splashT) : -3 * ((t - splashT) / (DUR3B - splashT));
    seed.position.set(0, sy, 0);
    seed.visible = sy > -1.6;
    (seed.material as THREE.MeshStandardMaterial).emissiveIntensity = sy > 0 ? 2.0 : 0.6;
    const sp = ctx.scene.getObjectByName("splash") as THREE.InstancedMesh;
    const vel = sp.userData.vel as Float32Array, age = t - splashT, m4 = new THREE.Matrix4();
    for (let i = 0; i < SPL; i++) {
      if (age <= 0) m4.makeScale(0, 0, 0);
      else {
        const y = vel[i * 3 + 1] * age - 9 * age * age; // 위로 솟았다 중력으로 낙하
        const s = y < -0.4 ? 0 : 0.9;
        m4.makeScale(s, s, s).setPosition(vel[i * 3] * age, y, vel[i * 3 + 2] * age);
      }
      sp.setMatrixAt(i, m4);
    }
    sp.instanceMatrix.needsUpdate = true;
    ctx.camera.position.set(7, 3.2, 13); // 낮게 수평선 보며 입수 포착
    ctx.camera.lookAt(_look.set(0, 1.5, 0));
  },
};

// 씬 3c — 멀리 마리아나 해구가 어둡게, 클로즈업된 씨앗이 천천히 가라앉음
const DUR3C = 5;
export const sceneSink: CutScene = {
  name: "sink",
  duration: DUR3C,
  build(ctx) {
    ctx.scene.background = new THREE.Color(0x12455c);
    ctx.scene.fog = new THREE.FogExp2(0x12455c, 0.009); // 옅게 → 해구가 멀리까지 보임
    ctx.scene.add(new THREE.AmbientLight(0x356b86, 2.0));
    const top = new THREE.DirectionalLight(0x9fcfe8, 2.4);
    top.position.set(8, 80, 12);
    ctx.scene.add(top);
    const sb = seabed(); // 마리아나 해구(멀리 보임)
    sb.position.set(0, -26, -34);
    ctx.scene.add(sb);
    ctx.scene.add(makeSeed(0.6, 0.45)); // 수중 → 발광 약하게
  },
  update(t, _dt, ctx) {
    const seed = ctx.scene.getObjectByName("seed3")!;
    seed.position.set(0, 7 - (t / DUR3C) * 15, 0); // 천천히 가라앉음
    seed.rotation.y += 0.004;
    ctx.camera.position.set(seed.position.x + 3, seed.position.y + 1.1, seed.position.z + 4.6); // 클로즈업
    ctx.camera.lookAt(seed.position);
  },
};

// ─────────────── 씬 4: 코어 성장(주변 물질 흡입) ───────────────
const DUR4 = 7;
const DEBRIS = 46;
const CORE4 = new THREE.Vector3(0, 2, 0);
export const sceneCore: CutScene = {
  name: "core",
  duration: DUR4,
  build(ctx) {
    ctx.scene.background = DEEP_COL.clone();
    ctx.scene.fog = new THREE.FogExp2(0x0e3a4e, 0.02);
    underLights(ctx.scene);
    const sb = seabed();
    sb.position.y = -6;
    ctx.scene.add(sb);
    ctx.scene.add(makeCore(1.2, 0xff4a1e));
    const deb = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1, flatShading: true }), DEBRIS);
    deb.name = "debris";
    deb.frustumCulled = false;
    const sx = new Float32Array(DEBRIS * 3), delay = new Float32Array(DEBRIS), travel = new Float32Array(DEBRIS);
    const r = rng(51), m4 = new THREE.Matrix4();
    for (let i = 0; i < DEBRIS; i++) {
      const th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1), rad = 9 + r() * 8;
      sx[i * 3] = CORE4.x + rad * Math.sin(ph) * Math.cos(th);
      sx[i * 3 + 1] = CORE4.y + rad * Math.cos(ph) * 0.5;
      sx[i * 3 + 2] = CORE4.z + rad * Math.sin(ph) * Math.sin(th);
      delay[i] = r() * 2.6;
      travel[i] = 2.6 + r() * 2.2;
      deb.setMatrixAt(i, m4.setPosition(sx[i * 3], sx[i * 3 + 1], sx[i * 3 + 2]));
    }
    deb.userData = { sx, delay, travel };
    ctx.scene.add(deb);
  },
  update(t, _dt, ctx) {
    const k = t / DUR4;
    const core = ctx.scene.getObjectByName("core") as THREE.Mesh;
    const grow = 0.6 + ease(k) * 3.1;
    core.scale.setScalar(grow * (1 + Math.sin(t * 4) * 0.04)); // 성장 + 박동
    (core.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.2 + Math.sin(t * 5) * 0.8;
    const deb = ctx.scene.getObjectByName("debris") as THREE.InstancedMesh;
    const sx = deb.userData.sx as Float32Array, delay = deb.userData.delay as Float32Array, travel = deb.userData.travel as Float32Array;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < DEBRIS; i++) {
      const u = Math.min(1, Math.max(0, (t - delay[i]) / travel[i])); // 0 시작 → 1 흡수
      const e = ease(u);
      const s = (1 - u) * 0.9 + 0.05; // 코어에 가까울수록 작아짐(흡수)
      m4.makeScale(s, s, s).setPosition(
        sx[i * 3] + (CORE4.x - sx[i * 3]) * e,
        sx[i * 3 + 1] + (CORE4.y - sx[i * 3 + 1]) * e,
        sx[i * 3 + 2] + (CORE4.z - sx[i * 3 + 2]) * e
      );
      deb.setMatrixAt(i, m4);
    }
    deb.instanceMatrix.needsUpdate = true;
    // 카메라: 천천히 코어로 다가가며 살짝 선회
    const a = t * 0.22, rad = 22 - ease(k) * 8;
    ctx.camera.position.set(Math.cos(a) * rad, 4 + ease(k) * 2, Math.sin(a) * rad);
    ctx.camera.lookAt(CORE4);
  },
};

// ─────────────── 씬 5: 좌→우로 가로지르는 해구 + 해구선을 따라 붉게 빛나는 코어 + 플라즈모이드 상승 ───────────────
const DUR5 = 8;
const PLAS = 800;
export const sceneRise: CutScene = {
  name: "rise",
  duration: DUR5,
  build(ctx) {
    ctx.scene.background = new THREE.Color(0x050e15); // 주변은 매우 어둡게
    ctx.scene.fog = new THREE.FogExp2(0x050e15, 0.005);
    ctx.scene.add(new THREE.AmbientLight(0x1b3646, 1.5));
    const top = new THREE.DirectionalLight(0x3a6076, 1.0); // 해저 형태가 어둡게나마 보이도록
    top.position.set(20, 80, 40);
    ctx.scene.add(top);
    // 해구를 따라 붉게 — 점광원으로 협곡 벽을 붉게 비춤
    for (const lx of [-170, -90, -10, 70, 150]) {
      const pl = new THREE.PointLight(0xff3411, 150, 220, 1.1);
      pl.position.set(lx, -3, 0);
      ctx.scene.add(pl);
    }

    // 해저 + 좌우로 가로지르는 해구(골). worldZ=0 을 따라 X축 방향으로 깊게 패임.
    const fg = new THREE.PlaneGeometry(680, 460, 140, 90);
    const fp = fg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i), y = fp.getY(i); // 회전 후 worldZ = -y
      const trench = -13 * Math.exp(-(y * y) / (2 * 16 * 16)); // y≈0(worldZ≈0) 깊은 골
      fp.setZ(i, trench + lump(x * 0.02, 0, y * 0.045) * 4 - 1);
    }
    fg.rotateX(-Math.PI / 2);
    fg.computeVertexNormals();
    ctx.scene.add(new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: 0x0f1c24, roughness: 1, flatShading: true })));

    // 해구 바닥을 따라 붉게 빛나는 코어(용암 리프트) — 가는 발광 선(좌→우)
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x2a0604, emissive: 0xff1606, emissiveIntensity: 1.7, roughness: 0.5, flatShading: true });
    const vein = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), coreMat, 56);
    vein.name = "core";
    vein.frustumCulled = false;
    const r = rng(31), m4 = new THREE.Matrix4();
    for (let i = 0; i < 56; i++) {
      const x = -215 + (i / 55) * 430, z = (r() - 0.5) * 5, y = -10 + (r() - 0.5) * 1.4, s = 3 + r() * 3.2;
      m4.makeScale(s * 1.8, s * 0.5, s * 0.8).setPosition(x, y, z); // 가늘고 납작하게
      vein.setMatrixAt(i, m4);
    }
    ctx.scene.add(vein);

    // 해수면 글로우(멀리 위)
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ color: 0x163a4f, transparent: true, opacity: 0.22 }));
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = 95;
    ctx.scene.add(surf);

    // 다수의 작은 플라즈모이드 — 해구선을 따라 솟아 해수면으로 상승
    const sw = plasmoidSwarm(PLAS, 77);
    const py = new Float32Array(PLAS), px = new Float32Array(PLAS), pz = new Float32Array(PLAS), sp = new Float32Array(PLAS), sz = new Float32Array(PLAS), ph = new Float32Array(PLAS);
    const r2 = rng(77), mm = new THREE.Matrix4();
    for (let i = 0; i < PLAS; i++) {
      px[i] = -205 + r2() * 410; // 해구를 따라(좌→우)
      pz[i] = (r2() - 0.5) * 14;
      py[i] = -8 + r2() * 7;
      sp[i] = 5 + r2() * 7;
      sz[i] = 0.6 + r2() * 0.7;
      ph[i] = r2() * Math.PI * 2;
      mm.makeScale(sz[i], sz[i], sz[i]).setPosition(px[i], py[i], pz[i]);
      sw.setMatrixAt(i, mm);
    }
    sw.userData = { py, px, pz, sp, sz, ph };
    ctx.scene.add(sw);
  },
  update(t, _dt, ctx) {
    const core = ctx.scene.getObjectByName("core") as THREE.InstancedMesh;
    (core.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 + Math.sin(t * 1.8) * 0.5;
    const sw = ctx.scene.getObjectByName("plasmoids") as THREE.InstancedMesh;
    const py = sw.userData.py as Float32Array, px = sw.userData.px as Float32Array, pz = sw.userData.pz as Float32Array;
    const sp = sw.userData.sp as Float32Array, sz = sw.userData.sz as Float32Array, ph = sw.userData.ph as Float32Array;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < PLAS; i++) {
      const s = sz[i] * (1 + Math.sin(t * 4 + ph[i]) * 0.2);
      m4.makeScale(s, s, s).setPosition(
        px[i] + Math.sin(t * 0.9 + ph[i]) * 2.2,
        py[i] + sp[i] * t, // 해수면을 향해 상승
        pz[i] + Math.cos(t * 0.8 + ph[i]) * 2.2
      );
      sw.setMatrixAt(i, m4);
    }
    sw.instanceMatrix.needsUpdate = true;
    // 원거리 — 해구가 좌상단→우하단으로 가로지르는 광경(아주 천천히 접근)
    const k = t / DUR5;
    ctx.camera.position.set(0, 54 - k * 6, 126 - k * 16);
    ctx.camera.lookAt(_look.set(0, -6, -8));
    ctx.camera.rotateZ(0.26); // 약 15° 롤 → 해구가 좌상단→우하단으로 기울어짐
  },
};

// ─────────────── 씬 6: 해변 집 — 플라즈모이드 통과 → 붕괴 ───────────────
const DUR6 = 7.5;
const TC6 = DUR6 * 0.46; // 붕괴 시작(플라즈모이드가 집 중앙 통과)
export const sceneHouse: CutScene = {
  name: "house",
  duration: DUR6,
  build(ctx) {
    ctx.scene.background = new THREE.Color(0x14213a); // 어스름 해질녘
    ctx.scene.fog = null;
    ctx.scene.add(new THREE.AmbientLight(0x35415e, 1.5));
    const moon = new THREE.DirectionalLight(0xaec6ff, 1.8);
    moon.position.set(-30, 40, 20);
    ctx.scene.add(moon);
    // 모래 바닥 + 바다
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x6b6048, roughness: 1, flatShading: true }));
    sand.rotation.x = -Math.PI / 2;
    ctx.scene.add(sand);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(300, 120), new THREE.MeshStandardMaterial({ color: 0x16344a, roughness: 0.7 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.05, -60);
    ctx.scene.add(sea);
    ctx.scene.add(beachHouse());
    const plas = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 2), new THREE.MeshBasicMaterial({ color: 0xff7a20 })); // 빛나는 오렌지
    plas.name = "plas6";
    ctx.scene.add(plas);
  },
  update(t, _dt, ctx) {
    const plas = ctx.scene.getObjectByName("plas6")!;
    plas.position.set(-11 + (t / DUR6) * 22, 2.2, 0); // 집을 가로질러 통과
    const house = ctx.scene.getObjectByName("house") as THREE.Group;
    const ud = house.userData as { walls: { g: THREE.Group; axis: "x" | "z"; ang: number }[]; roof: THREE.Mesh };
    // 통과 시 나머지 벽이 한 번에 쓰러짐(TC6 ~ +0.8s)
    const wallE = ease(Math.min(1, Math.max(0, (t - TC6) / 0.8)));
    for (const w of ud.walls) w.g.rotation[w.axis] = w.ang * wallE;
    // 1초 뒤 지붕이 한 번에 내려앉음(TC6+1 ~ +0.8s) — 오른쪽 벽에 기댄 듯 기울며
    const roofE = ease(Math.min(1, Math.max(0, (t - (TC6 + 1)) / 0.8)));
    ud.roof.position.y = 4.3 - roofE * 2.7;
    ud.roof.rotation.x = roofE * -0.45; // 앞벽(가까운 벽) 쪽이 높게 기대며 내려앉음
    // 카메라: 측상방에서 — 남은 앞벽 너머로 무너지는 지붕·벽이 보이도록
    track(ctx, t / DUR6, [-13, 8, 16], [-3, 6.5, 12.5], _look.set(0, 1.5, -1));
  },
};

/** 인트로 컷씬 시퀀스(스펙 4장 1~6번 전체). */
export function introScenes(): CutScene[] {
  return [sceneOumuamua, sceneDispersal, sceneFall, sceneSplash, sceneSink, sceneCore, sceneRise, sceneHouse];
}
