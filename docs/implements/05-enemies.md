# 05 · 적 (플라즈모이드 · 데이터 스펙 · 스폰 · 웨이브)

소스: [PlasmoidSpec.ts](../../src/enemies/PlasmoidSpec.ts), [SeedEnemy.ts](../../src/enemies/SeedEnemy.ts), [EnemyManager.ts](../../src/enemies/EnemyManager.ts), [DrainBeams.ts](../../src/fx/DrainBeams.ts), [plasmoids.ts](../../src/enemies/plasmoids.ts), 데이터: [public/enemies/plasmoid.json](../../public/enemies/plasmoid.json)

## PlasmoidSpec — 온도(T) 단일 노브 + 고유 아키타입 데이터 시스템

적 1종을 `PlasmoidSpec`(JSON)으로 외부화. **온도 T(별 표면온도, K)** 하나가 색·체력가중치·희귀도·기본속도를 묶는다 — 저온=적색·최약, 고온=청백·최강(별 색온도 메타포). 색은 `"0xRRGGBB"` 문자열(JSON 0x 리터럴 불가) → `parseHexColor`.

그 위에 개체 행동을 **고유 아키타입**(`archetypes.{rusher, kiter}`)으로 정의한다 — 어느 드론이 플레이하든 무관(MP 혼합 전장 대응). 온도(T) 시스템은 색·체력·시각크기·기본속도·희귀도를 그대로 구동하되, **이동 난이도는 더 이상 고도로 변하지 않는다**(과거 "고도 가중" 시스템 폐기).

스펙 구조(`PlasmoidSpec`): `hp`(`PlasmoidHpSpec`), `color.stops`(`ColorStop[]`), `visual`(`PlasmoidVisualSpec`), `spawn`(`PlasmoidSpawnSpec`), `contact`(`PlasmoidContactSpec`), `archetypes`(`PlasmoidArchetypesSpec` = `{rusher, kiter}`).

### 아키타입 — 행동을 드론에서 분리
- **카이터 = "모기 플라즈모이드 / SKEETER"**(공중형, `PlasmoidKiterArchetype`): `keepDist` 거리를 유지하며 **도주**(`strafeMix 0`)하고 사거리에서 **드레인 빔**(`drainDamage`/`drainInterval`)으로 원거리 공격. 플레이어가 원을 그리면 예측 리드로 도주(`KITER_FLEE_LEAD`)하고 **수직 회피**(궤도면 이탈, 주로 상승; `orbitRef`/`evadeGain`)한다. 상공(`spawnAlt` 80–300m)에 소수(`countBase 3`, `countCap 5`) 등장, 처치 환수 8. 튜닝: `speed 52`, `turnRateDeg 100`, `keepDist 60`, `keepBand 12`, `attackRange 95`, `drainDamage 2`, `drainInterval 1.5`.
- **러셔 = "거머리 플라즈모이드 / LEECH"**(지상형, `PlasmoidRusherArchetype`): 적극 **접근**해 **접촉**으로 흡수(`spec.contact`). `speedMul 1.5`(× `rollAppearance` 속도)로 더 빠른 돌격. 지표(`spawnAlt` 0–60m)에 떼(`countBase 6`, `countCap 12`)로 등장, 처치 환수 5.
- 공통 베이스(`PlasmoidArchetypeBase`): `name`(표시명 "국문 / ENGLISH"), `spawnAltMin/spawnAltMax`, `countBase/countCap`, `killRefund`. 스폰 시 각 개체에 `archetypeName`·`killRefund`·`targetIndex`가 실린다.

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

> **폐기된 고도 가중 시스템.** 과거의 `altitudeSpeedMult`/`contactAltWeaken` 함수, `altitude` 스펙 블록, `contact.altWeakRef/altWeakMin`는 모두 제거됐다. 또한 전역 스폰 고도(`spawnAltitude`/`SPAWN_BIAS`/`SPAWN_CEILING`)도 아키타입별 고도 밴드(`spawnAltMin/spawnAltMax`)로 대체됐다. 온도(T)는 색·HP·시각크기·기본속도·희귀도를 계속 구동하지만, 이동 난이도가 고도에 따라 변하지는 않는다.

