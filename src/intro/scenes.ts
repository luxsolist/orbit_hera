import * as THREE from "three";
import type { CutScene } from "./CinematicPlayer";
import type { Frag } from "./helpers";
import {
  ease, rng, lump, track, spinAlong, makeSwarm, updateSwarm,
  starfield, sun, oumuamua, lights, underLights,
  earth, moon, seabed, makeCore, plasmoidSwarm, beachHouse, fallFrag, makeDormantCore,
  setState, getState, DORMANT_ORANGE, PLAS_STRONG, CORE_TEMP, SPACE_COL, DEEP_COL, SPIN_RATE, FWD1,
} from "./helpers";

// 인트로 군집 userData 상태(병렬 Float32Array) — setState/getState 로 타입 안전 접근.
interface CoreSwarmState { birth: Float32Array; vel: Float32Array; off: Float32Array; }
interface VelState { vel: Float32Array; }
interface DebrisState { sx: Float32Array; delay: Float32Array; travel: Float32Array; }
interface RiseSwarmState { py: Float32Array; px: Float32Array; pz: Float32Array; sp: Float32Array; sz: Float32Array; ph: Float32Array; }
interface HouseState { wallFrags: Frag[]; roofFrags: Frag[]; }

// 인트로 컷씬(스펙 4장 1~6번). 공용 빌딩블록은 helpers.ts, 여기는 씬별 연출/타임라인만.

const _look = new THREE.Vector3();

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

// ─────────────── 씬 2: 코어 흩어짐 ───────────────
const DUR2 = 6.5;
const CORE_COUNT = 15; // 소수(열몇 개)만
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

    // 소수의 코어 — 크기는 미세 먼지급 유지하되 밝은 오렌지로 발광(낙하/입수/침강 코어과 통일). 회전 결 나선 방출 → 서서히 멀어짐.
    const orange = new THREE.Color(DORMANT_ORANGE);
    const mat = new THREE.MeshStandardMaterial({ color: orange.clone().multiplyScalar(0.2), emissive: DORMANT_ORANGE, emissiveIntensity: 2.2, roughness: 0.5, metalness: 0 });
    const inst = makeSwarm(new THREE.IcosahedronGeometry(0.03, 0), mat, CORE_COUNT, "cores"); // 코어 10cm급 — 크기 유지(최소 가시)
    const birth = new Float32Array(CORE_COUNT);
    const vel = new Float32Array(CORE_COUNT * 3); // 전진(같은 방향) + 반경(서서히 멀어짐) + 접선(회전 결)
    const off = new Float32Array(CORE_COUNT * 3); // 방출점: 긴 축 둘레 표면(각도 phi)
    const r = rng(7);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CORE_COUNT; i++) {
      birth[i] = 0.6 + r() * 4.2; // 비행 내내 회전 결을 따라 하나씩
      // 방출 각도 = 그 순간의 스핀 각도(회전 결) + 약간 분산 → 코어들이 나선으로 배열됨
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
    setState<CoreSwarmState>(inst, { birth, vel, off });
    ctx.scene.add(inst);
  },
  update(t, _dt, ctx) {
    const rock = ctx.scene.getObjectByName("rock")!;
    rock2Pos(rock.position, t); // 아치를 그리며 비행(씬1과 유사)
    spinAlong(rock, FWD, SPIN_RATE * t); // 긴 축 = 비행 방향, 그 축 둘레로 천천히 스크류 회전

    const inst = ctx.scene.getObjectByName("cores") as THREE.InstancedMesh;
    const { birth, vel, off } = getState<CoreSwarmState>(inst);
    updateSwarm(inst, (i, m4) => {
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
    });
    // 카메라 무빙(씬1식 이징 트랙) — 보는 각도만 다르게(왼쪽-약간아래 → 오른쪽-위 크레인)
    track(ctx, t / DUR2, [-15, 1, 12], [7, 6.5, 11], rock.position);
  },
};

// ─────────────── 씬 3: 바다 낙하(3분할) ───────────────
const FALL_DIR = new THREE.Vector3(0, -0.12, -1).normalize(); // 씬3a 비행 방향(지구 쪽)

// 씬 3a — 멀리 지구 절반이 보이고, 카메라가 코어 바로 뒤를 추적하며 지구로 비행
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
    ctx.scene.add(makeDormantCore(0.5, 2.0)); // 블룸 과다로 지구가 씻기지 않게 약간 낮춤
  },
  update(t, dt, ctx) {
    const e = ctx.scene.getObjectByName("earth");
    if (e) e.rotation.y += dt * 0.03;
    const coreObj = ctx.scene.getObjectByName("core3")!;
    const d = 6 * t; // 지구 쪽으로 비행
    coreObj.position.set(FALL_DIR.x * d, 6 + FALL_DIR.y * d, 30 + FALL_DIR.z * d);
    coreObj.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
    // 카메라: 코어 바로 뒤(근접) — 지구가 정면 멀리
    ctx.camera.position.set(coreObj.position.x - FALL_DIR.x * 7, coreObj.position.y - FALL_DIR.y * 7 + 2, coreObj.position.z - FALL_DIR.z * 7);
    ctx.camera.lookAt(coreObj.position);
  },
};

