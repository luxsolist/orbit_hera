# CORE — 구현 문서 (Implementation Notes)

이 디렉터리는 현재 코드베이스에 **실제로 구현되어 있는** 내용을 시스템 단위로 정리한다.
게임 디자인 비전은 [../spec/overview.md](../spec/overview.md), 현행 데이터/규칙 명세는
[../spec/](../spec/01-data-schemas.md), 사용자용 요약은 [../../README.md](../../README.md)를 참고한다.

> 기준 버전: `package.json` v0.3.0 · 스택: Three.js(WebGL2) + Vite + TypeScript(strict)
> 테스트: Vitest 단위 **703개**(40파일) + Playwright e2e 스모크(인트로 + 카탈로그 전 전장 = 스트리밍 3맵)

## 핵심 설계 원칙

- **데이터 구동 콘텐츠** — 드론/무기/맵은 런타임 JSON. 새 콘텐츠는 `src/` 수정 없이 파일 추가만으로
  도입(스키마 [../spec/01-data-schemas.md](../spec/01-data-schemas.md)).
- **순수 코어 분리** — 적분/조준/스폰/투영 등 핵심 로직은 부수효과 없는 export 함수로 빼서 단위
  테스트로 고정(`stepVerticalVelocity`, `pursueStep`, `bestAlignedDir`, `archetypeCount`, `pickSpawnType`,
  `chooseTarget`, `stickyMinIndex`, `kiterVelocity`, `applyHeal`, …).
- **콜백 배선** — 시스템 간 결합은 콜백(`onKill`, `onFired`, `onDeploy` …)으로 느슨하게.

## 문서 색인

| 문서 | 내용 |
| :--- | :--- |
| [01-architecture.md](01-architecture.md) | Game 오케스트레이터 · 상태 머신 · 프레임 루프 · 데이터 구동 로딩 · 렌더 셋업 |
| [02-input-and-player.md](02-input-and-player.md) | 입력(Pointer Lock/키보드) · 보행/비행 컨트롤러 · 충돌 서브스테핑 · 모바일 컨트롤 |
| [03-world.md](03-world.md) | World/StreamingWorld 빌더 · 청크 스트리밍(표면 베이크 텍스처·수역 구멍·건물 높이 보간) · TerrainField · SkyEnvironment · CollisionWorld · 특수 권역(precinct) · 건물 전투(체력·검정 잔해·파괴) |
| [04-weapons.md](04-weapons.md) | 드론별 빔(중주파/경주파·듀얼 발사관) · 특수(살포/오버드라이브 스트림) · 360°오토+수동조준 · 데미지/감쇠/쿨다운 · 공유 발사·상태기계 · 절차적 사운드 |
| [05-enemies.md](05-enemies.md) | 플라즈모이드 **온도(T) 데이터 시스템**(색·체력·크기·속도·스폰분포) · **아키타입**(러셔/카이터) · CoreEnemy(주입형 외형·3D 추적·디졸브) · 멀티타깃 어그로/웨이브 매니저 |
| [06-ui-menu-intro.md](06-ui-menu-intro.md) | 세계지도 메뉴(근접 점 클러스터링 + 확대 지도 드릴다운 · 탐방 모드 토글) · HUD(조준선 둘레 적방향 화살표 · 미션 배너) · 미니맵/후방뷰 · 인트로 컷씬/절차적 배경음악 · 메뉴 배경 · FX |
| [07-build-test-tooling.md](07-build-test-tooling.md) | Vite(소스맵 hidden + 난독화) · 테스트 스위트 · e2e · 월드맵 생성기 |
| [08-game-instance-mission.md](08-game-instance-mission.md) | 게임 인스턴스(플레이타임 컨테이너) · 미션 시스템(격멸/도시·랜드마크 방어/사수, 순수 평가) · 리스폰 예산 · 미션 종료/재출격 · MP 확장 지점 |

## 소스 트리

