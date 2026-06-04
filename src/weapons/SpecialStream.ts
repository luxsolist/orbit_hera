import * as THREE from "three";
import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { Sfx } from "../core/Sfx";
import { DamageNumbers } from "../fx/damageNumbers";
import type { StreamSpec, SpecialWeapon } from "./WeaponSpec";
import { makeGlowTexture, BeamPool, fireEmitters, type BeamStyle } from "./beamFx";
import { DrainCycle } from "./DrainCycle";
import { parseHexColor } from "../core/math";
import { bestAlignedDir } from "./targeting";

// 오버드라이브 스트림(특수) — 발동 시 freq 게이지가 0 이 될 때까지 듀얼 발사관으로 전방 연속 사격.
// 발사관당 중주파 빔 수준 데미지(거리 falloff). 콘 살포(barrage)와 달리 정면 집중 화력.
// 상태기계는 DrainCycle, 발사 루프는 beamFx.fireEmitters 공유.

const TRIGGER_FLOOR = 5; // 발동 최소 freq

export class SpecialStream implements SpecialWeapon {
  private raycaster = new THREE.Raycaster();
  private beamPool: BeamPool;
  private damageNumbers: DamageNumbers;
  private glowTexture: THREE.Texture;
  private cycle: DrainCycle;
  private readonly assistCos: number;
  private readonly style: BeamStyle;

  onFired?: () => void;

  constructor(
    scene: THREE.Scene,
    private player: PlayerController,
    private enemies: EnemyManager,
    private spec: StreamSpec,
    private sfx?: Sfx
  ) {
    this.raycaster.far = spec.range;
    this.assistCos = Math.cos(THREE.MathUtils.degToRad(spec.assistConeDeg));
    this.style = { beamColor: parseHexColor(spec.colorBeam), glowColor: parseHexColor(spec.colorGlow), radius: 0.06, glowScale: 2.6 };
    this.damageNumbers = new DamageNumbers(scene);
    this.glowTexture = makeGlowTexture("rgba(150,255,255,0.85)", "rgba(80,220,255,0)");
    this.beamPool = new BeamPool(scene, this.glowTexture, spec.beamLifetime, 4);
    this.cycle = new DrainCycle({ cooldown: spec.cooldown, drainRate: spec.drainRate, fireInterval: spec.fireInterval, triggerFloor: TRIGGER_FLOOR });
  }

  get cooldownReady(): number {
    return this.cycle.cooldownReady;
  }
  get cooldownRemainingSec(): number {
    return this.cycle.cooldownRemainingSec;
  }
  get isActive(): boolean {
    return this.cycle.isActive;
  }

  reset(): void {
    this.cycle.reset();
    this.player.freqRegenSuppressed = false;
  }

  update(dt: number, triggerPressed: boolean): void {
    const r = this.cycle.step(dt, triggerPressed, this.player.freq);
    this.player.freqRegenSuppressed = r.active;
    if (r.drain) this.player.freq = Math.max(0, this.player.freq - r.drain);
    if (r.fire) this.fire();
    this.damageNumbers.update(dt);
    this.beamPool.update(dt);
  }

  /** 한 번의 사격 — 에임 어시스트 방향으로 듀얼 발사관 일제 사격(공유 fireEmitters). */
  private fire(): void {
    const cam = this.player.camera.position;
    const aim = this.player.getAimDirection().clone();
    const assist = bestAlignedDir(cam, aim, this.enemies.aliveWorldPositions, this.spec.range, this.assistCos);
    const dir = assist ? new THREE.Vector3(assist.x, assist.y, assist.z) : aim;
    fireEmitters(
      { raycaster: this.raycaster, enemies: this.enemies, damageNumbers: this.damageNumbers, beamPool: this.beamPool },
      {
        origin: cam,
        dir,
        muzzleOffsets: this.spec.muzzleOffsets,
        baseDamage: this.spec.damage,
        falloff: this.spec.falloff,
        range: this.spec.range,
        style: this.style,
      }
    );
    this.sfx?.overdrive(); // 볼리당 1회 — 묵직하되 짧은 연사 전용음
    this.onFired?.();
  }
}
