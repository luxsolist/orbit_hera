# 05 · 적 (플라즈모이드 · 데이터 스펙 · 스폰 · 웨이브)

소스: [PlasmoidSpec.ts](../../src/enemies/PlasmoidSpec.ts), [CoreEnemy.ts](../../src/enemies/CoreEnemy.ts), [EnemyManager.ts](../../src/enemies/EnemyManager.ts), [DrainBeams.ts](../../src/fx/DrainBeams.ts), [plasmoids.ts](../../src/enemies/plasmoids.ts), 데이터: [public/enemies/plasmoid.json](../../public/enemies/plasmoid.json)

> 세계관 물리 해석(플라즈모이드 = 6차원 본체의 3차원 투영, 온도 T = KK 준위, 흡수 = 영점 에너지 수확)과
> 파생 메커닉 로드맵(위상 이탈·강제 결어긋남·균열 스폰·씨앗 장)은 [../spec/05-dimensional-cosmology.md](../spec/05-dimensional-cosmology.md)(정본) 참조.
> ⚠️ 공격 체계(접촉 흡수/드레인)는 직무 기반 체계로 재정립이 결정됨(정본:
> [서사편 §6](../private/05x-narrative-truth.md) ⚠️스포일러) — 이 문서는 구현 교체 전까지의
> 현행 사양을 기술한다.

## PlasmoidSpec — 온도(T) 단일 노브 + 고유 아키타입 데이터 시스템

적 1종을 `PlasmoidSpec`(JSON)으로 외부화. **온도 T(별 표면온도, K)** 하나가 색·체력가중치·희귀도·기본속도를 묶는다 — 저온=적색·최약, 고온=청백·최강(별 색온도 메타포). 색은 `"0xRRGGBB"` 문자열(JSON 0x 리터럴 불가) → `parseHexColor`.

그 위에 개체 행동을 **고유 아키타입**(`archetypes.{rusher, kiter}`)으로 정의한다 — 어느 드론이 플레이하든 무관(MP 혼합 전장 대응). 온도(T) 시스템은 색·체력·시각크기·기본속도·희귀도를 그대로 구동하되, **이동 난이도는 더 이상 고도로 변하지 않는다**(과거 "고도 가중" 시스템 폐기).

스펙 구조(`PlasmoidSpec`): `hp`(`PlasmoidHpSpec`), `color.stops`(`ColorStop[]`), `visual`(`PlasmoidVisualSpec`), `spawn`(`PlasmoidSpawnSpec`), `contact`(`PlasmoidContactSpec`), `archetypes`(`PlasmoidArchetypesSpec` = `{rusher, kiter, marker}`), `sweep`(`SweepSpec` — 심판 파문 전장 이벤트).

### 아키타입 — 행동을 드론에서 분리
- **카이터 = "모기 플라즈모이드 / SKEETER"**(공중형, `PlasmoidKiterArchetype`): `keepDist` 거리를 유지하되 **keepDist 구(球) 위 개체 고유 방위(`homeDir`)** 로 향해 무리가 xy·z 모두 고르게 분산하고, 사거리에서 **드레인 빔**(`drainDamage`/`drainInterval`)으로 원거리 공격. `homeDir`은 매 프레임 **구면 랜덤워크로 표류**해 한 마리도 죽기 전까지 xyz 전 방향으로 자유 유영(`HOME_WANDER`). 너무 가까우면 직접 도주(`KITER_FLEE_LEAD` 예측 리드), 플레이어 원돌기엔 **수직 회피**(개체별 위/아래 무작위 = `homeDir.y` 부호; `orbitRef`/`evadeGain`). 상공(`spawnAlt` 80–300m)에 소수(`countBase 3`, `countCap 5`) 등장, 처치 환수 8. 튜닝: 속도 `speed 89`↔`speedMin 67`(플라이어 최고속 −20%~−40%), `turnRateDeg 100`, `keepDist 60`, `keepBand 12`, `attackRange 95`, `drainDamage 1.4`, `drainInterval 1.5`.
- **러셔 = "거머리 플라즈모이드 / LEECH"**(지상형, `PlasmoidRusherArchetype`): 적극 **접근**해 **접촉**으로 흡수(`spec.contact`). 속도 `speed 17`↔`speedMin 12`(워커 최고속 19.44보다 약간 느려 공격할 틈을 줌). 지표(`spawnAlt` 0–60m)에 떼(`countBase 6`, `countCap 12`)로 등장, 처치 환수 5.
- **마커 = "소인체 플라즈모이드 / BRANDER"**(중공형, `PlasmoidMarkerArchetype` — 서사편 §6.1 ① MARK): 카이터형 유영(`turnRateDeg 90`/`keepDist 70`/`keepBand 18`, 회피 옵션 없음)으로 중거리를 맴돌며 **낙인 유도탄**(`tomb`: `projSpeed 22`, `projTurnRateDeg 70`, `projTtl 14`, `fireRange 220`, `fireInterval 7`)을 발사. 명중해도 무피해 — **낙인**만 부착되고(표적당 상한 5), 주기적 **심판 파문**이 지나갈 때 낙인 1개당 `sweepDamage 18` 피해(최대 90 — 워커는 만피에서 생존, 플라이어는 방치 시 치명). 카운터: 느린 유도탄 회피(선회 캡이라 스트레이프로 흘림) / **근원 마커 격파**(그 개체의 낙인·유도탄 소산) / 관측 고정(W1)으로 장전 동결. 물량은 드론 종류 무관 전원 비례(`countBase 2`, `countCap 4`), 중고도(`spawnAlt` 40–160m). 접촉·드레인 없음, 처치 환수 8(최우선 표적 보상). 건물 낙인은 커터(§6.10-2) 단계에서 도입 예정 🔭.
- 공통 베이스(`PlasmoidArchetypeBase`): `name`(표시명 "국문 / ENGLISH"), `spawnAltMin/spawnAltMax`, `countBase/countCap`, `killRefund`. 스폰 시 각 개체에 `archetypeName`·`killRefund`·`targetIndex`·`role`(직무 — 공격 경로 분기)이 실린다.

