# 05 · 적 (플라즈모이드 · 데이터 스펙 · 스폰 · 웨이브)

소스: [PlasmoidSpec.ts](../../src/enemies/PlasmoidSpec.ts), [SeedEnemy.ts](../../src/enemies/SeedEnemy.ts), [EnemyManager.ts](../../src/enemies/EnemyManager.ts), [plasmoids.ts](../../src/enemies/plasmoids.ts), 데이터: [public/enemies/plasmoid.json](../../public/enemies/plasmoid.json)

## PlasmoidSpec — 온도(T) 단일 노브 데이터 시스템

적 1종을 `PlasmoidSpec`(JSON)으로 외부화. **온도 T(별 표면온도, K)** 하나가 색·체력가중치·희귀도·속도를 모두 묶는다 — 저온=적색·최약, 고온=청백·최강(별 색온도 메타포). 색은 `"0xRRGGBB"` 문자열(JSON 0x 리터럴 불가) → `parseHexColor`.

스펙 구조(`PlasmoidSpec`): `hp`(`PlasmoidHpSpec`), `color.stops`(`ColorStop[]`), `visual`(`PlasmoidVisualSpec`), `spawn`(`PlasmoidSpawnSpec`), `altitude`(`PlasmoidAltitudeSpec`), `contact`(`PlasmoidContactSpec`).

### "분리형" 모델 — 체력 ↔ 보이는 크기 디커플링
1. **체력(밸런스)** `plasmoidHp(spec, diameter, T)` = `basePerArea × 지름² × colorWeight` (표면적 기반 → 크기로 폭주 안 함). 지름은 `hp.minDiameter`~`hp.maxDiameter` 클램프.
2. **렌더 크기(연출)** `visualDiameter(spec, hp)` = `clamp(minD + k·hp^exponent, minD, maxD)`. 계수 `k`는 `(anchorHp, anchorDiameter)`로 역산 → 큰 HP가 극적으로 거대해지되 `maxDiameter`로 소프트캡.

### 온도 → 색 / 가중치 (구간 보간)
- `locate(stops, T)` — `T`가 속한 stop 구간 인덱스와 보간계수(양끝 클램프).
- `colorWeight(stops, T)` — T → 체력 가중치(구간 선형보간).
- `colorAt(stops, T)` — T → 색(0xRRGGBB; 채널별 선형보간). 렌더/발광용.
- `lowestColor`/`highestColor` — 최저(최약·최냉)·최고(최강·최열) stop 헬퍼.

### 강함(s) → 속도·희귀도
- `strength(spec, hp)` = 로그 정규화 `[0,1]` over `hpFloor`..`hpCeil`.
- `speedForStrength(spec, s)` = `speedMax − (speedMax−speedMin)·s` (질량 모델: 강할수록 둔함).
- `sampleTemp(tMin, tCap, alpha, u)` — 온도 희귀도 `f(T)∝T^-alpha`의 역CDF 샘플. 고온(강체)일수록 드묾. `alpha=1`은 로그분포 특수처리. 현 스펙 `tempAlpha=2`.

### 고도 속도 가중 (`altitudeSpeedMult(spec, altitude)`)
지면 대비 고도(m)로 이동속도 배수 산출 — 영역별(수중/지표/공중) 드론과 추격 균형용.
- 지표(`altitude=0`) → ×1.
- 공중↑ → `airRef`에서 상한 ×`(1+airBoostMax)`까지 가속(클램프).
- 지하/수중↓ → `depthRef`에서 하한 ×`(1−depthSlowMax)`까지 감속(클램프).
- 현 스펙: `airRef 220`, `depthRef 50`, `airBoostMax 4.52`, `depthSlowMax 0.6`. `airRef`는 220으로 잡아 가속 그라디언트가 0–300m 전투 밴드 전체에 걸치게 한다.

