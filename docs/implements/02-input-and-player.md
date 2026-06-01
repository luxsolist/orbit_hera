# 02 · 입력 & 플레이어 컨트롤러

소스: [src/core/Input.ts](../../src/core/Input.ts), [src/player/PlayerController.ts](../../src/player/PlayerController.ts)

## 입력 (Input)

키보드 폴링 + Pointer Lock 마우스룩 상태를 한곳에서 관리한다.

### 키 상태
- `keys: Set` — 눌림 유지 상태(폴링용). `isDown(code)`로 조회.
- `pressed: Set` — **이번 프레임에 새로 눌린** 키(엣지). `wasPressed(code)`로 조회.
  - `keydown`에서 이미 눌려있지 않을 때만 추가 → **OS 키 반복 제외**.
- `endFrame()`에서 `pressed`와 `firePressed`를 비운다(엣지 1프레임 한정).

### 마우스 / 사격
- `mousemove`는 락 상태에서만 `movementX/Y`를 **누적**. `consumeMouse()`가 읽고 0으로 리셋.
- 좌클릭: `firePressed`(엣지) + `fireHeld`(연속 사격용 유지). `mouseup`은 `window`에서 받아 캔버스 밖에서 떼도 해제.

### Pointer Lock
- `pointerlockchange`로 `locked` 갱신. 락 해제 시 `keys`/`pressed`/`fireHeld`를 모두 비워 **상태 누수 방지**(일시정지 후 키가 눌린 채로 남는 문제 차단).
- `requestLock()` → `canvas.requestPointerLock()`.

## 플레이어 컨트롤러 (PlayerController)

카메라가 곧 현재 링크된 무인 병기의 1인칭 시점. 핵앤슬래시 기동감을 위해 운동량 기반 가감속과
2단 점프·코요테 타임·회피 대시를 갖춘다.

### 주요 상수

| 상수 | 값 | 의미 |
| :--- | :--- | :--- |
| `EYE_HEIGHT` | 2.2 | 지표면 위 카메라 높이 |
| `WALK_SPEED` | 26 | 목표 수평 속도 |
| `GROUND_RATE` / `AIR_RATE` | 18 / 4.5 | 지상=즉각적, 공중=관성 응답속도 |
| `GRAVITY` | 46 | 중력(빠릿한 점프 아크) |
| `JUMP_VELOCITY` / `AIR_JUMP_VELOCITY` | 17 / 15 | 지상 / 2단 점프 초속 |
| `MAX_AIR_JUMPS` | 1 | 지상 + 공중 1회 = 총 2단 |
| `LOW_JUMP_MULT` | 2.2 | 상승 중 점프키 떼면 추가 중력(가변 높이) |
| `COYOTE_TIME` | 0.1 | 발판 이탈 직후 점프 허용 유예 |
| `DASH_SPEED` / `DURATION` / `COOLDOWN` | 64 / 0.16 / 0.55 | 회피 대시 버스트 |
| `MOUSE_SENSITIVITY` | 0.0022 | 마우스 감도 |
| `PLAYER_RADIUS` | 1.2 | 바위 충돌 수평 반경 |

### update 파이프라인 (매 프레임)

1. **무적 타이머** 감쇠 (`invuln`)
2. **시점 회전** — `consumeMouse()`로 yaw/pitch 갱신, pitch는 ±(π/2−0.05)로 클램프
3. **이동 입력** — yaw 기준 forward/right로 WASD `wish` 벡터 구성 후 정규화
4. **회피 대시** — Shift 엣지 + 쿨다운 0 → 입력 방향(없으면 정면)으로 대시. 대시 중에는 운동량을 `DASH_SPEED`로 덮어씀
5. **가감속** — 비대시 시 지수 접근 `1 − exp(−rate·dt)`로 목표 속도에 부드럽게 수렴(지상/공중 rate 분리)
6. **수평 적분 + 경계 클램프** — 맵 반경 `TERRAIN_HALF − 4`로 제한
7. **바위 충돌** — `world.resolveCollision`으로 밀어내고, 분리 법선 방향으로 **파고드는 속도 성분만 제거**(접선 이동 유지 → 벽 슬라이딩)
8. **점프/중력**
   - 지상: `coyote` 리셋, 공중 점프 예산 복원
   - Space 엣지: 지상/코요테면 지상 점프, 아니면 공중 점프 예산 소모
   - **가변 점프 높이**: 상승 중 키를 떼면 `GRAVITY × LOW_JUMP_MULT` 적용
   - 지표면(`heightAt + EYE_HEIGHT`) 아래로 내려가면 착지 처리
9. **주파수 재충전** — 초당 22 회복 (`maxFreq`까지)
10. **카메라 동기화** (`syncCamera`)

### 전투 연동 상태
- `hp`/`maxHp` 100, `freq`/`maxFreq` 100
- `takeDamage(amount)` — 무적/사망 중 무시, 피격 시 0.6s 무적 부여
- `spendFrequency(amount)` — 부족하면 `false`(빔 발사 차단)
- `isDead` — `hp ≤ 0`
- `reset()` — 사망 후 재접속 시 위치/속도/자원 전부 초기화 (스폰 `(0,_,24)`)