// 씬 3b — 망망대해 수평선 배경, 코어이 바닷물로 첨벙 입수
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
    ctx.scene.add(makeDormantCore(0.45, 2.0));
    const sp = makeSwarm(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0xe3f1ff, roughness: 0.3 }), SPL, "splash");
    const vel = new Float32Array(SPL * 3), r = rng(61), hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SPL; i++) {
      const a = r() * Math.PI * 2, out = 1.2 + r() * 2.4;
      vel[i * 3] = Math.cos(a) * out;
      vel[i * 3 + 1] = 4.5 + r() * 4; // 위로 솟구침
      vel[i * 3 + 2] = Math.sin(a) * out;
      sp.setMatrixAt(i, hidden);
    }
    setState<VelState>(sp, { vel });
    ctx.scene.add(sp);
  },
  update(t, _dt, ctx) {
    const coreObj = ctx.scene.getObjectByName("core3") as THREE.Mesh;
    const splashT = 2.2;
    const sy = t < splashT ? 28 * (1 - t / splashT) : -3 * ((t - splashT) / (DUR3B - splashT));
    coreObj.position.set(0, sy, 0);
    coreObj.visible = sy > -1.6;
    (coreObj.material as THREE.MeshStandardMaterial).emissiveIntensity = sy > 0 ? 2.0 : 0.6;
    const sp = ctx.scene.getObjectByName("splash") as THREE.InstancedMesh;
    const { vel } = getState<VelState>(sp), age = t - splashT;
    updateSwarm(sp, (i, m4) => {
      if (age <= 0) m4.makeScale(0, 0, 0);
      else {
        const y = vel[i * 3 + 1] * age - 9 * age * age; // 위로 솟았다 중력으로 낙하
        const s = y < -0.4 ? 0 : 0.9;
        m4.makeScale(s, s, s).setPosition(vel[i * 3] * age, y, vel[i * 3 + 2] * age);
      }
    });
    ctx.camera.position.set(7, 3.2, 13); // 낮게 수평선 보며 입수 포착
    ctx.camera.lookAt(_look.set(0, 1.5, 0));
  },
};

// 씬 3c — 멀리 마리아나 해구가 어둡게, 클로즈업된 코어이 천천히 가라앉음
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
    ctx.scene.add(makeDormantCore(0.6, 1.8)); // 수중이지만 밝은 오렌지 통일(낙하·입수와 동일 톤)
  },
  update(t, _dt, ctx) {
    const coreObj = ctx.scene.getObjectByName("core3")!;
    coreObj.position.set(0, 7 - (t / DUR3C) * 15, 0); // 천천히 가라앉음
    coreObj.rotation.y += 0.004;
    ctx.camera.position.set(coreObj.position.x + 3, coreObj.position.y + 1.1, coreObj.position.z + 4.6); // 클로즈업
    ctx.camera.lookAt(coreObj.position);
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
    ctx.scene.add(makeCore(1.2, CORE_TEMP));
    const deb = makeSwarm(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1, flatShading: true }), DEBRIS, "debris");
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
    setState<DebrisState>(deb, { sx, delay, travel });
    ctx.scene.add(deb);
  },
  update(t, _dt, ctx) {
    const k = t / DUR4;
    const core = ctx.scene.getObjectByName("core") as THREE.Mesh;
    const grow = 0.6 + ease(k) * 3.1;
    core.scale.setScalar(grow * (1 + Math.sin(t * 4) * 0.04)); // 성장 + 박동
    (core.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.2 + Math.sin(t * 5) * 0.8;
    const deb = ctx.scene.getObjectByName("debris") as THREE.InstancedMesh;
    const { sx, delay, travel } = getState<DebrisState>(deb);
    updateSwarm(deb, (i, m4) => {
      const u = Math.min(1, Math.max(0, (t - delay[i]) / travel[i])); // 0 시작 → 1 흡수
      const e = ease(u);
      const s = (1 - u) * 0.9 + 0.05; // 코어에 가까울수록 작아짐(흡수)
      m4.makeScale(s, s, s).setPosition(
        sx[i * 3] + (CORE4.x - sx[i * 3]) * e,
        sx[i * 3 + 1] + (CORE4.y - sx[i * 3 + 1]) * e,
        sx[i * 3 + 2] + (CORE4.z - sx[i * 3 + 2]) * e
      );
    });
    // 카메라: 천천히 코어로 다가가며 살짝 선회
    const a = t * 0.22, rad = 22 - ease(k) * 8;
    ctx.camera.position.set(Math.cos(a) * rad, 4 + ease(k) * 2, Math.sin(a) * rad);
    ctx.camera.lookAt(CORE4);
  },
};

