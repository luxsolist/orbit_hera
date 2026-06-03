# 01 · 아키텍처 — 오케스트레이션 & 게임 루프

소스: [src/main.ts](../../src/main.ts), [src/core/Game.ts](../../src/core/Game.ts)

## 부트스트랩

`main.ts`가 `#game` 캔버스를 잡아 `Game`을 생성하고 `start()`만 호출한다. HUD/오버레이/메뉴는
[index.html](../../index.html)에 정적으로 배치되어 있고 런타임에 DOM을 직접 갱신한다.

```
main.ts → new Game(canvas) → game.start()
```

`Game` 생성자는 렌더러/씬/입력/사운드/HUD/모바일컨트롤/메뉴를 만들고, `start()`는 인트로 컷씬을
띄운 뒤 `renderer.setAnimationLoop(frame)`을 건다. 전장(World·Player·적·무기)은 **선택 시점에**
빌드된다(아래 로딩 흐름).

## 렌더링 셋업

- `WebGLRenderer` — antialias, `high-performance`, pixelRatio ≤ 2
- 그림자 `PCFSoftShadowMap`, 톤매핑 `ACESFilmicToneMapping`(exposure 1.05)
- 최종 출력은 전장별 `EffectComposer`(UnrealBloom)를 통해 렌더 — [06](06-ui-menu-intro.md) 참고

## 상태 머신

```ts
type GameState = "intro" | "menu" | "loading" | "playing" | "paused" | "dead";
```

```
intro ─(컷씬 끝)─▶ menu ─(점 클릭→드론 선택)─▶ loading ─(빌드)─▶ playing
                   ▲                                                 │ ⇅ ESC(포인터락)
                   └────────────── dead ◀─(HP 0)─────────── paused ◀─┘
```

- **intro** — `CinematicPlayer`가 인트로 장면 재생, 끝나면 `showMenu()`.
- **menu** — `MenuScreen`(세계지도)이 활성. 배경엔 `MenuBackground`가 랜덤 인트로 장면을 페이드
  전환하며 렌더. 점 클릭 → 팝업에서 드론 선택 → `onDeploy(mapId, droneId)` → `selectMap()`.
- **loading → playing** — 데이터 fetch + 전장 빌드(아래).
- **paused** — `playing` 중 포인터 락이 풀리면(ESC 등) 자동 전이.
- **dead** — `player.isDead` → 포인터 락 해제 + "LINK LOST" 패널(정화 수/웨이브).

## 데이터 구동 로딩 흐름 (`selectMap`)

```
selectMap(mapId, droneId)
  fetchMap(mapId)                         // public/maps/<id>.json
  fetchDrone(droneId)                     // public/drones/<id>.json
  Promise.all[ fetchWeapon(primary),      // 드론의 weapons.{primary,special}
               fetchWeapon(special) ]
  new World(scene, map)
  new PlayerController(input, world, aspect, drone)
  mobile.configure({ actions, fireLabel, specialLabel })   // 라벨은 무기 abbr
  new EnemyManager / FrequencyBeam / SpecialBarrage / composer / RearView / Minimap
  session = { ... }; wireEvents(session); beginPlay()
```

각 fetch 실패는 `failToMenu(msg)`로 콘솔 기록 후 메뉴 복귀. 전장 1회 빌드 후 맵 변경은 reload.
모든 fetch는 제네릭 [`core/loader.ts`](../../src/core/loader.ts)(`makeLoader<Catalog,Item>`)를 통해
카탈로그/상세를 일관되게 가져온다.

## 이벤트 배선 (`wireEvents`)

| 발신 | 콜백 | 수신 |
| :--- | :--- | :--- |
| Beam / Special | `onFired` | HUD 크로스헤어 점멸 |
| Enemies | `onKill` | HUD 처치 수 |
| Enemies | `onWaveChange(w)` | HUD 웨이브 |
| Enemies | `onPlayerHit` | HUD 피격 비네팅 |
| MenuScreen | `onDeploy` / `onPlayIntro` | Game `selectMap` / `playIntro` |

## 프레임 루프 (`frame`)

```
dt = min(clock.getDelta(), 0.05)               // 스파이크 클램프

intro: intro.update(dt) | 끝나면 showMenu()
menu : menuBg.update(dt)                        // 배경 장면 렌더
playing && locked && !mobile.isBlocked:
    player.update(dt)
    world.update(px, pz)                        // 태양 그림자 추종
    beam.update(dt, input.fireHeld)
    special.update(dt, input.specialPressed)
    enemies.update(dt)
    hud.update + setHp/setFrequency/setSpecial
    if player.isDead → onDeath()
input.endFrame()                                // 엣지 플래그 리셋
composer.render()                               // Bloom 포함
playing: rearView.render(); minimap.render()
```

핵심: **`dt` 상한 0.05s**로 탭 복귀 시 물리 폭주 방지. 시뮬레이션은 `playing && locked`일 때만,
**렌더는 항상**(일시정지 화면도 그려짐). `input.endFrame()`은 매 프레임 호출해 엣지 입력을 정리.