### 접촉(에너지 흡수) 피해 (`contactDamage(spec, hp, altitude)`)
플라즈모이드가 물체에서 **에너지를 빨아들여** 약화시키고(인트로의 집 붕괴 원인) 그만큼 **자기 체력을 회복**한다는 설정. `contactDamage`가 반환하는 단일 수치 = 플레이어 HP 피해 = 적 자가 회복량.
- 식: `hpDamage × (1 + strengthMul×strength(hp)) × altWeaken` — 강체(`strength` 1)일수록 묵직(×(1+strengthMul)).
- `altWeaken` = 지표(고도 ≤ 0)에서 1, `altWeakRef` 고도에서 `altWeakMin`까지 선형 감소(클램프). **고고도일수록 접촉이 약해진다**(저공=묵직 / 고공=경쾌한 공중전 유도). 음수 고도(지하)는 ×1.
- 현 스펙(`contact`): `hpDamage 9`, `strengthMul 2.0`, `altWeakRef 250`, `altWeakMin 0.3`.

### 스폰 롤 (`rollAppearance(spec, wave, rand)`)
한 마리의 외형/속도를 굴린다(순수 함수, `rand:()=>[0,1)` 주입으로 테스트 결정성). → `{ temp, maxHp, diameter, color, speed }`(`SpawnRoll`).
- 온도 상한 `tCap = min(tMax, tMin + wave×WAVE_TEMP_STEP)` (`WAVE_TEMP_STEP=900`) — 웨이브가 오를수록 강한 청백 개체 해금.
- `temp = sampleTemp(tMin, tCap, tempAlpha, rand())` — 저온 편향(약체가 흔함).
- 체력 산정용 노미널 지름 `nominal = NOMINAL_MIN + rand()×NOMINAL_SPAN + min(NOMINAL_WAVE_CAP, wave×NOMINAL_WAVE_GROW)`(`0.8`/`0.8`/`0.04`). 웨이브 보너스는 `NOMINAL_WAVE_CAP=1.0`으로 캡 — 노미널 지름이 무한 증가하지 않아 HP에 천장이 생긴다(플레이어 데미지는 고정이므로 후반 웨이브의 사실상 불사 개체 발생을 차단; 과거 경계 근처 불사화 이슈 수정).
- `maxHp = plasmoidHp(…)`, `diameter = visualDiameter(…)`, `color = colorAt(…)`.
- `speed = max(SPEED_FLOOR, speedForStrength(strength(maxHp)) + (rand()−0.5)×SPEED_JITTER)`(`1.5`/`1.0`).

### 기본 스펙 / 로더
- `DEFAULT_PLASMOID` — `public/enemies/plasmoid.json`과 동일(테스트 동치 검증). 비동기 로드가 어려운 곳(인트로 연출, `EnemyManager` 기본값)이 동기적으로 사용.
- 현 데이터(`plasmoid.json`): `hp{ basePerArea 100, minDiameter 0.5, maxDiameter 60 }`; `color.stops` 5단계(3000K `0xff3b30` w1.0 → 12000K `0x4aa6ff` w5.0); `visual{ minDiameter 1, maxDiameter 300, anchorHp 200000, anchorDiameter 250, exponent 0.82 }`; `spawn{ tempAlpha 2, speedMax 13.5, speedMin 3.75, hpFloor 100, hpCeil 200000 }`; `altitude{ airRef 220, depthRef 50, airBoostMax 4.52, depthSlowMax 0.6 }`; `contact{ hpDamage 9, strengthMul 2.0, altWeakRef 250, altWeakMin 0.3 }`.
- [plasmoids.ts](../../src/enemies/plasmoids.ts) — `makeLoader("enemies","적")` 기반. `fetchPlasmoidCatalog()`(`public/enemies/index.json`) + `fetchPlasmoid(id)`(`<id>.json`).
- 테스트: [tests/plasmoidSpec.test.ts](../../tests/plasmoidSpec.test.ts).

