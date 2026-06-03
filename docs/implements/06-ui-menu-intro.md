# 06 · UI · 메뉴 · 인트로 · FX

소스: [MenuScreen.ts](../../src/ui/MenuScreen.ts), [HUD.ts](../../src/ui/HUD.ts),
[Minimap.ts](../../src/ui/Minimap.ts), [RearView.ts](../../src/ui/RearView.ts),
[worldMapSvg.ts](../../src/ui/worldMapSvg.ts), [intro/](../../src/intro/),
[fx/](../../src/fx/)

## MenuScreen — 세계지도 전장 선택

`Game`에서 분리된 메뉴 UI 클래스(Game은 루프/상태에 집중). 콜백 주입:
`{ onDeploy(mapId, droneId), onPlayIntro() }`.

- **세계지도** — Natural Earth 대륙 윤곽 SVG([worldMapSvg](../../src/ui/worldMapSvg.ts) +
  생성 데이터 worldLand) 위에, 맵 카탈로그의 `lat/lon`을 equirectangular로 투영한 점 배치.
  진입마다 랜덤 2개 "침공 중"(붉은 깜빡임), 나머지 등록(흰 점).
- **지역 팝업** — 점 클릭 → 그 위에 지역 정보 + **드론 선택 버튼**. 선택 즉시 `onDeploy` → 출격.
- **스토리/도움말 사이드 팝업** — "스토리"(첫 항목 INTRO → `onPlayIntro`), "?"(조작 안내).
  조작 안내는 드론 스펙 `actions[].desc`/`label`에서 동적 생성.
- `projectLatLon(lat, lon)` 투영은 순수([tests/worldMap.test.ts](../../tests/worldMap.test.ts)).

## HUD

체력/주파수 게이지, 크로스헤어(발사 점멸 `flashFire`), 처치 수/웨이브, 특수무기 쿨다운 링(진행률·
잔여초·발동중), 피격 비네팅(`flashDamage`), 유닛명. DOM은 [index.html](../../index.html)에 정적 배치,
런타임에 갱신.

## Minimap · RearView

- **Minimap** — 플레이어 주변을 `world.queryMinimap(cx,cz,r,sink)`로 받아 캔버스에 지형/도로/수역/
  건물/적/콜라이더를 위에서 내려다본 뷰로 그림. 플레이어 yaw로 회전.
- **RearView** — 후방 카메라를 별도 렌더 타깃에 그려 HUD에 후방 시야 위젯 제공.

## 인트로 / 메뉴 배경

- **CinematicPlayer** — 전용 씬/카메라로 인트로 컷씬 재생. 각 `scene`은 `build → update(t) → dispose`.
- **scenes / helpers** — 오무아무아 횡단, 씨앗 산포, 입수, 코어 성장 등 장면 정의 + 결정적 난수(`rng`),
  ease, 카메라 보간 헬퍼([tests/introHelpers.test.ts](../../tests/introHelpers.test.ts)).
- **MenuBackground** — 메뉴(전장 선택) 배경으로 인트로 장면 중 하나를 랜덤 재생, 끝나면 다른 장면으로
  교체하며 사이를 **검정 페이드(0.7s)** 전환. 페이드 div는 캔버스 위·메뉴 오버레이 아래.

## FX

- **dissolve** ([fx/dissolve.ts](../../src/fx/dissolve.ts)) — 적 소멸용 디졸브 셰이더 머티리얼(GLSL):
  진행도에 따라 가장자리 발광 + 알파 컷. 피격 플래시·박동 펄스 유니폼.
- **postprocessing** ([fx/postprocessing.ts](../../src/fx/postprocessing.ts)) — `EffectComposer` +
  `UnrealBloomPass`로 빔/이미시브 글로우. `createComposer(renderer, scene, camera)`.
- **damageNumbers** ([fx/damageNumbers.ts](../../src/fx/damageNumbers.ts)) — 적중 위치에 플로팅
  데미지 숫자(상승 + 페이드).
