import { fetchDrone, fetchDroneCatalog } from "../player/drones";
import type { DroneCatalogEntry, DroneSpec } from "../player/DroneSpec";
import { fetchCatalog } from "../world/maps";
import type { MapCatalogEntry } from "../world/MapData";
import { buildWorldSvg, projectLatLon } from "./worldMapSvg";

const WORLD_SVG = buildWorldSvg();

/** Game 이 주입하는 콜백 — 메뉴는 UI만 담당하고 출격/인트로 재생은 Game 이 처리. */
interface MenuCallbacks {
  /** 점 팝업에서 기체 선택 → 해당 전장+기체로 출격 */
  onDeploy: (mapId: string, droneId: string) => void;
  /** 스토리 목록의 인트로 항목 → 인트로 컷씬 재생 */
  onPlayIntro: () => void;
}

/**
 * 전장 선택 메뉴 UI — 세계지도(침공 점) + 점 클릭 팝업(지역 정보·기체 선택·출격) +
 * 스토리/도움말 사이드 팝업 + 조작 안내. 상태 전이·세션 빌드는 Game 이 담당.
 */
export class MenuScreen {
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
  private hintMoveMouse: HTMLElement;
  private hintMoveTouch: HTMLElement;

  private catalog: MapCatalogEntry[] = [];
  private invadedIds = new Set<string>(); // 침공 중(붉은 깜빡임) 지역 — 진입마다 랜덤 2개
  private droneCatalog: DroneCatalogEntry[] = [];
  private droneSpecs = new Map<string, DroneSpec>(); // 조작 안내/팝업용 로드 캐시
  private selectedDroneId: string;

  constructor(private cb: MenuCallbacks) {
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

    // 지도 점 클릭 → 지역 팝업, 배경 클릭 → 모든 팝업 닫기
    this.worldMap.addEventListener("click", (e) => {
      const dot = (e.target as HTMLElement).closest("[data-map]") as HTMLElement | null;
      if (dot?.dataset.map) {
        this.storyPopup.hidden = true;
        this.helpPopup.hidden = true;
        this.openPopup(dot.dataset.map);
      } else this.closeAllPopups();
    });
    byId("zonePopClose").addEventListener("click", () => (this.zonePopup.hidden = true));
    byId("storyBtn").addEventListener("click", () => this.toggleSidePop(this.storyPopup));
    byId("helpBtn").addEventListener("click", () => this.toggleSidePop(this.helpPopup));
    this.renderStoryList();
  }

  /** 메뉴 표시 — 드론/전장 목록 로드 + 침공 지역 랜덤 + 세계지도/안내 렌더. */
  async show(): Promise<void> {
    this.menuLayout.hidden = false;
    this.closeAllPopups();
    try {
      if (!this.droneCatalog.length) this.droneCatalog = await fetchDroneCatalog();
    } catch (e) {
      console.error("드론 목록 로드 실패", e);
    }
    void this.loadControls(this.selectedDroneId); // 기본 기체 조작 안내
    try {
      if (!this.catalog.length) this.catalog = await fetchCatalog();
      this.pickInvaded();
      this.renderWorldMap();
    } catch (e) {
      console.error("전장 목록 로드 실패", e);
    }
  }

  hide(): void {
    this.menuLayout.hidden = true;
    this.closeAllPopups();
  }

  closeAllPopups(): void {
    this.zonePopup.hidden = true;
    this.storyPopup.hidden = true;
    this.helpPopup.hidden = true;
  }

  /** 침공 중(붉은 깜빡임) 지역을 랜덤 2개 선택. 나머지 등록 지역은 흰색 점. */
  private pickInvaded(): void {
    const N = 2;
    const pool = [...this.catalog];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.invadedIds = new Set(pool.slice(0, Math.min(N, pool.length)).map((m) => m.id));
  }

  /** 세계지도에 등록 지역을 점으로(흰색=등록, 붉은 깜빡임=침공 중). 위경도 → equirectangular. */
  private renderWorldMap(): void {
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

  /** 점 클릭 → 그 위치 위에 지역 정보 + 기체 선택(출격) 팝업. 기체 선택 시 즉시 출격. */
  private openPopup(id: string): void {
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
        this.selectedDroneId = d.id;
        this.cb.onDeploy(m.id, d.id); // 이 전장+기체로 즉시 출격
      });
      this.zonePopDrones.appendChild(btn);
    }
    this.zonePopup.style.left = `${x.toFixed(2)}%`;
    this.zonePopup.style.top = `${y.toFixed(2)}%`;
    this.zonePopup.classList.toggle("zonepop--l", x > 72); // 우측 끝이면 살짝 왼쪽으로
    this.zonePopup.classList.toggle("zonepop--r", x < 28); // 좌측 끝이면 살짝 오른쪽으로
    this.zonePopup.hidden = false;
  }

  /** 사이드 팝업(스토리/도움말) 토글 — 다른 팝업은 닫음. */
  private toggleSidePop(pop: HTMLElement): void {
    const show = pop.hidden;
    this.closeAllPopups();
    pop.hidden = !show;
  }

  /** 스토리 목록 렌더(첫 항목 = 인트로 컷씬). 향후 항목 계속 추가 예정. */
  private renderStoryList(): void {
    const items: { label: string; action: () => void }[] = [
      { label: "▶ 인트로 / INTRO", action: () => this.cb.onPlayIntro() },
    ];
    this.storyList.innerHTML = "";
    for (const it of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidepop__item";
      btn.textContent = it.label;
      btn.addEventListener("click", () => {
        this.storyPopup.hidden = true;
        it.action();
      });
      this.storyList.appendChild(btn);
    }
  }

  /** 기본 기체 스펙 로드(캐시) → 조작 안내(키 설명) 갱신. */
  private async loadControls(id: string): Promise<void> {
    try {
      let spec = this.droneSpecs.get(id);
      if (!spec) {
        spec = await fetchDrone(id);
        this.droneSpecs.set(id, spec);
      }
      this.renderControls(spec);
    } catch {
      /* 무시 — 안내 기본값 유지 */
    }
  }

  /** 드론 스펙(actions)의 키 설명으로 조작 안내를 갱신. */
  private renderControls(spec: DroneSpec): void {
    const keyDisp = (k: string) => (k === "Space" ? "SPACE" : k.replace(/(Left|Right)$/, "").toUpperCase());
    const acts = spec.actions;
    this.hintMoveMouse.innerHTML =
      "<b>WASD</b> 이동 · " + acts.map((a) => `<b>${keyDisp(a.key)}</b> ${a.desc}`).join(" · ");
    this.hintMoveTouch.innerHTML = acts.map((a) => `<b>${a.label}</b> ${a.desc}`).join(" · ");
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}