### "분리형" 모델 — 체력 ↔ 보이는 크기 디커플링
1. **체력(밸런스)** `plasmoidHp(spec, diameter, T)` = `basePerArea × 지름² × colorWeight` (표면적 기반 → 크기로 폭주 안 함). 지름은 `hp.minDiameter`~`hp.maxDiameter` 클램프.
2. **렌더 크기(연출)** `visualDiameter(spec, hp)` = `clamp(minD + k·hp^exponent, minD, maxD)`. 계수 `k`는 `(anchorHp, anchorDiameter)`로 역산 → 큰 HP가 극적으로 거대해지되 `maxDiameter`로 소프트캡.

### 온도 → 색 / 가중치 (구간 보간)
- `locate(stops, T)` — `T`가 속한 stop 구간 인덱스와 보간계수(양끝 클램프).
- `colorWeight(stops, T)` — T → 체력 가중치(구간 선형보간).
- `colorAt(stops, T)` — T → 색(0xRRGGBB; 채널별 선형보간). 렌더/발광용.
- `lowestColor`/`highestColor` — 최저(최약·최냉)·최고(최강·최열) stop 헬퍼.

### 색 강도(g01) → 속도·발광, 강함(s) → 희귀도
- `colorStrength01(stops, T)` = 색가중치를 `[최저,최고]`로 정규화한 **색 강도 g01∈[0,1]**(적색 0 → 청백 1). 속도 감속·발광을 잇는 단일 노브. ([tests/plasmoidSpec.test.ts](../../tests/plasmoidSpec.test.ts))
  - **속도**: 개체 속도 = `arche.speed + (arche.speedMin − arche.speed)·g01` (적색=최고속 `speed`, 청백=최저속 `speedMin`). 아키타입별 구간으로 "최고속 대비 일정 비율까지만 감속"을 보장.
  - **발광**: `glow = 1 + GLOW_STRENGTH·g01` 을 셸·코어 인스턴스 색에 곱해 **청백(강체)일수록 밝게 블룸**, 적색(약체)은 솔리드.
- `strength(spec, hp)` = 로그 정규화 `[0,1]` over `hpFloor`..`hpCeil`. (희귀도/연출용; 속도는 더 이상 이걸 쓰지 않음)
- `speedForStrength(spec, s)` — 레거시 질량 모델(현 아키타입 속도는 `colorStrength01` 사용). `rollAppearance.speed`도 현재 미사용.
- `sampleTemp(tMin, tCap, alpha, u)` — 온도 희귀도 `f(T)∝T^-alpha`의 역CDF 샘플. 고온(강체)일수록 드묾. `alpha=1`은 로그분포 특수처리. 현 스펙 `tempAlpha=2`.

> **폐기된 고도 가중 시스템.** 과거의 `altitudeSpeedMult`/`contactAltWeaken` 함수, `altitude` 스펙 블록, `contact.altWeakRef/altWeakMin`는 모두 제거됐다. 또한 전역 스폰 고도(`spawnAltitude`/`SPAWN_BIAS`/`SPAWN_CEILING`)도 아키타입별 고도 밴드(`spawnAltMin/spawnAltMax`)로 대체됐다. 온도(T)는 색·HP·시각크기·기본속도·희귀도를 계속 구동하지만, 이동 난이도가 고도에 따라 변하지는 않는다.