### 접촉(에너지 흡수) 피해 (`contactDamage(spec, hp)`)
플라즈모이드가 물체에서 **에너지를 빨아들여** 약화시키고(인트로의 집 붕괴 원인) 그만큼 **자기 체력을 회복**한다는 설정. `contactDamage`가 반환하는 단일 수치 = 플레이어 HP 피해 = 적 자가 회복량. (러셔 전용 — 카이터는 `drainDamage`를 쓴다.)
- 식: `hpDamage × (1 + strengthMul×strength(hp))` — 강함(s)에만 비례. 강체(`strength` 1)일수록 묵직(×(1+strengthMul)). 고도 의존 없음.
- 현 스펙(`contact`): `hpDamage 10`, `strengthMul 2.0`.

### 스폰 롤 (`rollAppearance(spec, wave, rand)`)
한 마리의 외형/속도를 굴린다(순수 함수, `rand:()=>[0,1)` 주입으로 테스트 결정성). → `{ temp, maxHp, diameter, color, speed }`(`SpawnRoll`).
- 온도 상한 `tCap = min(tMax, tMin + wave×WAVE_TEMP_STEP)` (`WAVE_TEMP_STEP=900`) — 웨이브가 오를수록 강한 청백 개체 해금.
- `temp = sampleTemp(tMin, tCap, tempAlpha, rand())` — 저온 편향(약체가 흔함).
- 체력 산정용 노미널 지름 `nominal = NOMINAL_MIN + rand()×NOMINAL_SPAN + min(NOMINAL_WAVE_CAP, wave×NOMINAL_WAVE_GROW)`(`0.8`/`0.8`/`0.04`). 웨이브 보너스는 `NOMINAL_WAVE_CAP=1.0`으로 캡 — 노미널 지름이 무한 증가하지 않아 HP에 천장이 생긴다(플레이어 데미지는 고정이므로 후반 웨이브의 사실상 불사 개체 발생을 차단; 과거 경계 근처 불사화 이슈 수정).
- `maxHp = plasmoidHp(…)`, `diameter = visualDiameter(…)`, `color = colorAt(…)`.
- `speed = max(SPEED_FLOOR, speedForStrength(strength(maxHp)) + (rand()−0.5)×SPEED_JITTER)`(`1.5`/`1.0`). 이 값은 러셔 기본속도로 쓰이고 `speedMul`이 곱해진다(카이터는 아키타입 `speed` 고정 사용).

### 아키타입별 물량 + 스폰 타입 선택 (순수)
- `archetypeCount(arche, wave, matchingPlayers)` — `per = min(countCap, countBase + floor((wave−1)/2))`, × `matchingPlayers`. `matchingPlayers ≤ 0`이면 0. 러셔는 워커 수, 카이터는 플라이어 수에 비례 — **구성 기반 자기정렬**(단일 드론 세션은 매칭 아키타입만 스폰 → 이길 수 없는 미스매치 없음).
- `pickSpawnType(pendingRusher, pendingKiter, rand)` — 두 잔여 예산을 잔여 비율로 가중 추첨해 이번에 스폰할 타입 반환(한 종 0이면 다른 종, 둘 다 0이면 null). 웨이브 내내 두 예산이 섞여 투입된다.

