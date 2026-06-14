import * as THREE from "three";
import type { Vec3 } from "../core/math";
import { aimArrow, arrowOffset } from "./aimArrows";

const ARROW_RING_RADIUS = 26; // 조준선 둘레 화살표 반경(px) — 크로스헤어(34px) 바로 바깥
const ARROW_DEAD_CONE_TAN = Math.tan((9 * Math.PI) / 180); // 정면 중앙 9° 데드콘(이미 보이는 적은 숨김)
const ARROW_MAX = 16; // 화살표 동시 표시 상한(풀)

/**
 * 원격 접속 HUD 오버레이 제어.
 * DOM 요소를 직접 갱신(체력/주파수/처치/웨이브/크로스헤어/피격 플래시 + 적 방향 화살표).
 */
export class HUD {
  private root: HTMLElement;
  private hpFill: HTMLElement;
  private freqFill: HTMLElement;
  private killCount: HTMLElement;
  private waveCount: HTMLElement;
  private destroyedCount: HTMLElement;
  private landmarkLostCount: HTMLElement;
  private unitName: HTMLElement;
  private crosshair: HTMLElement;
  private damage: HTMLElement;

  private arrowLayer: HTMLDivElement; // 조준선 중심에 위치한 화살표 컨테이너(0 크기 원점)
  private arrows: HTMLDivElement[] = [];
  private _v = new THREE.Vector3();

  private fireFlashTimer = 0;
  private damageFlashTimer = 0;

  private specialEl: HTMLElement;
  private specialFill: SVGCircleElement;
  private specialLabel: HTMLElement;
  // SVG 원둘레(반경 15.6) — CSS dasharray 와 동일하게 유지
  private readonly specialCirc = 2 * Math.PI * 15.6;

  // 미션 배너(상단 중앙) — 인스턴스 미션 목표/타이머/리스폰
  private missionBar: HTMLElement;
  private missionObjective: HTMLElement;
  private missionTime: HTMLElement;
  private missionDetail: HTMLElement;
  private missionResp: HTMLElement;

  constructor() {
    this.root = byId("hud");
    this.hpFill = byId("hpFill");
    this.freqFill = byId("freqFill");
    this.killCount = byId("killCount");
    this.waveCount = byId("waveCount");
    this.destroyedCount = byId("destroyedCount");
    this.landmarkLostCount = byId("landmarkLostCount");
    this.unitName = byId("unitName");
    this.crosshair = byId("crosshair");
    this.specialEl = byId("specialIndicator");
    this.specialFill = byId("specialFill") as unknown as SVGCircleElement;
    this.specialLabel = byId("specialLabel");
    this.missionBar = byId("missionBar");
    this.missionObjective = byId("missionObjective");
    this.missionTime = byId("missionTime");
    this.missionDetail = byId("missionDetail");
    this.missionResp = byId("missionResp");

    // 데미지 비네팅은 동적 생성
    this.damage = document.createElement("div");
    this.damage.className = "hud__damage";
    this.root.appendChild(this.damage);

    // 적 방향 화살표 레이어 — 화면 중심(조준선)을 원점으로 하는 0 크기 컨테이너
    this.arrowLayer = document.createElement("div");
    this.arrowLayer.style.cssText =
      "position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:4";
    this.root.appendChild(this.arrowLayer);
  }

  setActive(active: boolean) {
    this.root.classList.toggle("is-active", active);
  }

  setHp(hp: number, max: number) {
    this.hpFill.style.width = `${Math.max(0, (hp / max) * 100)}%`;
  }

  setFrequency(freq: number, max: number) {
    this.freqFill.style.width = `${Math.max(0, (freq / max) * 100)}%`;
  }

  setKills(n: number) {
    this.killCount.textContent = String(n);
  }

  setWave(n: number) {
    this.waveCount.textContent = String(n);
  }

  /** 파괴된 건물 수 / 랜드마크 수 갱신. */
  setDestroyed(buildings: number, landmarks: number) {
    this.destroyedCount.textContent = String(buildings);
    this.landmarkLostCount.textContent = String(landmarks);
  }

  setUnitName(name: string) {
    this.unitName.textContent = name;
  }

  /** 미션 목표 배너 설정. visible=false(탐방)면 배너 숨김. */
  setMission(objective: string, visible: boolean) {
    this.missionObjective.textContent = objective;
    this.missionBar.style.display = visible ? "" : "none";
  }

