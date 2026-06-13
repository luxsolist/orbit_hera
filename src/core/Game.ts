import * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Input } from "./Input";
import { MobileControls } from "./MobileControls";
import { Sfx } from "./Sfx";
import { Diagnostics } from "./Diagnostics";
import { World } from "../world/World";
import { StreamingWorld } from "../world/StreamingWorld";
import type { GameWorld } from "../world/GameWorld";
import { PlayerController } from "../player/PlayerController";
import { fetchDrone } from "../player/drones";
import type { DroneSpec } from "../player/DroneSpec";
import { fetchWeapon } from "../weapons/weapons";
import { withAutoBoost, type BeamSpec, type SpecialWeapon } from "../weapons/WeaponSpec";
import { EnemyManager } from "../enemies/EnemyManager";
import { fetchPlasmoid } from "../enemies/plasmoids";
import { DEFAULT_PLASMOID } from "../enemies/PlasmoidSpec";
import { FrequencyBeam } from "../weapons/FrequencyBeam";
import { SpecialBarrage } from "../weapons/SpecialBarrage";
import { SpecialStream } from "../weapons/SpecialStream";
import { HUD } from "../ui/HUD";
import { RearView } from "../ui/RearView";
import { Minimap } from "../ui/Minimap";
import { hudSizesFor, hudComponentsFor } from "../ui/hudLayout";
import { MenuScreen } from "../ui/MenuScreen";
import { createComposer, disposeComposer } from "../fx/postprocessing";
import { TargetBrackets } from "../fx/TargetBrackets";
import { CinematicPlayer } from "../intro/CinematicPlayer";
import { MenuBackground } from "../intro/MenuBackground";
import { introScenes } from "../intro/scenes";
import { fetchMap, fetchCatalog, loadTerrainHeights } from "../world/maps";
import type { MapCatalogEntry, NormalizedMap } from "../world/MapData";

type GameState = "intro" | "menu" | "loading" | "playing" | "paused" | "dead";

/** 전장 빌드 후 함께 생성되는 플레이 세션 — 전부 존재 or 전부 없음(옵셔널 필드 + non-null 단언 제거). */
interface Session {
  world: GameWorld;
  player: PlayerController;
  enemies: EnemyManager;
  beam: FrequencyBeam;
  special: SpecialWeapon;
  composer: EffectComposer;
  rearView: RearView;
  minimap: Minimap;
  brackets: TargetBrackets;
}

