import { fetchDrone, fetchDroneCatalog } from "../player/drones";
import type { DroneCatalogEntry, DroneSpec } from "../player/DroneSpec";
import { fetchCatalog } from "../world/maps";
import type { MapCatalogEntry } from "../world/MapData";
import { buildWorldSvg, projectLatLon, clusterDots, zoomMapBox, projectInBox } from "./worldMapSvg";

const WORLD_SVG = buildWorldSvg();

/** Game 이 주입하는 콜백 — 메뉴는 UI만 담당하고 출격/인트로 재생은 Game 이 처리. */
interface MenuCallbacks {
  /** 점 팝업에서 기체 선택 → 해당 전장+기체로 출격. peaceful=탐방 모드(적 미스폰). */
  onDeploy: (mapId: string, droneId: string, peaceful: boolean) => void;
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
  private zonePopPeace: HTMLInputElement;
  private zonePopDrones: HTMLElement;
  private storyPopup: HTMLElement;
  private storyList: HTMLElement;
  private helpPopup: HTMLElement;
  private clusterPopup: HTMLElement;
  private clusterMap: HTMLElement;
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
    this.zonePopPeace = byId("zonePopPeace") as HTMLInputElement;
    this.zonePopDrones = byId("zonePopDrones");
    this.storyPopup = byId("storyPopup");
    this.storyList = byId("storyList");
    this.helpPopup = byId("helpPopup");
    this.clusterPopup = byId("clusterPopup");
    this.clusterMap = byId("clusterMap");
    this.hintMoveMouse = byId("hintMoveMouse");
    this.hintMoveTouch = byId("hintMoveTouch");
    this.selectedDroneId = new URLSearchParams(window.location.search).get("drone") || "walker";

    // 지도 점 클릭 → 단일 점=지역 팝업 / 클러스터=확대창. 배경 클릭 → 모든 팝업 닫기.
    this.worldMap.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest("[data-map],[data-cluster]") as HTMLElement | null;
      if (el?.dataset.cluster) {
        this.storyPopup.hidden = true; this.helpPopup.hidden = true;
        this.openClusterZoom(el.dataset.cluster.split(","), parseFloat(el.style.left), parseFloat(el.style.top));
      } else if (el?.dataset.map) {
        this.storyPopup.hidden = true; this.helpPopup.hidden = true;
        this.clusterPopup.hidden = true;
        this.openPopup(el.dataset.map);
      } else this.closeAllPopups();
    });
    // 확대창 안의 세부 점 클릭 → 기존 출격 팝업(확대창은 닫지 않고 유지).
    this.clusterMap.addEventListener("click", (e) => {
      const dot = (e.target as HTMLElement).closest("[data-map]") as HTMLElement | null;
      if (dot?.dataset.map) this.openPopup(dot.dataset.map);
    });
    byId("clusterPopClose").addEventListener("click", () => (this.clusterPopup.hidden = true));
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
    this.clusterPopup.hidden = true;
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

  /** 세계지도에 등록 지역을 점으로. 가까운 점은 **대표 점(클러스터)** 으로 묶고(하나라도 침공이면 붉음), 단일은 그대로. */
  private renderWorldMap(): void {
    const pts = this.catalog
      .filter((r) => r.lat != null && r.lon != null)
      .map((r) => ({ id: r.id, ...projectLatLon(r.lat!, r.lon!), invaded: this.invadedIds.has(r.id) }));
    const dots = clusterDots(pts, 2.6)
      .map((c) => {
        const invaded = c.members.some((m) => m.invaded);
        const cls = invaded ? "zone-dot--invaded" : "zone-dot--reg";
        const pos = `left:${c.x.toFixed(2)}%;top:${c.y.toFixed(2)}%`;
        if (c.members.length === 1) {
          return `<button type="button" class="zone-dot ${cls}" data-map="${c.members[0].id}" style="${pos}"><i></i></button>`;
        }
        // 대표 점(클러스터) — 클릭 시 확대창. 멤버 수 배지.
        const ids = c.members.map((m) => m.id).join(",");
        return `<button type="button" class="zone-dot zone-dot--cluster ${cls}" data-cluster="${ids}" style="${pos}"><i></i><b class="zone-dot__n">${c.members.length}</b></button>`;
      })
      .join("");
    this.worldMap.innerHTML = WORLD_SVG + dots;
  }

  /**
   * 클러스터(대표 점) 클릭 → 그 지역을 **확대한 지도 위에** 세부 점들을 **정확한 위치**로 표시. 세부 점 클릭은 출격 팝업.
   * 확대 지도(viewBox 크롭)·점 배치는 worldMapSvg 공통 로직(zoomMapBox/projectInBox/buildWorldSvg) — 모든 확대창이 공유.
   */
  private openClusterZoom(ids: string[], anchorX: number, anchorY: number): void {
    const members = ids.map((id) => this.catalog.find((c) => c.id === id)).filter((m): m is MapCatalogEntry => !!m && m.lat != null && m.lon != null);
    if (members.length < 2) { if (members[0]) this.openPopup(members[0].id); return; }
    // 확대창을 대표 점 근처에 띄우고(좌우 보정), 레이아웃된 박스 종횡비로 확대 지도 생성.
    this.clusterPopup.style.left = `${Math.min(72, Math.max(2, anchorX)).toFixed(1)}%`;
    this.clusterPopup.style.top = `${Math.min(60, Math.max(4, anchorY + 4)).toFixed(1)}%`;
    this.clusterPopup.hidden = false;
    const zw = this.clusterMap.clientWidth || 300, zh = this.clusterMap.clientHeight || 220;
    const box = zoomMapBox(members.map((m) => ({ lat: m.lat!, lon: m.lon! })), zw / zh);
    // 해안선 두께 = 기본 세계지도 해안선 픽셀의 2배(렌더 크기·확대율 보정). 그리드는 생략(step 0).
    const baseStrokePx = 0.3 * ((this.worldMap.clientWidth || 860) / 360);
    const svg = buildWorldSvg(box, 0, (2 * baseStrokePx * box.w) / zw);
    const dots = members
      .map((m) => {
        const { x, y } = projectInBox(m.lat!, m.lon!, box); // 지도상 정확한 위치
        const cls = this.invadedIds.has(m.id) ? "zone-dot--invaded" : "zone-dot--reg";
        const lblCls = x > 55 ? "zone-dot__lbl zone-dot__lbl--l" : "zone-dot__lbl"; // 오른쪽 점은 라벨 왼쪽(창 밖 넘침 방지)
        return `<button type="button" class="zone-dot ${cls}" data-map="${m.id}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%"><i></i><span class="${lblCls}">${m.name}</span></button>`;
      })
      .join("");
    this.clusterMap.innerHTML = svg + dots;
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
        this.cb.onDeploy(m.id, d.id, this.zonePopPeace.checked); // 이 전장+기체로 즉시 출격(탐방 토글 반영)
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