  /** 미션 실시간 상태 갱신 — 잔여 시간(m:ss)·진행 상세·잔여 리스폰. 30초 이하 시간은 경고색. */
  updateMission(timeLeftSec: number, detail: string, respawnsLeft: number) {
    this.missionTime.textContent = timeLeftSec === Infinity ? "∞" : fmtTime(timeLeftSec);
    this.missionTime.classList.toggle("is-urgent", timeLeftSec !== Infinity && timeLeftSec <= 30);
    this.missionDetail.textContent = detail;
    this.missionResp.textContent = respawnsLeft === Infinity ? "⟳ ∞" : `⟳ ${respawnsLeft}`;
  }

  /**
   * 특수 무기 상태 갱신.
   * @param ready 0~1 진행률(1=즉시 발동 가능)
   * @param active 발동 중 여부
   * @param remainingSec 쿨다운 남은 초(없으면 -1)
   */
  setSpecial(ready: number, active: boolean, remainingSec: number) {
    const r = Math.max(0, Math.min(1, ready));
    // dashoffset = circumference * (1 - progress)
    this.specialFill.style.strokeDashoffset = String(this.specialCirc * (1 - r));
    this.specialEl.classList.toggle("is-ready", r >= 1 && !active);
    this.specialEl.classList.toggle("is-active", active);
    this.specialEl.classList.toggle("is-cooling", !active && r < 1);
    if (active) this.specialLabel.textContent = "FIRE";
    else if (r >= 1) this.specialLabel.textContent = "RMB";
    else this.specialLabel.textContent = String(Math.ceil(remainingSec));
  }

  /**
   * 조준선 둘레에 적(플라즈모이드) 방향 붉은 화살표 배치 — 적 수만큼. 비행 중 적 위치 식별용.
   * 정면 중앙(이미 보이는 적)은 데드콘으로 생략. 후방 포함 전 방향 표시.
   */
  setEnemyDirections(camera: THREE.Camera, positions: readonly Vec3[]) {
    camera.updateMatrixWorld();
    let n = 0;
    for (const p of positions) {
      if (n >= ARROW_MAX) break;
      this._v.set(p.x, p.y, p.z);
      camera.worldToLocal(this._v); // 카메라 로컬(오른쪽 +x, 위 +y, 정면 -z)
      const { angle, hidden } = aimArrow(this._v.x, this._v.y, this._v.z, ARROW_DEAD_CONE_TAN);
      if (hidden) continue;
      const { x, y } = arrowOffset(angle, ARROW_RING_RADIUS);
      const el = this.acquireArrow(n++);
      el.style.display = "block";
      el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${angle.toFixed(3)}rad)`;
    }
    for (let i = n; i < this.arrows.length; i++) this.arrows[i].style.display = "none";
  }

  /** 적 방향 화살표 전부 숨김(사망/일시정지 — 잔상 방지). */
  clearEnemyDirections() {
    for (const a of this.arrows) a.style.display = "none";
  }

  private acquireArrow(i: number): HTMLDivElement {
    let el = this.arrows[i];
    if (!el) {
      el = document.createElement("div");
      // CSS 삼각형(위 방향) — rotate 로 적 방향을 가리킴. 붉은색 + 글로우.
      el.style.cssText =
        "position:absolute;left:0;top:0;width:0;height:0;transform-origin:center;" +
        "border-left:4px solid transparent;border-right:4px solid transparent;" +
        "border-bottom:7px solid #ff3b30;filter:drop-shadow(0 0 2px #ff3b30);will-change:transform";
      this.arrowLayer.appendChild(el);
      this.arrows[i] = el;
    }
    return el;
  }

  flashFire() {
    this.crosshair.classList.add("is-firing");
    this.fireFlashTimer = 0.06;
  }

  flashDamage() {
    this.damage.classList.add("is-hit");
    this.damageFlashTimer = 0.12;
  }

  update(dt: number) {
    if (this.fireFlashTimer > 0) {
      this.fireFlashTimer -= dt;
      if (this.fireFlashTimer <= 0) this.crosshair.classList.remove("is-firing");
    }
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= dt;
      if (this.damageFlashTimer <= 0) this.damage.classList.remove("is-hit");
    }
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`HUD element #${id} not found`);
  return el;
}

/** 초 → m:ss(올림). */
function fmtTime(sec: number): string {
  const t = Math.max(0, Math.ceil(sec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
