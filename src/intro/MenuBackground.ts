import * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { createComposer } from "../fx/postprocessing";
import { disposeObject } from "./CinematicPlayer";
import type { CutScene, SceneCtx } from "./CinematicPlayer";

const FADE = 0.7; // 장면 시작/끝 페이드(검정) 길이(초)

/**
 * 메인(전장 선택) 화면 배경 — 인트로 컷씬 중 하나를 랜덤으로 골라 실시간 렌더한다.
 * 한 장면이 끝나면 다른 랜덤 장면으로 교체(순환), 장면 사이는 검정 페이드로 전환.
 * 페이드 div 는 캔버스 위·메뉴 오버레이(z-20) 아래에 두어 배경만 어두워진다.
 */
export class MenuBackground {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private cut!: CutScene;
  private t = 0;
  private fade: HTMLDivElement;

  constructor(renderer: THREE.WebGLRenderer, private scenes: CutScene[]) {
    const size = renderer.getSize(new THREE.Vector2());
    this.camera = new THREE.PerspectiveCamera(60, size.x / Math.max(1, size.y), 0.1, 4000);
    this.composer = createComposer(renderer, this.scene, this.camera);
    this.fade = document.createElement("div");
    // #app(fixed) 내부에 캔버스 위·오버레이(z-20) 아래로 → 배경 장면만 페이드
    this.fade.style.cssText =
      "position:absolute;inset:0;background:#04060c;pointer-events:none;z-index:5;opacity:1";
    (document.getElementById("app") ?? document.body).appendChild(this.fade);
    this.pickRandom();
  }

  private get ctx(): SceneCtx {
    return { scene: this.scene, camera: this.camera };
  }

  /** 새 랜덤 장면으로 교체(이전 장면 정리 후 빌드). */
  private pickRandom(): void {
    this.cut?.dispose?.(this.ctx);
    this.clearScene();
    this.cut = this.scenes[(Math.random() * this.scenes.length) | 0];
    this.t = 0;
    this.cut.build(this.ctx);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t >= this.cut.duration) this.pickRandom(); // 장면 종료(페이드아웃 끝) → 다른 랜덤 장면
    this.cut.update(Math.min(this.t, this.cut.duration), dt, this.ctx);
    this.composer.render();

    // 장면 시작 FADE 동안 페이드인, 끝 FADE 동안 페이드아웃(전환은 검정에서 일어남)
    const d = this.cut.duration;
    let o = 0;
    if (this.t < FADE) o = 1 - this.t / FADE;
    else if (this.t > d - FADE) o = (this.t - (d - FADE)) / FADE;
    this.fade.style.opacity = Math.min(1, Math.max(0, o)).toFixed(3);
  }

  setSize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }

  private clearScene(): void {
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const o = this.scene.children[i];
      this.scene.remove(o);
      disposeObject(o);
    }
  }

  dispose(): void {
    this.cut?.dispose?.(this.ctx);
    this.clearScene();
    this.fade.remove();
  }
}
