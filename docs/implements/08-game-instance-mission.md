# 08 · 게임 인스턴스 & 미션

소스: [GameInstance.ts](../../src/game/GameInstance.ts), [mission.ts](../../src/game/mission.ts),
[missions.ts](../../src/game/missions.ts), 데이터: [public/missions/index.json](../../public/missions/index.json) ·
연동: [core/Game.ts](../../src/core/Game.ts) · 가드: [tests/mission.test.ts](../../tests/mission.test.ts)

## 개념 — 한 플레이타임 = 한 인스턴스

게임에 진입하면(전장+기체 선택 → 출격) **게임 인스턴스**가 생성된다. 인스턴스는 그 플레이타임의
**미션(목표/종료 조건)** · **경과 시간** · **리스폰 예산** · **플라즈모이드/건물/랜드마크 상태**를 한곳에서
집계·관리하고, 매 프레임 미션 상태를 평가해 성공/실패로 종료한다. 향후 **멀티플레이도 이 인스턴스가
팀 전체(`players[]`)를 관장**하도록 설계됐다(현재 1인 → `[player]`).

```
selectMap → 시스템 빌드(world/player/enemies/…) → GameInstance 생성(미션 배정)
beginPlay → instance.start()         // 타이머·리스폰 예산 리셋
frame    → instance.update(dt)       // 타이머 진행 + 미션 평가 → 종료 시 onEnd
death    → instance.registerDeath()  // 리스폰 가능?  제자리 부활 : 미션 실패
end      → 결과 패널 → 재시작(reload 재출격)
```

## 미션 모델 (순수 — mission.ts)

전투 수치/규칙은 전부 데이터(`MissionSpec`)에서 오고, 평가 로직은 THREE/DOM 비의존 **순수 함수**라
단위 테스트로 고정한다([tests/mission.test.ts](../../tests/mission.test.ts)).

### 미션 종류(`MissionKind`)
| kind | 목표 | 성공 | 실패 |
| :--- | :--- | :--- | :--- |
| `eradicate` | 제한시간 내 플라즈모이드 N기 격멸 | `kills ≥ killTarget` | 시간 초과 · 리스폰 소진 |
| `defend-buildings` | 도시 방어(건물 손실 N채 미만) | 시간 만료까지 생존 | `buildingsDestroyed ≥ maxBuildingLoss` · 리스폰 소진 |
| `defend-landmark` | 랜드마크 사수(파괴 0) | 시간 만료까지 생존 | `landmarksDestroyed ≥ maxLandmarkLoss` · 리스폰 소진 |
| `survival` | 지역 사수(최소 기체 손실) | 시간 만료까지 생존 | 리스폰 소진 |
| `free-roam` | 탐방(목표/종료 없음) | — | — |

