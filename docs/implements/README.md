# SEED — 구현 문서 (Implementation Notes)

이 디렉터리는 현재 코드베이스에 **실제로 구현되어 있는** 내용을 시스템 단위로 정리한다.
게임 디자인 비전은 [../spec/overview.md](../spec/overview.md), 현행 데이터/규칙 명세는
[../spec/](../spec/01-data-schemas.md), 사용자용 요약은 [../../README.md](../../README.md)를 참고한다.

> 기준 버전: `package.json` v0.3.0 · 스택: Three.js(WebGL2) + Vite + TypeScript(strict)
> 테스트: Vitest 단위 **115개** + Playwright e2e 스모크(4맵)

## 핵심 설계 원칙

- **데이터 구동 콘텐츠** — 드론/무기/맵은 런타임 JSON. 새 콘텐츠는 `src/` 수정 없이 파일 추가만으로
  도입(스키마 [../spec/01-data-schemas.md](../spec/01-data-schemas.md)).
- **순수 코어 분리** — 적분/조준/스폰/투영 등 핵심 로직은 부수효과 없는 export 함수로 빼서 단위
  테스트로 고정(`stepVerticalVelocity`, `pursueStep`, `bestAlignedDir`, `spawnAltitude`, …).
- **콜백 배선** — 시스템 간 결합은 콜백(`onKill`, `onFired`, `onDeploy` …)으로 느슨하게.

## 문서 색인

| 문서 | 내용 |
| :--- | :--- |
| [01-architecture.md](01-architecture.md) | Game 오케스트레이터 · 상태 머신 · 프레임 루프 · 데이터 구동 로딩 · 렌더 셋업 |
| [02-input-and-player.md](02-input-and-player.md) | 입력(Pointer Lock/키보드) · 보행/비행 컨트롤러 · 충돌 서브스테핑 · 모바일 컨트롤 |
| [03-world.md](03-world.md) | World 빌더 · TerrainField · SkyEnvironment · CollisionWorld · 특수 권역(precinct) |
| [04-weapons.md](04-weapons.md) | 주파수 빔 · 다중 빔 살포 · 콘 조준 통합 · 데미지 모델 · 절차적 사운드 |
| [05-enemies.md](05-enemies.md) | 플라즈모이드(공중 스폰·3D 추적·디졸브) · 웨이브 매니저 |
| [06-ui-menu-intro.md](06-ui-menu-intro.md) | 세계지도 메뉴 · HUD · 미니맵/후방뷰 · 인트로 컷씬/메뉴 배경 · FX |
| [07-build-test-tooling.md](07-build-test-tooling.md) | Vite(소스맵 hidden + 난독화) · 테스트 스위트 · e2e · 월드맵 생성기 |

## 소스 트리

```
src/
  main.ts                    진입점 — Game 부트스트랩
  core/
    Game.ts                  루프/상태/세션 오케스트레이션
    Input.ts                 키보드 + Pointer Lock + 합성 입력
    MobileControls.ts        가상 조이스틱 + 버튼 클러스터(가로 전용)
    Sfx.ts                   절차적 발사음(Web Audio)
    loader.ts                제네릭 JSON 카탈로그 로더
  player/
    DroneSpec.ts             드론 데이터 타입(보행/비행)
    PlayerController.ts       데이터 구동 FPS 컨트롤러(보행/비행) + 순수 헬퍼
    drones.ts                드론 카탈로그/스펙 fetch
  weapons/
    WeaponSpec.ts            무기 타입 + damageForDistance
    FrequencyBeam.ts          히트스캔 빔(자동/수동/어시스트)
    SpecialBarrage.ts         다중 빔 살포(특수)
    targeting.ts             공유 콘 조준(순수)
    beamFx.ts                빔/글로우 비주얼 공통
    weapons.ts               무기 카탈로그/스펙 fetch
  enemies/
    SeedEnemy.ts             플라즈모이드(3D 추적·자유 부유·디졸브)
    EnemyManager.ts          공중 스폰/웨이브/집계 + spawnAltitude(순수)
  world/
    World.ts                 전장 메시 빌더(지형/건물/도로/수역/랜드마크/담장)
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
    HUD.ts, Minimap.ts, RearView.ts, worldMapSvg.ts, styles.css
  fx/
    dissolve.ts, postprocessing.ts, damageNumbers.ts
  intro/
    CinematicPlayer.ts, scenes.ts, helpers.ts, MenuBackground.ts
index.html                   캔버스 + HUD/오버레이/메뉴 정적 마크업
public/{drones,weapons,maps}/  런타임 데이터(JSON)
```
