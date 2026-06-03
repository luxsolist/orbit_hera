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
import { CinematicPlayer } from "../intro/CinematicPlayer";
import { introScenes } from "../intro/scenes";
import { fetchCatalog, fetchMap } from "../world/maps";
import type { MapCatalogEntry } from "../world/MapData";

type GameState = "intro" | "menu" | "loading" | "playing" | "paused" | "dead";

/** 전장 빌드 후 함께 생성되는 플레이 세션 — 전부 존재 or 전부 없음(옵셔널 필드 + non-null 단언 제거). */
interface Session {
  world: World;
  player: PlayerController;
  enemies: EnemyManager;
  beam: FrequencyBeam;
  special: SpecialBarrage;
  composer: EffectComposer;
  rearView: RearView;
  minimap: Minimap;
}

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

  // 전장 선택 후 원자적으로 생성되는 플레이 세션(전부 존재 or 전부 없음)
  private session?: Session;

  private state: GameState = "menu";
  private intro?: CinematicPlayer;
  private overlay: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlaySubtitle: HTMLElement;
  private startBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private introBtn: HTMLButtonElement;
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
    this.introBtn = byId("introBtn") as HTMLButtonElement;
    this.mapList = byId("mapList");
    this.startBtn.addEventListener("click", () => this.startOrResume());
    this.backBtn.addEventListener("click", () => this.changeMap());
    this.introBtn.addEventListener("click", () => this.playIntro());

    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("pointerlockchange", () => this.onPointerLockChange());

    this.showMenu(); // 전장 선택으로 바로 진입(인트로는 버튼으로 재생)
  }

  /** 메뉴의 인트로 버튼 → 시네마틱 재생. 종료/스킵(클릭)·Esc(즉시) 시 메뉴로 복귀. */
  private playIntro() {
    if (this.state !== "menu" || this.intro) return;
    this.state = "intro";
    this.overlay.classList.add("is-hidden");
    this.setPlayActive(false);
    try {
      this.intro = new CinematicPlayer(this.renderer, introScenes());
    } catch {
      this.showMenu(); // 생성 실패 시 곧장 메뉴
    }
  }

  start() {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** HUD + 모바일 가상 컨트롤을 함께 표시/숨김(플레이 중에만 표시). */
  private setPlayActive(active: boolean) {
    this.hud.setActive(active);
    this.mobile.setActive(active);
  }

  // ─────────────────────────── 전장 선택 메뉴 ───────────────────────────

  private async showMenu() {
    this.state = "menu";
    this.overlayTitle.textContent = "SEED";
    this.overlayTitle.setAttribute("data-text", "SEED");
    this.overlaySubtitle.textContent = "전장 선택 / SELECT BATTLEFIELD";
    this.startBtn.hidden = true;
    this.backBtn.hidden = true;
    this.introBtn.hidden = false;
    this.mapList.hidden = false;
    this.overlay.classList.remove("is-hidden");
    this.setPlayActive(false);
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
    if (this.session) return;
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

    const world = new World(this.scene, map);
    const aspect = window.innerWidth / window.innerHeight;
    const player = new PlayerController(this.input, world, aspect);
    const enemies = new EnemyManager(this.scene, world, player);
    const beam = new FrequencyBeam(this.scene, player, enemies);
    const special = new SpecialBarrage(this.scene, player, enemies);
    const composer = createComposer(this.renderer, this.scene, player.camera);
    const rearView = new RearView(this.renderer, this.scene, player);
    const minimap = new Minimap(player, enemies, world);
    this.session = { world, player, enemies, beam, special, composer, rearView, minimap };
    this.wireEvents(this.session);
    this.beginPlay();
  }

  private beginPlay() {
    const s = this.session;
    if (!s) return;
    s.player.reset();
    s.enemies.start();
    s.special.reset();
    this.hud.setKills(0);
    this.state = "playing";
    this.hideOverlay();
    this.setPlayActive(true);
    if (this.mobile.enabled) {
      this.input.locked = true;
      this.mobile.attemptLandscapeLock();
    } else {
      this.input.requestLock();
    }
  }

  private wireEvents(s: Session) {
    s.beam.onFired = () => this.hud.flashFire();
    s.special.onFired = () => this.hud.flashFire();
    s.enemies.onKill = () => this.hud.setKills(s.enemies.killCount);
    s.enemies.onWaveChange = (w) => this.hud.setWave(w);
    s.enemies.onPlayerHit = () => this.hud.flashDamage();
  }

  /** 일시정지/사망 후 버튼: 재접속(같은 전장 재개/재시작) */
  private startOrResume() {
    if (this.state === "dead") {
      this.beginPlay();
    } else if (this.state === "paused") {
      this.state = "playing";
      this.hideOverlay();
      this.setPlayActive(true);
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
      this.setPlayActive(false);
    }
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === "intro") {
      if (this.intro && !this.intro.done) this.intro.update(dt);
      else { this.intro = undefined; this.showMenu(); }
      return;
    }

    const s = this.session;
    if (!s) return; // 전장 빌드 전(메뉴)

    if (this.state === "playing" && this.input.locked && !this.mobile.isBlocked) {
      s.player.update(dt);
      s.world.update(s.player.worldPosition.x, s.player.worldPosition.z); // 그림자 추종
      s.beam.update(dt, this.input.fireHeld);
      s.special.update(dt, this.input.specialPressed);
      s.enemies.update(dt);
      this.hud.update(dt);

      this.hud.setHp(s.player.hp, s.player.maxHp);
      this.hud.setFrequency(s.player.freq, s.player.maxFreq);
      const cdReady = s.special.cooldownReady;
      const cdRemaining = Math.max(0, 60 - cdReady * 60);
      this.hud.setSpecial(cdReady, s.special.isActive, cdRemaining);
      this.mobile.setSpecialState(cdReady, s.special.isActive, cdRemaining);

      if (s.player.isDead) this.onDeath();
    }

    this.input.endFrame();
    s.composer.render();
    if (this.state === "playing") {
      s.rearView.render();
      s.minimap.render();
    }
  }

  private onDeath() {
    const s = this.session;
    this.state = "dead";
    this.setPlayActive(false);
    document.exitPointerLock();
    this.showPanel(
      "LINK LOST",
      s ? `정화 ${s.enemies.killCount}체 · WAVE ${s.enemies.wave}` : "",
      "재시작 / RESTART"
    );
  }

  /** 일시정지/사망 패널(맵 목록 숨김, 재접속 + 전장 선택 버튼) */
  private showPanel(title: string, subtitle: string, startLabel: string) {
    this.overlayTitle.textContent = title;
    this.overlayTitle.setAttribute("data-text", title);
    this.overlaySubtitle.textContent = subtitle;
    this.mapList.hidden = true;
    this.introBtn.hidden = true;
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
    if (this.session) {
      this.session.player.camera.aspect = w / h;
      this.session.player.camera.updateProjectionMatrix();
      this.session.composer.setSize(w, h);
    }
    this.intro?.setSize(w, h);
    this.renderer.setSize(w, h);
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}