- **명세(`MissionSpec`)**: `id`·`name`("국문 / ENGLISH")·`kind`·`duration`(초; 0=무제한)·`killTarget`·
  `maxBuildingLoss`·`maxLandmarkLoss`·`respawns`(<0=무한)·**`zoneRadius`**(교전 구역 반경 m, 0=무제한)·
  **`spawnCount`**(총 투입 수, 0=웨이브)·**`spawnRadius`**(초기 투입 분산 반경 m)·**`totalHp`**(투입 체력 총합 예산)·
  **`bossHp`**(중간보스 1기 체력)·**`concurrentCap`**(동시 개체 상한 — >0 = 점진 투입)·**`reinforceInterval`**(증원 간격 s).
  데이터 = [public/missions/index.json](../../public/missions/index.json).
  - **작전구역(`zoneRadius`, 기본 5km)** — 시작 위치 중심 원. **플레이어·플라즈모이드 모두** 이 밖으로 못 나간다
    (`PlayerController.setZone`은 경계에서 바깥 속도 제거; `EnemyManager.setZone`은 매 프레임 적 위치를 원 안으로
    클램프 — 공통 순수 `clampToDisk`). 미션마다 다른 크기 가능. 탐방은 0(무제한). **중심은 건물 밀집 도심**
    (`pickSpawnChunk` 밀집도 상위, [03-world](03-world.md#streamingworld--전지구-타일-월드청크-스트리밍)). 경계는
    **반투명 에너지 벽**([EnergyWall](06-ui-menu-intro.md#fx)) + 미니맵 호박색 호로 표시된다.
  - **점진 투입(`spawnCount`/`spawnRadius`/`concurrentCap`/`reinforceInterval`, 기본 45/1.5km/26/1.5s)** —
    초기에 상한×0.6 기만 반경 `spawnRadius` 원판에 투입하고, 나머지는 **균열 앵커**(전장 중심에서
    `spawnRadius`×0.5 이격 — 위협 방향, 소산 표류·심판 파문과 동일 지점) 주변 링(40–200m)에서
    `reinforceInterval` 간격으로 **동시 상한 미만일 때만** 1기씩 증원(`EnemyManager.startBurst`+`tickReinforce`).
    처치가 곧 증원 유입 = 압력 항상성. `concurrentCap 0` 이면 레거시 일괄(전량 즉시). `spawnRadius ≤ zoneRadius`.
  - **체력 총합(`totalHp`/`bossHp`, 기본 7만/1만)** — 투입 전체 HP 합 = `totalHp`. **피라미드 배분**(`pyramidHp`):
    잡몹 60%(가중 1) → 중견 30%(가중 5) → 정예 10%(가중 13) 순으로 증원 큐가 소비되어 **뒤로 갈수록 강해지고**,
    **중간보스(`bossHp`)가 마지막**에 등장(클라이맥스). HP가 클수록 크고 푸른 개체(보스가 최대) —
    상세는 [05-enemies](05-enemies.md#스폰-spawnone--tickspawns--startburst). *(일괄 100기 모델은 도시 붕괴
    속도·역삼각 압력 곡선 문제로 폐기 — 플레이테스트 근거, [tests/reinforce.test.ts](../../tests/reinforce.test.ts).)*
- **평가 입력(`MissionRuntime`)**: `elapsed`·`kills`·`buildingsDestroyed`·`landmarksDestroyed`·`deaths`.
- **v2 런타임(훅 ② 복합 실패 조건)** — `GameInstance` 는 `MissionSpecV2`([missionV2.ts](../../src/game/missionV2.ts))를
  구동한다: 승리(goal)와 무관하게 **fail 4종(리스폰·시간·건물 한도·랜드마크 한도)을 동시 평가**
  (`evaluateMissionV2` — v1 의 마감 프레임 의미론 유지: 격멸형은 성공 우선, 생존/사수형은 실패 우선;
  실패 우선순위 랜드마크→건물→리스폰→시간). `missions/index.json` 은 v2 형식이며 v1 항목도
  `normalizeMissionPool`(fromLegacy)로 수용, 미지원 goal/deploy 는 `runnableV2` 가 거른다.
  첫 소비처: "정밀 정화 / SURGICAL"(격멸+건물 한도 — [06-missions §3-F](../spec/06-missions.md)).
- **deploy 모델 분기(훅 ①)** — `Game.beginPlay` 가 v2 `deploy` 유니온으로 투입기를 고른다:
  `pyramid`→`startBurst` · `horde`→`startHorde` · `roster`→`startRoster` · `boss`→`startRoster`(boss 유닛
  + escort, `projections` 지정). `purge-all` 목표치는 `deployKillCredits(deploy)` 로 스펙에서 도출(보스
  그룹 = 1크레딧 — 다중 투영의 처치 크레딧 계약과 일치). 신규 미션: 대정화(horde)·편대 해체(roster)·
  삼중 투영(boss).
- **직무별 격멸(훅 ③)** — `purge-role` goal: 개체의 **투입 직무**(`CoreEnemy.deployRole` — elite/boss 는
  행동(role)과 별개로 태깅)를 `EnemyManager.roleKills` 가 집계(보스 = 그룹당 1)하고, 목표치는
  `deployRoleCredits(deploy, role)` 로 스펙에서 도출(roster/boss 투입 한정). 잡몹 처치는 목표에 안 잡혀
  "표적 식별"이 곧 플레이가 된다. 표면 문구는 `DEPLOY_ROLE_NAMES`(소인체·정예·거대 투영 — §8.2 허용
  어휘). 신규 미션: 근원 사냥 / BRAND HUNT(소인체 6기 전멸).
- **어그로 변조(훅 ④)** — `modifiers.aggro`: `EnemyManager.setAggro`(투입 후 지정 — clear 가 "player" 리셋).
  building/landmark 성향은 **인식 반경 0**(피격 provoked 시에만 플레이어 교전), landmark 는
  `BuildingCombat.nearestLandmark`(거리 무제한 — 소수 전수 탐색)로 직행 후 일반 건물 폴백.
  변조 게이트: `SUPPORTED_MODIFIERS`(현재 aggro) 외 변조 지정 미션은 `runnableV2` 가 풀에서 제외.
  신규 미션: 오래 선 자리 / DEEP ROOTS(aggro: landmark — 얽힘 택소노미 §8 의 첫 체감) + 정밀 정화에
  aggro: building 적용.
- **보스 행동 확장(훅 ⑤)** — deploy `boss` 의 `emit`(살아있는 보스 주변 링에서 주기 분출, 전장 생존
  상한 게이트) · `ownSweep`(심판 파문 원점 = 살아있는 보스, 소산 시 균열 폴백) · `groups`+`healLink`
  (그룹 간 range 내 상호 회복 — 필라멘트로 가시화: "떼어놓거나 함께 태워라") · `RosterUnit.shield`
  (호위 생존 중 받는 피해 배수 — `CoreEnemy.damageMul`, 표시 데미지도 감쇄 반영, 호위 전멸 시 해제).
- **페이즈·구역·변조(훅 ⑥)** — `runDeploy`(GameInstance)가 deploy 모델 공용 매핑을 담당하고,
  phased 는 첫 페이즈만 즉시 투입 후 GameInstance 가 트리거(전멸 `fieldCleared` / `afterSec`)마다
  `fresh=false` 로 이어 투입(킬·채점 카운터 관통 누적, HUD 웨이브 = 페이즈 번호). `zoneShrink` 는
  Game 이 주기마다 반경 축소 + 플레이어/적 존 갱신 + 에너지 벽 재생성 + 저음 신호. `freqRegenMul`
  은 PlayerController 게이지 회복 배수, `sweepPeriodMul` 은 BrandSystem 파문 주기 배수.
  신규 미션 8종: 호위 붕괴·성숙체·쌍생·정예 소탕·이중 전선·최후 저지선·해일·옅은 장(총 18미션).
  체계 정본·패턴 카탈로그는 [06-missions](../spec/06-missions.md), 테스트는 [tests/missionV2.test.ts](../../tests/missionV2.test.ts).
- **결과 채점(공명 점수)** — 종료 패널이 `EnemyManager.stats`(근원 격파·파문 무상 통과·관측 고정)를 집계해
  `정화×10 + 근원 격파×25 + 무상 통과×40 + 관측 고정×5 + 성공 보너스 500` 을 표시(`Game.endMission`).
  "어떻게 싸웠는가"의 가시화 — 서사편 §7 W5(공명 각인)의 선행 형태이며 표면 어휘 규칙(§8.2)을 따른다.
  인스턴스가 매 프레임 시스템에서 집계해 만든다(부수효과 없음).
- **`evaluateMission(spec, rt) → {status, progress, reason}`** — `status`는 `active|success|failed`.
  **실패 조건을 시간초과-성공보다 먼저** 검사해 마감 프레임 동시 충족을 실패로 우선한다(방어 미션). 단
  `eradicate`는 목표 달성을 최우선(같은 프레임 시간초과여도 성공).
- **리스폰 실패(`deathFail`)** = `respawns ≥ 0 && deaths > respawns` — 예산을 넘는 사망이면 실패.
- `missionObjectiveText`/`missionProgressText` — HUD 배너 문구(정적 목표 + 실시간 진행).
- `pickMission(pool, u)` — `u∈[0,1)` 비례로 풀에서 1개 선택(순수, 난수 주입). 빈 풀은 `FREE_ROAM` 폴백.

### 미션 배정 — 인스턴스마다 랜덤
출격 시 `fetchMissions()`(데이터 풀)에서 `pickMission(pool, Math.random())`로 하나를 뽑는다. **탐방
(peaceful) 모드**는 적이 없으므로 목표·종료가 없는 `FREE_ROAM`(무한 리스폰)을 배정한다. 풀 로드 실패
시 내장 `DEFAULT_MISSIONS`로 폴백(전투 진입 차단 방지) — `DEFAULT_MISSIONS ≡ public/missions/index.json`.

## 런타임 인스턴스 (GameInstance)

`GameInstance`는 미션 + 시스템 참조(`players[]`/`enemies`/`buildings`)를 들고 런타임 집계·타이머·콜백만
담당한다(평가는 순수 mission.ts에 위임).

- **`start()`** — `elapsed`/`deaths`/`respawnsUsed`/상태 리셋(새 플레이타임).
- **`update(dt)`** — 활성 중이면 타이머 진행(`free-roam`은 시간 멈춤) + `evaluateMission`. 종료 전이
  프레임에 **`onEnd(outcome)` 1회** 호출(이후 비활성 — 중복 방지).
- **`registerDeath() → boolean`** — 사망 통지. 리스폰 예산이 남으면 `true`(호출부가 제자리 부활) ·
  소진이면 `false`(다음 평가에서 `deathFail`로 실패). **`finalize()`** 는 소진 즉시 종료 평가 강제.
- **게터**: `isActive`·`outcome`·`timeLeft`(∞=무제한)·`respawnsLeft`(∞=무한)·`elapsedSec`·`deathCount`·
  `playerCount`(MP). **`snapshot()`** — HUD용 `{objective, detail, timeLeft, respawnsLeft, progress, status, reason}`.

## Game 연동 — 상태/루프/리스폰

[Game.ts](../../src/core/Game.ts)의 `Session`에 `instance: GameInstance`가 추가됐다.

- **생성**(`selectMap`) — 시스템 빌드 후 미션 배정 → `new GameInstance({ mission, players:[player], enemies, buildings })`.
- **시작**(`beginPlay`) — `instance.start()` + HUD 미션 배너 초기화(`setMission`/`updateMission`).
- **프레임**(`frame`) — 시뮬레이션 끝에 `instance.update(dt)` → (비탐방) `snapshot()`을 HUD에 푸시.
  종료 전이는 `onEnd → endMission`이 처리하므로, 사망 처리는 **여전히 `playing`일 때만** 수행한다.
- **사망**(`handlePlayerDeath`) — `instance.registerDeath()`가 `true`면 **제자리 부활**
  (`player.respawn()` = 스폰 복귀 + 1.5s 무적, **적/미션/처치 유지**) + 피격 플래시. `false`면
  `instance.finalize()`로 미션 실패 전이.
- **종료**(`endMission(outcome)`) — 포인터락 해제 + 결과 패널("작전 완수/실패" + 사유 + 정화 수).
  상태는 기존 `dead`를 재사용한다.

> `player.respawn(protectSec=1.5)`([PlayerController](../../src/player/PlayerController.ts))는 `reset()` +
> 짧은 무적으로 스폰 즉사를 막는다. `reset()`(전체 초기화)과 달리 적/웨이브/처치 수는 건드리지 않는다.

### 재시작 = reload 재출격 (단일 세션 모델 유지)
미션 종료 후 **재시작은 페이지 reload**로 클린 인스턴스(새 랜덤 미션)를 만든다 — 기존 "세션 1회 +
reload" 모델([01-architecture](01-architecture.md#상태-머신))과 일치하고, EnemyManager·BuildingCombat
상태 리셋 경로를 새로 만들지 않아 안전. 출격 정보는 `sessionStorage`(`core.deploy`)에 저장하고,
"다시/RETRY"는 재출격 플래그(`core.retry`)를 세운 뒤 reload → 부팅 시 `maybeAutoRedeploy()`가 메뉴를
건너뛰고 같은 전장/기체로 바로 재출격한다. "전장 선택/CHANGE MAP"은 두 키를 지우고 메뉴로 reload.

## HUD — 미션 배너

[index.html](../../index.html) `#missionBar`(상단 중앙, 게이지 아래) + [HUD.ts](../../src/ui/HUD.ts):
- `setMission(objective, visible)` — 정적 목표 문구(탐방이면 `visible=false`로 숨김).
- `updateMission(timeLeftSec, detail, respawnsLeft)` — 잔여 시간(`m:ss`, 30초 이하 경고색) · 진행 상세
  (`32 / 60`, `손실 3 / 10` 등) · 잔여 리스폰(`⟳ 3`/`⟳ ∞`). 매 프레임 갱신.

## 멀티플레이 구조 (워커/플라이어 혼합팀)

전장에 워커/플라이어 여러 대가 동시에 존재하는 경우까지 **시뮬레이션은 이미 N-플레이어로 정확**하게
동작하도록 설계됐다(렌더/입력/네트워킹은 후속). 핵심은 **팀 명부(`players[]`)** 를 1급 개념으로 두고
스폰·타깃팅·예산·미션을 그 명부 위에서 처리하는 것:

- **명부 = `players[]`** — `EnemyManager`·`GameInstance` 둘 다 받는다. 현재 로컬 1인은 `[player]`,
  원격 플레이어는 이 배열에 아바타로 합류한다(아래 시임).
- **구성 비례 스폰(자기정렬)** — `pickBurstType(walkers, flyers)`/`archetypeCount(..., matchingPlayers)`가
  팀의 워커:플라이어 비율대로 러셔:카이터를 뽑는다 → **고아 적이 없음**(플라이어 0명이면 카이터 0).
- **1인당 스케일** — `startBurst`가 `count`·`totalHp`·`concurrentCap`을 살아있는 인원 N배로(보스 1기 공유) → 1인당 체감 일정.
- **상성 타깃팅** — 적은 자기 상성 드론을 우선 표적(카이터→플라이어/러셔→워커, `matchupMul`+`MISMATCH_PENALTY`).
  혼합팀에서 각자 자기 레인을 맡고, **미스매치 폴백**(`engageKeepDist`)으로 어쩔 수 없는 매칭도 처치 가능.
  상세: [05-enemies](05-enemies.md#멀티타깃-표적-선택-어그로-분산--상성-가중--mp).
- **팀 집계** — 인스턴스가 처치/건물손실/사망을 팀 단위로 모은다(`killCount`·`deathCount`·`playerCount`).
  리스폰은 현재 팀 공유 예산(필요 시 1인당으로 분리 가능).

### 네트워킹 시임 (후속)
- **권위 분리** — 미션 평가(`evaluateMission`)·표적/조향·HP는 모두 순수/결정적이라 **권위 서버에서 그대로
  재사용**, 클라이언트는 표시만. `MissionRuntime`·적 스냅샷만 동기화하면 종료 판정이 일치.
- **원격 플레이어 합류 지점** — 원격 아바타를 `PlayerController` 호환 객체로 만들어 `EnemyManager`/
  `GameInstance`의 `players[]`에 push하면 스폰·타깃팅·스케일이 자동 반영(로컬 클라이언트는 `session.player`
  만 카메라/입력/HUD로 렌더). 입력은 플레이어별로 라우팅.
- `onEnd`/`snapshot()`가 네트워크 경계의 자연스러운 직렬화 지점. 교전 구역(`zoneRadius`)은 현재 플레이어별
  (각자 스폰 중심) — 공유 전장 구역으로 바꿀지는 네트워킹 설계 시 결정.

## 캠페인·진행·감독 배선 (P0~P2, 2026-08)

- **캠페인**([campaign.ts](../../src/game/campaign.ts) — 순수): CHAPTERS 7장·evidenceGains(트랙 4종)·
  applyMissionResult(도시 상태/벡터/자매쌍/챕터 전진)·applyRevelation(5→6장)·sortieLinkReport(2연전)·
  sutureReadout(재독 점수판)·pickCampaignMission(챕터 가중 = 규칙 기반 감독). Game.endMission 이
  MissionReport 를 만들어 campaignStore/progressStore 에 적립. 메뉴: 사건 파일·표류 오버레이·도시 상태 점.
- **experiment 골**(v2) — GameInstance 가 observedCount≥targets 프레임만 observeHold 누적(이탈 시
  2배속 감쇠), 성공 시 계시(recallAll + 계시 패널 + 6장 문법 전환).
- **진행 MVP**([progression.ts](../../src/player/progression.ts) — §7.4): xpForKill(강함 비례)/
  levelFromXp/droneGrowth. 출격 시점 스냅샷: applyGrowth(HP/재생) + scaleWeaponDamage(무기 배수).
- **LLM 감독 파일럿**([directorClient.ts](../../src/game/directorClient.ts) — §10 단계 1):
  RemoteDirector(45s 주기 스냅샷 POST, 8s 타임아웃, 실패=개입 없음) → validateDirectorActions 통과분만
  Game.applyDirectorAction(변조/증원/brief→HUD 통신 라인). 엔드포인트: `?director=<url>`/localStorage.