```
src/
  main.ts                    진입점 — Game 부트스트랩
  core/
    Game.ts                  루프/상태/세션 오케스트레이션(+ 인스턴스 수명/재출격)
    Input.ts                 키보드 + Pointer Lock + 합성 입력
    MobileControls.ts        가상 조이스틱 + 버튼 클러스터(가로 전용)
    Sfx.ts                   절차적 발사음(Web Audio — 노이즈 주도 에너지 방전음)
    loader.ts                제네릭 JSON 카탈로그 로더
    math.ts                  공용 순수 유틸(clamp/lerp/Vec3/parseHexColor)
    Diagnostics.ts           온디바이스 진단(?diag — 컨텍스트손실/에러/메모리/하트비트)
  game/
    mission.ts               미션 명세/평가(순수) + 풀 선택 — 격멸/방어/사수/탐방
    GameInstance.ts          플레이타임 인스턴스 — 미션·시간·리스폰·건물/적 상태 집계(MP 대응 players[])
    missions.ts              미션 풀 fetch(public/missions/index.json, 폴백 DEFAULT_MISSIONS)
  player/
    DroneSpec.ts             드론 데이터 타입(보행/비행)
    PlayerController.ts       데이터 구동 FPS 컨트롤러(보행/비행) + 순수 헬퍼(heal/applyHeal/respawn 포함)
    drones.ts                드론 카탈로그/스펙 fetch
  weapons/
    WeaponSpec.ts            무기 타입(beam/barrage/stream) + damageForDistance/cooldownReadyFrac
    FrequencyBeam.ts          히트스캔 빔(360°오토+수동, 듀얼 발사관)
    SpecialBarrage.ts         다중 빔 살포(콘 다중타깃 특수)
    SpecialStream.ts          오버드라이브(듀얼 발사관 집중 연사 특수)
    DrainCycle.ts            소진형 특수 상태기계(발동/소진/사용후쿨다운, 순수)
    targeting.ts             공유 콘 조준(순수)
    beamFx.ts                빔/글로우 비주얼 + 공유 발사(fireEmitters)·컴포저 해제
    weapons.ts               무기 카탈로그/스펙 fetch
  enemies/
    PlasmoidSpec.ts          온도(T)→색/체력/크기/속도/스폰분포 + 아키타입(rusher/kiter) 시스템(순수)
    CoreEnemy.ts             플라즈모이드(주입형 외형·아키타입 거동·3D 추적·디졸브·태깅) + chooseTarget/stickyMinIndex/kiterVelocity(순수)
    EnemyManager.ts          멀티타깃 어그로 + 아키타입별 스폰 예산(archetypeCount/pickSpawnType, 순수)/웨이브/집계
    plasmoids.ts             적 카탈로그/스펙 fetch
  world/
    GameWorld.ts             World/StreamingWorld 공통 표면 인터페이스(Game이 동일하게 소비)
    World.ts                 모놀리식 전장 메시 빌더(지형/건물/도로/수역/랜드마크/담장)
    StreamingWorld.ts        전지구 청크 스트리밍 월드(1024m 타일·부동 원점)
    chunkStream.ts           청크 스트리머(속도 프리페치·히스테리시스·시간예산 큐·LRU)
    chunkMesh.ts             청크 메시 빌더(지형 표면 베이크 텍스처·수역 구멍·건물 높이 보간·리본)
    chunkManifest.ts         청크 메타/타일 매니페스트 + 셀·블록 경로/격자 좌표(순수)
    mapLocator.ts            위경도 → 청크/랜드마크 로케이터(manifest fetch·근접 청크)
    BuildingCombat.ts        건물/랜드마크 전투(체력·점진 적색·붕괴·검정 잔해 인스턴싱·스트리밍 영속)
    TerrainField.ts          지형 높이·도심/경계 마스크(순수 질의)
    SkyEnvironment.ts        조명·하늘·태양 그림자 추종
    CollisionWorld.ts        OBB/삼각/원/담장 콜라이더 + 격자 브로드페이즈
    SpatialGrid.ts           균일 격자 공간 인덱스
    StructureBuilder.ts      데이터 구동 랜드마크(parts/mats) 인터프리터
    precinct.ts              권역 건물 양식 해석(순수)
    MapData.ts               맵 데이터 타입 + PrecinctSpec
    maps.ts / geo.ts         맵 fetch / 지오메트리 색 유틸
  ui/
    MenuScreen.ts            세계지도 전장 선택 메뉴 + 팝업
    HUD.ts, Minimap.ts, RearView.ts, hudLayout.ts(화면비례 위젯 기하·순수), aimArrows.ts(조준선 둘레 적방향 화살표·순수), worldMapSvg.ts, styles.css
  fx/
    dissolve.ts, postprocessing.ts(disposeComposer), damageNumbers.ts, TargetBrackets.ts, DrainBeams.ts(드레인 빔 풀), EnergyWall.ts(작전구역 경계 벽)
  intro/
    CinematicPlayer.ts, scenes.ts, helpers.ts, CinematicAudio.ts(인트로 절차적 배경음악), MenuBackground.ts
index.html                   캔버스 + HUD/오버레이/메뉴 정적 마크업
public/{drones,weapons,maps,enemies,missions}/  런타임 데이터(JSON)
```