### 기본 스펙 / 로더
- `DEFAULT_PLASMOID` — `public/enemies/plasmoid.json`과 동일(테스트 동치 검증). 비동기 로드가 어려운 곳(인트로 연출, `EnemyManager` 기본값)이 동기적으로 사용.
- 현 데이터(`plasmoid.json`): `hp{ basePerArea 100, minDiameter 0.5, maxDiameter 60 }`; `color.stops` 5단계(3000K `0xff3b30` w1.0 → 12000K `0x4aa6ff` w5.0); `visual{ minDiameter 1, maxDiameter 300, anchorHp 200000, anchorDiameter 250, exponent 0.82 }`; `spawn{ tempAlpha 2, speedMax 13.5, speedMin 3.75, hpFloor 100, hpCeil 200000 }`; `contact{ hpDamage 10, strengthMul 2.0 }`; `archetypes.rusher{ name "거머리 플라즈모이드 / LEECH", spawnAltMin 0, spawnAltMax 60, countBase 6, countCap 12, killRefund 5, speedMul 1.5 }`; `archetypes.kiter{ name "모기 플라즈모이드 / SKEETER", spawnAltMin 80, spawnAltMax 300, countBase 3, countCap 5, killRefund 8, speed 52, turnRateDeg 100, keepDist 60, keepBand 12, strafeMix 0, orbitRef 35, evadeGain 0.85, attackRange 95, drainDamage 2, drainInterval 1.5 }`.
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
- **`updateMotion(dt, target, speedScale, steer?)`** — 3D 이동 + 자유 부유 + 공격 쿨다운. 카이터(`setKiter` 설정)면 `kiterVelocity`로 도주/선회, 아니면 추격형(`steer` 제공 시 예측 요격+분리, 없으면 단순 호밍 `pursueStep`). `speedScale`은 추격형에만 곱해지며 현재 매니저가 항상 1을 넘긴다(고도 가중 폐기).

### 흡수 = 성장 (`grow`)
- `grow(amount)` — 드레인/흡수한 만큼 `maxHp`·`hp`를 올리고 **시각 크기도 `maxScale`(초기 `baseScale`의 ~1.5배)까지 점증**. 방치한 모기가 더 크고 탱키해져 쫓아갈 동기를 만든다(살아있을 때만).
- `absorbEnergy(amount)` — 러셔 접촉용. `hp`만 `maxHp` 한도 내 회복(크기/최대치 증가 없음).
- `setKiter(params)` / `get isKiter` — 카이터 행동 활성화/판별(매니저가 드레인↔접촉 경로 분기).

### 이동 — 자유 부유 + 3D (추격형 / 카이터)
- **지형/물체와 충돌하지 않고** 자유롭게 떠다닌다(지표면 지향성·강하 없음).
- **추격형(러셔):** 플레이어를 향해 **상하 포함 3D**로 다가온다. `steer` 없으면 단순 호밍 `pursueStep`, 있으면 아래 군집 조향을 합성. `STOP_DIST=2.2m` 이내면 추격 정지(접촉 교전 거리). ([tests/pursue.test.ts](../../tests/pursue.test.ts))
- **카이터(모기):** `kiterVelocity(...)`로 `keepDist` 유지 — 가까우면 도주, 멀면 접근, 밴드(`keepBand`) 내면 `strafeMix`로 접선 선회↔도주 블렌딩(현 스펙 0=계속 멀어짐). `turnToward(cur, desired, turnRate·dt)`로 선회속도를 캡해 "빠르되 읽히는" 기동을 만들고, 분리(동료 밀어냄)를 합성한다. 플레이어 미래 위치(`KITER_FLEE_LEAD=0.35s`)를 기준으로 도주해 제자리 원돌기를 가로질러 빠져나간다. 플레이어의 접선(궤도) 속도가 크면 궤도면을 벗어나는 방향(`orbitRef` 기준, 주로 상승; `evadeGain`)으로 **수직 회피**한다. 고도 가중 미적용(`kiter.speed` 고정). ([tests/kiter.test.ts](../../tests/kiter.test.ts))
- **예측 요격(`interceptPoint`)** — 현재 위치가 아니라 플레이어의 **예상 미래 위치**(현위치 + 속도×리드, `LEAD_MAX=1s`)로 향함. 플레이어가 원을 그려도 안쪽을 가로질러 끊고 들어와, 뒤로 모아 한 덩어리로 만드는 카이팅을 차단.
- **분리(`separationVector`)** — 반경(자기+상대 반경+`SEP_MARGIN=2`) 안의 동료를 거리 반비례로 밀어냄(`SEP_GAIN=0.7`). 한 점에 겹쳐 쌓이지 않고 플레이어 주위로 퍼진 무리(링)가 됨. `STOP_DIST` 이내에서도 적용.
- 추격+분리는 `steerVelocity`로 합성 후 **최고속도(speed)로 클램프**. 플레이어 속도는 `EnemyManager`가 프레임 변위 EMA(`dt·8`)로 추정하며, 동료 스냅샷(`boids`)은 프레임 시작 시점으로 고정(순서 무관).
- 미세 상하 흔들림(`BOB_AMPLITUDE=0.4`, `BOB_RATE=2`, 누적 없는 진동)으로 부유감.

