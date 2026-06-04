import * as THREE from "three";
import type { PlayerController } from "../player/PlayerController";
import { hudSizesFor } from "./hudLayout";

/**
 * 좌측 상단 후방 시야 카메라.
 * 메인 컴포저 렌더 직후 같은 캔버스의 좌상단 영역에 viewport/scissor 로 덧그린다.
 * 박스 크기는 화면 비례(hudSizesFor) — CSS 테두리 박스와 동일 공식으로 정렬.
 * 원격 드론 컨셉의 디제틱 보조 디스플레이.
 */
export class RearView {
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private player: PlayerController;
  private aspect = 0; // 마지막 적용 종횡비(변할 때만 투영 갱신)

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, player: PlayerController) {
    this.renderer = renderer;
    this.scene = scene;
    this.player = player;
    // FOV 는 메인보다 약간 넓게(보조 시야의 정보량 ↑). 종횡비는 매 프레임 화면 크기로 갱신.
    this.camera = new THREE.PerspectiveCamera(82, 12 / 7, 0.1, 600);
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
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const { rearW, rearH, margin } = hudSizesFor(winW, winH);
    const asp = rearW / rearH;
    if (asp !== this.aspect) {
      this.camera.aspect = asp;
      this.camera.updateProjectionMatrix();
      this.aspect = asp;
    }
    // WebGL 좌표계는 좌하단 원점 → 좌상단 박스를 위해 y 를 뒤집어 계산
    const x = margin;
    const y = winH - margin - rearH;

    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.setScissorTest(true);
    r.setScissor(x, y, rearW, rearH);
    r.setViewport(x, y, rearW, rearH);
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, winW, winH);
    r.autoClear = prevAutoClear;
  }
}
