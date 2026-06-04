# 01 · 아키텍처 — 오케스트레이션 & 게임 루프

소스: [src/main.ts](../../src/main.ts), [src/core/Game.ts](../../src/core/Game.ts),
[src/core/Diagnostics.ts](../../src/core/Diagnostics.ts), [src/fx/postprocessing.ts](../../src/fx/postprocessing.ts)

## 부트스트랩

`main.ts`가 `#game` 캔버스를 잡아 `Game`을 생성하고 `start()`만 호출한다. HUD/오버레이/메뉴는
[index.html](../../index.html)에 정적으로 배치되어 있고 런타임에 DOM을 직접 갱신한다.

```
main.ts → new Game(canvas) → game.start()
```

`Game` 생성자는 단일 `WebGLRenderer`/씬/입력/사운드/HUD/모바일컨트롤/메뉴/진단을 만들고 곧장
`showMenu()`로 진입한다(인트로는 메뉴의 버튼으로만 재생). `start()`는 클럭을 시작하고
`renderer.setAnimationLoop(...)`을 건다 — 프레임 본문은 `diag.guard(...)`로 감싼 try/catch 안에서
돈다. 전장(World·Player·적·무기)은 **선택 시점에** 빌드된다(아래 로딩 흐름).

## 렌더링 셋업

- **단일 `WebGLRenderer`** — antialias, `high-performance`. DPR 캡은 **터치/iPad는 1.5, 데스크톱은 2**
  (`navigator.maxTouchPoints > 0 ? 1.5 : 2`) — Retina 프레임버퍼·VRAM 부하를 낮춰 반복 실행 시 GPU 스톨 방지.
- 그림자 `PCFSoftShadowMap`, 톤매핑 `ACESFilmicToneMapping`(exposure 1.05)
- 최종 출력은 전장별 `EffectComposer`(UnrealBloom)를 통해 렌더 — [06](06-ui-menu-intro.md) 참고

## GPU 수명 주기 / iPad 멈춤 완화

반복 새로고침(맵 변경=reload)·인트로 재생 누적으로 인한 iPad WebKit 멈춤을 막기 위한 자원 관리:

- **블룸 절반 해상도** — `UnrealBloomPass`를 화면 ½ 해상도로 만들어 밉체인 RT 메모리/대역폭을 1/4로
  ([fx/postprocessing.ts](../../src/fx/postprocessing.ts)).
- **컴포저 완전 해제** — `EffectComposer.dispose()`는 자체 핑퐁 RT 2개만 풀고 추가 패스의 렌더타깃은
  남긴다. `disposeComposer()`가 **모든 패스의 `dispose()`까지** 호출해 블룸 RT(컴포저당 ~11개) 누수를
  막는다. `CinematicPlayer`·`MenuBackground`는 종료 시 이 함수로 컴포저를 해제한다.
- **객체 해제** — `disposeObject()`는 지오메트리뿐 아니라 머티리얼이 들고 있는 텍스처(`map` 등)까지 해제.
- **페이지 이탈 정리** — `pagehide`(bfcache 미복귀 `!persisted`일 때만)에서 `teardown()`이 세션 컴포저를
  해제하고 `renderer.forceContextLoss()` + `renderer.dispose()`로 GPU 컨텍스트를 즉시 반납한다(iOS가
  다음 페이지에 컨텍스트를 빨리 내주게 해 reload 반복 누적 멈춤 방지).

## 진단 계측 — [core/Diagnostics.ts](../../src/core/Diagnostics.ts)

URL 에 `?diag` 가 있을 때만 켜지는 온디바이스 진단(특히 원격 디버깅이 어려운 iPad). 화면 오버레이로:

- **WebGL 컨텍스트 손실/복구/생성실패** 감시(`webglcontextlost` 등),
- **전역 JS 에러 / 미처리 프라미스 거부** 표면화,
- 상태 전환마다 `renderer.info` 스냅샷(geo/tex/prog/calls),
- 프레임 하트비트(프레임#·fps) — 멈춤이 RAF 정지인지 로직 정지인지 판별,
- `guard()`로 프레임 루프 본문을 감싸 조용한 예외를 표면화.

> 이 계측으로 iPad 반복 실행 멈춤의 근인을 진단했다 — **미해제 블룸 렌더타깃이 인트로 사이클마다
> 텍스처를 ~+22개씩 누수**시키고 있었다(위 컴포저 완전 해제로 해결).

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
- **dead** — `player.isDead` → 포인터 락 해제 + "LINK LOST" 패널(정화 수/웨이브) + **재접속/RECONNECT**
  버튼(같은 전장 재시작 `beginPlay`) + **전장 선택**(reload) 버튼.

> **세션은 페이지 로드당 1회.** `selectMap`은 `if (this.session) return`으로 가드되어 한 번 전장을 빌드하면
> 다른 맵으로 가려면 **`location.reload()`**(전장 선택 버튼)로 메뉴부터 다시 시작한다. 이 단일 세션 +
> reload 모델이 위 GPU 수명 주기 완화와 짝을 이룬다.

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
