import * as THREE from "three";
import type { PlayerController } from "../player/PlayerController";

const REAR_W = 240;
const REAR_H = 140;
const MARGIN = 16;

/**
 * 좌측 상단 후방 시야 카메라.
 * 메인 컴포저 렌더 직후 같은 캔버스의 좌상단 영역에 viewport/scissor 로 덧그린다.
 * 원격 드론 컨셉의 디제틱 보조 디스플레이.
 */
export class RearView {
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private player: PlayerController;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, player: PlayerController) {
    this.renderer = renderer;
    this.scene = scene;
    this.player = player;
    // FOV 는 메인보다 약간 넓게(보조 시야의 정보량 ↑).
    this.camera = new THREE.PerspectiveCamera(82, REAR_W / REAR_H, 0.1, 600);
  }

  /** 매 프레임: 카메라를 플레이어 위치/뒤쪽으로 갱신하고 좌상단 박스에 덧그린다. */
  render() {
    const yaw = this.player.viewYaw + Math.PI; // 뒤쪽 방향
    const pos = this.player.worldPosition;

    this.camera.position.copy(pos);
    // 후방 보조 카메라는 수평으로 고정(피치는 따라가지 않음 → 시야 안정)
    const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.camera.lookAt(pos.x + dir.x, pos.y, pos.z + dir.z);

    const r = this.renderer;
    const winH = window.innerHeight;
    // WebGL 좌표계는 좌하단 원점 → 좌상단 박스를 위해 y 를 뒤집어 계산
    const x = MARGIN;
    const y = winH - MARGIN - REAR_H;

    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.setScissorTest(true);
    r.setScissor(x, y, REAR_W, REAR_H);
    r.setViewport(x, y, REAR_W, REAR_H);
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, window.innerWidth, winH);
    r.autoClear = prevAutoClear;
  }

  /** 후방 박스(테두리)와 같은 크기의 영역을 차지하므로, 외부 CSS 요소가 이 좌표에 맞게 배치된다 */
  static get size(): { w: number; h: number; margin: number } {
    return { w: REAR_W, h: REAR_H, margin: MARGIN };
  }
}