### 접촉(에너지 흡수) 피해 (`contactDamage(spec, hp)`)
플라즈모이드가 물체에서 **에너지를 빨아들여** 약화시키고(인트로의 집 붕괴 원인) 그만큼 **자신이 성장**한다는 설정. `contactDamage`가 반환하는 단일 수치 = 표적(플레이어/건물) 피해 = 적 성장량(`grow`). (러셔 전용 흡수량 — 카이터는 `drainDamage`를 쓴다.) 카이터·러셔 **둘 다** 흡수 시 `grow`로 성장한다(아래 `EnemyManager.attack`).
- 식: `hpDamage × (1 + strengthMul×strength(hp))` — 강함(s)에만 비례. 강체(`strength` 1)일수록 묵직(×(1+strengthMul)). 고도 의존 없음.
- 현 스펙(`contact`): `hpDamage 10`, `strengthMul 2.0`.

### 스폰 롤 (`rollAppearance(spec, wave, rand)`)
한 마리의 외형/속도를 굴린다(순수 함수, `rand:()=>[0,1)` 주입으로 테스트 결정성). → `{ temp, maxHp, diameter, color, speed }`(`SpawnRoll`).
- 온도 상한 `tCap = min(tMax, tMin + wave×WAVE_TEMP_STEP)` (`WAVE_TEMP_STEP=900`) — 웨이브가 오를수록 강한 청백 개체 해금.
- `temp = sampleTemp(tMin, tCap, tempAlpha, rand())` — 저온 편향(약체가 흔함).
- 체력 산정용 노미널 지름 `nominal = NOMINAL_MIN + rand()×NOMINAL_SPAN + min(NOMINAL_WAVE_CAP, wave×NOMINAL_WAVE_GROW)`(`0.8`/`0.8`/`0.04`). 웨이브 보너스는 `NOMINAL_WAVE_CAP=1.0`으로 캡 — 노미널 지름이 무한 증가하지 않아 HP에 천장이 생긴다(플레이어 데미지는 고정이므로 후반 웨이브의 사실상 불사 개체 발생을 차단; 과거 경계 근처 불사화 이슈 수정).
- `maxHp = plasmoidHp(…)`, `diameter = visualDiameter(…)`, `color = colorAt(…)`.
- `speed = …`(레거시 필드, 현재 미사용). 러셔·카이터 **둘 다** 개체 속도를 `arche.speed↔speedMin`를 `colorStrength01`로 보간해 산출한다(아래 `EnemyManager.spawnOne`).

### 아키타입별 물량 + 스폰 타입 선택 (순수)
- `archetypeCount(arche, wave, matchingPlayers)` — `per = min(countCap, countBase + floor((wave−1)/2))`, × `matchingPlayers`. `matchingPlayers ≤ 0`이면 0. 러셔는 워커 수, 카이터는 플라이어 수에 비례 — **구성 기반 자기정렬**(단일 드론 세션은 매칭 아키타입만 스폰 → 이길 수 없는 미스매치 없음).
- `pickSpawnType(pendingRusher, pendingKiter, rand)` — 두 잔여 예산을 잔여 비율로 가중 추첨해 이번에 스폰할 타입 반환(한 종 0이면 다른 종, 둘 다 0이면 null). 웨이브 내내 두 예산이 섞여 투입된다.

### 기본 스펙 / 로더
- `DEFAULT_PLASMOID` — `public/enemies/plasmoid.json`과 동일(테스트 동치 검증). 비동기 로드가 어려운 곳(인트로 연출, `EnemyManager` 기본값)이 동기적으로 사용.
- 현 데이터(`plasmoid.json`): `hp{ basePerArea 100, minDiameter 0.5, maxDiameter 60 }`; `color.stops` 5단계(3000K `0xff3b30` w1.0 → 12000K `0x4aa6ff` w5.0); `visual{ minDiameter 2, maxDiameter 600, anchorHp 200000, anchorDiameter 500, exponent 0.82 }`(렌더 크기 ×2); `spawn{ tempAlpha 2, speedMax 13.5, speedMin 3.75, hpFloor 100, hpCeil 200000 }`; `contact{ hpDamage 10, strengthMul 2.0 }`; `archetypes.rusher{ name "거머리 플라즈모이드 / LEECH", spawnAltMin 0, spawnAltMax 60, countBase 6, countCap 12, killRefund 5, speed 17, speedMin 12 }`; `archetypes.kiter{ name "모기 플라즈모이드 / SKEETER", spawnAltMin 80, spawnAltMax 300, countBase 3, countCap 5, killRefund 8, speed 89, speedMin 67, turnRateDeg 100, keepDist 60, keepBand 12, strafeMix 0, orbitRef 35, evadeGain 0.85, attackRange 95, drainDamage 1.4, drainInterval 1.5 }`. (`speed`/`speedMin`은 아키타입 공통 base 필드.)
- [plasmoids.ts](../../src/enemies/plasmoids.ts) — `makeLoader("enemies","적")` 기반. `fetchPlasmoidCatalog()`(`public/enemies/index.json`) + `fetchPlasmoid(id)`(`<id>.json`).
- 테스트: [tests/plasmoidSpec.test.ts](../../tests/plasmoidSpec.test.ts).

