import * as THREE from "three";
import type { Vec3 } from "../core/math";
import { aimArrow, arrowOffset } from "./aimArrows";

const ARROW_RING_RADIUS = 26; // 조준선 둘레 화살표 반경(px) — 크로스헤어(34px) 바로 바깥
const ARROW_DEAD_CONE_TAN = Math.tan((9 * Math.PI) / 180); // 정면 중앙 9° 데드콘(이미 보이는 적은 숨김)
const ARROW_MAX = 16; // 화살표 동시 표시 상한(풀)
const DMG_RING_RADIUS = 88; // 피해 방향 인디케이터 반경(px) — 적 화살표보다 바깥, 크게
const DMG_WEDGE_LIFE = 0.7; // 피해 방향 인디케이터 수명(s)
const DMG_WEDGE_MAX = 6; // 동시 표시 상한(풀)
const SWEEP_PULSE_LIFE = 0.55; // 파문 통과 화면 펄스 수명(s)

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
  private reckoning!: HTMLDivElement; // 낙인/심판 파문 경고(동적 생성)
  private sweepPulse!: HTMLDivElement; // 파문 통과 전면 펄스(동적 생성)
  private sweepPulseTimer = 0;
  private sweepPulsePeak = 0;
  private dmgWedges: { el: HTMLDivElement; life: number }[] = []; // 피해 방향 인디케이터 풀
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

    // 낙인/심판 파문 경고(동적 생성) — 크로스헤어 아래 중앙. 표면 어휘만 사용(§8.2).
    this.reckoning = document.createElement("div");
    this.reckoning.className = "hud__reckoning";
    this.reckoning.style.cssText =
      "position:fixed;left:50%;top:60%;transform:translateX(-50%);display:none;" +
      "font:600 14px/1.4 monospace;letter-spacing:0.08em;text-align:center;pointer-events:none;z-index:5;" +
      "text-shadow:0 0 8px currentColor";
    this.root.appendChild(this.reckoning);

    // 적 방향 화살표 레이어 — 화면 중심(조준선)을 원점으로 하는 0 크기 컨테이너
    this.arrowLayer = document.createElement("div");
    this.arrowLayer.style.cssText =
      "position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:4";
    this.root.appendChild(this.arrowLayer);

    // 파문 통과 전면 펄스 — 가장자리에서 차오르는 붉은 워시(피해 비네팅과 별개의 이벤트 임팩트)
    this.sweepPulse = document.createElement("div");
    this.sweepPulse.className = "hud__sweeppulse";
    this.sweepPulse.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:3;opacity:0;" +
      "background:radial-gradient(ellipse at center, rgba(255,60,40,0) 35%, rgba(255,36,24,0.55) 100%)";
    this.root.appendChild(this.sweepPulse);
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

  /**
   * 낙인/심판 파문 상태 — 매 프레임 폴링 갱신.
   * @param sweepWarnLeft 파문 예고 잔여(s). 0=파면 통과 중, null=비표시
   * @param brands 현재 낙인 수(0=없음)
   */
  setReckoning(sweepWarnLeft: number | null, brands: number) {
    let msg = "";
    if (brands > 0) msg = `⚠ 낙인 ×${brands} — 근원을 격파하라`;
    if (sweepWarnLeft !== null) {
      const sweepMsg = sweepWarnLeft > 0 ? `심판 파문 도래 ${Math.ceil(sweepWarnLeft)}s` : "심판 파문 통과 중";
      msg = msg ? `${msg}\n${sweepMsg}` : sweepMsg;
    }
    if (!msg) {
      this.reckoning.style.display = "none";
      return;
    }
    // 낙인이 있으면 위협(적색), 파문 예고만이면 주의(주황)
    this.reckoning.style.color = brands > 0 ? "#ff453a" : "#ff9f0a";
    this.reckoning.style.whiteSpace = "pre";
    if (this.reckoning.textContent !== msg) this.reckoning.textContent = msg;
    this.reckoning.style.display = "block";
  }

  /** 심판 파문 통과 순간 화면 펄스 — strong(낙인 피해)이면 더 진하게. */
  pulseSweep(strong: boolean) {
    this.sweepPulsePeak = strong ? 1 : 0.45;
    this.sweepPulseTimer = SWEEP_PULSE_LIFE;
  }

  /**
   * 피해 방향 인디케이터 — 피해 발원 월드 좌표를 화면 각도로 투영해 조준선 둘레(적 화살표보다
   * 바깥)에 큰 붉은 쐐기를 잠깐 표시. "어디서 맞았는지"의 즉답.
   */
  flashDamageFrom(camera: THREE.Camera, source: Vec3) {
    camera.updateMatrixWorld();
    this._v.set(source.x, source.y, source.z);
    camera.worldToLocal(this._v);
    const { angle } = aimArrow(this._v.x, this._v.y, this._v.z, 0); // 데드콘 0 — 정면 피해도 표시
    const { x, y } = arrowOffset(angle, DMG_RING_RADIUS);
    // 풀 획득 — 여유 슬롯 또는 가장 오래된 쐐기 재사용
    let slot = this.dmgWedges.find((w) => w.life <= 0);
    if (!slot && this.dmgWedges.length < DMG_WEDGE_MAX) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;left:0;top:0;width:0;height:0;transform-origin:center;display:none;" +
        "border-left:11px solid transparent;border-right:11px solid transparent;" +
        "border-bottom:20px solid #ff2d20;filter:drop-shadow(0 0 6px #ff2d20);will-change:transform,opacity";
      this.arrowLayer.appendChild(el);
      slot = { el, life: 0 };
      this.dmgWedges.push(slot);
    }
    if (!slot) slot = this.dmgWedges.reduce((a, b) => (a.life < b.life ? a : b));
    slot.life = DMG_WEDGE_LIFE;
    slot.el.style.display = "block";
    slot.el.style.opacity = "1";
    slot.el.style.transform =
      `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${angle.toFixed(3)}rad)`;
  }

  /** 락온 상태를 크로스헤어에 반영. locked=true면 락온 링 표시, false면 해제. */
  setLockOn(locked: boolean): void {
    this.crosshair.classList.toggle("is-lockon", locked);
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
    // 파문 펄스 — 즉시 피크 후 수명 비례 페이드
    if (this.sweepPulseTimer > 0) {
      this.sweepPulseTimer -= dt;
      const t = Math.max(0, this.sweepPulseTimer / SWEEP_PULSE_LIFE);
      this.sweepPulse.style.opacity = String(this.sweepPulsePeak * t);
    }
    // 피해 방향 쐐기 페이드
    for (const w of this.dmgWedges) {
      if (w.life <= 0) continue;
      w.life -= dt;
      if (w.life <= 0) w.el.style.display = "none";
      else w.el.style.opacity = String(Math.min(1, w.life / (DMG_WEDGE_LIFE * 0.6)));
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
