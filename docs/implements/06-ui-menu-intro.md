# 06 · UI · 메뉴 · 인트로 · FX

소스: [MenuScreen.ts](../../src/ui/MenuScreen.ts), [HUD.ts](../../src/ui/HUD.ts),
[Minimap.ts](../../src/ui/Minimap.ts), [RearView.ts](../../src/ui/RearView.ts),
[worldMapSvg.ts](../../src/ui/worldMapSvg.ts), [intro/](../../src/intro/),
[fx/](../../src/fx/)

## MenuScreen — 세계지도 전장 선택

`Game`에서 분리된 메뉴 UI 클래스(Game은 루프/상태에 집중). 콜백 주입:
`{ onDeploy(mapId, droneId, peaceful), onPlayIntro() }`.

- **세계지도** — Natural Earth 대륙 윤곽 SVG([worldMapSvg](../../src/ui/worldMapSvg.ts) +
  생성 데이터 worldLand) 위에, 맵 카탈로그의 `lat/lon`을 equirectangular로 투영한 점 배치.
  진입마다 랜덤 2개 "침공 중"(붉은 깜빡임), 나머지 등록(흰 점).
- **근접 점 클러스터링** — 세계지도(2:1 종횡비)상 너무 가까운 점들을 `clusterDots(pts, threshold=2.6%, aspect=0.5)`
  (Union-Find)로 한 **대표 점**으로 묶고 멤버 수 배지를 단다. 클러스터 안에 "침공 중" 멤버가 하나라도 있으면
  대표 점이 붉게 표시. 단일 점은 `data-map`, 묶인 점은 `data-cluster`로 마크.
- **재귀 확대(drill-down)** — 대표 점 클릭 → **세계지도 자체가 그 지역으로 확대**된다(`viewStack`에
  뷰 박스를 push). 확대 상태에서 지도·표류 오버레이·점을 전부 현재 뷰 기준으로 다시 그리고, 뷰 밖 점은
  버린다. 군집 임계값은 화면 백분율이라 배율과 무관하게 같은 시각 밀도를 유지한다 — 확대하면 도시가
  화면에서 멀어져 군집이 자연히 풀린다. 축소는 `mapZoomBar`(◀ 축소 / 전체) 또는 **Esc**.
  - **`zoomToSplit`이 전진을 보장한다.** `fitViewBox`는 점 분포에만 의존해 "담기만" 하므로 **상대 간격이
    보존**되고, 등간격으로 늘어선 다수는 아무리 확대해도 같은 군집으로 남는다(실측: 100도시 확장 시
    동아시아 25개가 2.45% 간격 — 임계 2.6% 미만이라 영원히 한 덩어리, 사용자에겐 "클릭이 안 먹는다").
    그래서 판정 기준은 "박스가 줄었나"가 아니라 **"군집이 실제로 쪼개졌나"**다.
  - **도달 보장**: 빌드 27개·전체 99개 모두 **최대 깊이 2** — 어느 도시든 두 번 안에 닿는다
    ([tests/worldMapDrill.test.ts](../../tests/worldMapDrill.test.ts)).
  - **확대 중에는 단일 점에 이름표**를 단다. 전체 지도에서는 안 단다(라벨끼리 뒤엉킨다). 반대로
    확대하면 배경(110m 해안선)이 뭉개져 위치만으로는 식별이 안 된다(실측 ×323에서 오사카·교토·나라
    구분 불가). 좌우 면은 `labelSide`가 **추정 폭**으로 정한다 — 옛 고정 임계값(`x>55%`)은 이름 길이를
    몰라 `"루앙프라방 · Luang Prabang"`(≈146px)이 폭 306px 상자 중앙에서도 잘렸다.
  - **확대 중에는 좌하단 오버레이(사건 파일 · 스토리 버튼)를 숨긴다** — `menu--zoomed` 클래스.
    전체 지도에서는 점이 대륙 위에만 있어 겹치지 않지만, 확대하면 점이 지도 어디로든 가므로 좌하단
    고정 오버레이가 전장을 가린다(사건 파일은 `pointer-events:none`이라 클릭은 통과했지만 시야를
    덮는 건 그대로였다). 스토리 목록이 열려 있었다면 함께 닫는다 — 버튼이 사라지므로.

  > **폐지: 확대 팝업(`clusterpop`)** — 306×225 한 장에 군집 전원을 지리적으로 정확히 배치하려던 구조.
  > `zoomMapBox`가 "최근접 쌍을 13% 이상 벌린다"는 목표를 함께 지려다 축소 하한(`exW/w`)이 **여백을
  > 정확히 0으로 붕괴**시켰다 — 양 끝 도시가 0%·100%에 박혀 점이 테두리에 잘리고(실측: 서울 0.0% ·
  > 나라 100.0%) 최근접 11px로 클릭이 서로 가로막혔다. 근본 원인은 **축척이 다른 도시가 한 군집에
  > 섞이는 것**(서울↔부산 325km와 교토↔나라 30km가 같은 군집)이라 한 배율로는 풀 수 없었다.
  > 지도 자체를 파고들면 "한 화면에 다 담는다"는 제약 자체가 사라진다.