## CoreEnemy — 플라즈모이드 개체

박동하는 유기적 에너지 구체. 빔 누적 피격으로 쪼그라들다 디졸브 소멸(셰이더).

생성자 `(position, appearance: CoreAppearance, speed=4.5)`:
- `CoreAppearance { maxHp, diameter, color }` — `PlasmoidSpec` 시스템 산출값을 주입.
- `baseScale = diameter / 2`(셸 지오 지름 2 기준).
- **렌더는 하이브리드 InstancedMesh**(대량 처리). 살아있는 개체는 메시를 씬에 안 넣고 시각 상태(`coreScale`/`coreBright`/`glow`)만 보유 → `EnemyManager`가 소유한 **셸·코어 InstancedMesh 2개**에 매 프레임 기록. **디졸브가 시작되면** 개별 그룹(디졸브 셰이더 메시)을 씬에 추가(소수·일시적이라 셰이더 인스턴싱 회피). ([CoreEnemy](../../src/enemies/CoreEnemy.ts), [EnemyManager.updateInstances](../../src/enemies/EnemyManager.ts))
  - 셸(본체) = `MeshBasic`(자체발광, 조명에 탁해지지 않음) instanceColor `color×(SHELL_BASE·glow + 피격가산)`, `DoubleSide`(코앞 적 내부 적중), 그림자. 코어 = `MeshBasic` instanceColor `color×coreBright·CORE_BLOOM·glow`(블룸 발광).
  - 디졸브 셸 머티리얼은 `DoubleSide`. 피격 플래시는 순백 대신 셸 색조로 번쩍여 적/청백 가독성 보존.
- `glow = 1 + GLOW_STRENGTH·g01`(색 강도) → **청백(강체)일수록 환히 빛남**. ([tests/coreEnemy.test.ts](../../tests/coreEnemy.test.ts))

`update(dt, target, speedScale=1, steer?)`는 두 책임으로 분리(가독성):
- **`updateVisual(dt)`** — 피격 플래시(제곱 감쇠) · 디졸브 진행 · 박동(pulse) 스케일/발광. 소멸 중이면 `false` 반환 → 이동 생략.
- **`updateMotion(dt, target, speedScale, steer?)`** — 3D 이동 + 자유 부유 + 공격 쿨다운. 카이터(`setKiter` 설정)면 `kiterVelocity`로 도주/선회, 아니면 추격형(`steer` 제공 시 예측 요격+분리, 없으면 단순 호밍 `pursueStep`). `speedScale`은 추격형에만 곱해지며 현재 매니저가 항상 1을 넘긴다(고도 가중 폐기).

### 흡수 = 성장 (`grow`)
- `grow(amount)` — 드레인/흡수한 만큼 `maxHp`·`hp`를 올리고 **시각 크기도 `maxScale`(초기 `baseScale`의 ~1.5배)까지 점증**. 방치한 모기가 더 크고 탱키해져 쫓아갈 동기를 만든다(살아있을 때만).
- `absorbEnergy(amount)` — `hp`만 `maxHp` 한도 내 회복(크기/최대치 증가 없음). 현 `EnemyManager`는 러셔·카이터 모두 `grow`를 쓰므로 미사용(회복 전용 프리미티브로 보존).
- `setKiter(params)` / `get isKiter` — 카이터 행동 활성화/판별(매니저가 드레인↔접촉 경로 분기).

### 이동 — 자유 부유 + 3D (추격형 / 카이터)
- **지형/물체와 충돌하지 않고** 자유롭게 떠다닌다(지표면 지향성·강하 없음).
- **추격형(러셔):** 플레이어를 향해 **상하 포함 3D**로 다가온다. `steer` 없으면 단순 호밍 `pursueStep`, 있으면 아래 군집 조향을 합성. `STOP_DIST=2.2m` 이내면 추격 정지(접촉 교전 거리). ([tests/pursue.test.ts](../../tests/pursue.test.ts))
- **카이터(모기):** `kiterVelocity(...)`로 `keepDist` 유지 — 너무 가까우면 직접 도주, 그 외엔 **keepDist 구 위 개체 고유 방위(`homeDir`)** 지점으로 향한다 → 무리가 한쪽/한 높이에 뭉치지 않고 **xy·z 모두 고르게 분산**. `homeDir`은 `CoreEnemy.updateMotion`에서 매 프레임 **구면 랜덤워크**(`HOME_WANDER=2.0`)로 표류 → 한 마리도 죽기 전까지 xyz 전 방향 자유 유영(z 위/아래도 수시 전환). `turnToward(cur, desired, turnRate·dt)`로 선회 캡 + 분리 합성. 플레이어 미래 위치(`KITER_FLEE_LEAD=0.35s`) 예측 도주 + 원돌기 시 궤도면 이탈 **수직 회피**(개체별 위/아래 = `homeDir.y` 부호; `orbitRef`/`evadeGain`). `homeDir` 없으면(테스트 폴백) 기존 반경 도주/선회. ([tests/kiter.test.ts](../../tests/kiter.test.ts))
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

