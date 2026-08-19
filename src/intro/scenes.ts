import * as THREE from "three";
import type { CutScene } from "./CinematicPlayer";
import type { Frag } from "./helpers";
import {
  ease, rng, lump, track, spinAlong, makeSwarm, updateSwarm,
  starfield, sun, oumuamua, lights, underLights,
  seabed, makeCore, plasmoidSwarm, beachHouse, fallFrag,
  setState, getState, PLAS_STRONG, CORE_TEMP, SPACE_COL, DEEP_COL, SPIN_RATE, FWD1,
} from "./helpers";

// 인트로 군집 userData 상태(병렬 Float32Array) — setState/getState 로 타입 안전 접근.
interface DebrisState { sx: Float32Array; delay: Float32Array; travel: Float32Array; }
interface RiseSwarmState { py: Float32Array; px: Float32Array; pz: Float32Array; sp: Float32Array; sz: Float32Array; ph: Float32Array; }
interface HouseState { wallFrags: Frag[]; roofFrags: Frag[]; mats?: { m: THREE.MeshStandardMaterial; c: THREE.Color }[]; }

// 인트로 컷씬(spec/overview §4 개정 시나리오 — 세계관 정본 반영판).
// 아무것도 떨어지지 않는다: 오무아무아 = 탐침의 투영(횡단 → 소멸), 균열은 심해에서 직접 열린다.
// 공용 빌딩블록은 helpers.ts, 여기는 씬별 연출/타임라인만.

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

// ─────────────── 씬 2: 투영 소멸 — 탐침이 시야에서 꺼진다 ───────────────
// 아무것도 떨어지지 않는다: 스캔을 마친 오무아무아(탐침의 투영)가 비행 중 명멸하며 접히듯 사라진다.
const DUR2 = 6.5;
const VANISH_T = DUR2 * 0.58; // 투영 거둠 시작
const VANISH_LEN = 1.5; // 거둠 소요(s)
const START2 = new THREE.Vector3(-7, 0, 1.5); // 씬2 시작 위치
const FWD = new THREE.Vector3(1, 0.05, -0.16).normalize(); // 비행 방향(한쪽으로 쭉)
const ASPD = 1.5; // 소행성 속도
const RIGHT = new THREE.Vector3().crossVectors(FWD, new THREE.Vector3(0, 1, 0)).normalize();
const UP = new THREE.Vector3().crossVectors(RIGHT, FWD).normalize();
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

export const sceneVanish: CutScene = {
  name: "vanish",
  duration: DUR2,
  build(ctx) {
    ctx.scene.background = SPACE_COL.clone();
    ctx.scene.add(starfield(900, 23));
    lights(ctx.scene); // 씬1과 동일 조명 — 보는 각도만 다름
    const rock = oumuamua();
    rock.position.copy(START2);
    ctx.scene.add(rock);
  },
  update(t, dt, ctx) {
    const rock = ctx.scene.getObjectByName("rock")!;
    rock2Pos(rock.position, t); // 아치를 그리며 비행(씬1과 유사)
    spinAlong(rock, FWD, SPIN_RATE * t); // 긴 축 = 비행 방향, 그 축 둘레로 천천히 스크류 회전

    // 투영 거둠 — 그림자가 접히듯: 진행 축은 유지한 채 명멸하며 얇아지다 사라진다(폭발/파편 없음).
    const u = Math.min(1, Math.max(0, (t - VANISH_T) / VANISH_LEN));
    if (u > 0) {
      const flicker = u < 1 ? 1 + Math.sin(t * 42) * 0.3 * (1 - u) : 0; // 사라지는 동안 명멸
      const thin = Math.max(0.0001, (1 - ease(u)) * flicker); // 단면이 얇아짐
      rock.scale.set(Math.max(0.0001, 1 - ease(u) * 0.55), thin, thin); // 긴 축은 늦게, 둘레는 먼저 접힘
    }
    const stars = ctx.scene.getObjectByName("stars");
    if (stars) stars.rotation.y += dt * 0.01;
    // 카메라는 소멸 지점을 계속 응시 — 텅 빈 별밭에 잠시 머무는 여백이 연출의 핵심
    track(ctx, t / DUR2, [-15, 1, 12], [7, 6.5, 11], rock.position);
  },
};

