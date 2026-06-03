# 04 · 무기 (빔 · 살포 · 조준 · 사운드)

소스: [FrequencyBeam.ts](../../src/weapons/FrequencyBeam.ts),
[SpecialBarrage.ts](../../src/weapons/SpecialBarrage.ts), [targeting.ts](../../src/weapons/targeting.ts),
[WeaponSpec.ts](../../src/weapons/WeaponSpec.ts), [beamFx.ts](../../src/weapons/beamFx.ts),
[Sfx.ts](../../src/core/Sfx.ts)

전투 수치는 전부 `BeamSpec`/`BarrageSpec`(JSON)에서 주입된다(값은 [spec/02](../spec/02-drones-weapons.md)).
코드는 메커니즘만 담는다.

## FrequencyBeam — 주파수 빔 (히트스캔)

매 프레임 `update(dt, fireHeld)`:
1. 쿨다운 감쇠.
2. **자동발사 우선** — `acquireAutoFireTarget`(콘 `auto.coneDeg` + `auto.range`)로 적이 있으면
   저비용 연사(자동 조준).
3. 없고 `fireHeld`면 **수동 사격** — `acquireAssistTarget`(어시스트 콘 `manual.assistConeDeg`)로
   가장 정렬된 적으로 조준 보정 후 고데미지 발사.
4. `fireAt(dir, cost, baseDamage, manual)` — 주파수 차감 → 레이캐스트 → 적중 시
   `damageForDistance`로 거리 보정 데미지 → `applyFrequencyHit` → 처치 시 `onKill`. 빔/임팩트 FX 스폰.

조준은 `enemyPositions()`(적 월드 좌표)를 모아 순수 `bestAlignedDir`에 위임(아래).

## SpecialBarrage — 다중 빔 살포 (특수)

`update(dt, triggerPressed)`:
- 우클릭 + 쿨다운 완료 + 주파수 충분 → **발동**(쿨다운 60s 시작, 자연 회복 억제).
- 발동 중 `drainRate`로 주파수 소모, `salvoInterval`마다 `fireSalvo()`. 게이지 0이면 종료.
- `fireSalvo` — 전방 콘 안 가장 가까운 적 최대 `maxBeams`기에 동시 레이캐스트 + 빔 + 데미지.
  타깃은 순수 `nearestInCone`에 위임(`index`로 메시 역참조). `sfx.barrage(빔 수)`로 묵직한 일제사격음.

## 콘 조준 통합 (targeting — 순수)

과거 3곳(`acquireAssistTarget`·`acquireAutoFireTarget`·`acquireTargets`)에 복제됐던 로직을 단일
모듈로 통합. THREE 비의존(`{x,y,z}`) → 단위 테스트 가능
([tests/targeting.test.ts](../../tests/targeting.test.ts)).

| 함수 | 용도 |
| :--- | :--- |
| `coneTargets(origin, aimDir, positions, range, coneCos)` | 공통 코어 — 콘+사거리 후보 수집(등 뒤/사거리 밖/콘 밖 제외) |
| `bestAlignedDir(...)` | 가장 정렬된 단일 타깃 방향(에임 어시스트·자동발사) |
| `nearestInCone(..., max)` | 거리순 N개(일제사격) |

빔/살포 클래스는 적 좌표만 넘기고 결과를 THREE.Vector3로 변환해 쓴다.

## 데미지 모델 (WeaponSpec)

```
damageForDistance(dist, base, falloff) = base × clamp(refDist / dist, minMult, maxMult)
```
근접일수록 가중↑, 원거리 하한 클램프. 가드: [tests/WeaponSpec.test.ts](../../tests/WeaponSpec.test.ts).

## 비주얼 공통 (beamFx)

`makeGlowTexture(mid, outer)` + `spawnBeam(scene, glowTex, from, to, {beamColor, glowColor, radius,
glowScale})` — 빔 실린더 + 글로우 스프라이트 생성. FrequencyBeam·SpecialBarrage가 공유(중복 제거).

## 절차적 사운드 (Sfx — Web Audio)

오실레이터 + 바이쿼드 필터 + 게인 엔벨로프 + 컴프레서로 발사음을 **합성**(에셋 없음).
스타크래프트 시즈탱크(노말 모드) 스타일의 묵직한 포성: 하강 스윕 + 충격 thump + 메탈릭 링 + 크랙.
- `beam()` — 기본 빔 수동 발사.
- `barrage(beamCount)` — 동시 발사 빔 수에 비례해 더 묵직하게.
- 첫 사용자 제스처(전장 클릭) 안에서 `resume()`로 오디오 컨텍스트 활성(브라우저 정책).
