# 02 · 입력 & 플레이어 컨트롤러

소스: [Input.ts](../../src/core/Input.ts), [PlayerController.ts](../../src/player/PlayerController.ts),
[MobileControls.ts](../../src/core/MobileControls.ts), [DroneSpec.ts](../../src/player/DroneSpec.ts)

## 입력 (Input)

키보드 폴링 + Pointer Lock 마우스룩 + 합성(모바일) 입력을 한곳에서 관리한다.

- **키 상태 = 집합(`Set`)** — 눌린 키를 `Set`에 누적하므로 동시 입력 제한이 없다(전후좌우 + 상승/하강 동시).
  `isDown(code)`(폴링), `wasPressed(code)`(이번 프레임 새 눌림 = 엣지, OS 키 반복 제외).
- **게임 키 기본동작 차단** — 락(플레이) 중에는 `GAME_KEYS`(`KeyW/A/S/D`·`Space`·`ShiftLeft/Right`·`KeyC`)의
  `keydown`/`keyup`에서 `e.preventDefault()` → Space 페이지 스크롤 등 브라우저 기본동작을 막아
  데스크톱에서 이동 + 상승/하강 동시 입력이 안정적으로 들어간다.
- 마우스: 락 상태에서 `movementX/Y` 누적 → `consumeMouse()`가 읽고 0 리셋. `addLookDelta()`(모바일 드래그).
- 사격: `firePressed`(엣지)·`fireHeld`(유지, 좌클릭)·`specialPressed`(우클릭). `mouseup`은 `window`에서 받음.
- **Pointer Lock은 데스크톱 전용** — `pointerlockchange`로 `locked`를 갱신. 모바일은 실제 포인터 락이 없어
  Game이 `input.locked`를 직접 true로 두는 합성 락으로 시뮬레이션을 진행한다.
- `moveScale`(0~1) — 조이스틱 변위 비례 속도 배율(키보드는 항상 1=전속). `syntheticKeyDown/Up` — 모바일 버튼이 키 합성.
- 락 해제 시 키/엣지/`fireHeld`를 모두 비워 **상태 누수 방지**. `endFrame()`이 엣지 플래그 정리.

## 플레이어 컨트롤러 (PlayerController)

**데이터 구동** — `DroneSpec`(JSON)으로 이동 형태(보행/비행)·치수·바이탈·시야·대시를 설정한다.
카메라가 곧 현재 드론의 1인칭 시점. 새 드론은 JSON 추가만으로 도입.

### 순수 헬퍼 (export, 단위 테스트 대상)
- `dirSpeedMult(mx, mz, fwd)` — 이동 방향과 시선 수평벡터의 정렬도로 속도 배수: **전진 1.0 / 옆 0.85
  (`STRAFE_MULT`) / 후진 0.6 (`BACK_MULT`)**. 보행·비행에 모두 적용 → 무한 후진 백페달 카이팅 억제.
- `stepVerticalVelocity(vy, dt, jump)` — 보행 수직 적분: 상승 감속 → 하강 가속 → 종단 클램프.
  ([tests/PlayerController.test.ts](../../tests/PlayerController.test.ts))
- `spawnHeightAboveGround(move, eye)` — 스폰 시 지면 대비 높이: 비행 `min(spawnHeight, ceiling)`,
  보행 `eye`. ([tests/spawn.test.ts](../../tests/spawn.test.ts))
- `applyHeal(hp, maxHp, amount)` — 회복 순수 전이: **사망(hp≤0) 또는 비양수 회복이면 불변**(부활 불가),
  그 외엔 `min(maxHp, hp+amount)`로 가산(최대치 한도 클램프).

### update 파이프라인
1. 무적 타이머 감쇠
2. 시점 회전(`consumeMouse`) — pitch 클램프 ±(π/2−0.05)
3. 수평 의도(yaw 기준 forward/right로 WASD `wish`)
4. **대시** — `spec.dash` 있는 드론만(보행). Shift 엣지 + 쿨다운 0 → 입력 방향 버스트(운동량 덮어씀)
5. 수평 속도 결정 — 보행/비행 분기(아래)
6. **수평 적분 + 서브스테핑 충돌** — `MOVE_MAX_STEP=0.8m` 단위로 쪼개 `world.resolveCollision`
   적용(고속 대시 터널링 방지). 분리 법선으로 파고드는 속도만 제거 → 벽 슬라이딩
7. 수직 — 보행 `updateWalkVertical(jump)` / 비행 `updateFlyVertical`, 직후 절대 하드리밋
   `min(position.y, HARD_CEILING=5000)` 일괄 클램프(모든 기체 공통)
8. 주파수 재충전(`freqRegen`, 특수무기 발동 중엔 외부 억제)
9. 카메라 동기화

### 보행 (WalkMove)
- 지상/공중 응답 분리(`groundAccel`/`airAccel`)로 목표 속도에 지수 접근.
- 점프: `stepVerticalVelocity` 적분. `maxRiseHeight` 소프트 게이트(디딘 지면 대비 초과 시 추가 점프
  금지, 강제 위치 보정 없이 자연 하강). `coyoteTime` 유예.
- 지면(`heightAt + eye`)/콜라이더 윗면 위로 착지. 옥상·바위 윗면에 설 수 있음(`standSurfaceY`).

### 비행 (FlyMove)
- **시선결합 3D 이동** — 피치 포함 전후 방향 + 수평 스트레이프를 3D 단위벡터로(방향 무관 동일 최고속).
  위 보고 전진→상승, 아래 보고 전진→하강. 수평 속도에 `dirSpeedMult` 적용(후진 페널티).
- **순수 수직 추력** — `Space`=상승, `Shift`(좌/우) **또는 `C`**=하강(`verticalSpeed`). `C`는 `Shift`+`WASD`
  키 고스팅(N-key rollover) 회피용 대체키. 입력 없으면 호버(0).
