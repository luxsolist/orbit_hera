import { fetchDrone, fetchDroneCatalog } from "../player/drones";
import type { DroneCatalogEntry, DroneSpec } from "../player/DroneSpec";
import { fetchCatalog } from "../world/maps";
import type { MapCatalogEntry } from "../world/MapData";
import { buildWorldSvg, clusterDots, zoomToSplit, projectInBox, driftOverlaySvg, niceGridStep, estLabelPx, labelSide, FULL_VIEW, type ViewBox } from "./worldMapSvg";
import type { CampaignData } from "../core/progress";
import { chapterMeta, driftConvergence, pairedCity, revealed } from "../game/campaign";
import { bestiaryCards } from "../game/bestiary";
import { SHELL_GEOS } from "../enemies/CoreEnemy";
import { silhouetteSvg } from "./shapeSvg";
import { fetchPlasmoid } from "../enemies/plasmoids";
import { DEFAULT_PLASMOID } from "../enemies/PlasmoidSpec";

/** Game 이 주입하는 콜백 — 메뉴는 UI만 담당하고 출격/인트로 재생은 Game 이 처리. */
interface MenuCallbacks {
  /** 점 팝업에서 기체 선택 → 해당 전장+기체로 출격. peaceful=탐방 모드(적 미스폰). */
  onDeploy: (mapId: string, droneId: string, peaceful: boolean) => void;
  /** 스토리 목록의 인트로 항목 → 인트로 컷씬 재생 */
  onPlayIntro: () => void;
  /** 캠페인 상태(수사판) — 세계지도 오버레이·사건 파일 패널·팝업 도시 상태의 데이터 원천. */
  campaign: () => CampaignData;
  /** 드론 현재 레벨(§7.4 진행) — 출격 팝업 기체 카드에 표시. */
  droneLevel: (droneId: string) => number;
}

