# ANDROID-01 v3 · ED-209형 공용 역관절 워커

인트로와 향후 3인칭 플레이어 표현에 공용으로 쓰는 `walker` 기체의 시각 에셋이다. 전투 수치·충돌체·기존 1인칭 카메라는 변경하지 않는다.

## 제공 파일

- `public/models/android-01.glb`: PBR 재질, 관절 계층, 부착점 및 idle / walk / aim 애니메이션을 포함한 배포용 바이너리.
- `src/assets/WalkerMech.ts`: 정본 생성 코드. Three.js Group을 상속하며 보행·조준·낮은 자세를 직접 제어한다. 인트로 코드, DOM, 외부 다운로드에 의존하지 않는다.
- `src/assets/exportWalker.ts`: 브라우저용 GLB 내보내기 어댑터. 절차적 roughness 텍스처를 내보내기에 맞게 변환한다.
- `tools/mech-preview.html`: 개발 서버에서 전후면·보행·조준을 확인하고 GLB를 내려받는 검토 화면.
- `public/models/index.json`: 에셋 식별자와 기체 연결 정보.

## 외형과 좌표 계약

로보캅(2014) ED-209 참고 이미지의 실루엣을 바탕으로 긴 쐐기형 일체 차체, 측면 붉은 센서, 양옆 쌍열 포신, 어깨 발사 셀, 후면 냉각부, 뒤로 꺾이는 무릎과 긴 정강이·갈라진 발을 구성한다. 사람형 머리와 손은 없다. 안정적인 에셋 ID android-01과 walker 연결은 유지하며 버전은 3이다.

- 단위: 미터. 위쪽 +Y, 기체 앞쪽 +Z.
- 루트 원점: 양발 사이의 지면. 루트 위치에는 카메라 위치가 아닌 발밑 월드 좌표를 넣는다.
- 대기 자세 높이: 약 2.85 m. 카메라 소켓 높이: 약 2.32 m.
- 기존 walker의 시점 높이 2.2 m는 별도의 플레이 규칙이다. 시각 에셋의 센서 위치와 자동으로 같다고 가정하지 않는다.
- 이름 있는 강체 관절로 움직이는 메카다. 스킨 변형을 사용하는 캐릭터 리그는 아니다.
- 고품질 버전: 20,236 triangles, 49 mesh batches, 18 groups, 6 sockets. 그림자 패스의 draw call은 별도다.
- `detail: "medium"`은 작은 체결부와 방열 슬랫을 줄인다. 다수 NPC를 위한 자동 LOD·인스턴싱은 별도 구현 대상이다.

## 관절과 부착점

| 이름 | 용도 |
| --- | --- |
| pelvis | 골반, 낮은 자세 |
| torso / head | 차체 조준과 차체에 고정된 센서 기준점 |
| left/right_hip, knee, ankle | 길이 0.92 / 1.38 m의 역관절 2절 IK와 접지 |
| left/right_shoulder, elbow, wrist | 좌우 무장 가대(기존 관절 이름 호환) |
| left/right_pauldron | 고정 가대 덮개(기존 관절 이름 호환) |
| socket_camera | 센서 시점 |
| socket_muzzle | 빔 원점. 소켓의 +Z가 발사 방향 |
| socket_muzzle_left | 왼쪽 무장 총구. +Z 발사 방향 |
| socket_offhand | 기존 호출 호환용 왼쪽 무장 부착점 |
| socket_back | 등 부착점 |
| socket_focus | 3인칭 카메라 추적 목표점 |

`getWorldPosition()` / `getWorldDirection()`으로 월드 좌표와 방향을 읽는다. 기존 게임이 -Z를 전방으로 쓰는 경우 루트 yaw에 Math.PI 보정을 적용한다.

## 런타임 사용

```ts
import { WalkerMech } from "./assets/WalkerMech";

const mech = new WalkerMech({ detail: "high" });
scene.add(mech);
mech.position.copy(footWorldPosition);
mech.rotation.y = heading;
mech.setPose({
  phase: gaitPhase, // 이동 거리에 따라 누적하는 라디안 주기
  walk: movingWeight, // 0..1
  aim: aimingWeight, // 0..1
  aimYaw: torsoYaw, // -0.8..0.8 radians
  aimPitch: pitch, // -0.65..0.65; 양수는 위쪽
  crouch: crouchWeight, // 0..1
});
mech.sockets.muzzle.getWorldPosition(beamOrigin);
mech.sockets.muzzle.getWorldDirection(beamDirection);
// 기체를 제거할 때:
mech.dispose();
```

