import * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Input } from "./Input";
import { MobileControls } from "./MobileControls";
import { Sfx } from "./Sfx";
import { World } from "../world/World";
import { PlayerController } from "../player/PlayerController";
import { fetchDrone, fetchDroneCatalog } from "../player/drones";
import type { DroneCatalogEntry, DroneSpec } from "../player/DroneSpec";
import { fetchWeapon } from "../weapons/weapons";
import type { BeamSpec, BarrageSpec } from "../weapons/WeaponSpec";
import { EnemyManager } from "../enemies/EnemyManager";
import { FrequencyBeam } from "../weapons/FrequencyBeam";
import { SpecialBarrage } from "../weapons/SpecialBarrage";
import { HUD } from "../ui/HUD";
import { RearView } from "../ui/RearView";
import { Minimap } from "../ui/Minimap";
import { createComposer } from "../fx/postprocessing";
import { CinematicPlayer } from "../intro/CinematicPlayer";
import { MenuBackground } from "../intro/MenuBackground";
import { introScenes } from "../intro/scenes";
import { buildWorldSvg, projectLatLon } from "../ui/worldMapSvg";
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
  private sfx = new Sfx();

  // 전장 선택 후 원자적으로 생성되는 플레이 세션(전부 존재 or 전부 없음)
  private session?: Session;

  private state: GameState = "menu";
  private intro?: CinematicPlayer;
  private menuBg?: MenuBackground; // 메뉴 배경: 랜덤 인트로 장면
  private overlay: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlaySubtitle: HTMLElement;
  private startBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private catalog: MapCatalogEntry[] = [];
  private invadedIds = new Set<string>(); // 침공 중(붉은 깜빡임) 지역 id — 진입마다 랜덤 2개
  private menuLayout: HTMLElement;
  private worldMap: HTMLElement;
  private zonePopup: HTMLElement;
  private zonePopName: HTMLElement;
  private zonePopSub: HTMLElement;
  private zonePopMeta: HTMLElement;
  private zonePopDrones: HTMLElement;
  private storyPopup: HTMLElement;
  private storyList: HTMLElement;
  private helpPopup: HTMLElement;
  private droneCatalog: DroneCatalogEntry[] = [];
  private droneSpecs = new Map<string, DroneSpec>(); // 로드 캐시(안내/빌드 공용)
  private selectedDroneId: string;
  private hintMoveMouse: HTMLElement;
  private hintMoveTouch: HTMLElement;

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

    this.overlay = byId("overlay");
    this.overlayTitle = this.overlay.querySelector(".overlay__title") as HTMLElement;
    this.overlaySubtitle = this.overlay.querySelector(".overlay__subtitle") as HTMLElement;
    this.startBtn = byId("startBtn") as HTMLButtonElement;
    this.backBtn = byId("backBtn") as HTMLButtonElement;
    this.menuLayout = byId("menuLayout");
    this.worldMap = byId("worldMap");
    this.zonePopup = byId("zonePopup");
    this.zonePopName = byId("zonePopName");
    this.zonePopSub = byId("zonePopSub");
    this.zonePopMeta = byId("zonePopMeta");
    this.zonePopDrones = byId("zonePopDrones");
    this.storyPopup = byId("storyPopup");
    this.storyList = byId("storyList");
    this.helpPopup = byId("helpPopup");
    this.hintMoveMouse = byId("hintMoveMouse");
    this.hintMoveTouch = byId("hintMoveTouch");
    this.selectedDroneId = new URLSearchParams(window.location.search).get("drone") || "walker";
    this.startBtn.addEventListener("click", () => this.startOrResume());
    this.backBtn.addEventListener("click", () => this.changeMap());
    // 지도 점 클릭 → 지역 팝업, 배경 클릭 → 모든 팝업 닫기
    this.worldMap.addEventListener("click", (e) => {
      const dot = (e.target as HTMLElement).closest("[data-map]") as HTMLElement | null;
      if (dot?.dataset.map) { this.storyPopup.hidden = true; this.helpPopup.hidden = true; this.openPopup(dot.dataset.map); }
      else this.closeAllPopups();
    });
    byId("zonePopClose").addEventListener("click", () => this.closePopup());
    byId("storyBtn").addEventListener("click", () => this.toggleSidePop(this.storyPopup));
    byId("helpBtn").addEventListener("click", () => this.toggleSidePop(this.helpPopup));
    this.renderStoryList();

    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("pointerlockchange", () => this.onPointerLockChange());

    this.showMenu(); // 전장 선택으로 바로 진입(인트로는 버튼으로 재생)
  }

  /** 메뉴의 인트로 버튼 → 시네마틱 재생. 종료/스킵(클릭)·Esc(즉시) 시 메뉴로 복귀. */
  private playIntro() {
    if (this.state !== "menu" || this.intro) return;
    this.state = "intro";
    this.clearMenuBg();
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

  /** 메뉴 배경(랜덤 인트로 장면) 정리 — 메뉴 이탈(전장 선택/인트로 재생) 시 호출. */
  private clearMenuBg() {
    this.overlay.classList.remove("overlay--scene");
    this.closeAllPopups();
    if (this.menuBg) {
      this.menuBg.dispose();
      this.menuBg = undefined;
    }
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
    this.startBtn.hidden = true;
    this.backBtn.hidden = true;
    this.menuLayout.hidden = false;
    this.closeAllPopups();
    this.overlay.classList.remove("is-hidden");
    this.overlay.classList.add("overlay--scene"); // 메뉴 배경(인트로 장면) 비치도록 반투명
    this.setPlayActive(false);
    // 기체(드론) 목록 — 팝업 출격 버튼/조작 안내용
    try {
      if (!this.droneCatalog.length) this.droneCatalog = await fetchDroneCatalog();
    } catch { /* 드론 목록 로드 실패 — 비치명적 */ }
    void this.loadControls(this.selectedDroneId); // 기본 기체 조작 안내
    try {
      if (!this.catalog.length) this.catalog = await fetchCatalog();
      this.pickInvaded(); // 진입마다 침공 중 지역 랜덤 2개
      this.renderWorldMap();
    } catch (e) {
      this.overlaySubtitle.textContent = "전장 목록 로드 실패 — " + (e as Error).message;
    }
  }

  /** 침공 중(붉은 깜빡임) 지역을 랜덤 2개 선택. 나머지 등록 지역은 흰색 점. */
  private pickInvaded() {
    const N = 2;
    const pool = [...this.catalog];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.invadedIds = new Set(pool.slice(0, Math.min(N, pool.length)).map((m) => m.id));
  }

  /** 세계지도에 등록 지역을 점으로(흰색=등록, 붉은 깜빡임=침공 중). 위경도 → equirectangular. */
  private renderWorldMap() {
    const dots = this.catalog
      .filter((r) => r.lat != null && r.lon != null)
      .map((r) => {
        const { x, y } = projectLatLon(r.lat!, r.lon!);
        const cls = this.invadedIds.has(r.id) ? "zone-dot--invaded" : "zone-dot--reg";
        return `<button type="button" class="zone-dot ${cls}" data-map="${r.id}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%"><i></i></button>`;
      })
      .join("");
    this.worldMap.innerHTML = WORLD_SVG + dots;
  }

  /** 점 클릭 → 그 위치 위에 지역 정보 + 기체 선택(출격) 팝업. 기체 선택 시 즉시 전장 이동. */
  private openPopup(id: string) {
    const m = this.catalog.find((c) => c.id === id);
    if (!m || m.lat == null || m.lon == null) return;
    const { x, y } = projectLatLon(m.lat, m.lon);
    const mb = m.bytes ? (m.bytes / 1024 / 1024).toFixed(1) + "MB" : "";
    this.zonePopName.textContent = m.name;
    this.zonePopSub.textContent = m.subtitle;
    this.zonePopMeta.textContent = `${m.buildings ?? "?"} buildings · ${mb}` + (this.invadedIds.has(m.id) ? " · ⚠ 침공 중" : "");
    this.zonePopDrones.innerHTML = "";
    for (const d of this.droneCatalog) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zonepop__drone";
      btn.innerHTML =
        `<span class="zonepop__drone-name">${d.displayName}</span>` +
        `<span class="zonepop__drone-mode">${d.mode === "fly" ? "비행 / FLY" : "보행 / WALK"}</span>`;
      btn.addEventListener("click", () => {
        this.selectedDroneId = d.id; // 이 기체로 즉시 출격
        this.selectMap(m.id);
      });
      this.zonePopDrones.appendChild(btn);
    }
    this.zonePopup.style.left = `${x.toFixed(2)}%`;
    this.zonePopup.style.top = `${y.toFixed(2)}%`;
    this.zonePopup.classList.toggle("zonepop--l", x > 72); // 우측 끝이면 살짝 왼쪽으로
    this.zonePopup.classList.toggle("zonepop--r", x < 28); // 좌측 끝이면 살짝 오른쪽으로
    this.zonePopup.hidden = false;
  }

  private closePopup() {
    if (this.zonePopup) this.zonePopup.hidden = true;
  }

  private closeAllPopups() {
    this.zonePopup.hidden = true;
    this.storyPopup.hidden = true;
    this.helpPopup.hidden = true;
  }

  /** 사이드 팝업(스토리/도움말) 토글 — 다른 팝업은 닫음. */
  private toggleSidePop(pop: HTMLElement) {
    const show = pop.hidden;
    this.closeAllPopups();
    pop.hidden = !show;
  }

  /** 스토리 목록 렌더(첫 항목 = 인트로 컷씬). 향후 항목 계속 추가 예정. */
  private renderStoryList() {
    const items: { label: string; action: () => void }[] = [
      { label: "▶ 인트로 / INTRO", action: () => this.playIntro() },
    ];
    this.storyList.innerHTML = "";
    for (const it of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidepop__item";
      btn.textContent = it.label;
      btn.addEventListener("click", () => { this.storyPopup.hidden = true; it.action(); });
      this.storyList.appendChild(btn);
    }
  }

  /** 기본 기체 스펙 로드(캐시) → 메뉴 하단 조작 안내(키 설명) 갱신. */
  private async loadControls(id: string) {
    try {
      let spec = this.droneSpecs.get(id);
      if (!spec) {
        spec = await fetchDrone(id);
        this.droneSpecs.set(id, spec);
      }
      this.renderControls(spec);
    } catch { /* 무시 */ }
  }

  /** 드론 스펙(actions)의 키 설명으로 조작 안내를 갱신. */
  private renderControls(spec: DroneSpec) {
    const keyDisp = (k: string) => (k === "Space" ? "SPACE" : k.replace(/(Left|Right)$/, "").toUpperCase());
    const acts = spec.actions;
    this.hintMoveMouse.innerHTML =
      "<b>WASD</b> 이동 · " + acts.map((a) => `<b>${keyDisp(a.key)}</b> ${a.desc}`).join(" · ");
    this.hintMoveTouch.innerHTML = acts.map((a) => `<b>${a.label}</b> ${a.desc}`).join(" · ");
  }

  /** 전장 선택 → 데이터 다운로드 → 월드/시스템 빌드(최초 1회). 이후 맵 변경은 reload. */
  private async selectMap(id: string) {
    if (this.session) return;
    this.sfx.resume(); // 클릭 제스처 내에서 오디오 컨텍스트 활성화(브라우저 정책)
    this.clearMenuBg(); // 메뉴 배경 종료
    this.state = "loading";
    this.menuLayout.hidden = true;
    this.closePopup();
    this.overlaySubtitle.textContent = "전장 전송 중… / DOWNLOADING";
    let map;
    try {
      map = await fetchMap(id);
    } catch (e) {
      this.overlaySubtitle.textContent = "전송 실패 — " + (e as Error).message;
      this.menuLayout.hidden = false;
      this.state = "menu";
      return;
    }
    // 전장 선택 화면에서 고른 기체로 빌드(기본 walker) — 메뉴에서 이미 로드됐으면 캐시 사용
    const droneId = this.selectedDroneId;
    let drone = this.droneSpecs.get(droneId);
    if (!drone) {
      try {
        drone = await fetchDrone(droneId);
        this.droneSpecs.set(droneId, drone);
      } catch (e) {
        this.overlaySubtitle.textContent = "드론 스펙 로드 실패 — " + (e as Error).message;
        this.menuLayout.hidden = false;
        this.state = "menu";
        return;
      }
    }

    // 드론 무장(무기 스펙) 로드 — 드론 JSON 의 weapons.primary/special 참조
    let primaryWeapon, specialWeapon;
    try {
      [primaryWeapon, specialWeapon] = await Promise.all([
        fetchWeapon(drone.weapons.primary),
        fetchWeapon(drone.weapons.special),
      ]);
    } catch (e) {
      this.overlaySubtitle.textContent = "무기 스펙 로드 실패 — " + (e as Error).message;
      this.menuLayout.hidden = false;
      this.state = "menu";
      return;
    }

    this.overlaySubtitle.textContent = "전장 구축 중… / BUILDING";
    // 다음 프레임으로 넘겨 UI 가 갱신되도록
    await new Promise((r) => setTimeout(r, 16));

    const world = new World(this.scene, map);
    const aspect = window.innerWidth / window.innerHeight;
    const player = new PlayerController(this.input, world, aspect, drone);
    this.hud.setUnitName(drone.name);
    // 모바일 버튼 구성 — 동작(드론) + 전투 라벨(무기 스펙 abbr)
    this.mobile.configure({
      actions: drone.actions,
      fireLabel: (primaryWeapon as BeamSpec).abbr,
      specialLabel: (specialWeapon as BarrageSpec).abbr,
    });
    const enemies = new EnemyManager(this.scene, world, player);
    const beam = new FrequencyBeam(this.scene, player, enemies, primaryWeapon as BeamSpec, this.sfx);
    const special = new SpecialBarrage(this.scene, player, enemies, specialWeapon as BarrageSpec, this.sfx);
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
    this.sfx.resume(); // 사용자 클릭 제스처 → 오디오 활성화/재개
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

    if (this.state === "menu") {
      if (!this.menuBg) {
        this.menuBg = new MenuBackground(this.renderer, introScenes());
        this.overlay.classList.add("overlay--scene");
      }
      this.menuBg.update(dt); // 랜덤 인트로 장면을 배경으로 렌더
      return;
    }

    const s = this.session;
    if (!s) return; // 전장 빌드 전(로딩)

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
    this.menuLayout.hidden = true;
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
    this.menuBg?.setSize(w, h);
    this.renderer.setSize(w, h);
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

const WORLD_SVG = buildWorldSvg();