## SeedEnemy — 플라즈모이드 개체

박동하는 유기적 에너지 구체. 빔 누적 피격으로 쪼그라들다 디졸브 소멸(셰이더).

생성자 `(position, appearance: SeedAppearance, speed=4.5)`:
- `SeedAppearance { maxHp, diameter, color }` — `PlasmoidSpec` 시스템 산출값을 주입.
- `baseScale = diameter / 2`(셸 지오 지름 2 기준).
- 표면/코어 색은 주입된 `color`(`colorAt`)에서 파생 — 본체 `×0.42`, 디졸브 가장자리 흰색 `lerp 0.25`, 코어 `emissive=color`. ([tests/seedEnemy.test.ts](../../tests/seedEnemy.test.ts))
- 디졸브 셸 머티리얼은 `DoubleSide` — 거대 개체가 `STOP_DIST`(2.2m)까지 다가와 카메라를 감싸도 내부 면이 레이캐스트에 적중 등록(코앞에서 무피해이던 버그 수정).
- 피격 플래시는 순백 대신 셸 자기 색조로 번쩍여 적색(약체)/청백(강체) 가독성을 보존(`dissolve` 프래그먼트 셰이더 `uFlash`).

`update(dt, target, speedScale=1, steer?)`는 두 책임으로 분리(가독성):
- **`updateVisual(dt)`** — 피격 플래시(제곱 감쇠) · 디졸브 진행 · 박동(pulse) 스케일/발광. 소멸 중이면 `false` 반환 → 이동 생략.
- **`updateMotion(dt, target, speedScale, steer?)`** — 3D 추적 + 자유 부유 + 공격 쿨다운. `speedScale`은 고도 가중(`altitudeSpeedMult`). `steer` 제공 시 예측 요격 + 분리 조향.

### 이동 — 자유 부유 + 3D 추적 (군집 조향)
- **지형/물체와 충돌하지 않고** 자유롭게 떠다닌다(지표면 지향성·강하 없음).
- 플레이어를 향해 **상하 포함 3D**로 다가온다. `steer` 없으면 단순 호밍 `pursueStep`, 있으면 아래 군집 조향을 합성. `STOP_DIST=2.2m` 이내면 추격 정지(접촉 교전 거리). ([tests/pursue.test.ts](../../tests/pursue.test.ts))
- **예측 요격(`interceptPoint`)** — 현재 위치가 아니라 플레이어의 **예상 미래 위치**(현위치 + 속도×리드, `LEAD_MAX=1s`)로 향함. 플레이어가 원을 그려도 안쪽을 가로질러 끊고 들어와, 뒤로 모아 한 덩어리로 만드는 카이팅을 차단.
- **분리(`separationVector`)** — 반경(자기+상대 반경+`SEP_MARGIN=2`) 안의 동료를 거리 반비례로 밀어냄(`SEP_GAIN=0.7`). 한 점에 겹쳐 쌓이지 않고 플레이어 주위로 퍼진 무리(링)가 됨. `STOP_DIST` 이내에서도 적용.
- 추격+분리는 `steerVelocity`로 합성 후 **최고속도(speed)로 클램프**. 플레이어 속도는 `EnemyManager`가 프레임 변위 EMA(`dt·8`)로 추정하며, 동료 스냅샷(`boids`)은 프레임 시작 시점으로 고정(순서 무관).
- 미세 상하 흔들림(`BOB_AMPLITUDE=0.4`, `BOB_RATE=2`, 누적 없는 진동)으로 부유감.

### 전투
- `applyFrequencyHit(damage)` — HP 차감, 0 이하면 `dissolving` 전이(처치 true 반환). 피격 시 발광/플래시.
- `tryAttack(playerPos, range)` — 사거리 안 + 쿨다운(1s) 0이면 공격 true.
- 상태: `alive → dissolving → dead`(디졸브 완료). `dead`는 매니저가 정리.
- `tagEnemy(mesh, enemy)` / `getEnemy(obj)` — 레이캐스트 적중 메쉬 → 적 역참조(userData 한 곳 캡슐화).

