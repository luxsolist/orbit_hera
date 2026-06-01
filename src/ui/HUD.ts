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

  constructor() {
    this.root = byId("hud");
    this.hpFill = byId("hpFill");
    this.freqFill = byId("freqFill");
    this.killCount = byId("killCount");
    this.waveCount = byId("waveCount");
    this.unitName = byId("unitName");
    this.crosshair = byId("crosshair");

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
