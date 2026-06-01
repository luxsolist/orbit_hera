import * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Input } from "./Input";
import { MobileControls } from "./MobileControls";
import { World } from "../world/World";
import { PlayerController } from "../player/PlayerController";
import { EnemyManager } from "../enemies/EnemyManager";
import { FrequencyBeam } from "../weapons/FrequencyBeam";
import { SpecialBarrage } from "../weapons/SpecialBarrage";
import { HUD } from "../ui/HUD";
import { RearView } from "../ui/RearView";
import { Minimap } from "../ui/Minimap";
import { createComposer } from "../fx/postprocessing";

type GameState = "title" | "playing" | "paused" | "dead";

/**
 * Seed 코어 게임 루프 오케스트레이터.
 * 렌더러/씬/카메라/포스트프로세싱과 모든 시스템(입력·월드·플레이어·적·무기·HUD)을 묶는다.
 */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private composer: EffectComposer;
  private clock = new THREE.Clock();

  private input: Input;
  private mobile: MobileControls;
  private world: World;
  private player: PlayerController;
  private enemies: EnemyManager;
  private beam: FrequencyBeam;
  private special: SpecialBarrage;
  private hud: HUD;
  private rearView: RearView;
  private minimap: Minimap;

  private state: GameState = "title";
  private overlay: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlaySubtitle: HTMLElement;
  private startBtn: HTMLButtonElement;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // 시스템 구성
    this.input = new Input(canvas);
    this.mobile = new MobileControls(this.input);
    this.world = new World(this.scene);
    this.player = new PlayerController(this.input, this.world, window.innerWidth / window.innerHeight);
    this.enemies = new EnemyManager(this.scene, this.world, this.player);
    this.beam = new FrequencyBeam(this.scene, this.player, this.enemies);
    this.special = new SpecialBarrage(this.scene, this.player, this.enemies);
    this.hud = new HUD();
    this.composer = createComposer(this.renderer, this.scene, this.player.camera);
    this.rearView = new RearView(this.renderer, this.scene, this.player);
    this.minimap = new Minimap(this.player, this.enemies, this.world);

    this.wireEvents();

    // 오버레이
    this.overlay = byId("overlay");
    this.overlayTitle = this.overlay.querySelector(".overlay__title") as HTMLElement;
    this.overlaySubtitle = this.overlay.querySelector(".overlay__subtitle") as HTMLElement;
    this.startBtn = byId("startBtn") as HTMLButtonElement;
    this.startBtn.addEventListener("click", () => this.startOrResume());

    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("pointerlockchange", () => this.onPointerLockChange());
  }

  private wireEvents() {
    this.beam.onFired = () => this.hud.flashFire();
    this.special.onFired = () => this.hud.flashFire();
    this.enemies.onKill = () => this.hud.setKills(this.enemies.killCount);
    this.enemies.onWaveChange = (w) => this.hud.setWave(w);
    this.enemies.onPlayerHit = () => this.hud.flashDamage();
    this.hud.setUnitName("ANDROID-01");
  }

  start() {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** 시작 버튼: 첫 접속 또는 사망 후 재접속 또는 일시정지 해제 */
  private startOrResume() {
    if (this.state === "title" || this.state === "dead") {
      this.player.reset();
      this.enemies.start();
      this.special.reset();
      this.hud.setKills(0);
      this.state = "playing";
    } else if (this.state === "paused") {
      this.state = "playing";
    }
    this.hideOverlay();
    this.hud.setActive(true);
    // 터치 디바이스에서는 포인터락이 의미 없음 — 강제로 잠금 상태로 가정.
    // 사용자 제스처 컨텍스트에서 풀스크린 + 가로 모드 잠금을 시도(폴백은 회전 안내).
    if (this.mobile.enabled) {
      this.input.locked = true;
      this.mobile.attemptLandscapeLock();
    } else {
      this.input.requestLock();
    }
  }

  private onPointerLockChange() {
    // 터치 디바이스는 포인터락 이벤트로 일시정지하지 않는다(애초에 락이 없음).
    if (this.mobile.enabled) return;
    if (!this.input.locked && this.state === "playing") {
      // ESC 등으로 잠금 해제 → 일시정지
      this.state = "paused";
      this.showOverlay("PAUSED", "LINK SUSPENDED — 클릭하여 재접속");
      this.hud.setActive(false);
    }
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05); // 스파이크 방지

    // 모바일 세로 모드 등으로 입력을 받지 말아야 할 때는 게임 로직을 건너뛰고
    // 렌더만 유지(회전 안내 오버레이가 화면을 덮음).
    if (this.state === "playing" && this.input.locked && !this.mobile.isBlocked) {
      this.player.update(dt);
      this.beam.update(dt, this.input.fireHeld);
      this.special.update(dt, this.input.specialPressed);
      this.enemies.update(dt);
      this.hud.update(dt);

      // HUD 수치 동기화
      this.hud.setHp(this.player.hp, this.player.maxHp);
      this.hud.setFrequency(this.player.freq, this.player.maxFreq);
      const cdReady = this.special.cooldownReady;
      const cdRemaining = Math.max(0, 60 - cdReady * 60);
      this.hud.setSpecial(cdReady, this.special.isActive, cdRemaining);
      this.mobile.setSpecialState(cdReady, this.special.isActive, cdRemaining);

      if (this.player.isDead) this.onDeath();
    }

    this.input.endFrame();
    this.composer.render();
    // 메인 렌더 후 좌상단 후방 시야를 덧그리고, 미니맵(2D 캔버스)을 갱신.
    if (this.state === "playing") {
      this.rearView.render();
      this.minimap.render();
    }
  }

  private onDeath() {
    this.state = "dead";
    this.hud.setActive(false);
    document.exitPointerLock();
    this.showOverlay(
      "LINK LOST",
      `정화 ${this.enemies.killCount}체 · WAVE ${this.enemies.wave} — 재접속하여 재개`
    );
  }

  private showOverlay(title: string, subtitle: string) {
    this.overlayTitle.textContent = title;
    this.overlayTitle.setAttribute("data-text", title);
    this.overlaySubtitle.textContent = subtitle;
    this.startBtn.textContent = this.state === "paused" ? "재접속 / RESUME" : "재접속 / LINK IN";
    this.overlay.classList.remove("is-hidden");
  }

  private hideOverlay() {
    this.overlay.classList.add("is-hidden");
  }

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}
