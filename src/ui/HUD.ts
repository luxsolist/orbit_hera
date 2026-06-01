/**
 * 원격 접속 HUD 오버레이 제어.
 * DOM 요소를 직접 갱신(체력/주파수/처치/웨이브/크로스헤어/피격 플래시).
 */
export class HUD {
  private root: HTMLElement;
  private hpFill: HTMLElement;
  private freqFill: HTMLElement;
  private killCount: HTMLElement;
  private waveCount: HTMLElement;
  private unitName: HTMLElement;
  private crosshair: HTMLElement;
  private damage: HTMLElement;

  private fireFlashTimer = 0;
  private damageFlashTimer = 0;

  private specialEl: HTMLElement;
  private specialFill: SVGCircleElement;
  private specialLabel: HTMLElement;
  // SVG 원둘레(반경 15.6) — CSS dasharray 와 동일하게 유지
  private readonly specialCirc = 2 * Math.PI * 15.6;

  constructor() {
    this.root = byId("hud");
    this.hpFill = byId("hpFill");
    this.freqFill = byId("freqFill");
    this.killCount = byId("killCount");
    this.waveCount = byId("waveCount");
    this.unitName = byId("unitName");
    this.crosshair = byId("crosshair");
    this.specialEl = byId("specialIndicator");
    this.specialFill = byId("specialFill") as unknown as SVGCircleElement;
    this.specialLabel = byId("specialLabel");

    // 데미지 비네팅은 동적 생성
    this.damage = document.createElement("div");
    this.damage.className = "hud__damage";
    this.root.appendChild(this.damage);
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

  setUnitName(name: string) {
    this.unitName.textContent = name;
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