const EVIDENCE_LABELS: readonly { key: keyof CampaignData["evidence"]; label: string }[] = [
  { key: "heatmap", label: "열지도" },
  { key: "pulse", label: "박자" },
  { key: "drift", label: "방향" },
  { key: "immortal", label: "불멸성" },
];

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
  private storyHead: HTMLElement;
  private storyList: HTMLElement;
  private plasmoidSpecCache: import("../enemies/PlasmoidSpec").PlasmoidSpec | null = null; // 도감 로드 캐시
  private helpPopup: HTMLElement;
  private mapZoomBar: HTMLElement;
  private hintMoveMouse: HTMLElement;
  private hintMoveTouch: HTMLElement;

  private catalog: MapCatalogEntry[] = [];
  /**
   * 확대 이력 — 비어 있으면 전체 지도. 마지막 원소가 현재 뷰다.
   *
   * 팝업 확대창(clusterpop)을 대체한다. 확대창은 306×225 한 장에 군집 전원을 지리적으로 정확히
   * 배치해야 했는데, 그게 원리적으로 불가능했다(실측: 한일 5도시가 최근접 11px·양 끝이 0%/100% 에
   * 박혀 잘렸고, 100도시 확장 시 한 군집이 **25개**·최근접 2px). 지도 자체를 파고들면 한 화면에
   * 다 담을 이유가 사라진다 — 겹치면 한 단계 더 들어가면 되고, 각 단계는 군집을 반드시 쪼갠다.
   */
  private viewStack: ViewBox[] = [];
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
    this.storyHead = byId("storyHead");
    this.storyList = byId("storyList");
    this.helpPopup = byId("helpPopup");
    this.mapZoomBar = byId("mapZoomBar");
    this.hintMoveMouse = byId("hintMoveMouse");
    this.hintMoveTouch = byId("hintMoveTouch");
    this.selectedDroneId = new URLSearchParams(window.location.search).get("drone") || "walker";

    // 지도 점 클릭 → 단일 점=출격 팝업 / 군집=그 지역으로 **확대**. 배경 클릭 → 팝업 닫기.
    this.worldMap.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest("[data-map],[data-cluster]") as HTMLElement | null;
      if (el?.dataset.cluster) {
        this.storyPopup.hidden = true; this.helpPopup.hidden = true; this.zonePopup.hidden = true;
        this.zoomIntoCluster(el.dataset.cluster.split(","));
      } else if (el?.dataset.map) {
        this.storyPopup.hidden = true; this.helpPopup.hidden = true;
        this.openPopup(el.dataset.map);
      } else this.closeAllPopups();
    });
    // 확대 바 — 한 단계 축소 / 전체 보기.
    this.mapZoomBar.addEventListener("click", (e) => {
      const act = ((e.target as HTMLElement).closest("[data-zoom]") as HTMLElement | null)?.dataset.zoom;
      if (act === "out") this.zoomOut();
      else if (act === "reset") this.resetZoom();
    });
    // Esc — 팝업이 열려 있으면 팝업부터, 아니면 한 단계 축소. 확대 상태로 갇히지 않게.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || this.menuLayout.hidden) return;
      const anyPop = !this.zonePopup.hidden || !this.storyPopup.hidden || !this.helpPopup.hidden;
      if (anyPop) this.closeAllPopups();
      else if (this.viewStack.length) this.zoomOut();
    });
    byId("zonePopClose").addEventListener("click", () => (this.zonePopup.hidden = true));
    byId("storyBtn").addEventListener("click", () => {
      if (this.storyPopup.hidden) this.renderStoryList(); // 재오픈 시 항상 목록부터(도감 잔류 방지)
      this.toggleSidePop(this.storyPopup);
    });
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

  /**
   * 도시 상태(캠페인) → 점 상태 클래스 — 함락=회색 잔상, 침공=붉음. 캠페인 기록이 오늘의 랜덤
   * 로테이션보다 우선: 방어해 둔 도시가 로테이션 때문에 "침공 중"으로 표기되지 않게(수사판 신뢰).
   */
  private dotStateClass(id: string, camp: CampaignData): string {
    const st = camp.cities[id]?.state;
    if (st === "fallen") return "zone-dot--fallen";
    if (st === "defended") return "zone-dot--reg";
    if (st === "contested" || this.invadedIds.has(id)) return "zone-dot--invaded";
    return "zone-dot--reg";
  }

  /** 현재 뷰 박스 — 확대 이력의 마지막, 비었으면 전체 지도. */
  private get view(): ViewBox {
    return this.viewStack[this.viewStack.length - 1] ?? FULL_VIEW;
  }

  /**
   * 세계지도 렌더 — **현재 뷰 박스 기준**으로 지도·표류 오버레이·점을 모두 다시 그린다.
   * 가까운 점은 대표 점(군집)으로 묶이고(하나라도 침공이면 붉음), 군집 클릭은 그 지역으로 확대한다.
   *
   * 군집 임계값은 화면 백분율이라 **배율과 무관하게** 같은 시각 밀도를 유지한다 — 확대하면 도시들이
   * 화면에서 멀어지므로 군집이 자연히 풀린다. 이게 재귀 확대가 성립하는 근거다.
   */
  private renderWorldMap(): void {
    const camp = this.cb.campaign();
    const box = this.view;
    const rank = (cls: string) => (cls === "zone-dot--fallen" ? 2 : cls === "zone-dot--invaded" ? 1 : 0);
    const pts = this.catalog
      .filter((r) => r.lat != null && r.lon != null)
      .map((r) => ({ id: r.id, ...projectInBox(r.lat!, r.lon!, box), cls: this.dotStateClass(r.id, camp) }))
      // 뷰 밖은 버린다 — 안 버리면 확대 시 화면 밖 좌표(수천 %)의 버튼이 쌓이고, 군집 계산도 오염된다.
      // 여백을 조금 둬서 경계에 걸친 점이 갑자기 사라지지 않게 한다.
      .filter((p) => p.x >= -6 && p.x <= 106 && p.y >= -6 && p.y <= 106);
    // 확대 중에는 단일 점에 **이름을 붙인다**. 전체 지도에서는 붙이지 않는다 — 27~100개가 한 화면에
    // 있어 라벨끼리 뒤엉킨다. 반대로 확대하면 배경(110m 해안선)이 뭉개져 위치만으로는 식별이 안 되므로
    // 이름이 유일한 단서가 된다(실측 ×323 에서 오사카·교토·나라가 구분 불가였다).
    const mapPx = this.worldMap.clientWidth || 900;
    const showLabels = this.viewStack.length > 0;
    const dots = clusterDots(pts, 2.6)
      .map((c) => {
        // 대표 점 상태 = 멤버 중 최악(함락 > 침공 > 방어)
        const cls = c.members.reduce((a, m) => (rank(m.cls) > rank(a) ? m.cls : a), "zone-dot--reg");
        const pos = `left:${c.x.toFixed(2)}%;top:${c.y.toFixed(2)}%`;
        if (c.members.length === 1) {
          const id = c.members[0].id;
          let lbl = "";
          if (showLabels) {
            // 한글 표기만 — `"루앙프라방 · Luang Prabang"` 전체는 폭이 2배가 넘어 잘 넘친다.
            const nm = (this.catalog.find((r) => r.id === id)?.name ?? "").split(" · ")[0];
            if (nm) lbl = `<span class="zone-dot__lbl zone-dot__lbl--${labelSide(c.x, estLabelPx(nm), mapPx)}">${nm}</span>`;
          }
          return `<button type="button" class="zone-dot ${cls}" data-map="${id}" style="${pos}"><i></i>${lbl}</button>`;
        }
        // 대표 점(군집) — 클릭 시 그 지역으로 확대. 멤버 수 배지.
        const ids = c.members.map((m) => m.id).join(",");
        return `<button type="button" class="zone-dot zone-dot--cluster ${cls}" data-cluster="${ids}" style="${pos}"><i></i><b class="zone-dot__n">${c.members.length}</b></button>`;
      })
      .join("");
    // 확대할수록 대륙 윤곽이 두꺼워 보이므로 배율만큼 얇게, 그리드는 폭에 맞는 간격으로 다시 잡는다.
    const k = box.w / FULL_VIEW.w;
    const svg = buildWorldSvg(box, niceGridStep(box.w), 0.3 * k);
    // 표류 벡터 오버레이(§9.2-5) — 점 아래 깔리도록 세계지도 바로 뒤에 삽입.
    this.worldMap.innerHTML = svg + driftOverlaySvg(camp.driftVectors, driftConvergence(camp), box) + dots;
    this.renderZoomBar();
    this.renderCaseFile(camp);
  }

  /** 확대 바 — 확대 중일 때만 보인다(축소·전체 + 현재 배율). 좌하단 오버레이는 확대 중 숨긴다. */
  private renderZoomBar(): void {
    const depth = this.viewStack.length;
    // 확대하면 점이 지도 어디로든 갈 수 있어 좌하단 고정 오버레이(사건 파일·스토리 버튼)가 전장을
    // 가린다. 전체 지도에서는 점이 대륙 위에만 있어 겹치지 않으므로 그때만 보인다.
    this.menuLayout.classList.toggle("menu--zoomed", depth > 0);
    if (depth > 0) this.storyPopup.hidden = true; // 버튼이 사라지므로 열린 목록도 함께 닫는다
    if (!depth) { this.mapZoomBar.hidden = true; this.mapZoomBar.innerHTML = ""; return; }
    const zoom = FULL_VIEW.w / this.view.w;
    this.mapZoomBar.innerHTML =
      `<button type="button" class="mapzoom__btn" data-zoom="out">◀ 축소 / BACK</button>` +
      `<button type="button" class="mapzoom__btn" data-zoom="reset">전체 / WORLD</button>` +
      `<span class="mapzoom__lv">×${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}</span>`;
    this.mapZoomBar.hidden = false;
  }

  /**
   * 군집 클릭 → 그 지역으로 확대. **매번 군집이 쪼개지도록** 전진을 보장한다.
   *
   * 판정은 zoomToSplit 이 한다 — "박스가 줄었나"가 아니라 **"군집이 실제로 쪼개졌나"** 를 본다.
   * 자세한 근거는 그 함수 주석 참조(등간격 다수는 확대해도 상대 간격이 그대로라 안 쪼개진다).
   */
  private zoomIntoCluster(ids: string[]): void {
    const members = ids
      .map((id) => this.catalog.find((c) => c.id === id))
      .filter((m): m is MapCatalogEntry => !!m && m.lat != null && m.lon != null);
    if (members.length < 2) { if (members[0]) this.openPopup(members[0].id); return; }
    const aspect = (this.worldMap.clientWidth || 900) / (this.worldMap.clientHeight || 450);
    this.viewStack.push(zoomToSplit(members.map((m) => ({ lat: m.lat!, lon: m.lon! })), this.view, aspect));
    this.renderWorldMap();
  }

  /** 한 단계 축소. */
  private zoomOut(): void {
    if (!this.viewStack.length) return;
    this.viewStack.pop();
    this.zonePopup.hidden = true; // 팝업은 확대 좌표에 고정돼 있다 — 뷰가 바뀌면 자리가 틀어진다
    this.renderWorldMap();
  }

  /** 전체 지도로. */
  private resetZoom(): void {
    if (!this.viewStack.length) return;
    this.viewStack.length = 0;
    this.zonePopup.hidden = true;
    this.renderWorldMap();
  }

  /** 사건 파일 패널(전조 콘솔) — 현재 장·질문·수사 방향 + 증거 게이지 4종. */
  private renderCaseFile(camp: CampaignData): void {
    const panel = document.getElementById("caseFile");
    if (!panel) return;
    const ch = chapterMeta(camp);
    const gauges = EVIDENCE_LABELS.map(({ key, label }) => {
      const v = Math.round(camp.evidence[key]);
      const hot = ch.track === key ? " casefile__bar--hot" : "";
      return (
        `<div class="casefile__row"><span class="casefile__evlabel">${label}</span>` +
        `<span class="casefile__bar${hot}"><i style="width:${v}%"></i></span>` +
        `<span class="casefile__evval">${v}</span></div>`
      );
    }).join("");
    panel.innerHTML =
      `<div class="casefile__title">${ch.title}</div>` +
      `<div class="casefile__q">Q. ${ch.question}</div>` +
      `<div class="casefile__brief">${ch.brief}</div>` + gauges;
    panel.hidden = false;
  }

  /** 점 클릭 → 그 위치 위에 지역 정보 + 기체 선택(출격) 팝업. 기체 선택 시 즉시 출격. */
  private openPopup(id: string): void {
    const m = this.catalog.find((c) => c.id === id);
    if (!m || m.lat == null || m.lon == null) return;
    const { x, y } = projectInBox(m.lat, m.lon, this.view); // 확대 중이면 확대 좌표 — 점 위에 정확히 뜬다
    const mb = m.bytes ? (m.bytes / 1024 / 1024).toFixed(1) + "MB" : "";
    this.zonePopName.textContent = m.name;
    this.zonePopSub.textContent = m.subtitle;
    // 도시 상태(캠페인) + 자매쌍 — 수사판 정보를 출격 팝업에도.
    const camp = this.cb.campaign();
    const st = camp.cities[m.id]?.state;
    // 캠페인 기록 우선(점 상태와 동일 규칙) — 방어됨이 랜덤 로테이션에 덮이지 않게
    const stLabel = st === "fallen" ? " · ✖ 함락"
      : st === "defended" ? " · ✓ 방어됨"
      : st === "contested" || this.invadedIds.has(m.id) ? " · ⚠ 침공 중" : "";
    const pair = pairedCity(m.id);
    const pairName = pair ? this.catalog.find((c) => c.id === pair)?.name : null;
    const pairLabel = pairName ? ` · 얽힘쌍 ${pairName.split(" ·")[0]}` : "";
    this.zonePopMeta.textContent = `${m.buildings ?? "?"} buildings · ${mb}` + stLabel + pairLabel;
    this.zonePopDrones.innerHTML = "";
    for (const d of this.droneCatalog) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zonepop__drone";
      const lv = this.cb.droneLevel(d.id);
      btn.innerHTML =
        `<span class="zonepop__drone-name">${d.displayName}${lv > 1 ? ` · Lv ${lv}` : ""}</span>` +
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

  /** 스토리 목록 렌더(첫 항목 = 인트로 컷씬, 둘째 = 도감). 향후 항목 계속 추가 예정. */
  private renderStoryList(): void {
    this.storyHead.textContent = "스토리 / STORY";
    const items: { label: string; action: () => void; close?: boolean }[] = [
      { label: "▶ 인트로 / INTRO", action: () => this.cb.onPlayIntro() },
      { label: "▤ 도감 / CODEX", action: () => void this.renderBestiary(), close: false },
    ];
    this.storyList.innerHTML = "";
    for (const it of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidepop__item";
      btn.textContent = it.label;
      btn.addEventListener("click", () => {
        if (it.close ?? true) this.storyPopup.hidden = true;
        it.action();
      });
      this.storyList.appendChild(btn);
    }
  }

  /**
   * 도감(§8.3 명칭 갱신의 시각화) — 인식 Ⅰ 동안 아키타입별 카드, 계시(6장) 이후엔 "그것(투영체)"
   * 한 장으로 접힌 카드(도감 병합 연출 — bestiary__card--merged 가 살짝 확대·발광하며 등장).
   * 스토리 팝업 안(같은 패널)에서 목록을 교체해 보여주고, 뒤로가기로 스토리 목록에 복귀.
   */
  private async renderBestiary(): Promise<void> {
    this.storyHead.textContent = "도감 / CODEX";
    this.storyList.innerHTML = `<button type="button" class="sidepop__item bestiary__back">← 목록으로</button>`;
    this.storyList.querySelector(".bestiary__back")!.addEventListener("click", () => this.renderStoryList());
    if (!this.plasmoidSpecCache) {
      try { this.plasmoidSpecCache = await fetchPlasmoid("plasmoid"); }
      catch { this.plasmoidSpecCache = DEFAULT_PLASMOID; }
    }
    const camp = this.cb.campaign();
    const cards = bestiaryCards(this.plasmoidSpecCache, revealed(camp));
    for (const c of cards) {
      const el = document.createElement("div");
      el.className = c.merged ? "bestiary__card bestiary__card--merged" : "bestiary__card";
      // 삽화는 게임에서 쓰는 실루엣(SHELL_GEOS)을 그대로 투영한다 — 형태를 바꿔도 도감이 자동 추종.
      const icon = c.shape ? `<div class="bestiary__icon">${silhouetteSvg(SHELL_GEOS[c.shape])}</div>` : "";
      el.innerHTML = `${icon}<div class="bestiary__text">`
        + `<div class="bestiary__name">${c.name}</div><div class="bestiary__brief">${c.brief}</div></div>`;
      this.storyList.appendChild(el);
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
