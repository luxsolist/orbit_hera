# 04 · 무기 (빔 · 살포 · 조준 · 사운드)

소스: [FrequencyBeam.ts](../../src/weapons/FrequencyBeam.ts),
[SpecialBarrage.ts](../../src/weapons/SpecialBarrage.ts), [SpecialStream.ts](../../src/weapons/SpecialStream.ts),
[DrainCycle.ts](../../src/weapons/DrainCycle.ts), [targeting.ts](../../src/weapons/targeting.ts),
[WeaponSpec.ts](../../src/weapons/WeaponSpec.ts), [beamFx.ts](../../src/weapons/beamFx.ts),
[Sfx.ts](../../src/core/Sfx.ts)

전투 수치는 전부 `BeamSpec`/`BarrageSpec`/`StreamSpec`(JSON)에서 주입된다(값은
[spec/02](../spec/02-drones-weapons.md)). 코드는 메커니즘만 담는다. 특수무기는 공통 `SpecialWeapon`
인터페이스(`update`/`reset`/`cooldownReady`/`cooldownRemainingSec`/`isActive`)로 구동된다.

## FrequencyBeam — 주파수 빔 (히트스캔)

매 프레임 `update(dt, firing)` — 오토와 수동이 **독립 쿨다운**이라 같은 프레임에 둘 다 발사 가능:
1. 두 쿨다운(`cooldown`=수동, `autoCooldown`=오토) 감쇠.
2. **오토파이어** — `autoCooldown ≤ 0`이면 `acquireAutoFireTarget`로 `auto.range` 안 **360° 최근접 적**
   (`nearestInCone`에 콘 cos −1, max 1) 방향을 잡아 저비용 연사. 정면을 안 봐도 추격자를 소프트락.
   `auto.range`(light 100 m / heavy 32 m) 안의 적을 자동 처치. 값은 [spec/02](../spec/02-drones-weapons.md).
   **모바일 보정**: 터치 조준 난도를 감안해 `Game`이 `withAutoBoost(spec, 2)`로 기본 빔의 `auto.range`·`manual.assistConeDeg`를 추가 ×2 한 **복제 스펙**을 주입(`mobile.enabled`이면 워커 32→64 m·플라이어 100→200 m; 캐시 원본 불변). ([tests/WeaponSpec.test.ts](../../tests/WeaponSpec.test.ts))
3. `firing`이고 `cooldown ≤ 0`이면 **수동 사격**(`fireManual`) — `acquireAssistTarget`(어시스트 콘
   `manual.assistConeDeg`, `bestAlignedDir`)로 가장 정렬된 적으로 조준 보정 후 풀데미지.
4. `fireAt(dir, cost, baseDamage, manual)` — 주파수 차감(볼리당 1회) → `sfx.beam(manual)` →
   공유 `fireEmitters`로 발사(명중은 **시점 중앙 단일 레이** 1회, 데미지는 발사관 수만큼 합산, 빔 시각만
   발사관 좌우에서 적중점으로 수렴) + `onHit`으로 임팩트/스파크 FX(기본 빔만).

명중 레이캐스트는 **셸 InstancedMesh 1개**(`enemies.hitMeshes`)에 쏘고, 적중의 `instanceId`를 `enemies.enemyFromHit(hit)`로 적에 역참조한다(개체별 메시 태그 폐지). 조준은 `enemies.aliveWorldPositions`(적 월드 좌표)를 모아 순수 targeting 함수에 위임(아래). 색은
`parseHexColor`(core/math)로 파싱. `muzzleOffsets` 없으면 단발(`[0]`), `[-x,x]`면 듀얼 발사관. 듀얼이라도 명중 판정은 **카메라 중앙
단일 레이** 1회뿐이고 데미지만 발사관 수배(듀얼=2×) — 과거 좌우 평행 듀얼빔(`[-0.55, 0.55]`) 사이로
작거나 쪼그라든 적이 빠져 무피해("좀비")로 남던 버그를 막는다. walker=heavy(단발), flyer=light(듀얼).

## SpecialBarrage — 다중 빔 살포 (특수)

`update(dt, triggerPressed)` — 상태는 공유 `DrainCycle`(아래)에 위임:
- `cycle.step`이 발동/소진/사용후쿨다운을 판정하고 `{fire, drain, active}`를 반환.
- 반환값으로 `freqRegenSuppressed` 설정·`drain`만큼 주파수 차감·`fire`면 `fireSalvo()` 실행.
- `fireSalvo` — 전방 콘 안 가장 가까운 적 최대 `maxBeams`기에 빔 + 데미지. 셸 인스턴싱으로 개체별 메시가 없어
  **레이캐스트 없이** `nearestInCone` 표적(`enemies.aliveEnemies[index]`)에 직접 적용(빔 끝점=표적 위치). `sfx.barrage(빔 수)`로 일제사격음.

## SpecialStream — 오버드라이브 스트림 (특수)

flyer 특수. 발동 시 게이지가 0이 될 때까지 **듀얼 발사관**으로 전방 집중 연속 사격(콘 살포와 달리 정면 화력).
- 상태기계는 SpecialBarrage와 동일하게 공유 `DrainCycle`.
- `fire` 프레임마다 `bestAlignedDir`(어시스트 콘)로 조준 → FrequencyBeam과 동일한 공유 `fireEmitters`로
  듀얼 발사관 일제 사격(데미지 `damage`×발사관 수, 거리 falloff). `sfx.overdrive()`(볼리당 1회) — 묵직하되
  짧은 연사 전용음.

## 콘 조준 통합 (targeting — 순수)

