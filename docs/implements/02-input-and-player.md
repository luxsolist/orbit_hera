# 02 · 입력 & 플레이어 컨트롤러

소스: [Input.ts](../../src/core/Input.ts), [PlayerController.ts](../../src/player/PlayerController.ts),
[MobileControls.ts](../../src/core/MobileControls.ts), [DroneSpec.ts](../../src/player/DroneSpec.ts)

## 입력 (Input)

키보드 폴링 + Pointer Lock 마우스룩 + 합성(모바일) 입력을 한곳에서 관리한다.

- `isDown(code)` — 눌림 유지(폴링). `wasPressed(code)` — 이번 프레임 새 눌림(엣지, OS 키 반복 제외).
- 마우스: 락 상태에서 `movementX/Y` 누적 → `consumeMouse()`가 읽고 0 리셋. `addLookDelta()`(모바일 드래그).
- 사격: `firePressed`(엣지)·`fireHeld`(유지, 좌클릭)·`specialPressed`(우클릭). `mouseup`은 `window`에서 받음.
- `moveScale`(0~1) — 조이스틱 변위 비례 속도 배율. `syntheticKeyDown/Up` — 모바일 버튼이 키 합성.
- 락 해제 시 키/엣지/`fireHeld`를 모두 비워 **상태 누수 방지**. `endFrame()`이 엣지 플래그 정리.

## 플레이어 컨트롤러 (PlayerController)

**데이터 구동** — `DroneSpec`(JSON)으로 이동 형태(보행/비행)·치수·바이탈·시야·대시를 설정한다.
카메라가 곧 현재 드론의 1인칭 시점. 새 드론은 JSON 추가만으로 도입.

### 순수 헬퍼 (export, 단위 테스트 대상)
- `stepVerticalVelocity(vy, dt, jump)` — 보행 수직 적분: 상승 감속 → 하강 가속 → 종단 클램프.
  ([tests/PlayerController.test.ts](../../tests/PlayerController.test.ts))
- `spawnHeightAboveGround(move, eye)` — 스폰 시 지면 대비 높이: 비행 `min(spawnHeight, ceiling)`,
  보행 `eye`. ([tests/spawn.test.ts](../../tests/spawn.test.ts))

### update 파이프라인
1. 무적 타이머 감쇠
2. 시점 회전(`consumeMouse`) — pitch 클램프 ±(π/2−0.05)
3. 수평 의도(yaw 기준 forward/right로 WASD `wish`)
4. **대시** — `spec.dash` 있는 드론만(보행). Shift 엣지 + 쿨다운 0 → 입력 방향 버스트(운동량 덮어씀)
5. 수평 속도 결정 — 보행/비행 분기(아래)
6. **수평 적분 + 서브스테핑 충돌** — `MOVE_MAX_STEP=0.8m` 단위로 쪼개 `world.resolveCollision`
   적용(고속 대시 터널링 방지). 분리 법선으로 파고드는 속도만 제거 → 벽 슬라이딩
7. 수직 — 보행 `updateWalkVertical(jump)` / 비행 `updateFlyVertical`
8. 주파수 재충전(`freqRegen`, 특수무기 발동 중엔 외부 억제)
9. 카메라 동기화

### 보행 (WalkMove)
- 지상/공중 응답 분리(`groundAccel`/`airAccel`)로 목표 속도에 지수 접근.
- 점프: `stepVerticalVelocity` 적분. `maxRiseHeight` 소프트 게이트(디딘 지면 대비 초과 시 추가 점프
  금지, 강제 위치 보정 없이 자연 하강). `coyoteTime` 유예.
- 지면(`heightAt + eye`)/콜라이더 윗면 위로 착지. 옥상·바위 윗면에 설 수 있음(`standSurfaceY`).

### 비행 (FlyMove)
- **시선결합 3D 이동** — 피치 포함 전후 방향 + 수평 스트레이프를 3D 단위벡터로(방향 무관 동일 최고속).
  위 보고 전진→상승, 아래 보고 전진→하강.
- **순수 수직 추력** — `Space`=상승, `Shift`=하강(`verticalSpeed`). 입력 없으면 호버(0).
- **뱅킹 롤** — 좌우 스트레이프 시 카메라를 `rollDeg`까지 기울임(`ROLL_RATE=6` 보간).
- 지면~`ceiling`(지면 대비) 사이로 고도 클램프. 대시/Ctrl 없음.

### 전투 연동
`hp/maxHp`, `freq/maxFreq`(드론별), `takeDamage`(0.6s 무적), `spendFrequency`(부족 시 false),
`isDead`(hp≤0), `reset()`(맵 스폰으로 위치/속도/자원 초기화). 스폰은 `placeAtSpawn()` —
맵 `spawn{x,z,yaw}` + 드론별 높이.

## 모바일 컨트롤 (MobileControls)

가로 모드 전용. 좌측=조이스틱, 우측=시선+버튼 클러스터.

- **조이스틱** — 터치 지점에 표시, 노브 변위 `KNOB_MAX_DIST=56px` 클램프. 정규화 변위(nx,ny)를
  순수 `joystickToKeys(nx, ny)`로 변환 → WASD 키 집합 + 속도 배율(`stepScale`, 4단계).
  데드존 0.2 밖 축만 키로(8방향). ([tests/mobileJoystick.test.ts](../../tests/mobileJoystick.test.ts))
- **버튼 템플릿** — 우하단 2×2: FIRE/SP(고정, 무기 `abbr` 라벨) + ACT1/ACT2(드론 `actions`).
  누르는 동안 `actions[].key`를 합성. `configure()`가 드론/무기별로 라벨·키를 주입.
- 세로 모드면 안내 + 입력 차단(`isBlocked`).
