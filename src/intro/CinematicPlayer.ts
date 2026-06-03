import * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { createComposer } from "../fx/postprocessing";

/** 컷씬이 채우고 갱신하는 렌더 컨텍스트(전용 씬/카메라). */
export interface SceneCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

/** 인트로 시네마틱의 한 장면. build → 매 프레임 update(t: 0..duration) → (선택) dispose. */
export interface CutScene {
  name: string;
  duration: number;
  build(ctx: SceneCtx): void;
  update(t: number, dt: number, ctx: SceneCtx): void;
  dispose?(ctx: SceneCtx): void;
}

const FADE_IN = 0.8;
const FADE_OUT = 0.45;

/**
 * 인트로 시네마틱 플레이어 — 전용 씬/카메라 + Bloom 컴포저로 컷씬 타임라인을 재생.
 * Game 의 렌더 루프가 매 프레임 update(dt) 를 호출하고 done 을 폴링한다.
 * 스킵: Esc / 클릭. 시작 시 검은 화면에서 페이드인, 종료/스킵 시 페이드아웃 후 done.
 */
export class CinematicPlayer {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private scenes: CutScene[];
  private idx = 0;
  private t = 0; // 현재 컷씬 로컬 시간
  private elapsed = 0; // 전체 경과(페이드인용)
  private finishing = false;
  private finishT = 0;
  private _done = false;
  private fade: HTMLDivElement;
  private hint: HTMLDivElement;
  private onSkip = (e: Event) => {
    if (e instanceof KeyboardEvent) {
      if (e.key === "Escape") this.endNow(); // Esc → 바로 종료
      return;
    }
    this.skip(); // 클릭 → 부드럽게 페이드아웃
  };

  constructor(renderer: THREE.WebGLRenderer, scenes: CutScene[]) {
    this.scenes = scenes;
    const size = renderer.getSize(new THREE.Vector2());
    this.camera = new THREE.PerspectiveCamera(60, size.x / Math.max(1, size.y), 0.1, 4000);
    this.composer = createComposer(renderer, this.scene, this.camera);

    this.fade = document.createElement("div");
    this.fade.style.cssText =
      "position:fixed;inset:0;background:#000;pointer-events:none;z-index:50;opacity:1";
    this.hint = document.createElement("div");
    this.hint.textContent = "Esc 종료 · 클릭 건너뛰기";
    this.hint.style.cssText =
      "position:fixed;right:18px;bottom:14px;color:#7fd6e0;font:600 12px/1 system-ui,sans-serif;" +
      "letter-spacing:.08em;opacity:.7;pointer-events:none;z-index:51;text-shadow:0 1px 3px #000";
    document.body.append(this.fade, this.hint);

    window.addEventListener("keydown", this.onSkip);
    window.addEventListener("pointerdown", this.onSkip);
    this.scenes[this.idx].build(this.ctx);
  }

  get done(): boolean {
    return this._done;
  }

  private get ctx(): SceneCtx {
    return { scene: this.scene, camera: this.camera };
  }

  setSize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }

  skip(): void {
    if (!this.finishing) {
      this.finishing = true;
      this.finishT = 0;
    }
  }

  /** 즉시 종료(페이드 없이) — Esc. 다음 프레임에 Game 이 done 을 감지해 메뉴 복귀. */
  endNow(): void {
    if (this._done) return;
    this._done = true;
    this.dispose();
  }

  update(dt: number): void {
    if (this._done) return;

    if (!this.finishing) {
      this.t += dt;
      this.elapsed += dt;
      let cur = this.scenes[this.idx];
      if (this.t >= cur.duration) {
        if (this.idx < this.scenes.length - 1) {
          this.clearScene();
          this.idx++;
          this.t = 0;
          this.scenes[this.idx].build(this.ctx);
          cur = this.scenes[this.idx];
        } else {
          this.skip(); // 마지막 씬 종료 → 페이드아웃
        }
      }
      if (!this.finishing) cur.update(Math.min(this.t, cur.duration), dt, this.ctx);
    } else {
      this.finishT += dt;
    }

    this.composer.render();
    this.updateFade();
  }

  private updateFade(): void {
    let o = 0;
    if (this.finishing) {
      o = Math.min(1, this.finishT / FADE_OUT);
      this.hint.style.opacity = "0";
      if (this.finishT >= FADE_OUT) {
        this._done = true;
        this.dispose();
        return;
      }
    } else if (this.elapsed < FADE_IN) {
      o = 1 - this.elapsed / FADE_IN;
    }
    this.fade.style.opacity = o.toFixed(3);
  }

  private clearScene(): void {
    this.scenes[this.idx].dispose?.(this.ctx);
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const o = this.scene.children[i];
      this.scene.remove(o);
      disposeObject(o);
    }
  }

  /** 멱등 — 종료/스킵 시 자체 호출, 외부에서 중단할 때도 안전. */
  dispose(): void {
    window.removeEventListener("keydown", this.onSkip);
    window.removeEventListener("pointerdown", this.onSkip);
    this.fade.remove();
    this.hint.remove();
    this.clearScene();
  }
}

function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