- **지역 팝업** — 점 클릭 → 그 위에 지역 정보 + **드론 선택 버튼** + **탐방 모드 토글**. 선택 즉시
  `onDeploy(mapId, droneId, peaceful)` → 출격. **탐방(peaceful) 모드**면 적이 미스폰(`enemies.start(false)`)되어
  전장을 자유 답사(가드: [tests/enemySpawnMode.test.ts](../../tests/enemySpawnMode.test.ts)).
- **스토리/도움말 사이드 팝업** — "스토리"(첫 항목 INTRO → `onPlayIntro`), "?"(조작 안내).
  조작 안내는 드론 스펙 `actions[].desc`/`label`에서 동적 생성.
- `projectLatLon`/`clusterDots`/`fitViewBox`/`zoomToSplit`/`clampToWorld`/`zoomAt`/`projectInBox`/
  `labelSide`/`estLabelPx` 투영·군집·확대 로직은 순수
  ([tests/worldMap.test.ts](../../tests/worldMap.test.ts)).

## HUD

체력/주파수 게이지(**화면 상단 가운데** `.hud__gauges`, 좌우 나란히), 크로스헤어(발사 점멸 `flashFire`),
처치 수/웨이브(페이즈 미션에선 페이즈 번호), 특수무기 쿨다운 링(진행률·잔여초·발동중), 피격
비네팅(`flashDamage`), 유닛명. DOM은 [index.html](../../index.html)에 정적 배치, 런타임에 갱신.
동적 생성 요소(전투 재정립·손맛 패스):

- **낙인/심판 파문 경고**(`.hud__reckoning`, `setReckoning(warnLeft, brands)`) — 크로스헤어 아래 중앙.
  낙인 수("⚠ 낙인 ×n — 근원을 격파하라", 적색) + 파문 도래 카운트다운/통과 중(주황). Game 이 매 프레임
  `enemies.sweepWarnLeft`/`brandCount` 를 폴링.
- **파문 전면 펄스**(`.hud__sweeppulse`, `pulseSweep(strong)`) — 파면이 플레이어를 통과하는 순간
  가장자리에서 차오르는 붉은 워시(낙인 피해면 진하게). `Sfx.reckoning`(초저역 쿠웅+럼블)과 동조.
- **피해 방향 인디케이터**(`flashDamageFrom(camera, source)`) — 피해 발원 월드 좌표를 화면 각도로
  투영해 조준선 둘레(적 화살표보다 바깥 88px)에 큰 붉은 쐐기를 0.7s 표시(풀 6, aimArrow 재사용).

### 미션 배너 (`#missionBar`)

