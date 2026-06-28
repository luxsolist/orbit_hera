import * as THREE from "three";
import type { PlayerController } from "../player/PlayerController";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { CoreEnemy } from "../enemies/CoreEnemy";
import type { Sfx } from "../core/Sfx";
import { DamageNumbers } from "../fx/damageNumbers";
import type { BarrageSpec, SpecialWeapon } from "./WeaponSpec";
import { damageForDistance } from "./WeaponSpec";
import { makeGlowTexture, muzzleFrom, BeamPool, type BeamStyle } from "./beamFx";
import { DrainCycle } from "./DrainCycle";
import { parseHexColor } from "../core/math";
import { nearestInCone } from "./targeting";

const TRIGGER_FLOOR = 5; // 발동 최소 freq

// 전투 수치(타깃 수·사거리·쿨다운·살포·데미지·색)는 모두 BarrageSpec(JSON)에서 주입.

/**
 * 특수 무기 — 다중 빔 살포.
 * 우클릭 1회 발동 → 전방 콘 안의 적(최대 10) 에게 빔을 동시에 연속 살포.
 * 발동 후 freq 게이지가 0 이 될 때까지 자동 유지되고, 사용 종료(게이지 0) 후 spec.cooldown 만큼 쿨다운.
 * 자연 회복은 발동 동안 억제(PlayerController.freqRegenSuppressed).
 */
export class SpecialBarrage implements SpecialWeapon {
  private beamPool: BeamPool;
  private damageNumbers: DamageNumbers;
  private glowTexture: THREE.Texture;

  private cycle: DrainCycle; // 발동/소진/사용후쿨다운 상태기계(SpecialStream 과 공유)
  private readonly coneCos: number; // 전방 콘(스펙 각도 → cos)
  private readonly style: BeamStyle;

  /** HUD 발광 트리거(크로스헤어 플래시 재사용) */
  onFired?: () => void;

  constructor(
    scene: THREE.Scene,
    private player: PlayerController,
    private enemies: EnemyManager,
    private spec: BarrageSpec,
    private sfx?: Sfx
  ) {
    this.coneCos = Math.cos(THREE.MathUtils.degToRad(spec.coneDeg));
    this.style = { beamColor: parseHexColor(spec.colorBeam), glowColor: parseHexColor(spec.colorGlow), radius: 0.07, glowScale: 2.8 };
    this.damageNumbers = new DamageNumbers(scene);
    this.glowTexture = makeGlowTexture("rgba(255,210,140,0.85)", "rgba(255,170,72,0)");
    this.beamPool = new BeamPool(scene, this.glowTexture, spec.beamLifetime, 5);
    this.cycle = new DrainCycle({ cooldown: spec.cooldown, drainRate: spec.drainRate, fireInterval: spec.salvoInterval, triggerFloor: TRIGGER_FLOOR });
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

  /** 게임 재시작 시 호출 — 쿨다운/활성 상태 초기화. */
  reset() {
    this.cycle.reset();
    this.player.freqRegenSuppressed = false;
  }

  update(dt: number, triggerPressed: boolean) {
    const r = this.cycle.step(dt, triggerPressed, this.player.freq);
    this.player.freqRegenSuppressed = r.active;
    if (r.drain) this.player.freq = Math.max(0, this.player.freq - r.drain);
    if (r.fire) this.fireSalvo();
    this.damageNumbers.update(dt);
    this.beamPool.update(dt);
  }

  /** 한 번의 살포: 전방 콘 안의 가장 가까운 적 최대 N 명에 동시 빔 사격. */
  private fireSalvo() {
    const origin = this.player.camera.position;
    const aimDir = this.player.getAimDirection().clone();

    const targets = this.acquireTargets(origin, aimDir, this.spec.maxBeams);
    if (targets.length === 0) {
      // 대상 없으면 빔만 안 쏘고 소진은 계속(특수 발동은 유지)
      return;
    }

    const muzzle = muzzleFrom(origin, aimDir);
    const world = this.player.gameWorld;

    for (const t of targets) {
      // 콘 표적이 곧 적 — 셸 인스턴싱으로 개체별 메시가 없어 표적 위치로 직접 적용(레이캐스트 불요).
      const endPoint = origin.clone().addScaledVector(t.dir, t.dist);
      // 건물 시야 차폐 — 적과의 사이가 건물로 막히면 빔은 건물 표면에서 멈추고 피해 없음(관통 차단).
      const bt = world.segmentHitsBuilding(origin.x, origin.y, origin.z, endPoint.x, endPoint.y, endPoint.z);
      if (bt <= 1) {
        this.spawnBeamVisual(muzzle, origin.clone().addScaledVector(t.dir, t.dist * bt));
        continue;
      }
      const enemy = t.enemy;
      if (enemy.state === "alive") {
        const dmg = damageForDistance(t.dist, this.spec.salvoDamage, this.spec.falloff);
        this.damageNumbers.spawn(endPoint, dmg);
        if (enemy.applyFrequencyHit(dmg)) this.enemies.registerKill(enemy);
      }
      this.spawnBeamVisual(muzzle, endPoint);
    }

    this.sfx?.barrage(targets.length); // 동시 발사된 빔 수에 비례한 묵직한 일제사격음
    this.onFired?.();
  }

  /** 전방 콘 안의 살아있는 적을 거리 오름차순으로 max 개까지(적 참조 동봉). */
  private acquireTargets(
    origin: THREE.Vector3,
    aimDir: THREE.Vector3,
    max: number
  ): { enemy: CoreEnemy; dir: THREE.Vector3; dist: number }[] {
    // aliveWorldPositions 와 aliveEnemies 는 동일 순서 → nearestInCone 의 index 로 적 역참조 가능
    const list = this.enemies.aliveEnemies;
    return nearestInCone(origin, aimDir, this.enemies.aliveWorldPositions, this.spec.range, this.coneCos, max).map((t) => ({
      enemy: list[t.index],
      dir: new THREE.Vector3(t.dir.x, t.dir.y, t.dir.z),
      dist: t.dist,
    }));
  }

  private spawnBeamVisual(from: THREE.Vector3, to: THREE.Vector3) {
    this.beamPool.spawn(from, to, this.style);
  }
}