## EnemyManager — 공중 스폰 / 웨이브 / 집계

생성자 `(scene, world, player, spec=DEFAULT_PLASMOID)` — 주입된 `PlasmoidSpec`으로 스폰 롤·고도 가중을 수행.

### 공중 스폰 (`spawnOne`)
- 플레이어 주변 근거리 밴드(반경 55~205 m, `TERRAIN_HALF` 클램프)에 배치.
- 고도는 순수 `spawnAltitude(u)` = `u^SPAWN_BIAS × SPAWN_CEILING` (`SPAWN_BIAS=2.5`, `SPAWN_CEILING=300m`). 지수 가중으로 **지상에 가까울수록 빈도↑**(경계 u=0→0, u→1→300, 단조). 최종 y = `world.heightAt(x,z) + spawnAltitude(rand)`. ([tests/spawn.test.ts](../../tests/spawn.test.ts))
- `SPAWN_CEILING=300`은 일반 플라즈모이드 전투 밴드 상한 = 비행드론 천장(300m)과 일치. 300m **위** 고도는 향후 항공모함·보스급 콘텐츠 전용으로 비워 둔다.
- 외형/속도는 `rollAppearance(spec, wave, Math.random)` → `SeedEnemy(pos, {maxHp,diameter,color}, speed)`.

### 매 프레임 고도 가중 + 군집 조향 (`update`)
- 각 적의 `altitude = enemy.y − world.heightAt(x,z)`를 계산해 `altitudeSpeedMult(spec, altitude)`로 속도 배수 전달(영역별 드론 추격 균형).
- 프레임 시작 시 플레이어 속도(EMA)·살아있는 적 스냅샷(`boids`)을 갱신하고, alive 적에 `{vel, boids, index}`를 `steer`로 넘겨 **예측 요격 + 분리**를 적용(원돌기·뭉침 방지). 디졸브 중인 적은 비주얼만 진행. 재입장(`clear`) 시 속도 추정 리셋(순간이동 스파이크 방지).
- 접촉 시 `tryAttack(playerPos, ATTACK_RANGE=3.2)` → `contactDamage(spec, enemy.maxHp, altitude)`로 흡수량 산출 → `player.takeDamage(absorb)`가 적용되면 `enemy.absorbEnergy(absorb)`로 **적이 같은 양만큼 체력 회복** + `onPlayerHit(absorb)`. 즉 플라즈모이드가 닿게 두면 적이 회복한다.
- `SeedEnemy.absorbEnergy(amount)` — `hp`를 `maxHp` 한도 내에서 회복(살아있을 때만).

### 웨이브 (`startNextWave`)
- `pendingSpawns = 4 + wave×2`를 0.35 s 간격 점진 스폰.
- 화면 적이 모두 정화(`enemies.length === 0` + 대기 0)되면 다음 웨이브 — 무한 증식.
- 집계: `killCount`(`registerKill`→`onKill`), `wave`(`onWaveChange`). `onPlayerHit`로 피격 통지.

### 집계 게터
- `hitMeshes` — 살아있는 적의 레이캐스트 대상 메쉬.
- `aliveWorldPositions` — 살아있는 적 월드 좌표(평문, `hitMeshes`와 인덱스 정합; 무기 콘 조준용).
- `aliveMarkers` — 월드 위치 + 시각 반경(`group.scale.x`; 코너 브래킷 등 화면 표식용).
- `aliveSnapshot` — `{x,z}` 위치 스냅샷(미니맵용).

`update(dt)` — 점진 스폰 → 각 적 `update`(플레이어 좌표 + 고도 가중 전달) + `tryAttack` → 사망 적 정리 → 웨이브 종료 판정.