게이지 바로 아래 **상단 중앙**에 게임 인스턴스의 미션 상태를 표시한다([08](08-game-instance-mission.md)):
정적 **목표 문구**(`setMission`) + **잔여 시간**(`m:ss`, 30초 이하 경고색) · **진행 상세**(`32 / 60`,
`손실 3 / 10` 등) · **잔여 리스폰**(`⟳ 3`/`⟳ ∞`)을 `updateMission`으로 매 프레임 갱신. **탐방 모드**는
목표가 없어 배너를 숨긴다(`setMission(_, false)`).

### 적 방향 화살표 ([aimArrows.ts](../../src/ui/aimArrows.ts))

조준선(크로스헤어) 둘레에 **살아있는 플라즈모이드 수만큼 작은 붉은 화살표**를 그 방향으로 배치 — 비행 중
적이 "어느 방향"에 있는지 식별. 카메라 로컬 좌표 기준이라 **후방/화면 밖 적도 포함**해 둘레로 표시하고,
정면 중앙 데드콘(약 9°) 안의 적(이미 보임)은 생략.
- 순수 헬퍼 `aimArrow(lx,ly,lz,deadConeTan)`(둘레 각도 + 숨김 판정) / `arrowOffset(angle,radius)`(중심 기준
  px 오프셋) — THREE 비의존 → 단위 테스트 가능.
- `HUD.setEnemyDirections(camera, positions)` 가 적 월드 좌표를 카메라 로컬로 변환해 화살표를 갱신(풀링,
  상한 16개), `clearEnemyDirections()` 로 전부 숨김. Game 플레이 루프가 `enemies.aliveWorldPositions`로
  매 프레임 갱신하고, 사망/일시정지 시 clear(잔상 방지).

## 화면 비례 레이아웃 (hudLayout)

후방화면·미니맵·여백·코너 텍스트·우하단 버튼이 **화면 짧은 변**(`min(가로,세로)`)에 비례해 크기 조정 —
작은 폰은 작게, 큰 태블릿/데스크톱은 크게(아이폰 과대·아이패드 과소 문제 해소).
- 순수 `hudSizes(shortSide)` / `hudSizesFor(w,h)` → `{minimap, rearW, rearH, margin}`(상·하한 클램프,
  후방=미니맵 비례). **단일 출처**: JS(후방 GL 뷰포트·미니맵 캔버스 해상도)와 CSS 박스 정렬이 같은 값을 씀.
  ([tests/hudLayout.test.ts](../../tests/hudLayout.test.ts))
- `Game.applyHudLayout()` 가 init/리사이즈/세션생성 시 `.hud__rear`·`#minimap` CSS 박스와 코너 텍스트
  `top` 을 배치하고 `Minimap.resize()` 호출. 순수 CSS 요소(게이지 폭·버튼 크기)는 `vmin`+`clamp()`로 직접 비례.
- 우하단 터치 버튼(`.tc__buttons`)은 `clamp(76px,13vmin,104px)`로 키움(기존 64px).

## Minimap · RearView

- **Minimap** — 플레이어 주변을 `world.queryMinimap(cx,cz,r,sink)`로 받아 캔버스에 지형/도로/수역/
  건물/적/콜라이더를 위에서 내려다본 뷰로 그림. 플레이어 yaw로 회전. 캔버스 크기/DPR은 `configureCanvas(size)`
  로 화면 비례 설정, `resize(size)`로 리사이즈 대응. **작전구역 경계**(`player.zone`)는 그 호가 미니맵 반경
  안에 들어올 때(=경계 근처) **호박색 점선 호**로 표시해 이탈 한계를 알린다.
- **RearView** — 후방 카메라를 메인 캔버스 좌상단에 viewport/scissor로 덧그림. 박스 크기/여백/종횡비는
  매 프레임 `hudSizesFor`로 산출(CSS 테두리 박스와 동일 공식 → 정렬).

## 인트로 / 메뉴 배경

> ✅ 컷씬은 **개정 세계관**([spec/overview §4](../spec/overview.md)) 반영판 — 아무것도 떨어지지
> 않는다: 오무아무아(탐침의 투영) 횡단 → **투영 소멸** → **심해 균열 개방**(바늘구멍) → 균열
> 확장(흡수) → 플라즈모이드 상승 → 해변 집 **디테일 상실 → 붕괴**. (구 휴면 코어 산포/입수/침강
> 씬은 제거 — 8씬 → 6씬.)

