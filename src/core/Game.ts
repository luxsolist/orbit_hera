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
import { fetchCatalog, fetchMap } from "../world/maps";
import type { MapCatalogEntry } from "../world/MapData";

type GameState = "menu" | "loading" | "playing" | "paused" | "dead";

/**
 * Seed 코어 게임 루프 오케스트레이터.
 * 전장(맵) 선택 → 서버에서 데이터 다운로드 → 월드/시스템 빌드 → 전투. 맵 변경은 재접속(reload).
 */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private clock = new THREE.Clock();

  private input: Input;
  private mobile: MobileControls;
  private hud: HUD;

  // 전장 선택 후 지연 생성
  private composer?: EffectComposer;
  private world?: World;
  private player?: PlayerController;
  private enemies?: EnemyManager;
  private beam?: FrequencyBeam;
  private special?: SpecialBarrage;
  private rearView?: RearView;
  private minimap?: Minimap;

  private state: GameState = "menu";
  private overlay: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlaySubtitle: HTMLElement;
  private startBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private mapList: HTMLElement;
  private catalog: MapCatalogEntry[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x0a0e12);

    this.input = new Input(canvas);
    this.mobile = new MobileControls(this.input);
    this.hud = new HUD();
    this.hud.setUnitName("ANDROID-01");

    this.overlay = byId("overlay");
    this.overlayTitle = this.overlay.querySelector(".overlay__title") as HTMLElement;
    this.overlaySubtitle = this.overlay.querySelector(".overlay__subtitle") as HTMLElement;
    this.startBtn = byId("startBtn") as HTMLButtonElement;
    this.backBtn = byId("backBtn") as HTMLButtonElement;
    this.mapList = byId("mapList");
    this.startBtn.addEventListener("click", () => this.startOrResume());
    this.backBtn.addEventListener("click", () => this.changeMap());

    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("pointerlockchange", () => this.onPointerLockChange());

    this.showMenu();
  }

  start() {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ─────────────────────────── 전장 선택 메뉴 ───────────────────────────

  private async showMenu() {
    this.state = "menu";
    this.overlayTitle.textContent = "SEED";
    this.overlayTitle.setAttribute("data-text", "SEED");
    this.overlaySubtitle.textContent = "전장 선택 / SELECT BATTLEFIELD";
    this.startBtn.hidden = true;
    this.backBtn.hidden = true;
    this.mapList.hidden = false;
    this.overlay.classList.remove("is-hidden");
    this.hud.setActive(false);
    try {
      if (!this.catalog.length) this.catalog = await fetchCatalog();
      this.renderMapList();
    } catch (e) {
      this.overlaySubtitle.textContent = "전장 목록 로드 실패 — " + (e as Error).message;
    }
  }

  private renderMapList() {
    this.mapList.innerHTML = "";
    for (const m of this.catalog) {
      const mb = m.bytes ? (m.bytes / 1024 / 1024).toFixed(1) + "MB" : "";
      const card = document.createElement("button");
      card.className = "overlay__map";
      card.type = "button";
      card.innerHTML =
        `<span class="overlay__map-name">${m.name}</span>` +
        `<span class="overlay__map-sub">${m.subtitle}</span>` +
        `<span class="overlay__map-meta">${m.buildings ?? "?"} buildings · ${mb}</span>`;
      card.addEventListener("click", () => this.selectMap(m.id));
      this.mapList.appendChild(card);
    }
  }

  /** 전장 선택 → 데이터 다운로드 → 월드/시스템 빌드(최초 1회). 이후 맵 변경은 reload. */
  private async selectMap(id: string) {
    if (this.world) return;
    this.state = "loading";
    this.mapList.hidden = true;
    this.overlaySubtitle.textContent = "전장 전송 중… / DOWNLOADING";
    let map;
    try {
      map = await fetchMap(id);
    } catch (e) {
      this.overlaySubtitle.textContent = "전송 실패 — " + (e as Error).message;
      this.mapList.hidden = false;
      this.state = "menu";
      return;
    }
    this.overlaySubtitle.textContent = "전장 구축 중… / BUILDING";
    // 다음 프레임으로 넘겨 UI 가 갱신되도록
    await new Promise((r) => setTimeout(r, 16));

    this.world = new World(this.scene, map);
    const aspect = window.innerWidth / window.innerHeight;
    this.player = new PlayerController(this.input, this.world, aspect);
    this.enemies = new EnemyManager(this.scene, this.world, this.player);
    this.beam = new FrequencyBeam(this.scene, this.player, this.enemies);
    this.special = new SpecialBarrage(this.scene, this.player, this.enemies);
    this.composer = createComposer(this.renderer, this.scene, this.player.camera);
    this.rearView = new RearView(this.renderer, this.scene, this.player);
    this.minimap = new Minimap(this.player, this.enemies, this.world);
    this.wireEvents();
    this.beginPlay();
  }

  private beginPlay() {
    this.player!.reset();
    this.enemies!.start();
    this.special!.reset();
    this.hud.setKills(0);
    this.state = "playing";
    this.hideOverlay();
    this.hud.setActive(true);
    if (this.mobile.enabled) {
      this.input.locked = true;
      this.mobile.attemptLandscapeLock();
    } else {
      this.input.requestLock();
    }
  }

  private wireEvents() {
    this.beam!.onFired = () => this.hud.flashFire();
    this.special!.onFired = () => this.hud.flashFire();
    this.enemies!.onKill = () => this.hud.setKills(this.enemies!.killCount);
    this.enemies!.onWaveChange = (w) => this.hud.setWave(w);
    this.enemies!.onPlayerHit = () => this.hud.flashDamage();
  }

  /** 일시정지/사망 후 버튼: 재접속(같은 전장 재개/재시작) */
  private startOrResume() {
    if (this.state === "dead") {
      this.beginPlay();
    } else if (this.state === "paused") {
      this.state = "playing";
      this.hideOverlay();
      this.hud.setActive(true);
      if (this.mobile.enabled) this.input.locked = true;
      else this.input.requestLock();
    }
  }

  /** 전장 변경 — 재접속(reload)으로 메뉴부터 다시 */
  private changeMap() {
    window.location.reload();
  }

  private onPointerLockChange() {
    if (this.mobile.enabled) return;
    if (!this.input.locked && this.state === "playing") {
      this.state = "paused";
      this.showPanel("PAUSED", "LINK SUSPENDED — 클릭하여 재접속", "재접속 / RESUME");
      this.hud.setActive(false);
    }
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.world || !this.player || !this.composer) return; // 전장 빌드 전(메뉴)

    if (this.state === "playing" && this.input.locked && !this.mobile.isBlocked) {
      this.player.update(dt);
      this.world.update(this.player.worldPosition.x, this.player.worldPosition.z); // 그림자 추종
      this.beam!.update(dt, this.input.fireHeld);
      this.special!.update(dt, this.input.specialPressed);
      this.enemies!.update(dt);
      this.hud.update(dt);

      this.hud.setHp(this.player.hp, this.player.maxHp);
      this.hud.setFrequency(this.player.freq, this.player.maxFreq);
      const cdReady = this.special!.cooldownReady;
      const cdRemaining = Math.max(0, 60 - cdReady * 60);
      this.hud.setSpecial(cdReady, this.special!.isActive, cdRemaining);
      this.mobile.setSpecialState(cdReady, this.special!.isActive, cdRemaining);

      if (this.player.isDead) this.onDeath();
    }

    this.input.endFrame();
    this.composer.render();
    if (this.state === "playing") {
      this.rearView!.render();
      this.minimap!.render();
    }
  }

  private onDeath() {
    this.state = "dead";
    this.hud.setActive(false);
    document.exitPointerLock();
    this.showPanel(
      "LINK LOST",
      `정화 ${this.enemies!.killCount}체 · WAVE ${this.enemies!.wave}`,
      "재시작 / RESTART"
    );
  }

  /** 일시정지/사망 패널(맵 목록 숨김, 재접속 + 전장 선택 버튼) */
  private showPanel(title: string, subtitle: string, startLabel: string) {
    this.overlayTitle.textContent = title;
    this.overlayTitle.setAttribute("data-text", title);
    this.overlaySubtitle.textContent = subtitle;
    this.mapList.hidden = true;
    this.startBtn.hidden = false;
    this.startBtn.textContent = startLabel;
    this.backBtn.hidden = false;
    this.overlay.classList.remove("is-hidden");
  }

  private hideOverlay() {
    this.overlay.classList.add("is-hidden");
  }

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.player) {
      this.player.camera.aspect = w / h;
      this.player.camera.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}
