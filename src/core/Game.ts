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
import { withAutoBoost, scaleWeaponDamage, type BeamSpec, type SpecialWeapon } from "../weapons/WeaponSpec";
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
import { createComposer, disposeComposer, addLensDistortPass } from "../fx/postprocessing";
import { projectLensPoints } from "../fx/lensDistort";
import type { LensDistortPass } from "../fx/LensDistortPass";
import { TargetBrackets } from "../fx/TargetBrackets";
import { EnergyWall } from "../fx/EnergyWall";
import { CinematicPlayer } from "../intro/CinematicPlayer";
import { MenuBackground } from "../intro/MenuBackground";
import { introScenes } from "../intro/scenes";
import { fetchMap, fetchCatalog, loadTerrainHeights } from "../world/maps";
import type { MapCatalogEntry, NormalizedMap } from "../world/MapData";
import { GameInstance, runDeploy } from "../game/GameInstance";
import { fetchMissions } from "../game/missions";
import type { MissionOutcome } from "../game/mission";
import { pickMissionV2, FREE_ROAM_V2, DEFAULT_MISSIONS_V2, resonanceScore } from "../game/missionV2";
import { flushStores, campaignStore, progressStore } from "./progress";
import {
  applyMissionResult, applyRevelation, pickCampaignMission, pairAggravation, chapterMeta,
  driftConvergence, revealed, sutureReadout, sortieLinkReport, REVELATION_LINES, type MissionReport,
} from "../game/campaign";
import { droneGrowth, levelFromXp, xpForKill, CLEAR_XP } from "../player/progression";
import { validateDirectorActions, type Director, type DirectorAction, type DirectorSnapshot } from "../game/director";
import { RemoteDirector, resolveDirectorEndpoint, DIRECTOR_INTERVAL_SEC } from "../game/directorClient";

type GameState = "intro" | "menu" | "loading" | "playing" | "paused" | "dead";

// 재시작(reload)으로 같은 전장/기체에 재출격하기 위한 sessionStorage 키.
const DEPLOY_KEY = "core.deploy";
const RETRY_KEY = "core.retry";

interface DeployInfo {
  id: string;
  droneId: string;
  peaceful: boolean;
}