- **CinematicPlayer** — 전용 씬/카메라로 인트로 컷씬 재생. 각 `scene`은 `build → update(t) → dispose`.
  종료 시 `disposeComposer`(블룸 패스 RT 포함)·`disposeObject`(지오+텍스처)로 GPU 자원 해제.
- **scenes / helpers** — 오무아무아 횡단, 투영 소멸(`sceneVanish`), 심해 균열 개방(`sceneRupture`),
  균열 확장, 플라즈모이드 상승, **해변 집 디테일 상실 → 붕괴**(재질색 플랫 톤 lerp + 조각화 `shatterBox`/
  모임지붕 `roofFace`/낙하 `fallFrag`) 등 장면 정의 + 결정적 난수(`rng`), ease, 카메라 보간(`track`).
  인트로의 코어·플라즈모이드 색은 **플라즈모이드 온도 시스템**(`colorAt`)에서 파생([tests/introHelpers.test.ts](../../tests/introHelpers.test.ts)).
- **MenuBackground** — 메뉴(전장 선택) 배경으로 인트로 장면 중 하나를 랜덤 재생, 끝나면 다른 장면으로
  교체하며 사이를 **검정 페이드(0.7s)** 전환. 페이드 div는 캔버스 위·메뉴 오버레이 아래. 이탈 시 컴포저 해제.
- **CinematicAudio** ([intro/CinematicAudio.ts](../../src/intro/CinematicAudio.ts)) — 인트로 컷씬 전용
  **절차적 배경음악(앰비언트 스코어)**. Web Audio API 로 즉석 합성, 외부 음원 0(게임 전반의 무에셋 기조 =
  `core/Sfx.ts`). **효과음 없이 배경음악만**(SFX 미포함). 구성: 옥타브를 아우르는 **디튠 톱니 패드 드론** +
  항시 **서브 저역** + **컨볼버 리버브**(절차적 임펄스 응답) + 느린 **필터 LFO**(호흡감). 8개 인트로 컷씬마다
  **무드 모핑** — `enterScene(name)`이 루트음을 retune(글라이드)하고 패드 필터 컷오프/게인·서브 게인을 그 장면
  무드로 램프. 불길한 장면(`rise`)엔 **트라이톤(증4도) 불협 보이스**를 올림. 마스터 페이드 인(0.8s)/아웃이 시각
  페이드와 동조.
  - `CinematicPlayer`가 생성자(사용자 제스처 = 인트로 버튼 클릭) 안에서 생성하고, 장면 진입마다 `enterScene`,
    스킵/종료 페이드 시 `stop(fade)`, 종료 시 `dispose()`(AudioContext close 로 모든 노드 일괄 해제).
    오디오 생성 실패해도 시각은 진행(`try/catch` → 무음).

## FX

- **dissolve** ([fx/dissolve.ts](../../src/fx/dissolve.ts)) — 적 소멸용 디졸브 셰이더 머티리얼(GLSL):
  진행도에 따라 가장자리 발광 + 알파 컷. 피격 플래시·박동 펄스 유니폼. `THREE.DoubleSide`(큰 적이
  코앞까지 다가와 카메라를 감싸도 내부면 레이캐스트가 잡혀 무피해 버그 방지). 피격 플래시는 순백 대신
  자기 색조 유지(`uEdgeColor * 2.6 * uFlash`) → 적색(약)/청백(강) 가독성 보존.
- **postprocessing** ([fx/postprocessing.ts](../../src/fx/postprocessing.ts)) — `EffectComposer` +
  `UnrealBloomPass`로 빔/이미시브 글로우. `createComposer(renderer, scene, camera)`. 블룸 렌더타깃은
  **반해상도**(iPad VRAM 절감). `disposeComposer(c)`는 컴포저 + **모든 패스의 RT까지** 해제
  (`EffectComposer.dispose()`만으론 패스 RT가 안 풀려 누수 → iPad 멈춤 원인이었음).