### 멀티타깃 표적 선택 (어그로 분산 + 상성 가중 — MP)
- `buildTargets(dt)` — 매 프레임 플레이어별 스냅샷(위치·생존·**속도 EMA** `dt·8`·**비행 여부** `playerIsFlyer`) 갱신.
- 각 적은 `pickTarget`(→ `chooseTarget`)으로 표적 점수 = **거리 × (1+`AGGRO_PENALTY=0.4`·부하) × 상성가중**의 최소를 고른다. **히스테리시스(`TARGET_HYSTERESIS=1.2`)**로 깜빡임 방지, **어그로 부하**로 도그파일 회피.
- **상성 가중(`matchupMul`, MP 혼합팀)** — 카이터↔플라이어 / 러셔↔워커가 상성. 상성이면 ×1, 비상성이면 ×`MISMATCH_PENALTY=3.0`로 점수를 불리하게 줘 **적이 자기 상성 드론을 우선 표적**으로 삼는다(절대 배제 아닌 가중 — 비상성이 충분히 가까우면 노린다). 혼합팀에서 각 플레이어가 자기 레인을 맡고, 솔로의 자기정렬이 인원수만큼 확장된다.
- **미스매치 폴백(`engageKeepDist`)** — 카이터가 어쩔 수 없이 **비상성(워커=지상)**을 노릴 때 `keepDist`를 `KITER_CLOSE_MUL=0.45`로 좁혀(60→27 m) 워커 자동조준 안으로 진입 → "못 잡는 적" 제거(여전히 드레인하되 처치 가능). 상성(플라이어) 표적이면 기본 keepDist 복원. (러셔가 플라이어를 노리면 속도 17≪111로 못 잡아 자연히 2순위 건물로.)
- 재입장(`clear`) 시 속도 추정 리셋(순간이동 스파이크 방지).

### 스폰 (`spawnOne` / `tickSpawns` / `startBurst`)
- **일괄 스폰(`startBurst`, 현행 미션):** 시작 위치(플레이어 무게중심) 중심 **반경 `spawnRadius`(미션값, 기본 1.5km) 원판에 면적 균등 분포**(`rr = √rand·radius`)로 `spawnCount`(기본 100)마리를 **한 번에** 투입. 아키타입은 `pickBurstType`(워커↔러셔/플라이어↔카이터 비례, 자기정렬). 클리어해도 웨이브 자동 재시작 없음(종료는 미션 인스턴스, [08](08-game-instance-mission.md)).
  - **MP 1인당 스케일**: `count`·`totalHp`를 **살아있는 플레이어 수 N배**(보스는 팀당 1기 유지)로 키워 1인당 체감 난이도를 일정하게. 아키타입 비율은 `pickBurstType`이 팀 구성대로 → 워커 a명·플라이어 b명이면 러셔:카이터 ≈ a:b(고아 적 없음).
  - **체력 총합 예산(`totalHp`)**: HP를 온도 롤이 아니라 **예산으로 배분**한다 — `distributeHp(totalHp, bossHp, count, rand)`가 합계 = `totalHp`(기본 7만)로, **index 0 = 중간보스(`bossHp` 기본 1만)** + 나머지 `count−1`기가 `totalHp−bossHp`(6만)를 무작위(0.5~1.5 가중)로 나눠 갖는다. 개체 외형은 **HP에서 산출**(`appearanceForHp`): HP↑ → 고온(청백)·대형(`visualDiameter`)·발광↑·속도↓ → 보스가 가장 크고 푸르게. (`hpFloor`~`hpCeil` 로그 정규화 `strength`로 온도 매핑.)
- 레거시 점진 스폰(`spawnOne`/`tickSpawns`)은 플레이어 무게중심 주변 근거리 밴드(반경 55~205 m, `TERRAIN_HALF` 클램프)에 배치.
- 고도는 **아키타입 고도 밴드**: `alt = spawnAltMin + rand×(spawnAltMax−spawnAltMin)`(러셔 0–60m 지표 / 카이터 80–300m 상공). 최종 y = `world.heightAt(x,z) + alt`. ([tests/spawn.test.ts](../../tests/spawn.test.ts))
- 외형/색은 `rollAppearance(spec, wave, Math.random)`(온도 시스템 유지). **개체 속도**는 색 강도 `g01 = colorStrength01(stops, temp)`로 `arche.speed↔speedMin`를 보간(러셔·카이터 공통), **발광** `glow = 1 + GLOW_STRENGTH·g01`. 카이터는 `setKiter(...)`(구면 균등 무작위 `homeDir` 주입, `turnRateDeg→rad`), 러셔는 `CoreEnemy(pos, app, spd)`. 각 개체에 `killRefund`·`archetypeName` 주입.
- `tickSpawns`는 `pickSpawnType`으로 두 잔여 예산(`pendingRusher`/`pendingKiter`)을 잔여 비율로 섞어 `SPAWN_INTERVAL=0.35s`마다 1마리씩 투입.