// ─────────────── 씬 3: 심해 균열 개방 — 바늘구멍이 열린다 ───────────────
// 마리아나 해구 최심부, 아무것도 없던 어둠 속에서 최초 균열(~10cm)이 바깥에서 뚫린다.
const DUR3 = 6;
const RUPTURE_T = 1.8; // 정적 후 개방 시작(s) — 어둠을 먼저 보여준다
export const sceneRupture: CutScene = {
  name: "rupture",
  duration: DUR3,
  build(ctx) {
    ctx.scene.background = new THREE.Color(0x06121c); // 최심부 — 씬 중 가장 어둡게
    ctx.scene.fog = new THREE.FogExp2(0x06121c, 0.012);
    ctx.scene.add(new THREE.AmbientLight(0x1d4257, 1.4));
    const top = new THREE.DirectionalLight(0x6fa3bd, 0.7); // 형태만 겨우 보이는 미광
    top.position.set(8, 80, 12);
    ctx.scene.add(top);
    const sb = seabed();
    sb.position.set(0, -8, -6);
    ctx.scene.add(sb);
    // 최초 균열 — 바늘구멍: 아주 작은 발광점 + 점광(주변 해저를 붉게 물들임)
    const rup = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshStandardMaterial({ color: 0x2a0604, emissive: 0xff2408, emissiveIntensity: 3.2, roughness: 0.5 })
    );
    rup.name = "rupture";
    rup.position.set(0, -7.3, -2);
    rup.scale.setScalar(0.0001); // 없음에서 시작
    ctx.scene.add(rup);
    const pl = new THREE.PointLight(0xff3411, 0, 70, 1.2);
    pl.name = "ruplight";
    pl.position.set(0, -6.9, -2);
    ctx.scene.add(pl);
  },
  update(t, _dt, ctx) {
    const k = t / DUR3;
    const rup = ctx.scene.getObjectByName("rupture")!;
    const pl = ctx.scene.getObjectByName("ruplight") as THREE.PointLight;
    // 정적(어둠) → 점화 → 미세하게 벌어짐. 크기는 끝까지 "바늘구멍~손톱" 스케일 유지(성장은 씬4의 몫).
    const open = Math.max(0, (t - RUPTURE_T) / (DUR3 - RUPTURE_T));
    const s = 0.001 + ease(open) * 0.32;
    rup.scale.setScalar(s * (1 + Math.sin(t * 7) * 0.15)); // 갓 열린 균열의 불안정한 박동
    pl.intensity = ease(open) * 130 * (1 + Math.sin(t * 5) * 0.2);
    // 카메라: 어둠 속을 천천히 밀고 들어가 점을 응시(푸시 인)
    ctx.camera.position.set(2.6 - k * 1.2, -5.0 - k * 1.0, 6.5 - k * 3.0);
    ctx.camera.lookAt(_look.set(0, -7.1, -2));
  },
};

// ─────────────── 씬 4: 균열(코어) 확장 — 주변 물질의 에너지 흡수 ───────────────
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

// ─────────────── 씬 6: 해변 집 — 플라즈모이드 통과 → 디테일 상실 → 붕괴 ───────────────
const DUR6 = 7.5;
const TC6 = DUR6 * 0.46; // 붕괴 시작(플라즈모이드가 집 중앙 통과)
const _flat = new THREE.Color(0x8a8478); // 디테일(색 정보)을 잃은 물질의 단일 무광 톤
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
    const house = beachHouse();
    ctx.scene.add(house);
    // 디테일 상실 캐시 — 붕괴 직전 집이 먼저 질감(색 정보)을 잃고 단조로운 다면체가 된다(영점 에너지 상실의 시각화, spec/overview §4).
    const ud6 = getState<HouseState>(house);
    const seen = new Set<THREE.Material>();
    const mats: { m: THREE.MeshStandardMaterial; c: THREE.Color }[] = [];
    house.traverse((o) => {
      const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mm && mm.color && !seen.has(mm)) {
        seen.add(mm);
        mats.push({ m: mm, c: mm.color.clone() });
      }
    });
    ud6.mats = mats;
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
    // ① 디테일 상실 — 플라즈모이드가 다가오는 동안(붕괴 1.6s 전부터) 색·질감이 단일 무광 톤으로
    //    바랜다: 붕괴보다 먼저 "정보(디테일)"가 사라진다.
    const fade = ease(Math.min(1, Math.max(0, (t - (TC6 - 1.6)) / 1.4)));
    if (ud.mats && fade > 0) {
      for (const e of ud.mats) e.m.color.copy(e.c).lerp(_flat, fade);
    }
    // ② 통과 시 벽이 제자리에서 다수 조각으로 갈라져 와르르 무너져 내림(TC6 기점)
    for (const f of ud.wallFrags) fallFrag(f, t - TC6);
    // 약간 뒤 지붕이 잘게 파사삭 부서져 내림(TC6+0.5 기점)
    for (const f of ud.roofFrags) fallFrag(f, t - (TC6 + 0.5));
    // 카메라: 측상방에서 — 무너져 내리는 벽·지붕과 잔해 더미가 보이도록
    track(ctx, t / DUR6, [-13, 8, 16], [-3, 6.5, 12.5], _look.set(0, 1.5, -1));
  },
};

/** 인트로 컷씬 시퀀스(spec/overview §4 개정 시나리오 — 횡단·소멸·균열 개방·확장·상승·집 붕괴). */
export function introScenes(): CutScene[] {
  return [sceneOumuamua, sceneVanish, sceneRupture, sceneCore, sceneRise, sceneHouse];
}