- **damageNumbers** ([fx/damageNumbers.ts](../../src/fx/damageNumbers.ts)) — 적중 위치에 플로팅
  데미지 숫자(상승 + 페이드).
- **빔 임팩트 FX**(`spawnImpact`, [weapons/FrequencyBeam.ts](../../src/weapons/FrequencyBeam.ts)) — 기본 빔
  적중부 연출을 "에너지 **중화**" 룩으로(빔이 플라즈모이드 에너지를 무력화 → 검게 탐): 일반 블렌딩의
  거의 검정(`0x05060a`) 어두운 버스트 + 가산 시안 "중화 링"(`makeRingTexture` 환형이라 어두운 배경에서도
  보임) + 어두운 잔재 스파크 파편. 확장·페이드 애니메이션은 공유.
- **TargetBrackets** ([fx/TargetBrackets.ts](../../src/fx/TargetBrackets.ts)) — **2km(`RANGE`) 이내** 플라즈모이드에
  카메라 빌보드 **코너 브래킷**(네 모서리 ㄱ자) 표시. **어두운 붉은색**(`0xb00000`), 투명도는 **거리 무관 일정**(페이드 제거).
  선이 아니라 **채워진 쿼드 메시**(매 프레임 `writeBracketGeo`로 갱신) — **프레임 크기는 대상 크기**(`bracketFrameRadius`, `MARGIN 1.56`)에,
  **선 두께는 화면상 일정**(`bracketHalfThick = THICK_SCREEN·거리`)에 따라 분리 제어. 두께는 모서리 **안쪽으로만** 들어가 ㄱ자 두 팔이
  외곽 꼭짓점에 맞물림 → **뾰족한 점이 항상 바깥**(+ 두께 대비 최소 크기 클램프 `MAX_T_FRAC`로 원거리에서도 외향 보장). ([tests/targetBrackets.test.ts](../../tests/targetBrackets.test.ts))
  브래킷 위에 적의 **현재 체력 수치**(`marker.hp`)를 DOM 라벨로 박스 상단에 표시 — 화면 투영, 카메라 뒤(`z>1`)면 숨김, 사망·일시정지엔 `hide()`로 잔상 제거.
- **Sfx.reckoning(hit)** — 심판 파문 통과음: 초저역 피치 드롭 "쿠웅"(64→30Hz) + 로우패스 럼블 스웰,
  낙인 피해(hit) 시 더 크고 길게 + 소각 링 한 점. 구역 축소(zoneShrink) 스텝에도 재사용(경계가 조여드는 신호).
- **EnergyWall** ([fx/EnergyWall.ts](../../src/fx/EnergyWall.ts)) — 작전구역 경계의 **반투명 에너지 벽**(반경
  `zoneRadius` 원통, `ShaderMaterial`). DoubleSide·depthWrite 끔(투과), **거리 페이드**(uNear 800/uFar 2600 —
  멀면 사라지고 경계 근처에서 진해짐, 원경 호리병 방지), 위로 흐르는 에너지 밴드 + 세로 격자선 + 프레넬,
  HDR 호박색이라 블룸에 걸려 발광. 지면(`heightAt(spawn)`) 기준 수직 범위(−200~+1600m)로 세워 고지대 맵 대응.
  `Game`이 존 있을 때 생성하고 프레임마다 `update(dt)`로 애니메이션, 종료 시 `dispose()`.
  구역 축소 변조(`zoneShrink`) 스텝마다 dispose 후 새 반경으로 재생성(미니맵 존 호는 `player.zone` 자동 추종).
- **Diagnostics** ([core/Diagnostics.ts](../../src/core/Diagnostics.ts)) — URL `?diag` 시 화면 오버레이로
  WebGL 컨텍스트 손실/전역 에러/`renderer.info` 스냅샷/프레임 하트비트 표시(온디바이스 진단).