/** 전장 빌드 후 함께 생성되는 플레이 세션 — 전부 존재 or 전부 없음(옵셔널 필드 + non-null 단언 제거). */
interface Session {
  world: GameWorld;
  player: PlayerController;
  enemies: EnemyManager;
  beam: FrequencyBeam;
  special: SpecialWeapon;
  composer: EffectComposer;
  lens: LensDistortPass; // 중력 렌즈 왜곡(§2.7.1) — 매 프레임 위상 이탈 개체 위치로 갱신
  rearView: RearView;
  minimap: Minimap;
  brackets: TargetBrackets;
  instance: GameInstance; // 이 플레이타임의 미션/상태/종료 조건 관리
  wall?: EnergyWall; // 작전구역 경계 에너지 벽(존 있을 때만)
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
  private currentCity: { id: string; lat: number; lon: number } | null = null; // 캠페인 적립(endMission)용
  private currentDroneId = "walker"; // XP 적립 대상(§7.4 — 드론별 독립)
  // LLM 감독 파일럿(§10 단계 1) — 엔드포인트 설정 시에만 활성. 부재/오류 = 개입 없음(우아한 강등).
  private director: Director | null = null;
  private directorTimer = 0;
  private directorBusy = false;
  private hitstopLeft = 0; // 히트스톱 잔여(s) — 수동 명중/처치 순간 시뮬레이션을 1~3프레임 정지(타격감)
  // 구역 축소(미션 변조 zoneShrink — 훅 ⑥): 주기마다 반경 축소, 에너지 벽 재생성. null = 비활성
  private zoneShrink: { everySec: number; step: number; minRadius: number; timer: number; radius: number } | null = null;
  private wallParams: { sx: number; sz: number; y0: number; y1: number } | null = null; // 벽 재생성 파라미터
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
      campaign: () => campaignStore.load(), // 수사판(지도 오버레이·사건 파일)의 데이터 원천
      droneLevel: (id) => levelFromXp(progressStore.load().drones[id]?.xp ?? 0), // §7.4 진행
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
    this.maybeAutoRedeploy(); // 미션 재시작(reload) → 저장된 전장으로 바로 재출격
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
    this.rememberDeploy({ id, droneId, peaceful }); // 재시작(reload) 재출격용
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
    // 진행 성장(§7.4) — 출격 시점 스냅샷: 저장 XP → 레벨 → HP/재생(플레이어)·데미지 배수(무기)
    const level = levelFromXp(progressStore.load().drones[droneId]?.xp ?? 0);
    const growth = droneGrowth(droneId, level);
    player.applyGrowth(growth);
    this.currentDroneId = droneId;
    primaryWeapon = scaleWeaponDamage(primaryWeapon, growth.dmgMult);
    specialWeapon = scaleWeaponDamage(specialWeapon, growth.dmgMult);
    this.hud.setUnitName(level > 1 ? `${drone.name} · Lv ${level}` : drone.name);
    // 모바일 버튼 구성 — 동작(드론) + 전투 라벨(무기 스펙 abbr)
    this.mobile.configure({
      actions: drone.actions,
      fireLabel: primaryWeapon.abbr, // abbr 은 모든 무기 타입 공통 → 캐스트 불필요
      specialLabel: specialWeapon.abbr,
    });
    const enemies = new EnemyManager(this.scene, world, [player], plasmoidSpec); // MP 대응: 플레이어 배열(현재 1인)
    // 모바일 — 에임어시스트 콘만 2배(터치 조준 난도 보정), 자동사격 사거리는 데스크탑과 동일(1km, rangeMul 1.0).
    // 데스크탑은 무영향. 캐시 스펙 불변(복제).
    const primarySpec = this.mobile.enabled
      ? withAutoBoost(primaryWeapon as BeamSpec, 2.0, 1.0)
      : (primaryWeapon as BeamSpec);
    const beam = new FrequencyBeam(this.scene, player, enemies, primarySpec, this.sfx);
    // 특수무기 타입별 구동 — barrage(콘 살포) / stream(오버드라이브 듀얼 연사). 판별 유니온 내로잉(캐스트 X).
    let special: SpecialWeapon;
    if (specialWeapon.type === "stream") special = new SpecialStream(this.scene, player, enemies, specialWeapon, this.sfx);
    else if (specialWeapon.type === "barrage") special = new SpecialBarrage(this.scene, player, enemies, specialWeapon, this.sfx);
    else return this.failToMenu("특수무기 타입 오류 — " + specialWeapon.type);
    const composer = createComposer(this.renderer, this.scene, player.camera);
    const lens = addLensDistortPass(composer); // 중력 렌즈 왜곡(§2.7.1) — 위상 이탈 개체 배경 일렁임
    lens.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    const rearView = new RearView(this.renderer, this.scene, player);
    const minimap = new Minimap(player, enemies, world);
    const brackets = new TargetBrackets(this.scene);
    // 이 플레이타임의 미션 — 탐방은 FREE_ROAM, 전투는 **챕터 가중 선택**(캠페인 §9 — 규칙 기반 감독).
    const pool = peaceful ? [] : await fetchMissions().catch(() => DEFAULT_MISSIONS_V2);
    const mission = peaceful
      ? FREE_ROAM_V2
      : pickCampaignMission(pool, campaignStore.load(), Math.random()) ?? pickMissionV2(pool, Math.random());
    this.currentCity = { id, lat: entry?.lat ?? 0, lon: entry?.lon ?? 0 }; // 미션 결과 → 캠페인 적립용
    // LLM 감독 파일럿(§10 단계 1) — ?director=<url>(저장) 또는 저장값. 탐방/미설정이면 감독 없음.
    const endpoint = resolveDirectorEndpoint(
      window.location.search,
      (k) => { try { return localStorage.getItem(k); } catch { return null; } },
      (k, v) => { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
      (k) => { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
    );
    this.director = endpoint && !peaceful ? new RemoteDirector(endpoint) : null;
    this.directorTimer = DIRECTOR_INTERVAL_SEC;
    const instance = new GameInstance({
      mission, players: [player], enemies, buildings: world.buildings ?? undefined,
      revealed: revealed(campaignStore.load()), // 명칭 갱신(§8.3) — 출격 시점 스냅샷
    });
    // 작전구역 에너지 벽 — 스폰(=존 중심) 주위 반경 zoneRadius. 지면 기준 수직 범위로 세움(고지대 맵 대응).
    let wall: EnergyWall | undefined;
    if (!peaceful && mission.zoneRadius > 0) {
      const sx = world.spawn.x, sz = world.spawn.z;
      const gy = world.heightAt(sx, sz);
      wall = new EnergyWall(this.scene, sx, sz, mission.zoneRadius, gy - 200, gy + 1600);
      this.wallParams = { sx, sz, y0: gy - 200, y1: gy + 1600 }; // 구역 축소 시 벽 재생성용
    } else this.wallParams = null;
    this.session = { world, player, enemies, beam, special, composer, lens, rearView, minimap, brackets, instance, wall };
    this.applyHudLayout(); // 새 미니맵을 현재 화면 비례로 동기화
    this.diag.snapshot(this.renderer, "battle-built"); // 세션(컴포저 등) 생성 직후 — 누수 추적 핵심 지점
    this.wireEvents(this.session);
    this.beginPlay();
  }

  private beginPlay() {
    const s = this.session;
    if (!s) return;
    s.player.reset();
    // 작전구역(미션 zoneRadius, 중심 = 스폰) — 플레이어·플라즈모이드 모두 이 원 밖으로 못 나간다. 탐방은 무제한.
    const m = s.instance.mission;
    if (!this.peaceful && m.zoneRadius > 0) {
      s.player.setZone(m.zoneRadius);
      const z = s.player.zone;
      if (z) s.enemies.setZone(z.cx, z.cz, z.radius);
    } else {
      s.player.clearZone();
      s.enemies.setZone(0, 0, 0);
    }
    // 적 투입 — deploy 모델 매핑은 runDeploy(훅 ①⑤⑥ 공용). phased 후속 페이즈는 GameInstance 가 구동.
    if (this.peaceful) s.enemies.start(false);
    else runDeploy(s.enemies, m.deploy, true);
    // 변조 레이어(훅 ④⑥) — 투입 후 지정(start*/clear 가 기본값으로 리셋하므로 반드시 이후에)
    s.enemies.setAggro(m.modifiers?.aggro ?? "player");
    s.enemies.setBuildingBrands(!!m.modifiers?.buildingBrands); // 공성 낙인(패턴 17)
    // 자매쌍 난이도 전이(§9.2-3) — 짝 도시가 무너져 있으면 파문 주기 단축(가중과 미션 변조 곱)
    const pairMul = this.peaceful || !this.currentCity ? 1 : pairAggravation(campaignStore.load(), this.currentCity.id);
    const sweepMul = (m.modifiers?.sweepPeriodMul ?? 1) * pairMul;
    if (sweepMul !== 1) s.enemies.setSweepPeriodMul(sweepMul);
    s.player.freqRegenMul = m.modifiers?.freqRegenMul ?? 1; // 옅은 장
    // 구역 축소(zoneShrink) — 주기마다 작전구역 반경을 줄인다(에너지 벽 재생성 포함)
    const shrink = m.modifiers?.zoneShrink;
    this.zoneShrink = !this.peaceful && shrink && m.zoneRadius > 0
      ? { ...shrink, timer: shrink.everySec, radius: m.zoneRadius }
      : null;
    s.special.reset();
    s.instance.start(); // 미션 타이머/리스폰 예산 초기화
    this.hud.setKills(0);
    this.hud.setDestroyed(s.world.buildings?.destroyedBuildings ?? 0, s.world.buildings?.destroyedLandmarks ?? 0);
    const snap = s.instance.snapshot();
    this.hud.setMission(snap.objective, s.instance.mission.goal.type !== "free-roam");
    this.hud.updateMission(snap.timeLeft, snap.detail, snap.respawnsLeft);
    // 브리핑 방송 — 2연전 관측 보고(2장 앵커) > 미션 brief > 현재 장의 수사 방향(§9.3 P0-5)
    if (!this.peaceful) {
      const camp = campaignStore.load();
      const brief = (this.currentCity && sortieLinkReport(camp, this.currentCity.id))
        ?? s.instance.mission.brief ?? chapterMeta(camp).brief;
      if (brief) this.hud.showBroadcast(brief, 8);
    }
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

  /** 히트스톱 충전(최댓값 유지 — 연타 누적 없음). 다음 프레임들의 시뮬레이션 dt 가 0 이 된다. */
  private hitstop(sec: number) {
    this.hitstopLeft = Math.max(this.hitstopLeft, sec);
  }

  private wireEvents(s: Session) {
    s.beam.onFired = () => this.hud.flashFire();
    s.special.onFired = () => {
      this.hud.flashFire();
      s.player.kick(0.0035); // 특수 볼리 반동(연사라 작게)
    };
    // 손맛 — 수동 사격 반동 킥 + 명중/처치 히트스톱(오토는 상시라 제외, 처치는 공통)
    s.beam.onManualFired = () => s.player.kick(0.006);
    s.beam.onManualHit = (killed) => this.hitstop(killed ? 0.06 : 0.025);
    s.enemies.onKill = (enemy) => {
      this.hud.setKills(s.enemies.killCount);
      this.hitstop(0.045); // 처치 확정 정지 프레임(오토/특수 포함)
      // 처치 XP(§7.4) — 강함 비례 10~50. update 는 스로틀 기록이라 프레임 부담 없음.
      if (!this.peaceful && enemy) {
        const gain = xpForKill(s.enemies.strengthOf(enemy));
        const id = this.currentDroneId;
        progressStore.update((p) => ({
          ...p,
          drones: { ...p.drones, [id]: { xp: (p.drones[id]?.xp ?? 0) + gain } },
        }));
      }
    };
    s.enemies.onWaveChange = (w) => this.hud.setWave(w);
    s.enemies.onPlayerHit = (_dmg, source) => {
      this.hud.flashDamage();
      this.sfx.sizzle(); // 접촉 피해 — 달군 철판에 물 닿는 "치익" 기화음
      s.player.shake(0.012); // 피격 셰이크
      if (source) this.hud.flashDamageFrom(s.player.camera, source); // 피해 방향 인디케이터
    };
    // 심판 파문이 내 위치를 통과 — 화면 펄스 + 저음 + 셰이크(낙인 피해면 강하게)
    s.enemies.onSweepPass = (branded) => {
      this.hud.pulseSweep(branded);
      this.sfx.reckoning(branded);
      s.player.shake(branded ? 0.024 : 0.012);
    };
    // 건물/랜드마크 파괴 → HUD 카운터 갱신(번쩍 + 슬로우 붕괴 연출은 BuildingCombat 가 진행) +
    // 방향 인디케이터(호박색 쐐기, 피격=붉은색과 색 구분) + 저음 — "저쪽에서 뭔가 무너졌다"는
    // 신호가 지금까진 카운터 변화뿐이라 놓치기 쉬웠다(e2e 검증에서 발견 — 2026-08).
    // 랜드마크 파괴는 더 무겁게(셰이크 추가) — 미션 목표 상실이라는 무게를 반영.
    const bc = s.world.buildings;
    if (bc) bc.onDestroyed = (isLandmark, x, y, z) => {
      this.hud.setDestroyed(bc.destroyedBuildings, bc.destroyedLandmarks);
      this.hud.flashLossFrom(s.player.camera, { x, y, z });
      this.sfx.reckoning(isLandmark);
      s.player.shake(isLandmark ? 0.022 : 0.01);
    };
    // 링크 리와인드(내부 id — 물리편 §2.8.3, 자가 시전). 표면 명칭은 "위상 소급"(§8.1 어휘 가드 —
    // "리와인드/롤백"은 L4 누설 금지어라 HUD엔 절대 쓰지 않는다). 위치·HP 복원 + 반경 내 최근 파괴 건물 되돌림.
    s.player.onLinkRewind = (revived) => {
      this.hud.setDestroyed(s.world.buildings?.destroyedBuildings ?? 0, s.world.buildings?.destroyedLandmarks ?? 0);
      // 문구를 이원화한다 — "자기 자신만 되돌아왔다"와 "주변 파괴도 함께 되돌렸다"는 다른 결과라,
      // 둘 다 성공처럼 들리는 문구는 '왜 아무것도 안 바뀐 것 같지?' 하는 혼란을 줄 수 있다(e2e 검증에서
      // 확인 — 반경 밖이면 실전에서 건물 복원이 잘 발동하지 않는다). 화면 펄스(청록)로도 시전을 못박는다.
      this.hud.showBroadcast(
        revived > 0
          ? `위상 소급 — 내 위치·상태가 돌아왔고, 무너졌던 ${revived}곳도 다시 섰다.`
          : "위상 소급 — 내 위치·상태만 돌아왔다(근처엔 되돌릴 파괴가 없었다).",
        5,
      );
      this.hud.pulseObserve(revived > 0);
      s.player.shake(revived > 0 ? 0.03 : 0.015);
      this.sfx.reckoning(revived > 0);
    };
    // 역행체(P3 §6.6) — 시전 예지 카운트다운 + 발동 시 처치 수 되감김·연출
    s.enemies.onRewindCast = (left) => this.hud.setRewindWarn(left);
    s.enemies.onRewound = (revived) => {
      this.hud.setKills(s.enemies.killCount); // 전과가 되감겼다 — 즉시 반영
      this.hud.showBroadcast(
        revived > 0 ? `역행 파동 — 소산 ${revived}체가 되돌아왔다. 시전자를 끊어라.` : "역행 파동 통과 — 위치가 되감겼다.",
        5,
      );
      s.player.shake(0.02);
      this.sfx.reckoning(true);
    };
    // 미션 종료(성공/실패) → 결과 패널(재시작은 reload)
    s.instance.onEnd = (outcome) => this.endMission(outcome);
  }

  /** 일시정지 후 재접속(제자리 재개) · 미션 종료 후 재시작(reload 재출격) 버튼. */
  private startOrResume() {
    this.sfx.resume(); // 사용자 클릭 제스처 → 오디오 활성화/재개
    if (this.state === "dead") {
      this.retryDeploy(); // 미션 종료 → 같은 전장으로 reload 재출격(새 인스턴스/미션)
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
    flushStores(); // 스로틀로 보류된 영속 기록 마감(진행/캠페인 — core/progress)
    this.renderer.setAnimationLoop(null);
    this.intro?.dispose();
    this.menuBg?.dispose();
    if (this.session) { disposeComposer(this.session.composer); this.session.wall?.dispose(); }
    this.renderer.forceContextLoss(); // GPU 컨텍스트 즉시 반납(iOS 회수 촉진)
    this.renderer.dispose();
  }

  private changeMap() {
    try { sessionStorage.removeItem(DEPLOY_KEY); sessionStorage.removeItem(RETRY_KEY); } catch { /* 무시 */ }
    window.location.reload();
  }

  // ─────────────────────────── 재출격(reload) ───────────────────────────

  /** 출격 정보를 저장(재시작 reload 시 같은 전장/기체로 재출격). */
  private rememberDeploy(d: DeployInfo) {
    try { sessionStorage.setItem(DEPLOY_KEY, JSON.stringify(d)); } catch { /* 비공개 모드 등 — 무시 */ }
  }

  /** 미션 재시작 — 재출격 플래그를 세우고 reload(클린 인스턴스/새 랜덤 미션). */
  private retryDeploy() {
    try { sessionStorage.setItem(RETRY_KEY, "1"); } catch { /* 무시 */ }
    window.location.reload();
  }

  /** 부팅 시 재출격 플래그가 있으면 메뉴를 건너뛰고 저장된 전장으로 바로 출격. */
  private maybeAutoRedeploy() {
    let retry: string | null = null;
    let raw: string | null = null;
    try { retry = sessionStorage.getItem(RETRY_KEY); raw = sessionStorage.getItem(DEPLOY_KEY); } catch { return; }
    if (!retry || !raw) return;
    try { sessionStorage.removeItem(RETRY_KEY); } catch { /* 무시 */ }
    try {
      const d = JSON.parse(raw) as DeployInfo;
      if (d && d.id && d.droneId) void this.selectMap(d.id, d.droneId, !!d.peaceful);
    } catch { /* 손상된 값 — 메뉴 유지 */ }
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
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    let dt = rawDt;
    // 히트스톱 — 시뮬레이션만 정지(dt=0). 시점 회전(마우스 델타)은 dt 무관이라 조작감 유지.
    if (this.hitstopLeft > 0) {
      this.hitstopLeft -= rawDt;
      dt = 0;
    }

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
      s.wall?.update(dt); // 작전구역 에너지 벽 애니메이션
      this.tickZoneShrink(s, dt); // 구역 축소 변조(훅 ⑥) — 주기 도래 시 반경 축소 + 벽 재생성
      s.beam.update(dt, this.input.fireHeld);
      s.special.update(dt, this.input.specialPressed);
      s.enemies.update(dt);

      // 락온 토글(W 두번 연타 / 조이스틱 더블탭)
      if (this.input.lockOnPressed) {
        const current = s.player.lockOnTarget;
        if (current) {
          // 이미 락온 → 해제
          s.player.setLockOn(null);
          this.hud.setLockOn(false);
        } else {
          // 락온 없음 → 조준 콘(30°) 안 최적 대상 선택
          const target = s.enemies.bestTargetInView(
            s.player.camera.position,
            s.player.getAimDirection(),
            30,
          );
          s.player.setLockOn(target);
          this.hud.setLockOn(target !== null);
        }
      }
      // 락온 대상이 사망하면 HUD도 즉시 해제
      if (s.player.lockOnTarget === null) this.hud.setLockOn(false);

      const lockedPos = s.player.lockOnTarget ? s.player.lockOnTarget.group.position : null;
      s.brackets.update(s.player.camera, s.enemies.aliveMarkers, lockedPos); // 코너 브래킷(락온=빨강·그 외 노랑)
      this.hud.setEnemyDirections(s.player.camera, s.enemies.aliveWorldPositions); // 조준선 둘레 방향 화살표
      this.hud.setReckoning(s.enemies.sweepWarnLeft, s.enemies.brandCount(0)); // 낙인/심판 파문 경고
      this.hud.update(rawDt); // HUD 페이드는 히트스톱 무관(실시간)

      this.hud.setHp(s.player.hp, s.player.maxHp);
      this.hud.setFrequency(s.player.freq, s.player.maxFreq);
      const cdReady = s.special.cooldownReady;
      const cdRemaining = s.special.cooldownRemainingSec;
      this.hud.setSpecial(cdReady, s.special.isActive, cdRemaining);
      this.mobile.setSpecialState(cdReady, s.special.isActive, cdRemaining);

      // 인스턴스: 미션 평가(타이머/목표/종료). 종료 전이 시 onEnd→endMission 으로 state 가 바뀐다.
      s.instance.update(dt);
      this.tickDirector(s, dt); // LLM 감독 파일럿(§10 단계 1) — 주기 경계에서 스냅샷 → 행동 적용
      if (s.instance.mission.goal.type !== "free-roam") {
        const snap = s.instance.snapshot();
        this.hud.updateMission(snap.timeLeft, snap.detail, snap.respawnsLeft);
      }
      // 사망 처리는 미션 종료(성공 등) 전이 후엔 생략 — 여전히 playing 일 때만.
      if (s.player.isDead && this.state === "playing") this.handlePlayerDeath();
    }

    // 중력 렌즈 왜곡(§2.7.1) — 위상 이탈 개체의 화면상 위치로 왜곡 점 갱신(플레이 중일 때만 무의미하지 않음)
    const phased = s.enemies.phasedMarkers(s.player.camera.position);
    s.lens.setPoints(projectLensPoints(phased, s.player.camera));

    this.input.endFrame();
    s.composer.render();
    if (this.state === "playing") {
      s.rearView.render();
      s.minimap.render();
    }
  }

  /** 구역 축소(zoneShrink) — 주기 도래 시 반경을 줄이고 플레이어/적 존·에너지 벽을 갱신한다. */
  /**
   * 감독 주기 틱(§10 단계 1) — DIRECTOR_INTERVAL 마다 집계 스냅샷을 POST, 응답 행동을 검증
   * 게이트(validateDirectorActions — 봉투·runnable·표면 어휘) 통과분만 적용. 스테일 응답(세션 교체·
   * 미션 종료 후 도착)은 폐기. 거부 사유는 감사 로그(콘솔 — 단계 2에서 파편 파이프라인으로 승격).
   */
  private tickDirector(s: Session, dt: number) {
    if (!this.director || this.directorBusy || !s.instance.isActive) return;
    this.directorTimer -= dt;
    if (this.directorTimer > 0) return;
    this.directorTimer = DIRECTOR_INTERVAL_SEC;
    this.directorBusy = true;
    const snap: DirectorSnapshot = {
      missionId: s.instance.mission.id,
      goalType: s.instance.mission.goal.type,
      runtime: s.instance.runtimeView,
      respawnsLeft: s.instance.respawnsLeft === Infinity ? -1 : s.instance.respawnsLeft, // JSON 안전(-1=무한)
      aliveEnemies: s.enemies.aliveSnapshot.length,
      reinforceQueued: s.enemies.reinforceQueuedCount,
      brandCount: s.enemies.brandCount(0),
      score: resonanceScore(s.enemies.killCount, s.enemies.stats, false),
      players: { count: 1, avgHpFrac: Math.max(0, s.player.hp) / s.player.maxHp },
    };
    void this.director.decide(snap).then((actions) => {
      this.directorBusy = false;
      if (this.session !== s || this.state !== "playing" || !s.instance.isActive) return; // 스테일 폐기
      const { accepted, rejected } = validateDirectorActions(actions);
      for (const r of rejected) console.info("[director] 행동 거부:", r.reason);
      for (const a of accepted) this.applyDirectorAction(s, a);
    });
  }

  /** 검증 통과 감독 행동 → 기존 엔진 노브 적용(신규 치트 경로 없음 — director.ts 계약). */
  private applyDirectorAction(s: Session, a: DirectorAction) {
    switch (a.type) {
      case "none": return;
      case "set-modifiers":
        if (a.modifiers.aggro) s.enemies.setAggro(a.modifiers.aggro);
        if (a.modifiers.sweepPeriodMul) s.enemies.setSweepPeriodMul(a.modifiers.sweepPeriodMul);
        if (a.modifiers.freqRegenMul) s.player.freqRegenMul = a.modifiers.freqRegenMul;
        return;
      case "reinforce":
        runDeploy(s.enemies, a.deploy, false); // 카운터 유지 증원 — 파문/증원 경계 문법과 동일
        return;
      case "brief":
        this.hud.showBroadcast(a.text, 8); // 표면 어휘 게이트 통과분만 여기 도달
        return;
    }
  }

  private tickZoneShrink(s: Session, dt: number) {
    const z = this.zoneShrink;
    if (!z || dt <= 0) return;
    z.timer -= dt;
    if (z.timer > 0) return;
    z.timer = z.everySec;
    z.radius = Math.max(z.minRadius, z.radius - z.step);
    const zone = s.player.zone;
    const cx = zone?.cx ?? s.world.spawn.x;
    const cz = zone?.cz ?? s.world.spawn.z;
    s.player.setZone(z.radius, cx, cz);
    s.enemies.setZone(cx, cz, z.radius);
    if (this.wallParams) {
      s.wall?.dispose();
      s.wall = new EnergyWall(this.scene, this.wallParams.sx, this.wallParams.sz, z.radius, this.wallParams.y0, this.wallParams.y1);
    }
    this.sfx.reckoning(false); // 경계가 조여드는 저음 — 이벤트 가독
    if (z.radius <= z.minRadius) this.zoneShrink = null; // 최소 반경 도달 — 종료
  }

  /**
   * 플레이어(기체) 파괴 — 인스턴스 리스폰 예산을 조회한다. 남으면 **제자리 부활**(적/미션/처치 유지)로
   * 전투를 잇고, 소진이면 인스턴스를 종료 평가(→ onEnd→endMission 으로 미션 실패 패널).
   */
  private handlePlayerDeath() {
    const s = this.session;
    if (!s) return;
    // 사망 시 락온 해제
    s.player.setLockOn(null);
    this.hud.setLockOn(false);
    if (s.instance.registerDeath()) {
      s.player.respawn(); // 스폰 복귀 + 짧은 무적. 적/미션은 그대로 진행
      this.hud.flashDamage();
      return;
    }
    s.instance.finalize(); // 리스폰 소진 → 미션 실패 전이(onEnd→endMission)
  }

  /** 미션 종료(성공/실패) → 포인터락 해제 + 결과 패널. 재시작은 reload(같은 전장 재출격). */
  private endMission(outcome: MissionOutcome) {
    if (this.state !== "playing") return;
    const s = this.session;
    this.state = "dead";
    this.setPlayActive(false);
    s?.brackets.hide(); // 결과 화면에 브래킷·체력수치 잔상 방지
    this.hud.clearEnemyDirections(); // 적 방향 화살표 잔상 방지
    // 실제 포인터락은 데스크탑만(모바일은 합성 락). iPad WebKit 은 exitPointerLock 미지원/실패 가능 →
    // 가드 없이 호출하면 예외로 showPanel 이 건너뛰어져 버튼이 안 뜸. 모바일은 호출 생략 + 옵셔널 체이닝.
    if (!this.mobile.enabled) document.exitPointerLock?.();
    const success = outcome.status === "success";
    const kills = s ? s.enemies.killCount : 0;
    const title = success ? "작전 완수 / MISSION COMPLETE" : "작전 실패 / MISSION FAILED";
    // 캠페인·진행 적립(P0) — 탐방 제외. 기록은 스로틀 + pagehide flush 가 마감(core/progress).
    // 실험(5장 앵커) 성공은 계시(§9.0-4) — 6장 진입 + 결과 패널 문법이 바뀐다(아래 sub 조립).
    let revelationNow = false; //  이번 종료가 계시 순간인가
    let convergenceNow = false; // 이번 종료로 표류 교점이 처음 수렴했는가(3장 삼각측량)
    if (!this.peaceful && this.currentCity && s) {
      const before = campaignStore.load();
      const report: MissionReport = {
        cityId: this.currentCity.id, missionId: s.instance.mission.id,
        goalType: s.instance.mission.goal.type, success,
        kills, zenoFreezes: s.enemies.stats.zenoFreezes,
        cityLat: this.currentCity.lat, cityLon: this.currentCity.lon,
      };
      let after = applyMissionResult(before, report, Math.random());
      revelationNow = success && s.instance.mission.goal.type === "experiment" && after.chapter === 5;
      if (revelationNow) after = applyRevelation(after);
      convergenceNow = !driftConvergence(before).show && driftConvergence(after).show;
      campaignStore.update(() => after);
      const id = this.currentDroneId;
      progressStore.update((p) => ({
        ...p,
        // 클리어 정액 XP(§7.4) — 성공 시 +200(현재 드론)
        drones: success ? { ...p.drones, [id]: { xp: (p.drones[id]?.xp ?? 0) + CLEAR_XP } } : p.drones,
        stats: {
          ...p.stats,
          kills: p.stats.kills + kills,
          battlefieldsCleared: p.stats.battlefieldsCleared + (success ? 1 : 0),
        },
      }));
    }
    // 결과 채점 — 어떻게 싸웠는가(근원 격파·파문 무상 통과·관측 고정)를 공명 점수로 집계.
    // 서사편 §7 W5(공명 각인)의 선행 형태 — "실패 유형이 다양할수록" 문법의 UI 기반. 표면 어휘만 사용(§8.2).
    let sub = `${outcome.reason} · 정화 ${kills}체`;
    if (s) {
      const st = s.enemies.stats;
      const sweepTotal = st.sweepHits + st.sweepCleanPasses;
      const score = resonanceScore(kills, st, success); // 순수 공식(missionV2) — 테스트 가드
      // 재독 문법(6장 이후, §9.4) — "정화 n체"가 아니라 "절단된 투영 / 본체 1 / 봉합도"로 읽는다.
      if (revealed(campaignStore.load())) sub = `${outcome.reason} · ${sutureReadout(kills, score)}`;
      sub += `\n근원 격파 ${st.markerKills} · 파문 무상 통과 ${st.sweepCleanPasses}/${sweepTotal} · 관측 고정 ${st.zenoFreezes}`;
      sub += `\n공명 점수 ${score}`;
    }
    if (convergenceNow) sub += "\n표류 벡터 교점 수렴 — 서태평양 해구. 모든 소산이 한 곳으로 흐른다.";
    if (revelationNow) {
      s?.enemies.recallAll(); // 전 투영 동시 회수 — 결과 패널 뒤로 일제 소산(한 몸의 신호)
      sub = `${REVELATION_LINES}\n\n${sub}`;
    }
    this.showPanel(revelationNow ? "계시 / REVELATION" : title, sub, "다시 / RETRY");
  }

  /** 일시정지/사망 패널(맵 목록 숨김, 재접속 + 전장 선택 버튼) */
  private showPanel(title: string, subtitle: string, startLabel: string) {
    this.overlayTitle.textContent = title;
    this.overlayTitle.setAttribute("data-text", title);
    this.overlaySubtitle.style.whiteSpace = "pre-line"; // 결과 채점 다행 표시
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
      this.session.lens.setAspect(w / h);
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
