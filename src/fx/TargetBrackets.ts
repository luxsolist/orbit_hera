import * as THREE from "three";

// 근거리 플라즈모이드 표식 — 카메라를 향하는 빌보드 "코너 브래킷"(네 모서리만 선).
// 대상 크기에 맞춘 사각 프레임. HDR 시안-화이트로 블룸에 걸려 또렷이 빛난다(조준/식별 HUD). 거리 페이드.

export const RANGE = 800; // 이 거리(m) 이내의 적만 표시(고고도 교전 가시성)
const CORNER_LEN = 0.45; // 변 절반(=1) 대비 코너 선 길이
const MARGIN = 1.3; // 대상보다 살짝 바깥으로 프레임
const MAX = 64; // 동시 표시 상한(풀)
const NEAR_OPACITY = 0.95; // 최근접 투명도
const FAR_OPACITY = 0.35; // RANGE 거리에서의 투명도(0 까지 안 떨어뜨려 원거리도 식별)
// HDR(>1) 시안-화이트 — ACES 톤매핑·블룸 임계(0.75) 를 넘겨 얇은 선도 또렷이 빛나게.
const BRACKET_COLOR = new THREE.Color(0x9fe6ff).multiplyScalar(1.6);

/** 거리 → 브래킷 투명도(근접 NEAR_OPACITY ~ RANGE FAR_OPACITY 선형, 양끝 클램프). 순수. */
export function bracketOpacity(dist: number): number {
  const k = Math.min(1, Math.max(0, dist / RANGE));
  return NEAR_OPACITY + (FAR_OPACITY - NEAR_OPACITY) * k;
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

/** ±1 정사각형의 네 모서리에만 ㄱ자 선을 둔 LineSegments 지오메트리. */
function makeBracketGeo(): THREE.BufferGeometry {
  const L = CORNER_LEN;
  const v: number[] = [];
  for (const [cx, cy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
    const sx = Math.sign(cx), sy = Math.sign(cy);
    v.push(cx, cy, 0, cx - sx * L, cy, 0); // 수평 코너 선
    v.push(cx, cy, 0, cx, cy - sy * L, 0); // 수직 코너 선
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  return g;
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
  private geo = makeBracketGeo();
  private pool: THREE.LineSegments[] = [];
  private mats: THREE.LineBasicMaterial[] = []; // 개체별 투명도(거리 페이드)용 — 슬롯마다 개별 머티리얼
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

  /** 매 프레임 — RANGE 이내 적에 브래킷(빌보드·대상 크기·거리 페이드) + 박스 위 체력 수치. */
  update(camera: THREE.Camera, markers: readonly BracketMarker[]): void {
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
      const op = bracketOpacity(Math.sqrt(d2)); // 멀수록 흐리되 하한 유지

      const b = this.acquire(i);
      b.visible = true;
      b.position.copy(m.pos);
      b.quaternion.copy(_camQuat); // 카메라 정면을 향함 → 화면상 정사각 프레임
      b.scale.setScalar(m.radius * MARGIN);
      this.mats[i].opacity = op;

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

  private acquire(i: number): THREE.LineSegments {
    let b = this.pool[i];
    if (!b) {
      const mat = new THREE.LineBasicMaterial({ color: BRACKET_COLOR, transparent: true, opacity: NEAR_OPACITY, depthTest: false, depthWrite: false });
      b = new THREE.LineSegments(this.geo, mat);
      b.frustumCulled = false;
      b.renderOrder = 3; // 장면 위에 얇게 올림
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
    this.geo.dispose();
    for (const m of this.mats) m?.dispose();
    this.layer?.remove();
  }
}
