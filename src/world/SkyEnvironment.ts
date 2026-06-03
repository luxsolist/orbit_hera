import * as THREE from "three";
import type { SpawnPoint } from "./MapData";

/**
 * 대기/조명 — 반구광 · 태양(그림자 추종) · 보조광 + 하늘 배경/포그.
 * 지형/구조 메시(World)와 독립. 큰 맵에서 그림자가 플레이어를 따라오도록 매 프레임 태양을 평행이동.
 */
export class SkyEnvironment {
  private readonly sun: THREE.DirectionalLight;

  constructor(scene: THREE.Scene, spawn: SpawnPoint) {
    const hemi = new THREE.HemisphereLight(0xbfdcff, 0x6f7a4a, 1.18);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3da, 2.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 1400;
    const s = 420; // 플레이어 주변을 덮는 그림자 범위(매 프레임 추종)
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0006;
    scene.add(sun.target);
    scene.add(sun);
    this.sun = sun;
    this.update(spawn.x, spawn.z); // 초기 위치

    const fill = new THREE.DirectionalLight(0xaecbe6, 0.4);
    fill.position.set(-200, 160, -300);
    scene.add(fill);

    scene.background = new THREE.Color(0x2f9bf2); // 선명한 하늘 파랑
    scene.fog = new THREE.Fog(0xb8e0ff, 900, 5000); // 밝고 청량한 원경 헤이즈
  }

  /** 매 프레임 호출 — 태양(그림자 프러스텀)을 플레이어 위치로 평행이동(광원 방향은 유지). */
  update(px: number, pz: number) {
    this.sun.position.set(px + 300, 520, pz + 360); // 남동 오전 햇살(상대 방향 고정)
    this.sun.target.position.set(px, 0, pz);
  }
}