### 매 프레임 군집 조향 + 공격 (`update`)
- 프레임 시작 시 표적 스냅샷·살아있는 적 스냅샷(`boids`)·어그로 부하(`load`)를 갱신하고, alive 적에 `{vel, boids, index}`를 `steer`로 넘긴다. 디졸브 중인 적은 비주얼만 진행.
- **표적 우선순위 — 인식 범위(awareness) 히스테리시스:** **기본은 건물 공격**. 플레이어가 **인식 반경(`AWARENESS_RADIUS=200m`)** 안에 들면 그 적은 **플레이어 공격으로 전환**하고, **한번 인식하면 `AWARENESS_LOSE_RADIUS=360m`까지 계속 추격**(히스테리시스: "들어오면 계속, 벗어나면 건물 복귀"). 전환 판정은 `enemy.targetIndex>=0 ? LOSE : AWARENESS` 제곱거리 비교. 건물 공격은 주변(`BUILDING_SEEK_R=700m`) 최근접 건물(`nearestTarget`/`damage` → [BuildingCombat](../../src/world/BuildingCombat.ts), 체력·붕괴·**검정 잔해**는 [03-world](03-world.md#건물-전투-buildingcombat)). 둘 다 공통 `attack()`. 건물이 파괴되면 점진 적색 → 번쩍 → 슬로우 붕괴 → 검정 잔해로 전이.
- **공통 공격 `attack(enemy, targetPos, from, player, buildingId)`:** 아키타입·표적(플레이어/건물) 공통 단일 경로. `tryAttack(targetPos, range, cooldown)` 통과 시 표적에 피해 → 적중하면 **`enemy.grow(amount)`(흡수=성장 — 러셔·카이터 동일)**. 카이터=고정 `drainDamage`·`DrainBeams.spawn(from→targetPos)`, 러셔=`contactDamage(spec, enemy.maxHp)`·빔 없음. 플레이어 피해 시 `onPlayerHit`, 건물이 이 타격으로 파괴되면 true 반환(호출부가 표적 해제).
- **카이터:** 이동 후 `clampKiterAltitude`(지면 위 `KITER_GROUND_CLEARANCE=1.5m` ~ `KITER_CEILING=1020m`로 클램프 — 가라앉음·천장 돌파 방지) 후 `attack`.
- 드레인 빔은 [DrainBeams](../../src/fx/DrainBeams.ts)(가산발광 풀, 적→표적)로 분리. `update`에서 페이드/정리.

### 웨이브 (`startNextWave`)
- 워커·플라이어 수를 세어 `pendingRusher = archetypeCount(rusher, wave, walkers)`, `pendingKiter = archetypeCount(kiter, wave, flyers)`로 **아키타입별 독립 예산** 산정 — 구성 기반 자기정렬(단일 구성은 자기 타입만, 이길 수 없는 미스매치 없음).
- 화면 적이 모두 정화(`enemies.length === 0` + 두 예산 0)되면 다음 웨이브 — 무한 증식.
- 집계: `killCount`(`registerKill(enemy?)`→`onKill`), `wave`(`onWaveChange`). `onPlayerHit`로 피격 통지.
- `registerKill(enemy?)` — `killCount++`, 사망 지점 **최근접 플레이어**를 그 개체의 아키타입 `killRefund`만큼 `heal`(흡수당한 물질 회수).

### 집계 게터
- `hitMeshes` — 레이캐스트 대상 = **셸 InstancedMesh 1개**(`[shellInst]`). 매 프레임 `boundingSphere`를 무효화해 이동한 인스턴스도 광역검사에 잡힘.
- `enemyFromHit(intersection)` — 레이캐스트 적중의 `instanceId`로 적 역참조(`beamFx`/`SpecialStream` 공용). 개별 메시 태그(`getEnemy`) 대신 인스턴스 슬롯 매핑.
- `aliveEnemies` — 살아있는 적 목록(`aliveWorldPositions`와 동일 순서; `SpecialBarrage` 콘 표적 index 역참조용 — 배러지는 레이캐스트 없이 표적에 직접 적용).
- `aliveWorldPositions` — 살아있는 적 월드 좌표(평문; 무기 콘 조준용).
- `aliveMarkers` — 월드 위치 + 시각 반경(`group.scale.x`; 코너 브래킷 등 화면 표식용).
- `aliveSnapshot` — `{x,z}` 위치 스냅샷(미니맵용).

`update(dt)` — 건물 연출(`world.buildings.update`) → 점진 스폰(`tickSpawns`, 미션 모드면 무동작) → 균열 증원(`tickReinforce` — 미션 점진 투입: 동시 상한 미만일 때 피라미드 큐에서 1기, [08](08-game-instance-mission.md) 참조) → 표적/`boids`/`load` 갱신 → 각 적 `update`(표적 좌표 + 조향 전달) + 공통 `attack`(건물 기본/인식 범위 안이면 플레이어, 흡수=성장; **마커는 `markerFire`로 분기** — 시야·사거리·쿨다운 통과 시 낙인탄 발사) → 드레인 빔 갱신 → **낙인/파문 갱신**(`brand.update` — 탐방 모드 제외) → 사망 적 정리 → 웨이브 종료 판정(일괄 모드는 자동 재시작 없음).

## 진형/행동 — 로스터 유닛의 배치와 상태 (조합 정립)

`DeployUnit.formation/behavior/anchor`([EnemyManager](../../src/enemies/EnemyManager.ts)):

- **배치(formationPos, 순수)** — `cluster`: 링 위 한 점 밀집(기본, 산개 70m) · `ring`: 전장 중심 포위
  (반경 lim×0.45, 균등각) · `line`: 중심을 바라보는 가로 전선(간격 28m). escort 유닛은 앵커 유닛
  중심 곁(+80m)에 배치. [tests/reinforce.test.ts](../../tests/reinforce.test.ts) 가 기하를 가드.
- **행동(formationStep)** — `hold`: 배치 지점 고수 · `patrol`: 배치 지점 주위 순회(반경 60m ·
  0.25rad/s, 개체별 위상 분산) · `escort`: 앵커 유닛 개체 추종(전멸 시 재앵커 → hunt 폴백).
  진형 유지 중에도 **사거리 내 기회 공격은 수행**(낙인탄/드레인/접촉 — attack/markerFire 의 사거리·
  쿨다운·시야 게이트 재사용)하고, **피격(provoked) 시 진형을 버리고 hunt 로 전환** — "축 하나를
  건드리면 그 축이 응답한다". 어그로 변조(aggro)·건물 공격 로직은 hunt 전환 후부터 적용.

## deploy 모델 — 미션 투입기 3종 (훅 ① — [06-missions](../spec/06-missions.md))

- **`startBurst`(pyramid)** — 피라미드 배분 점진 증원(아래 스폰 절). `startHorde` — 균일 저체력 `unitHp`×`count`,
  같은 균열 증원 인프라(상한+간격), 강도 곡선/보스 없음(핵앤슬래시 전용). `startRoster` — **고정 조합 전량
  즉시·증원 없음**: `DeployUnit{role, count, hp}` 배열, 유닛 그룹마다 전장 링 위 클러스터 배치(반경
  `ROSTER_CLUSTER_R` 70m — 편대가 한 덩어리로 읽힘; 진형 필드는 조합 정립 단계). role `elite` = 고체력
  러셔(색·크기는 HP 가 결정 — 청백), `boss` = 다중 투영 그룹 ×count(`bossProjections` 인자로 투영 수 지정).
- 공통 준비는 `beginMissionDeploy`(리셋·구성 스냅샷·균열 앵커 이격). MP 스케일: 비보스 물량·상한 ×인원,
  보스 그룹은 팀 공유. 테스트: [tests/reinforce.test.ts](../../tests/reinforce.test.ts).

## 다중 투영 보스 (§2.6 — HP 공유 구체)

미션 보스 예산(`bossHp`) 1기는 단일 구가 아니라 **HP 를 공유하는 투영 3기**(`BOSS_PROJECTIONS`)로 균열 주변에 등장한다
(`spawnBossProjections`) — 하나의 손이 드리우는 여러 그림자. 어느 구를 때려도 같은 풀(`CoreEnemy.sharedPool`)이 줄므로
**가장 느리고 가까운 구를 때리는 게 정답**(투영별 속도 차 `BOSS_SPEED_MULS`). 풀 소진 시 전 투영 동반 소산(`forceDissolve`),
처치 크레딧·환수(`BOSS_KILL_REFUND 15`)는 **그룹당 1회**(풀의 `killCredited` 래치 — 미션 격멸 수 계약 유지). 피격 순간
형제 투영으로 빛 필라멘트가 스치는 연출(`DrainBeams` 재활용, `BOSS_FILAMENT_CD` 스로틀)은 §1.10 계시 복선("이어져 있다")의
상시 리마인더다. 테스트: [tests/reinforce.test.ts](../../tests/reinforce.test.ts).

## BrandSystem — 낙인 유도탄 + 심판 파문 (서사편 §6.1 ① MARK)

[`BrandSystem.ts`](../../src/enemies/BrandSystem.ts) — 전투의 새 박자 "**낙인 회피 → 파문 전 대응 → 파문 통과**". EnemyManager 가 소유.

- **낙인 유도탄** — 마커가 발사(`launch`). 느린 호밍(순수 `homingStep` — `turnToward` 재사용, 선회 캡이라 회피 가능). 명중 시 표적 드론에 **낙인 부착(무피해)**, 붉은 팔면체 글리프 결정(§6.1 "붉은 글리프 결정화" — 캔버스 텍스처 없는 헤드리스 안전 메시)이 맥동·자전하며 날아온다.
- **심판 파문**(내부 id `sweep`) — 개체가 아닌 **전장 이벤트**. `SweepSpec{period 30, speed 250, warnSec 5, maxRadius 1600}` 주기로 균열 앵커(`riftAnchor` — 일괄 스폰 중심 또는 전투 개시 지점)에서 붉은 원통 파면이 확장. **낙인 붙은 표적만** 파면 교차([prevR, curR) 반개구간 — 진앙 포함, 균열 중심 면제 없음) 시 낙인 1개당 `sweepDamage` 피해(순수 `sweepCrossed`/`brandDamage`), 통과와 함께 낙인 소모(머시 무적이어도 소모). 낙인 없으면 무해한 전장 박자.
- **카운터 연동** — `notifyDead(enemy)`(`registerKill` 에서 호출): 격파된 마커의 유도탄·낙인 일괄 소산("마커 우선 격파"). 관측 고정(W1) 동결은 `tryAttack` 게이트로 장전 자체를 인터럽트. 빔 조사로 낙인 소각(W4 복구 사격)·건물 낙인(커터)은 후속 단계 🔭.
- **HUD** — `warnLeft`(예고 잔여 s / 파면 중 0 / 그 외 null)·`brandCount(idx)` 를 `EnemyManager.sweepWarnLeft`/`brandCount()` 로 노출, `Game` 이 매 프레임 폴링해 `HUD.setReckoning` 표시("낙인 ×n — 근원을 격파하라" / "심판 파문 도래 Ns"). 표면 어휘는 §8.2 준수(sweep/tomb/marker 는 코드 전용).
- 테스트: [tests/reckoning.test.ts](../../tests/reckoning.test.ts) (호밍 선회 캡·파면 교차·낙인 무피해/소모·근원 소산·예고), [tests/zeno.test.ts](../../tests/zeno.test.ts) (관측 고정).

## 재정립 2단계 + 대위상 세트 (P2~P3, 2026-08)

- **위상 이탈**(물리편 §2.1) — [PlasmoidSpec.phase](../../src/enemies/PlasmoidSpec.ts)(phaseRoll/
  phaseTimings — 강함 보간) + CoreEnemy 상태기계. 이탈 중 발광 감쇠(PHASE_DIM)·일반 무기 무효·공격
  불가·오토/어시스트/브래킷 제외·미니맵 빈 원. 카운터: `manual.decohere`(관측 펄스 — 강제 실체화) ·
  `manual.pinSec`(W2 관측 계류 — 재이탈 봉쇄). [tests/phase.test.ts](../../tests/phase.test.ts)
- **커터(절단체)** — cutterStep: 건물 상단 부착 → 절단 채널(W1 동결·경직 인터럽트) → 납치
  (BuildingCombat `abducting`: 부양·창백 틴트·고도 200 소거(잔해 없음)·격추/W4 `manual.mend` 재안착).
  [tests/abduct.test.ts](../../tests/abduct.test.ts)
- **역행체(리와인더)** — rewinderCast(시전 4s → performRewind: killLog 반경 내 부활(계류 확정 제외,
  상한 8, 스폰은 다음 프레임 서두 — 순회 정합)·killCount 되감김·플레이어 위치 역행(posHistory)).
  예지 HUD = onRewindCast 카운트다운. [tests/rewinder.test.ts](../../tests/rewinder.test.ts)
- **준위 강등** — kkLevelOf(75/50/25% 계단)·kkLevelColors, KK_MIN_HP 이상만. 색 강등+경직+방출 펄스.
- **역할 실루엣** — 직무별 셸 InstancedMesh 5종(가시 구/사면체/글리프 결정/절단 쐐기/시간 고리) +
  디졸브 동형(applySilhouette) + 낙인탄 장전 조준선(0.7s) + 러셔 돌진(15~60m, 4.5s 쿨).
- **동시 조사 판정** — 모든 피격이 `observedLeft`(0.6s 창)를 갱신 → `observedCount`(experiment 골 입력).