// ─────────────── 씬 5: 좌→우 해구 + 해구선을 따라 붉게 빛나는 코어 + 플라즈모이드 상승 ───────────────
const DUR5 = 8;
const PLAS = 800;
const VEIN = 56;
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
    const vein = makeSwarm(new THREE.IcosahedronGeometry(1, 2), coreMat, VEIN, "core");
    const r = rng(31), m4 = new THREE.Matrix4();
    for (let i = 0; i < VEIN; i++) {
      const x = -215 + (i / (VEIN - 1)) * 430, z = (r() - 0.5) * 5, y = -10 + (r() - 0.5) * 1.4, s = 3 + r() * 3.2;
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
    const { wn } = getState<{ wn: Float32Array }>(sw); // 시스템 정규화 가중치(0=적색~1=청백) — 강할수록 크게
    const py = new Float32Array(PLAS), px = new Float32Array(PLAS), pz = new Float32Array(PLAS), sp = new Float32Array(PLAS), sz = new Float32Array(PLAS), ph = new Float32Array(PLAS);
    const r2 = rng(77), mm = new THREE.Matrix4();
    for (let i = 0; i < PLAS; i++) {
      px[i] = -205 + r2() * 410; // 해구를 따라(좌→우)
      pz[i] = (r2() - 0.5) * 14;
      py[i] = -8 + r2() * 7;
      sp[i] = 5 + r2() * 7;
      sz[i] = 0.55 + wn[i] * 1.0 + r2() * 0.15; // 색(강함)에 비례한 크기 + 미세 변주
      ph[i] = r2() * Math.PI * 2;
      mm.makeScale(sz[i], sz[i], sz[i]).setPosition(px[i], py[i], pz[i]);
      sw.setMatrixAt(i, mm);
    }
    setState<RiseSwarmState>(sw, { py, px, pz, sp, sz, ph });
    ctx.scene.add(sw);
  },
  update(t, _dt, ctx) {
    const core = ctx.scene.getObjectByName("core") as THREE.InstancedMesh;
    (core.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 + Math.sin(t * 1.8) * 0.5;
    const sw = ctx.scene.getObjectByName("plasmoids") as THREE.InstancedMesh;
    const { py, px, pz, sp, sz, ph } = getState<RiseSwarmState>(sw);
    updateSwarm(sw, (i, m4) => {
      const s = sz[i] * (1 + Math.sin(t * 4 + ph[i]) * 0.2);
      m4.makeScale(s, s, s).setPosition(
        px[i] + Math.sin(t * 0.9 + ph[i]) * 2.2,
        py[i] + sp[i] * t, // 해수면을 향해 상승
        pz[i] + Math.cos(t * 0.8 + ph[i]) * 2.2
      );
    });
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
    const moonLight = new THREE.DirectionalLight(0xaec6ff, 1.8);
    moonLight.position.set(-30, 40, 20);
    ctx.scene.add(moonLight);
    // 모래 바닥 + 바다
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x6b6048, roughness: 1, flatShading: true }));
    sand.rotation.x = -Math.PI / 2;
    ctx.scene.add(sand);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(300, 120), new THREE.MeshStandardMaterial({ color: 0x16344a, roughness: 0.7 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.05, -60);
    ctx.scene.add(sea);
    ctx.scene.add(beachHouse());
    const plas = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.8, 2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PLAS_STRONG).multiplyScalar(0.1), emissive: PLAS_STRONG, emissiveIntensity: 0.8, roughness: 0.6 })
    ); // 가장 강한 개체(청백) — 희미하게 발광
    plas.name = "plas6";
    ctx.scene.add(plas);
  },
  update(t, _dt, ctx) {
    const plas = ctx.scene.getObjectByName("plas6")!;
    plas.position.set(-11 + (t / DUR6) * 22, 2.2, 0); // 집을 가로질러 통과
    const house = ctx.scene.getObjectByName("house") as THREE.Group;
    const ud = getState<HouseState>(house);
    // 통과 시 벽이 제자리에서 다수 조각으로 갈라져 와르르 무너져 내림(TC6 기점)
    for (const f of ud.wallFrags) fallFrag(f, t - TC6);
    // 약간 뒤 지붕이 잘게 파사삭 부서져 내림(TC6+0.5 기점)
    for (const f of ud.roofFrags) fallFrag(f, t - (TC6 + 0.5));
    // 카메라: 측상방에서 — 무너져 내리는 벽·지붕과 잔해 더미가 보이도록
    track(ctx, t / DUR6, [-13, 8, 16], [-3, 6.5, 12.5], _look.set(0, 1.5, -1));
  },
};

/** 인트로 컷씬 시퀀스(스펙 4장 1~6번 전체). */
export function introScenes(): CutScene[] {
  return [sceneOumuamua, sceneDispersal, sceneFall, sceneSplash, sceneSink, sceneCore, sceneRise, sceneHouse];
}
