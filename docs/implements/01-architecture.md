# 01 · 아키텍처 — 게임 루프 & 시스템 오케스트레이션

소스: [src/main.ts](../../src/main.ts), [src/core/Game.ts](../../src/core/Game.ts)

## 부트스트랩

[main.ts](../../src/main.ts)는 `#game` 캔버스를 잡아 `Game`을 생성하고 `start()`만 호출한다.
HUD/오버레이는 [index.html](../../index.html)에 정적으로 배치되어 있어 런타임에 DOM을 직접 갱신한다.

```
main.ts → new Game(canvas) → game.start()
```

## Game — 오케스트레이터

[Game.ts](../../src/core/Game.ts)는 렌더러/씬/카메라/포스트프로세싱과 모든 하위 시스템을 묶는 단일 진입 클래스다.

### 렌더링 셋업
- `WebGLRenderer` — antialias, `high-performance`, pixelRatio ≤ 2
- 그림자: `PCFSoftShadowMap` 활성
- 톤매핑: `ACESFilmicToneMapping`, exposure 1.05
- 최종 출력은 `EffectComposer`(Bloom)를 통해 렌더링 — [06-fx-and-ui.md](06-fx-and-ui.md) 참고

### 시스템 구성 (생성 순서 = 의존 순서)

```
Input    ← canvas
World    ← scene
Player   ← Input, World, aspect
Enemies  ← scene, World, Player
Beam     ← scene, Player, Enemies
HUD
Composer ← renderer, scene, player.camera
```

### 이벤트 배선 (`wireEvents`)
콜백으로 시스템 간 결합을 느슨하게 유지한다.

| 발신 | 콜백 | 수신(HUD) |
| :--- | :--- | :--- |
| Beam | `onFired` | `flashFire()` — 크로스헤어 점멸 |
| Enemies | `onKill` | `setKills(killCount)` |
| Enemies | `onWaveChange(w)` | `setWave(w)` |
| Enemies | `onPlayerHit` | `flashDamage()` — 피격 비네팅 |

## 상태 머신

```
GameState = "title" | "playing" | "paused" | "dead"
```

```
        startOrResume()                    onDeath()
title ───────────────► playing ◄──────────────────── (hp ≤ 0)
                        │   ▲                          │
        pointerlock 해제 │   │ startOrResume()         ▼
                        ▼   │                        dead
                      paused ──── startOrResume() ──► playing
```

- **title / dead → playing**: `player.reset()` + `enemies.start()` + 처치수 0 리셋
- **paused → playing**: 상태만 복원(진행 유지)
- 어느 전이든 오버레이 숨김 → HUD 활성 → `input.requestLock()` (Pointer Lock 요청)

### 일시정지 (`onPointerLockChange`)
`playing` 중 포인터 락이 풀리면(ESC 등) 자동으로 `paused` 전이 → "PAUSED / LINK SUSPENDED" 오버레이.

### 사망 (`onDeath`)
`player.isDead`가 되면 `dead` 전이 → 포인터 락 해제 → "LINK LOST" 오버레이에 정화 수/웨이브 표시.

## 프레임 루프 (`frame`)

`renderer.setAnimationLoop`으로 매 프레임 호출된다.

```
dt = min(clock.getDelta(), 0.05)        // 스파이크 클램프(탭 비활성 복귀 등)

if (playing && locked):
    player.update(dt)
    beam.update(dt, input.fireHeld)
    enemies.update(dt)
    hud.update(dt)
    hud.setHp / setFrequency            // 수치 동기화
    if player.isDead → onDeath()

input.endFrame()                        // 엣지 트리거 플래그 리셋
composer.render()                       // Bloom 포함 최종 렌더
```

핵심 설계:
- **`dt` 상한 0.05s**로 큰 시간 점프 시 물리/이동 폭주 방지.
- 시뮬레이션은 `playing && locked`일 때만 갱신하되 **렌더는 항상** 수행(일시정지 화면도 그려짐).
- `input.endFrame()`은 항상 호출해 `firePressed`/`pressed` 엣지 상태를 정리.

## 리사이즈 (`onResize`)
`window` resize 시 카메라 aspect + 렌더러 + 컴포저 크기를 함께 갱신한다.
