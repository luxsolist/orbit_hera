import * as THREE from "three";
import type { SpawnPoint } from "./MapData";
import { SKY_COLOR, FOG_COLOR, FOG_NEAR_RATIO, FOG_FAR_DEFAULT, LIGHT } from "./palette";

/**
 * 대기/조명 — 반구광 · 태양(그림자 추종) · 보조광 + 하늘 배경/포그.
 * 지형/구조 메시(World)와 독립. 큰 맵에서 그림자가 플레이어를 따라오도록 매 프레임 태양을 평행이동.
 */
export class SkyEnvironment {
  private readonly sun: THREE.DirectionalLight;

  /** viewFar = 지오메트리가 존재하는 최대 거리(스트리밍 청크 로드 반경). 포그가 그 지점에서 끝난다. */
  constructor(scene: THREE.Scene, spawn: SpawnPoint, viewFar = FOG_FAR_DEFAULT) {
    const hemi = new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemi);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(LIGHT.sunColor, LIGHT.sun);
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

    const fill = new THREE.DirectionalLight(LIGHT.fillColor, LIGHT.fill);
    fill.position.set(-200, 160, -300);
    scene.add(fill);

    scene.background = new THREE.Color(SKY_COLOR); // 차분한 회청 — 청백 플라즈모이드가 묻히지 않게
    // 포그의 실질 기능은 **청크 경계 은폐**(로드 반경 밖은 지오메트리가 없다). 교전 사거리를 흐리지
    // 않도록 늦게 시작해 경계에서 100% 가 된다. 색은 하늘보다 밝다 — 같게 두면 원경이 가라앉는다(palette.ts).
    scene.fog = new THREE.Fog(FOG_COLOR, viewFar * FOG_NEAR_RATIO, viewFar);
  }

  /** 매 프레임 호출 — 태양(그림자 프러스텀)을 플레이어 위치로 평행이동(광원 방향은 유지). */
  update(px: number, pz: number) {
    this.sun.position.set(px + 300, 520, pz + 360); // 남동 오전 햇살(상대 방향 고정)
    this.sun.target.position.set(px, 0, pz);
  }
}