- **비행 하한 고도** — `minAltitude`(flyer 18 m) 바닥으로 클램프해 지상 저속 안전지대로 내려갈 수 없다.
- **뱅킹 롤** — 좌우 스트레이프 시 카메라를 `rollDeg`까지 기울임(`ROLL_RATE=6` 보간).
- 지면+`minAltitude`~천장(지면 대비) 사이로 고도 클램프. 대시 없음(`spec.dash` 미보유).

### 상승 한도 — 지표면 상대 천장 + 절대 하드리밋
- **공통 함수 `maxRiseAltitude(standY, rise)`** = `min(HARD_CEILING, standY + rise + eye)`(private).
  보행 점프(`jump.maxRiseHeight`)와 비행 천장(`move.ceiling`)이 **둘 다 이 함수**를 거쳐 동일 코드로
  "최고 상승 고도(지표면 기준)"를 산출한다.
- **`HARD_CEILING = 5000`(export)** — 지표 무관 절대 최고 고도(m). 향후 항공모함·보스급 콘텐츠도 못 넘는
  글로벌 상한. 수직 적분 직후 `position.y`에 일괄 클램프(`min(position.y, HARD_CEILING)`).
- **천장은 지면 대비(`standSurfaceY` 기준)** — 비행 `ceiling` 1km 기준, 1km 절벽 위에선 ~2km, 해수면 위에선 1km까지
  도달(절대 `HARD_CEILING` 5km 클램프). 매 프레임 (x,z)에서 `standSurfaceY`를 재계산 → 수평 이동·동적 맵 지형에 자동 적응.
- **하강 스무딩** — 고지대→저지대 이동으로 캡이 낮아질 땐 즉시 스냅하지 않고 `CEIL_FALL_RATE=2.5`로
  부드럽게 하강(0.5m 근접 시 안착).

### 전투 연동
`hp/maxHp`, `freq/maxFreq`(드론별), `takeDamage`, `spendFrequency`(부족 시 false),
`isDead`(hp≤0), `reset()`(맵 스폰으로 위치/속도/자원 초기화). 스폰은 `placeAtSpawn()` —
맵 `spawn{x,z,yaw}` + 드론별 높이.

- **`takeDamage(amount): boolean`** — 0.6s 머시 무적/사망 중이면 무시하고 `false`, 적용 시 `true` 반환.
  반환값으로 적 접촉 회복(`absorbEnergy`)·HUD 피격 연출을 게이트한다(무적 중 회복/연출 차단).

- **`heal(amount)`** — 순수 `applyHeal`을 위임. **카이터/거머리 처치 시 흡수당했던 물질 HP 환수**
  (`EnemyManager.registerKill`의 `killRefund`)에 사용. 사망 시 부활 불가, `maxHp` 한도 클램프, 비양수 무시.
  ※ 아직 패시브 HP 자연 회복은 없다(향후 업그레이드 시스템 항목).

- **사망 시 포인터락 해제 가드** — `Game.onDeath()`는 데스크톱일 때만 `document.exitPointerLock?.()` 호출.
  모바일은 합성 락이라 생략하고 옵셔널 체이닝을 써, iPad WebKit에서 `exitPointerLock` 미지원/실패로
  예외가 나 사망 패널이 안 뜨는 문제를 막는다.

### 드론 바이탈/이동 수치 (현행 리밸런스, JSON 출처)
[`public/drones/walker.json`](../../public/drones/walker.json) ·
[`public/drones/flyer.json`](../../public/drones/flyer.json)

| 항목 | WALKER(보행) | FLYER(비행) |
| :--- | :--- | :--- |
| `speed` | 19.44 (≒70 km/h) | 111.11 (≒400 km/h) |
| `maxHp` | 120 | 60 |
| `maxFreq` / `freqRegen` | 120 / 28 | 90 / 16 |
| 수직 | 점프 `jump.velocity` 28, `maxRiseHeight` 100 | `verticalSpeed` 45, `ceiling` 1000, `minAltitude` 18, `spawnHeight` 100 |
| 대시 | `dash{192, 0.16, 2.0}` | 없음 |
| 무기 | primary `frequency-beam-heavy` / special `special-barrage` | primary `frequency-beam-light` / special `special-overdrive` |

## 모바일 컨트롤 (MobileControls)

가로 모드 전용. 좌측=조이스틱, 우측=시선+버튼 클러스터.

- **조이스틱** — 터치 지점에 표시, 노브 변위 `KNOB_MAX_DIST=56px` 클램프. 정규화 변위(nx,ny)를
  순수 `joystickToKeys(nx, ny)`로 변환 → WASD 키 집합 + 속도 배율(`stepScale`, 4단계).
  데드존 0.2 밖 축만 키로(8방향). ([tests/mobileJoystick.test.ts](../../tests/mobileJoystick.test.ts))
- **버튼 템플릿** — 우하단 2×2: FIRE/SP(고정, 무기 `abbr` 라벨) + ACT1/ACT2(드론 `actions`).
  누르는 동안 `actions[].key`를 합성. `configure()`가 드론/무기별로 라벨·키를 주입.
- **시야 드래그(룩)** — 우반쪽 빈 공간 스와이프 변위에 `LOOK_SCALE=3.2`를 곱해 `addLookDelta()`로
  전달(PlayerController의 `mouseSensitivity` 0.0022와 다시 곱해져 라디안/픽셀 ≒ 0.007). 모바일 전용
  민감도 배수로, **데스크탑 포인터락은 미적용**(데스크탑은 원시 `movementX/Y`만 사용해 동일).
- 세로 모드면 안내 + 입력 차단(`isBlocked`).