`setPose`는 결정적 절대 자세 입력이다. 프레임 간 전환 보간은 호출자가 수행한다. 보행은 제자리 관절 운동이며 루트 이동은 플레이어 컨트롤러가 담당한다. 지형 접지·벽 충돌·점프·회피 모션·카메라 충돌 회피는 향후 게임 연결 시 추가해야 한다.

GLB를 쓰는 경우 GLTFLoader와 AnimationMixer로 idle / walk / aim 클립을 재생한다. clipAction의 crossFadeTo로 전환할 수 있다. 코드 에셋의 setPose와 AnimationMixer를 같은 관절에 동시에 적용하지 않는다. 각 코드 인스턴스는 재질·지오메트리를 독립 소유하고 dispose는 멱등이다.

## 인트로 연결

`cinematicAssets.drone()`이 공용 WalkerMech를 만든다. 안전 구역 컷은 관절 보행을 적용하고, 접속 컷은 받침대 위에 발바닥을 배치하여 기체를 보여준다. 각 컷 종료 시 에셋을 해제한다.

## 검증과 재생성

- `node node_modules/vitest/vitest.mjs run tests/walkerMech.test.ts`
- Vite 개발 서버 실행 후 `node tests/e2e/mech.mjs`: 저장된 GLB를 다시 로드해 애니메이션·질감·부착점을 검사한다.
- 뷰어의 **GLB 에셋 내려받기**로 생성한 파일을 `public/models/android-01.glb`에 저장한다. 생성 코드를 변경하면 GLB도 다시 생성한다.
- `node tests/e2e/intro.mjs`: 메뉴 진입·스킵·모바일 인트로 회귀 검사.

## 형상 참고