/**
 * CORE 게임 루프 오케스트레이터.
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
  private diag = new Diagnostics();

  // 전장 선택 후 원자적으로 생성되는 플레이 세션(전부 존재 or 전부 없음)
  private session?: Session;

  private state: GameState = "menu";
  private peaceful = false; // 탐방 모드(적 미스폰) — selectMap 에서 설정, 재시작에도 유지
  private tornDown = false; // pagehide 정리 1회 가드
  private intro?: CinematicPlayer;
  private menuBg?: MenuBackground; // 메뉴 배경: 랜덤 인트로 장면
  private overlay: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlaySubtitle: HTMLElement;
  private startBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private menu: MenuScreen; // 전장 선택 메뉴 UI(세계지도/팝업/안내)

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    // 터치/iPad(Retina)는 DPR 캡을 낮춰 프레임버퍼·VRAM 부하 완화(반복 실행 시 GPU 스톨/멈춤 방지)
    const dprCap = navigator.maxTouchPoints > 0 ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x0a0e12);

    // 진단 계측(?diag) — WebGL 컨텍스트 손실/전역 에러/렌더러 자원 추적
    this.diag.watchContext(canvas);
    this.diag.watchGlobalErrors();
    this.diag.snapshot(this.renderer, "boot");

    this.input = new Input(canvas);
    this.mobile = new MobileControls(this.input);
    this.hud = new HUD();

    this.overlay = byId("overlay");
    this.overlayTitle = this.overlay.querySelector(".overlay__title") as HTMLElement;
    this.overlaySubtitle = this.overlay.querySelector(".overlay__subtitle") as HTMLElement;
    this.startBtn = byId("startBtn") as HTMLButtonElement;
    this.backBtn = byId("backBtn") as HTMLButtonElement;
    this.startBtn.addEventListener("click", () => this.startOrResume());
    this.backBtn.addEventListener("click", () => this.changeMap());
    this.menu = new MenuScreen({
      onDeploy: (mapId, droneId, peaceful) => void this.selectMap(mapId, droneId, peaceful),
      onPlayIntro: () => this.playIntro(),
    });

    this.applyHudLayout(); // 화면 비례 HUD 위젯 크기/위치 초기 적용
    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("pointerlockchange", () => this.onPointerLockChange());
    // 페이지 이탈(맵 변경=reload 등) 시 GPU 컨텍스트 즉시 반납 — iOS가 다음 페이지에 컨텍스트를 빨리 내주게 해
    // 새로고침 반복 누적으로 인한 멈춤 방지. bfcache 복귀 가능 시(persisted)엔 파괴하지 않음.
    window.addEventListener("pagehide", (e) => { if (!e.persisted) this.teardown(); });

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
    this.renderer.setAnimationLoop(() => this.diag.guard(() => { this.diag.tick(); this.frame(); }));
  }

  /** 메뉴 배경(랜덤 인트로 장면) 정리 — 메뉴 이탈(전장 선택/인트로 재생) 시 호출. */
  private clearMenuBg() {
    this.overlay.classList.remove("overlay--scene");
    this.menu.closeAllPopups();
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

  private showMenu() {
    this.state = "menu";
    this.diag.snapshot(this.renderer, "menu");
    this.overlayTitle.textContent = "CORE";
    this.overlayTitle.setAttribute("data-text", "CORE");
    this.startBtn.hidden = true;
    this.backBtn.hidden = true;
    this.overlay.classList.remove("is-hidden");
    this.overlay.classList.add("overlay--scene"); // 메뉴 배경(인트로 장면) 비치도록 반투명
    this.setPlayActive(false);
    void this.menu.show();
  }

  /** 로딩 중 오류 → 콘솔 기록 후 메뉴로 복귀. */
  private failToMenu(msg: string) {
    console.error(msg);
    this.showMenu();
  }

  /** 전장+기체 선택(메뉴 팝업) → 데이터 다운로드 → 월드/시스템 빌드. 이후 맵 변경은 reload. */
  private async selectMap(id: string, droneId: string, peaceful = false) {
    if (this.session) return;
    this.peaceful = peaceful;
    this.sfx.resume(); // 클릭 제스처 내에서 오디오 컨텍스트 활성화(브라우저 정책)
    this.clearMenuBg(); // 메뉴 배경 종료
    this.menu.hide();
    this.state = "loading";
    this.overlaySubtitle.textContent = "전장 전송 중… / DOWNLOADING";
    // 카탈로그에서 이 전장이 스트리밍(타일 월드)인지 판별 — 모놀리식 <id>.json 은 스트리밍이 아닐 때만 받는다.
    let entry: MapCatalogEntry | undefined;
    try {
      entry = (await fetchCatalog()).find((c) => c.id === id);
    } catch (e) {
      return this.failToMenu("전장 목록 로드 실패 — " + (e as Error).message);
    }
    let map: NormalizedMap | undefined;
    if (!entry?.stream) {
      try {
        map = await fetchMap(id);
      } catch (e) {
        return this.failToMenu("전송 실패 — " + (e as Error).message);
      }
    }
    // 고른 기체 스펙 로드
    let drone: DroneSpec;
    try {
      drone = await fetchDrone(droneId);
    } catch (e) {
      return this.failToMenu("드론 스펙 로드 실패 — " + (e as Error).message);
    }

    // 드론 무장(무기 스펙) 로드 — 드론 JSON 의 weapons.primary/special 참조
    let primaryWeapon, specialWeapon;
    try {
      [primaryWeapon, specialWeapon] = await Promise.all([
        fetchWeapon(drone.weapons.primary),
        fetchWeapon(drone.weapons.special),
      ]);
    } catch (e) {
      return this.failToMenu("무기 스펙 로드 실패 — " + (e as Error).message);
    }

    // 적(플라즈모이드) 스펙 로드 — 실패해도 내장 기본값으로 진행(전투 차단 방지)
    let plasmoidSpec = DEFAULT_PLASMOID;
    try {
      plasmoidSpec = await fetchPlasmoid("plasmoid");
    } catch {
      plasmoidSpec = DEFAULT_PLASMOID;
    }

    this.overlaySubtitle.textContent = "전장 구축 중… / BUILDING";
    // 다음 프레임으로 넘겨 UI 가 갱신되도록
    await new Promise((r) => setTimeout(r, 16));

    // 스트리밍 전장: 타일 월드를 플레이어 주변만 청크로 로드(StreamingWorld). 그 외: 모놀리식 World.
    let world: GameWorld;
    if (entry?.stream) {
      if (entry.lat == null || entry.lon == null) return this.failToMenu("스트리밍 전장 좌표 누락 — " + id);
      try {
        world = await StreamingWorld.create(this.scene, entry.lat, entry.lon, entry.spawnYaw ?? 0);
      } catch (e) {
        return this.failToMenu("타일 월드 로드 실패 — " + (e as Error).message);
      }
    } else {
      const terrainHeights = await loadTerrainHeights(map!); // DEM 하이트맵(있으면) — 없으면 null → 절차적 폴백
      world = new World(this.scene, map!, terrainHeights);
    }
    const aspect = window.innerWidth / window.innerHeight;
    const player = new PlayerController(this.input, world, aspect, drone);
    this.hud.setUnitName(drone.name);
    // 모바일 버튼 구성 — 동작(드론) + 전투 라벨(무기 스펙 abbr)
    this.mobile.configure({
      actions: drone.actions,
      fireLabel: primaryWeapon.abbr, // abbr 은 모든 무기 타입 공통 → 캐스트 불필요
      specialLabel: specialWeapon.abbr,
    });
    const enemies = new EnemyManager(this.scene, world, [player], plasmoidSpec); // MP 대응: 플레이어 배열(현재 1인)
    // 모바일 플라이어 — 자동조준(에임어시스트 콘)·자동사격(360° 사거리/범위)을 2배(터치 조준 난도 보정). 캐시 스펙 불변(복제).
    const primarySpec = this.mobile.enabled && drone.move.mode === "fly"
      ? withAutoBoost(primaryWeapon as BeamSpec, 2.0)
      : (primaryWeapon as BeamSpec);
    const beam = new FrequencyBeam(this.scene, player, enemies, primarySpec, this.sfx);
    // 특수무기 타입별 구동 — barrage(콘 살포) / stream(오버드라이브 듀얼 연사). 판별 유니온 내로잉(캐스트 X).
    let special: SpecialWeapon;
    if (specialWeapon.type === "stream") special = new SpecialStream(this.scene, player, enemies, specialWeapon, this.sfx);
    else if (specialWeapon.type === "barrage") special = new SpecialBarrage(this.scene, player, enemies, specialWeapon, this.sfx);
    else return this.failToMenu("특수무기 타입 오류 — " + specialWeapon.type);
    const composer = createComposer(this.renderer, this.scene, player.camera);
    const rearView = new RearView(this.renderer, this.scene, player);
    const minimap = new Minimap(player, enemies, world);
    const brackets = new TargetBrackets(this.scene);
    this.session = { world, player, enemies, beam, special, composer, rearView, minimap, brackets };
    this.applyHudLayout(); // 새 미니맵을 현재 화면 비례로 동기화
    this.diag.snapshot(this.renderer, "battle-built"); // 세션(컴포저 등) 생성 직후 — 누수 추적 핵심 지점
    this.wireEvents(this.session);
    this.beginPlay();
  }

  private beginPlay() {
    const s = this.session;
    if (!s) return;
    s.player.reset();
    s.enemies.start(!this.peaceful); // 탐방 모드면 적 미스폰
    s.special.reset();
    this.hud.setKills(0);
    this.hud.setDestroyed(s.world.buildings?.destroyedBuildings ?? 0, s.world.buildings?.destroyedLandmarks ?? 0);
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
    s.enemies.onPlayerHit = () => {
      this.hud.flashDamage();
      this.sfx.sizzle(); // 접촉 피해 — 달군 철판에 물 닿는 "치익" 기화음
    };
    // 건물/랜드마크 파괴 → HUD 카운터 갱신(번쩍 + 슬로우 붕괴 연출은 BuildingCombat 가 진행)
    const bc = s.world.buildings;
    if (bc) bc.onDestroyed = () => this.hud.setDestroyed(bc.destroyedBuildings, bc.destroyedLandmarks);
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
  /** 페이지 이탈 전 GPU 자원 즉시 해제 — 컴포저(+블룸 패스), 인트로/메뉴, 렌더러 컨텍스트. */
  private teardown() {
    if (this.tornDown) return;
    this.tornDown = true;
    this.renderer.setAnimationLoop(null);
    this.intro?.dispose();
    this.menuBg?.dispose();
    if (this.session) disposeComposer(this.session.composer);
    this.renderer.forceContextLoss(); // GPU 컨텍스트 즉시 반납(iOS 회수 촉진)
    this.renderer.dispose();
  }

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
        this.diag.snapshot(this.renderer, "menuBg+"); // 메뉴 배경 컴포저 생성 직후
      }
      this.menuBg.update(dt); // 랜덤 인트로 장면을 배경으로 렌더
      return;
    }

    const s = this.session;
    if (!s) return; // 전장 빌드 전(로딩)

    if (this.state === "playing" && this.input.locked && !this.mobile.isBlocked) {
      s.player.update(dt);
      const pp = s.player.worldPosition;
      s.world.update(pp.x, pp.z, pp.y); // 그림자 추종 + (스트리밍) 청크 로드/언로드
      s.beam.update(dt, this.input.fireHeld);
      s.special.update(dt, this.input.specialPressed);
      s.enemies.update(dt);
      s.brackets.update(s.player.camera, s.enemies.aliveMarkers); // 근거리 적에 코너 브래킷(TargetBrackets.RANGE)
      this.hud.setEnemyDirections(s.player.camera, s.enemies.aliveWorldPositions); // 조준선 둘레 방향 화살표
      this.hud.update(dt);

      this.hud.setHp(s.player.hp, s.player.maxHp);
      this.hud.setFrequency(s.player.freq, s.player.maxFreq);
      const cdReady = s.special.cooldownReady;
      const cdRemaining = s.special.cooldownRemainingSec;
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
    s?.brackets.hide(); // 사망 화면에 브래킷·체력수치 잔상 방지
    this.hud.clearEnemyDirections(); // 적 방향 화살표 잔상 방지
    // 실제 포인터락은 데스크탑만 사용(모바일은 합성 락). iPad WebKit 은 exitPointerLock 미지원/실패 가능 →
    // 가드 없이 호출하면 예외로 showPanel 이 건너뛰어져 버튼이 안 뜸. 모바일은 호출 생략 + 옵셔널 체이닝.
    if (!this.mobile.enabled) document.exitPointerLock?.();
    this.showPanel(
      "LINK LOST",
      s ? `정화 ${s.enemies.killCount}체 · WAVE ${s.enemies.wave}` : "",
      "재접속 / RECONNECT"
    );
  }

  /** 일시정지/사망 패널(맵 목록 숨김, 재접속 + 전장 선택 버튼) */
  private showPanel(title: string, subtitle: string, startLabel: string) {
    this.overlayTitle.textContent = title;
    this.overlayTitle.setAttribute("data-text", title);
    this.overlaySubtitle.textContent = subtitle;
    this.menu.hide();
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
    this.applyHudLayout();
  }

  /**
   * 전투 HUD 위젯(후방화면·미니맵·코너 텍스트)을 화면 비례 크기/위치로 배치(hudSizesFor 단일 출처).
   * 후방 GL 뷰포트(RearView)·미니맵 캔버스 해상도(Minimap)는 같은 공식을 직접 쓰고, 여기선 CSS 박스 정렬 담당.
   */
  private applyHudLayout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { minimap, rearW, rearH, margin } = hudSizesFor(w, h);
    const c = hudComponentsFor(w, h);
    const px = (n: number) => `${n}px`;

    const rear = document.querySelector(".hud__rear") as HTMLElement | null;
    if (rear) {
      rear.style.width = px(rearW);
      rear.style.height = px(rearH);
      rear.style.top = px(margin);
      rear.style.left = px(margin);
    }
    const mm = document.getElementById("minimap");
    if (mm) {
      mm.style.top = px(margin);
      mm.style.right = px(margin);
    }
    this.session?.minimap.resize(minimap);

    // 코너 텍스트는 각 위젯 아래로 내려 겹치지 않게(좌=후방 아래, 우=미니맵 아래)
    const tl = document.querySelector(".hud__corner--tl") as HTMLElement | null;
    if (tl) tl.style.top = px(margin + rearH + 22);
    const tr = document.querySelector(".hud__corner--tr") as HTMLElement | null;
    if (tr) tr.style.top = px(margin + minimap + 10);

    // 상단 중앙 게이지(가로 좁은 비율에서 축소된 폭 적용) — CSS clamp 를 인라인으로 덮어씀
    const gauges = document.querySelector(".hud__gauges") as HTMLElement | null;
    if (gauges) {
      gauges.style.top = px(c.gaugeTop);
      gauges.style.gap = px(c.gaugeGap);
      gauges.querySelectorAll<HTMLElement>(".hud__bar").forEach((b) => (b.style.width = px(c.bar)));
    }

    // 우하단 터치 버튼 클러스터(존재 시 = 터치 기기)
    const btns = document.querySelector(".tc__buttons") as HTMLElement | null;
    if (btns) {
      btns.style.gridTemplateColumns = `repeat(2, ${c.btn}px)`;
      btns.style.gridTemplateRows = `repeat(2, ${c.btn}px)`;
      btns.style.gap = px(c.btnGap);
      btns.style.right = px(c.btnInset);
      btns.style.bottom = px(c.btnInset);
    }
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}