과거 3곳(`acquireAssistTarget`·`acquireAutoFireTarget`·`acquireTargets`)에 복제됐던 로직을 단일
모듈로 통합. THREE 비의존(`{x,y,z}`) → 단위 테스트 가능
([tests/targeting.test.ts](../../tests/targeting.test.ts)).

| 함수 | 용도 |
| :--- | :--- |
| `coneTargets(origin, aimDir, positions, range, coneCos)` | 공통 코어 — 콘+사거리 후보 수집(등 뒤/사거리 밖/콘 밖 제외) |
| `bestAlignedDir(...)` | 가장 정렬된 단일 타깃 방향(에임 어시스트·오버드라이브) |
| `nearestInCone(..., max)` | 거리순 N개(살포·오토파이어는 콘 cos −1로 360°) |

무기 클래스는 `enemies.aliveWorldPositions`만 넘기고 결과를 THREE.Vector3로 변환해 쓴다.

## 게이지 소진 상태기계 (DrainCycle — 순수)

특수무기 두 종(SpecialBarrage·SpecialStream)이 공유하는 발동/소진/사용후쿨다운 상태기계. THREE/DOM
비의존 → 단위 테스트 가능. `step(dt, trigger, freq)` → `{fire, drain, active}`:
- 발동 조건: `trigger` + 비활성 + 쿨다운 완료 + `freq > triggerFloor`. 즉시 첫 발사.
- 활성 중 `drainRate`로 소진, `fireInterval`마다 `fire`. **게이지가 0이 되는 프레임에 종료하고 그때부터**
  `cooldown` 시작(발동 시점이 아니라 사용 종료 후 쿨다운). `cooldownReadyFrac`로 HUD 진행률 산출.

## 데미지 모델 (WeaponSpec)

```
damageForDistance(dist, base, falloff) = base × clamp(refDist / dist, minMult, maxMult)
cooldownReadyFrac(cooldown, max) = clamp(1 − cooldown / max, 0, 1)   // HUD 링 진행률
```
근접일수록 가중↑, 원거리 하한 클램프. 가드: [tests/WeaponSpec.test.ts](../../tests/WeaponSpec.test.ts).

## 비주얼 공통 (beamFx)

- `makeGlowTexture(mid, outer)` — 방사형 글로우 텍스처. `spawnBeam(scene, glowTex, from, to, {...})` —
  빔 실린더 + 글로우 스프라이트 생성. `BeamPool`이 이를 풀링해 매 프레임 페이드아웃·정리.
- `muzzleFrom`/`beamEnd`/`sideVector` — 머즐 위치·적중 끝점·측면 단위벡터 헬퍼.
- `fireEmitters(ctx, shot)` — **공유 발사관 일제 사격**: 명중 판정은 **시점(카메라) 중앙 단일 레이** 1회
  (평행 듀얼빔 사이로 작은/쪼그라든 적이 빠지는 명중 누락 방지) → 거리감쇠 데미지를 발사관 수만큼 합산
  (듀얼=2×)·데미지숫자·처치집계 + `onHit`(임팩트 등) → 빔 시각만 발사관(`muzzleOffsets`)마다 좌우 오프셋
  에서 적중점으로 수렴. FrequencyBeam·SpecialStream이 공유한다.

## 절차적 사운드 (Sfx — Web Audio)

오실레이터 + 바이쿼드 필터 + 게인 엔벨로프 + 컴프레서로 발사음을 **합성**(에셋 없음). 공통 포격 코어
`shot({f0, sweepFrom, sweepTime, dur, peak, crackGain, ringGain, subGain})` — 시즈탱크(탱크모드)식 묵직한
포성: 하강 스윕 톱니 + 추종 로우패스("뚜움") + 저역 thump·서브 옥타브 + 비조화 금속 링 2부분음 + 밴드패스
노이즈 크랙. 발사음 3종이 모두 이 코어를 같은 형태로 호출하고 파라미터만 달리한다(과거 노이즈 "블라스터"
코어 제거).
- `beam()` — 기본 무기(주파수 빔, 모든 드론 공통) 발사음. 공유 상수 `BEAM_BASE`(=`barrage` 단발 기준:
  `f0 52`, `dur 0.4`, `subGain 1.8` …)에 f0 지터만 얹어 호출 → 기본 사격음 = walker 특수(barrage)의 단발
  캐논음(둘이 손으로 따로 적히면 드리프트하므로 단일 출처). 수동/자동 발사음 동일.
- `barrage(beamCount)` — walker 특수. 같은 `BEAM_BASE` + `shot()` 코어를 살포 빔 수에 비례해 더 낮고·두껍고·길게
  (`beamCount` 1→10 포화 시 `f0 52→~41.6`, `subGain 1.8→2.4`, `dur·peak` 증가).
- `overdrive()` — flyer 특수(스트림)의 연사음. 기본 빔보다 **더 낮지만**(`f0 46`, `subGain 1.9`) **짧게**
  (`dur 0.14`, 금속 링 최소) → 0.09s 간격 연사에 포성 꼬리가 누적돼 뭉개지지 않는 타이트한 저음. SpecialStream이 호출.
- `sizzle()` — 플라즈모이드 접촉 피해음("달군 철판에 물" 기화음): 저역 퀜치 바디 + 증기 히스(밴드패스 하강
  스윕) + 케틀 휘슬 힌트. `Game.onPlayerHit`에서 재생.
- 깊이 순서: 기본 빔(`f0 52`) ≈ walker 특수 단발 기준 < `overdrive`(`46`, 더 깊되 짧음) < 10타깃 `barrage`(`~41.6`).
- 첫 사용자 제스처(전장 클릭) 안에서 `resume()`로 오디오 컨텍스트 활성(브라우저 정책).