### 전투
- `applyFrequencyHit(damage)` — HP 차감, 0 이하면 `dissolving` 전이(처치 true 반환). 피격 시 발광/플래시.
- `tryAttack(playerPos, range, cooldown=1.0)` — 사거리 안 + 쿨다운 0이면 공격 true. `cooldown`으로 접촉(1s)↔카이터 드레인 간격(`drainInterval`)을 분기.
- 상태: `alive → dissolving → dead`(디졸브 완료). `dead`는 매니저가 정리.
- `tagEnemy(mesh, enemy)` / `getEnemy(obj)` — 레이캐스트 적중 메쉬 → 적 역참조(userData 한 곳 캡슐화).

### 멀티타깃 표적 선택 (순수 — MP 기반)
- `chooseTarget(dists, load, currentIdx, aggroPenalty, hysteresis, scores)` — 점수 = `거리 × (1 + aggroPenalty·부하)` 의 최소 인덱스. `dist=Infinity`(사망/부재)는 제외, 유효 표적 없으면 -1. `scores`는 재사용 스크래치(할당 회피).
- `stickyMinIndex(scores, currentIdx, hysteresis)` — 최소 점수 인덱스. 단 현재 표적이 최소의 `hysteresis`배 이내면 유지(깜빡임 방지). 빈 배열은 -1.

## EnemyManager — 스폰 / 멀티타깃 / 웨이브 / 집계

생성자 `(scene, world, players[], spec=DEFAULT_PLASMOID)` — **플레이어 배열**을 받는다(MP 대응; Game은 현재 `[player]`). `DrainBeams` 풀과 카이터 공격 파라미터(`spec.archetypes.kiter`)를 보유.

### 멀티타깃 표적 선택 (어그로 분산)
- `buildTargets(dt)` — 매 프레임 플레이어별 스냅샷(위치·생존·**속도 EMA** `dt·8`) 갱신.
- 각 적은 `pickTarget`(→ `chooseTarget`)으로 **최근접 플레이어**를 고르되 **히스테리시스(`TARGET_HYSTERESIS=1.2`)**로 표적 깜빡임을 막고, **어그로 부하 가산(`AGGRO_PENALTY=0.4`)**으로 한 명에게 몰빵(도그파일)을 회피한다. 표적은 `enemy.targetIndex`에 유지. 표적이 공격받는다.
- 재입장(`clear`) 시 속도 추정 리셋(순간이동 스파이크 방지).