- 사용자 제공 ED-209 리부트 이미지에 맞춰 코드로 제작한 형태 재현이다. 원본 영화 제작용 모델을 가져온 것이 아니다.
- [Vitaly Bulgarov · RoboCop 2014 ED-209 디자인](https://www.bulgarov.com/robocop_ed209.html)


## v3 비율 조정

참고 이미지에서 보이는 상체 외피 약 1/3·하체 약 2/3의 높이 비율을 목표로 조정했다. v2 대비 외피의 폭 0.88배, 높이 0.62배, 깊이 0.82배로 낮고 납작하게 만들었다. 다리는 1.15배 길게, 1.18배 두껍게 하고, 발은 폭 1.18배·길이 1.20배로 넓혔다. 골반 높이는 2.07 m, 좌우 고관절 간격은 1.48 m다. 포신은 별도로 0.94배 크기를 유지한다.

치수는 WALKER_PROPORTIONS에서 관리한다. 비균일 스케일을 관절에 남기지 않고 메시 정점과 관절 오프셋에 반영하여 보행·조준 중 찌그러짐을 방지한다. 뷰어는 22도 화각의 먼 카메라와 낮은 측면 구도를 사용하며, 측면 검사 버튼을 추가했다.


### 실제 이동 상태에 연결하는 애니메이션

`WalkerMotionAnimator`는 `PlayerController.update(dt)` 이후의 `motionState`를 받아 발의 이동 방향과 주기를 계산한다. 모델의 월드 위치는 컨트롤러의 눈 위치에서 `body.eyeHeight`를 빼서 배치하고, 회전은 `viewYaw + Math.PI`로 맞춘다(+Z 전방 에셋 / -Z 전방 컨트롤러).

```ts
const animator = new WalkerMotionAnimator();
// Each frame, after the player's physics update:
mech.position.copy(player.worldPosition);
mech.position.y -= spec.body.eyeHeight;
mech.rotation.y = player.viewYaw + Math.PI;
animator.apply(mech, dt, player.motionState);
```

- 설정 원본은 `public/drones/walker.json`. 전진 4.8m/s, 후진 2.7m/s, 좌우 3m/s. 방향별 속도를 명시하며 대각선은 방향에 따라 보간한다.
- 발 교환은 양발 합산 초당 최대 2.5회. 접지 구간의 발 이동은 거리 기반이며 공중과 대시·제동 중에는 보행을 멈춘다.
- 점프 초기 속도 5.42m/s, 상승·하강 중력 9.81m/s². 발 기준 높이는 약 1.5m, 공중 재점프가 가능하며 지면 기준 100m 미만에서 다시 도약할 수 있다. 착지 시 골반 완충을 적용한다.
- 대시 최고속도 전후좌우 모두 20m/s. 추진 0.95초, 가속 30m/s² · 제동 24m/s², 재사용 2초. 지상에서 높이를 유지하며 정지 출발은 추진 시간 내 최고속도에 미달할 수 있다. 냉각 중 재발동과 공중 대시는 불가하다.
- 미리보기와 게임은 동일한 PlayerController를 사용한다. WASD / Space / Shift로 시험하며, 바닥 타일은 2m 단위다.
- GLB 기본 클립과 별도로 WalkerMotionAnimator가 실제 이동 상태를 관절에 연결한다. 동체 노즐 및 화염은 별도 런타임 에셋 `WalkerThrusters`로 구성한다.

게임성 조정: 수평 이동과 대시 최고속도 및 대시 가속·제동을 현실성 기준값의 1.5배로 상향했다. 점프 궤적, 추진 시간, 재사용 시간과 발 교환 상한은 유지한다. 발 교환 상한을 넘는 이동 속도는 게임적 추력 보조로 간주한다.


동체 로켓 분사: `new WalkerThrusters(mech)`로 부착하고, 포즈 적용 후 `thrusters.update(dt, player.motionState)`를 호출한다. `dashPowered`가 실제 추진 프레임을 구분하며 제동 중에는 분사가 꺼진다. 명령된 대시 방향의 반대쪽으로 두 노즐 이상이 분사한다. 대각선과 동체 조준 회전을 고려해 월드 공간 분사 방향을 유지한다. 점화 순간 강화, 고주파 화염 떨림, 청백색 코어·주황색 외곽, 주변 조명과 0.09초 소멸을 포함한다. 사용 종료 시 `thrusters.dispose()`를 호출한다. GLB 기본 모델과 효과는 별도 자원이다.

하단 점프 노즐: 동체 하부 중앙 프레임에 밀착된 단일 노즐은 수평 노즐의 1.8배 크기다. 성공한 점프마다 `motionState.jumpThrust`가 1로 재설정되고 0.24초간 감쇠한다. 하단 화염은 동체 기울기와 무관하게 월드 아래 방향으로 분사하며 공중 재점프에서도 재점화한다.

하단 노즐은 질량 분포가 아직 정의되지 않은 모델의 중앙 지지 프레임을 무게중심 기준으로 삼아 x=0, 동체 로컬 z=-0.12에 배치한다. 공중에서는 다리 길이를 약 12cm 더 펴고, 착지 시 0.12초에 걸쳐 최대 24cm 압축한 뒤 0.42초 동안 복원한다. 관절에는 접지 IK를 유지한다.

공중 방향 제어 시 `airMoveX/Z`에 따라 이동 반대쪽 동체 노즐을 45% 세기의 지속 분사로 점화한다. 입력 해제·착지 시 빠르게 소멸하며, 대시 추진 중에는 대시 방향과 강도가 우선한다. 점프 하단 분사와 동시에 사용할 수 있다.

대시 종료 연결: 추진 종료 후 제동 속도에 따라 대시 자세를 점진적으로 해제한다. 컨트롤러의 제동 완료 플래그 전환 전에 보행을 재개하며, 대시 전용 몸통 기울기와 자세 낮춤은 사용하지 않는다. 방향 입력을 유지하면 보행으로, 놓으면 대기 자세로 이어진다.

대시 다리 자세: 자동 도약(hopVelocity)은 0이며 골반을 낮추지 않는다. 명령된 대시 방향의 반대쪽으로 양 발의 IK 목표를 최대 28cm 옮겨 다리를 살짝 기울인다. 방향은 몸통 로컬 좌표로 변환하고 지수 보간하며, 추진 종료 0.25초 전부터 목표를 중앙으로 되돌린다. 점프·착지의 별도 자세는 유지한다.
