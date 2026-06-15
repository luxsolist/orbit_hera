import * as THREE from "three";

// 플라즈모이드 표식 — 카메라를 향하는 빌보드 "코너 브래킷"(네 모서리만 선).
// 대상 크기에 맞춘 사각 프레임. 평소 노란색, 락온 대상만 붉은색. 선 굵기는 화면상 일정(거리 무관), 크기만 타깃에 맞춰 커짐.

export const RANGE = 2000; // 이 거리(m) 이내의 적 모두 표시(2km)
const CORNER_LEN = 0.45; // 변 절반(=1) 대비 코너 선 길이
const MARGIN = 2.2; // 대상 반경 대비 프레임 반경(대상을 둘러쌈) — 크게(기존 1.56 → 2.2)
const MAX = 128; // 동시 표시 상한(풀) — 일괄 스폰(현 100) 전부 표식되도록 상향
const BRACKET_OPACITY = 0.9; // 투명도(거리 무관 일정 — 거리별 색/농도 변화 없음)
const THICK_SCREEN = 0.006; // 코너 선 절반 두께 = THICK_SCREEN·거리(m) → 화면상 두께 일정(타깃 크기·거리 무관). 클수록 두껍게
const MAX_T_FRAC = 0.35; // 두께/프레임반경 상한 — 멀어 두께가 커지면 프레임에 최소 크기 부여(코너 뾰족점이 항상 바깥 향하도록)
const BRACKET_COLOR = new THREE.Color(0xffd400); // 평소 — 노란색(솔리드)
const LOCK_COLOR = new THREE.Color(0xff2030); // 락온 대상 — 붉은색

/** 브래킷 투명도 — 거리 무관 일정(거리별 농도/색 변화 제거). 순수. */
export function bracketOpacity(_dist: number): number {
  return BRACKET_OPACITY;
}

/** 코너 선 절반 두께(m) — 거리 비례 → 화면상 두께 일정(타깃 크기 무관). 순수. */
export function bracketHalfThick(dist: number): number {
  return THICK_SCREEN * dist;
}

/**
 * 브래킷 프레임 반경(m) — 타깃 크기(radius·MARGIN)에 맞추되, 절반두께 t 대비 최소 크기 보장.
 * t ≤ MAX_T_FRAC·반경 을 항상 만족 → 두께가 팔을 삼키지 않아 코너 뾰족점이 항상 바깥을 향한다. 순수.
 */
export function bracketFrameRadius(targetRadius: number, halfThick: number): number {
  return Math.max(targetRadius * MARGIN, halfThick / MAX_T_FRAC);
}

/**
 * NDC(투영 좌표) → 화면 픽셀 + 가시성. z>1 은 카메라 뒤(절두체 밖) → visible:false. 순수.
 * (x:-1..1 → 0..w, y:1..-1 위→아래로 Y 뒤집어 0..h)
 */
export function projectToScreen(ndc: { x: number; y: number; z: number }, w: number, h: number): { left: number; top: number; visible: boolean } {
  return { left: (ndc.x * 0.5 + 0.5) * w, top: (-ndc.y * 0.5 + 0.5) * h, visible: ndc.z <= 1 };
}

/** 체력 → 라벨 문자열(0 미만 0, 올림). 순수. */
export function labelText(hp: number): string {
  return String(Math.max(0, Math.ceil(hp)));
}

const CORNERS = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
const VERTS = CORNERS.length * 2 * 6; // 코너 4 × (수평+수직) × 삼각형2(6정점)

/** 빈(0으로 채운) 코너 브래킷 지오메트리 — 매 프레임 writeBracketGeo 로 채운다(슬롯별 개별 지오메트리). */
function makeBracketGeo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(VERTS * 3), 3));
  return g;
}

/**
 * 코너 브래킷을 (프레임 반경 e, 절반 두께 t) 로 다시 쓴다 — 선이 아니라 채워진 쿼드.
 * 외곽 꼭짓점(X,Y)에 ㄱ자 두 팔이 맞물리고 **두께는 안쪽으로만** 들어간다 → 뾰족한 점이 항상 바깥(프레임 모서리)을 향함.
 * e 는 타깃 크기(프레임 크기), t 는 거리 비례(화면상 두께 일정).
 */