### 스폰 (`spawnOne` / `tickSpawns`)
- 살아있는 플레이어들의 **무게중심**(`playersCentroid`) 주변 근거리 밴드(반경 55~205 m, `TERRAIN_HALF` 클램프)에 배치.
- 고도는 **아키타입 고도 밴드**: `alt = spawnAltMin + rand×(spawnAltMax−spawnAltMin)`(러셔 0–60m 지표 / 카이터 80–300m 상공). 최종 y = `world.heightAt(x,z) + alt`. ([tests/spawn.test.ts](../../tests/spawn.test.ts))
- 외형/색은 `rollAppearance(spec, wave, Math.random)`(온도 시스템 유지). 카이터는 `setKiter(...)`로 도주/드레인 행동 활성화(개체별 ±10% 속도 변주, `turnRateDeg→rad`). 러셔는 `SeedEnemy(pos, app, roll.speed × rusher.speedMul)`. 각 개체에 `killRefund`·`archetypeName` 주입.
- `tickSpawns`는 `pickSpawnType`으로 두 잔여 예산(`pendingRusher`/`pendingKiter`)을 잔여 비율로 섞어 `SPAWN_INTERVAL=0.35s`마다 1마리씩 투입.

### 매 프레임 군집 조향 + 공격 (`update`)
- 프레임 시작 시 표적 스냅샷·살아있는 적 스냅샷(`boids`)·어그로 부하(`load`)를 갱신하고, alive 적에 `{vel, boids, index}`를 `steer`로 넘긴다. 디졸브 중인 적은 비주얼만 진행.
- **카이터:** 이동 후 `clampKiterAltitude`(지면 위 `KITER_GROUND_CLEARANCE=1.5m` ~ `KITER_CEILING=1020m`로 클램프 — 가라앉음·천장 돌파 방지) → `kiterAttack`: `tryAttack(t.pos, attackRange, drainInterval)` 통과 시 `takeDamage(drainDamage)` → **`enemy.grow(drainDamage)`(흡수=성장)** + `DrainBeams.spawn(적→표적, 개체색)` + `onPlayerHit`.
- **러셔:** 예측 요격+분리 조향 후 `contactAttack`: `tryAttack(t.pos, ATTACK_RANGE=3.2)` 통과 시 `contactDamage(spec, enemy.maxHp)`로 흡수량 산출 → `takeDamage(absorb)`가 적용되면 `enemy.absorbEnergy(absorb)`로 **적이 같은 양만큼 회복** + `onPlayerHit`. 닿게 두면 적이 회복한다.
- 드레인 빔은 [DrainBeams](../../src/fx/DrainBeams.ts)(가산발광 풀, 적→표적)로 분리. `update`에서 페이드/정리.

### 웨이브 (`startNextWave`)
- 워커·플라이어 수를 세어 `pendingRusher = archetypeCount(rusher, wave, walkers)`, `pendingKiter = archetypeCount(kiter, wave, flyers)`로 **아키타입별 독립 예산** 산정 — 구성 기반 자기정렬(단일 구성은 자기 타입만, 이길 수 없는 미스매치 없음).
- 화면 적이 모두 정화(`enemies.length === 0` + 두 예산 0)되면 다음 웨이브 — 무한 증식.
- 집계: `killCount`(`registerKill(enemy?)`→`onKill`), `wave`(`onWaveChange`). `onPlayerHit`로 피격 통지.
- `registerKill(enemy?)` — `killCount++`, 사망 지점 **최근접 플레이어**를 그 개체의 아키타입 `killRefund`만큼 `heal`(흡수당한 물질 회수).

### 집계 게터
- `hitMeshes` — 살아있는 적의 레이캐스트 대상 메쉬.
- `aliveWorldPositions` — 살아있는 적 월드 좌표(평문, `hitMeshes`와 인덱스 정합; 무기 콘 조준용).
- `aliveMarkers` — 월드 위치 + 시각 반경(`group.scale.x`; 코너 브래킷 등 화면 표식용).
- `aliveSnapshot` — `{x,z}` 위치 스냅샷(미니맵용).

`update(dt)` — 점진 스폰(`tickSpawns`) → 표적/`boids`/`load` 갱신 → 각 적 `update`(표적 좌표 + 조향 전달) + 아키타입별 공격(드레인/접촉) → 드레인 빔 갱신 → 사망 적 정리 → 웨이브 종료 판정.
