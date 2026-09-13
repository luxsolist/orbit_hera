import {solarState} from './CityTime';
import type {CityAppearance} from './cities/types';
import * as THREE from "three";
import type { SpawnPoint } from "./MapData";
import { SKY_COLOR, FOG_COLOR, FOG_NEAR_RATIO, FOG_FAR_DEFAULT, LIGHT } from "./palette";

/**
 * 대기/조명 — 반구광 · 태양(그림자 추종) · 보조광 + 하늘 배경/포그.
 * 지형/구조 메시(World)와 독립. 큰 맵에서 그림자가 플레이어를 따라오도록 매 프레임 태양을 평행이동.
 */
export class SkyEnvironment {
  private readonly sun: THREE.DirectionalLight;
  private hemi!:THREE.HemisphereLight;
  private fill!:THREE.DirectionalLight;
  private lastTime=-Infinity;
  private solar?:ReturnType<typeof solarState>;
  private fixedDate?:Date;
  setTime(date?:Date){this.fixedDate=date;this.lastTime=-Infinity;}


  /** viewFar = 지오메트리가 존재하는 최대 거리(스트리밍 청크 로드 반경). 포그가 그 지점에서 끝난다. */
  constructor(private scene: THREE.Scene, spawn: SpawnPoint, viewFar = FOG_FAR_DEFAULT, private environment?:CityAppearance['environment']) {
    const light=environment?.light??LIGHT;
    const hemi = new THREE.HemisphereLight(light.hemiSky, light.hemiGround, light.hemi);
    scene.add(hemi);this.hemi=hemi;

    const sun = new THREE.DirectionalLight(light.sunColor, light.sun);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 1400;
    const s = 420; // 플레이어 주변을 덮는 그림자 범위(매 프레임 추종)
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = .035;
    sun.shadow.radius = 2;
    scene.add(sun.target);
    scene.add(sun);
    this.sun = sun;


    const fill = new THREE.DirectionalLight(light.fillColor, light.fill);
    fill.position.set(-200, 160, -300);
    scene.add(fill);this.fill=fill;

    scene.background = new THREE.Color(environment?.sky??SKY_COLOR); // 차분한 회청 — 청백 플라즈모이드가 묻히지 않게
    // 포그의 실질 기능은 **청크 경계 은폐**(로드 반경 밖은 지오메트리가 없다). 교전 사거리를 흐리지
    // 않도록 늦게 시작해 경계에서 100% 가 된다. 색은 하늘보다 밝다 — 같게 두면 원경이 가라앉는다(palette.ts).
    scene.fog = new THREE.Fog(environment?.fog??FOG_COLOR, viewFar * FOG_NEAR_RATIO, viewFar);
    this.update(spawn.x,spawn.z);
  }

  /** 매 프레임 호출 — 태양(그림자 프러스텀)을 플레이어 위치로 평행이동(광원 방향은 유지). */
  update(px: number, pz: number) {
    const clock=this.environment?.clock;
    if(clock){
      const date=this.fixedDate??new Date();
      if(Math.abs(date.getTime()-this.lastTime)>=1000){
        this.lastTime=date.getTime();this.solar=solarState(date,clock);
        const s=this.solar,light=this.environment!.light;
        this.hemi.intensity=.32+(light.hemi-.32)*s.dayLight;
        this.hemi.color.set(0x667ea9).lerp(new THREE.Color(light.hemiSky),s.dayLight);
        this.hemi.groundColor.set(0x414f69).lerp(new THREE.Color(light.hemiGround),s.dayLight);
        this.sun.intensity=light.sun*s.dayLight;this.sun.color.set(light.sunColor).lerp(new THREE.Color(0xffa766),s.twilight);
        this.fill.intensity=.18+(light.fill-.18)*s.dayLight;
        this.fill.color.set(0x88a9dc).lerp(new THREE.Color(light.fillColor),s.dayLight);
        const fog=new THREE.Color(0x1e2e4b).lerp(new THREE.Color(this.environment!.fog),s.dayLight).lerp(new THREE.Color(0xc49c91),s.twilight*.45);
        (this.scene.fog as THREE.Fog).color.copy(fog);
        (this.scene.background as THREE.Color).set(0x101c36).lerp(new THREE.Color(this.environment!.sky),s.dayLight);
        this.scene.userData.cityNight=s.night;this.scene.userData.cityDaylight=s.dayLight;this.scene.userData.cityTwilight=s.twilight;
      }
    }
    const s=this.solar;
    if(s)this.sun.position.set(px+s.x*700,Math.max(45,s.y*700),pz+s.z*700);
    else this.sun.position.set(px + 300, 680, pz + 360); // 남동 오전 햇살(상대 방향 고정)
    this.sun.target.position.set(px, 0, pz);
  }
}