function writeBracketGeo(geo: THREE.BufferGeometry, e: number, t: number): void {
  const arr = (geo.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const L = CORNER_LEN * e; // 팔 길이는 프레임에 비례
  let o = 0;
  // (x0,y0)~(x1,y1) 대각 두 점으로 사각형(순서 무관, DoubleSide).
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    arr[o++] = x0; arr[o++] = y0; arr[o++] = 0; arr[o++] = x1; arr[o++] = y0; arr[o++] = 0; arr[o++] = x1; arr[o++] = y1; arr[o++] = 0;
    arr[o++] = x0; arr[o++] = y0; arr[o++] = 0; arr[o++] = x1; arr[o++] = y1; arr[o++] = 0; arr[o++] = x0; arr[o++] = y1; arr[o++] = 0;
  };
  for (const [cx, cy] of CORNERS) {
    const X = cx * e, Y = cy * e, sx = Math.sign(cx), sy = Math.sign(cy);
    quad(X, Y, X - sx * L, Y - sy * t); // 수평 팔 — 외곽(X,Y)에서 안쪽으로 길이 L, 두께는 안쪽으로 t
    quad(X, Y, X - sx * t, Y - sy * L); // 수직 팔 — 외곽(X,Y)에서 안쪽으로 길이 L, 두께는 안쪽으로 t
  }
  (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
}

/** 적 위치+시각 반경(월드)+체력 표식 입력. */
export interface BracketMarker {
  pos: THREE.Vector3;
  radius: number;
  hp: number;
}

const _camPos = new THREE.Vector3();
const _camQuat = new THREE.Quaternion();
const _camUp = new THREE.Vector3();
const _top = new THREE.Vector3(); // 박스 상단(라벨 위치) 투영용

/** 근거리 적에 코너 브래킷 + 체력 수치를 씌우는 경량 풀. 브래킷은 씬(3D), 체력 라벨은 DOM 오버레이. */
export class TargetBrackets {
  private group = new THREE.Group();
  private pool: THREE.Mesh[] = [];
  private mats: THREE.MeshBasicMaterial[] = []; // 개체별 투명도(거리 페이드)용 — 슬롯마다 개별 머티리얼
  private layer: HTMLDivElement | null = null; // 체력 라벨 DOM 컨테이너
  private labels: HTMLDivElement[] = [];

  constructor(scene: THREE.Scene) {
    this.group.name = "targetBrackets";
    scene.add(this.group);
    if (typeof document !== "undefined") {
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:3";
      document.body.appendChild(el);
      this.layer = el;
    }
  }

  /**
   * 매 프레임 — RANGE 이내 적에 브래킷(빌보드·대상 크기) + 박스 위 체력 수치.
   * lockedPos 와 동일 참조(===)인 마커는 붉은색(락온 강조), 나머지는 노란색.
   */
  update(camera: THREE.Camera, markers: readonly BracketMarker[], lockedPos: THREE.Vector3 | null = null): void {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert(); // 이 프레임 투영 정확성 보장
    camera.getWorldPosition(_camPos);
    camera.getWorldQuaternion(_camQuat);
    _camUp.set(0, 1, 0).applyQuaternion(_camQuat);
    const w = window.innerWidth, h = window.innerHeight;
    const r2 = RANGE * RANGE;
    let n = 0;
    for (const m of markers) {
      if (n >= MAX) break;
      const d2 = m.pos.distanceToSquared(_camPos);
      if (d2 > r2) continue;
      const i = n++;
      const dist = Math.sqrt(d2);
      const op = BRACKET_OPACITY; // 거리 무관 일정

      const b = this.acquire(i);
      b.visible = true;
      b.position.copy(m.pos);
      b.quaternion.copy(_camQuat); // 카메라 정면을 향함 → 화면상 정사각 프레임
      b.scale.setScalar(1); // 스케일 대신 지오메트리로 직접 크기 지정(두께를 크기와 분리)
      const t = bracketHalfThick(dist); // 절반 두께(화면상 일정)
      writeBracketGeo(b.geometry, bracketFrameRadius(m.radius, t), t); // 프레임=타깃 크기(두께 대비 최소 보장)
      this.mats[i].opacity = op;
      this.mats[i].color.set(lockedPos !== null && m.pos === lockedPos ? LOCK_COLOR : BRACKET_COLOR); // 락온=빨강, 그 외 노랑

      // 체력 수치 — 박스 상단을 화면에 투영해 라벨 배치(카메라 뒤면 숨김)
      const label = this.acquireLabel(i);
      if (label) {
        _top.copy(m.pos).addScaledVector(_camUp, m.radius * MARGIN).project(camera);
        const scr = projectToScreen(_top, w, h);
        if (scr.visible) {
          label.style.display = "block";
          label.style.left = scr.left.toFixed(1) + "px";
          label.style.top = scr.top.toFixed(1) + "px";
          label.style.opacity = op.toFixed(2);
          const txt = labelText(m.hp);
          if (label.textContent !== txt) label.textContent = txt;
        } else {
          label.style.display = "none";
        }
      }
    }
    for (let i = n; i < this.pool.length; i++) {
      this.pool[i].visible = false;
      if (this.labels[i]) this.labels[i].style.display = "none";
    }
  }

  private acquire(i: number): THREE.Mesh {
    let b = this.pool[i];
    if (!b) {
      const mat = new THREE.MeshBasicMaterial({ color: BRACKET_COLOR, transparent: true, opacity: BRACKET_OPACITY, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      b = new THREE.Mesh(makeBracketGeo(), mat); // 슬롯별 개별 지오메트리(매 프레임 크기·두께 갱신)
      b.frustumCulled = false;
      b.renderOrder = 3; // 장면 위에 올림
      this.group.add(b);
      this.pool[i] = b;
      this.mats[i] = mat;
    }
    return b;
  }

  private acquireLabel(i: number): HTMLDivElement | null {
    if (!this.layer) return null;
    let el = this.labels[i];
    if (!el) {
      el = document.createElement("div");
      el.style.cssText =
        "position:absolute;transform:translate(-50%,-110%);font:bold 11px ui-monospace,monospace;" +
        "color:#cdf6ff;text-shadow:0 0 3px #000,0 0 2px #000;white-space:nowrap;will-change:left,top";
      this.layer.appendChild(el);
      this.labels[i] = el;
    }
    return el;
  }

  /** 전투 외(사망/일시정지)에서 호출 — 브래킷·체력 라벨 모두 숨김(잔상 방지). */
  hide(): void {
    for (const b of this.pool) b.visible = false;
    for (const l of this.labels) l.style.display = "none";
  }

  dispose(): void {
    for (const b of this.pool) b.geometry.dispose();
    for (const m of this.mats) m?.dispose();
    this.layer?.remove();
  }
}
