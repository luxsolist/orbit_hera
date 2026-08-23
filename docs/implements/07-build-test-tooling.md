# 07 · 빌드 · 테스트 · 툴링

## 스택 / 스크립트

- **Three.js**(WebGL2) + **Vite** + **TypeScript**(strict, `noUnusedLocals/Parameters`).
- 의존성: `three`. 개발: `vite`, `typescript`, `vitest`, `playwright`, `vite-plugin-javascript-obfuscator`.

| 스크립트 | 동작 |
| :--- | :--- |
| `npm run dev` | Vite 개발 서버(HMR) |
| `npm run build` | `tsc --noEmit` + `vite build` → `dist/` |
| `npm run typecheck` | 타입체크만 |
| `npm test` | Vitest 단위 1회 |
| `npm run test:watch` | Vitest watch |
| `npm run test:e2e` | `vite build` 후 Playwright 스모크 |
| `npm run build:map -- <id>` | 맵 파이프라인(DEM→OSM→청크→검증) — [build-pipeline.mjs](../../scripts/build-pipeline.mjs) |
| `npm run gen:cities` | 도시 100선 → [city-catalog.json](../../scripts/data/city-catalog.json) 생성(maps.config 가 읽음) — [gen-city-config.mjs](../../scripts/gen-city-config.mjs) |
| `npm run validate:world -- <id>` | 청크 검증 게이트만 |

## 빌드 하드닝 (소스 보호) — [vite.config.ts](../../vite.config.ts)

공개 배포 시 원본 소스/데이터 노출을 줄인다:
- **`sourcemap: "hidden"`** — 소스맵은 생성하되 번들에 참조를 두지 않음(배포 안 하면 원본 비공개,
  내부 에러 추적엔 사용 가능).
- **난독화**(`apply: "build"`) — 우리 소스(`src/*`)만 식별자 리네임(hexadecimal) + 문자열 배열
  (base64, threshold 0.75). `node_modules`(three)·생성 데이터(`worldLand`)는 제외.
  controlFlowFlattening·selfDefending·debugProtection 등 위험/무거운 옵션은 **비활성**(기능/성능 보존).
- 데이터(`public/*.json`)는 정적 자산이라 그대로 노출됨 — 민감 로직은 데이터에 두지 않음.

## 테스트 스위트 (Vitest — 40파일 / 703테스트, node 환경)

핵심 로직을 **순수 함수로 빼서** 부수효과 없이 가드한다.

| 영역 | 파일 | 가드 |
| :--- | :--- | :--- |
| 공용 | `math` | clamp/lerp/parseHexColor·**디스크 클램프(clampToDisk 존 경계)** |
| 플레이어 | `PlayerController` `spawn` | 점프 적분 · **방향별 이동속도(dirSpeedMult)** · **천장/5km캡(maxRiseAltitude)** · **피해전이(applyDamage 무적·사망 게이트)** · 스폰 높이/고도 분포 |
| 적 | `pursue` `coreEnemy` `kiter` `plasmoidSpec` | 3D 추적·**예측요격(interceptPoint)·분리(separationVector)·합성조향(steerVelocity)** · **상태기계/태깅/자가회복·흡수=성장(grow)** · **온도→색·체력·크기·속도·스폰분포·아키타입별 물량·접촉흡수피해** |
| 무기 | `targeting` `WeaponSpec` `beamFx` `drainCycle` | 콘 조준 · 거리감쇠·쿨다운진행률 · **머즐/끝점·측면벡터(sideVector)·발사관합산(emitterDamage)** · **소진형 특수 상태기계** |
| 모바일 | `mobileJoystick` | 데드존·8방향·속도 4단계 |
| 인스턴스/미션 | `mission` | **미션 평가(격멸/방어/사수/탐방)·종료 우선순위·리스폰 예산(deathFail)·풀 선택(pickMission)·목표/진행 문구** |
| 월드 | `CollisionWorld` `SpatialGrid` `terrainField` `precinct` `geo` `StructureBuilder` `buildingCombat` | 충돌/격자/지형 질의(가우시안·도심마스크·오목경계)/권역 양식/지오 유틸/랜드마크 · **건물 체력·피격 틴트·파괴·잔해 슬롯** |
| 타일 월드 | `chunkMesh` `chunkManifest` `chunkStream` `mapLocator` `enemySpawnMode` | 청크→메시(드레이프·리본·중앙선·벽·삼각분할 안착) · 셀/블록 경로·격자 좌표 · 스트리밍 LOD/프리페치 · **위경도→청크/랜드마크 로케이터** · 탐방(무적) 모드 |
| 맵 파이프라인 | `worldValidate` `clip` `dem` `osm` `osmxml` | 청크/매니페스트 16종 불변식 게이트 · 폴리곤/폴리라인 클립(S-H·L-B) · DEM 디코드·bare-earth · OSM 변환·stroke병합·복개천·타일분할 · OSM XML 스트리밍 파서 |
| 데이터 | `specs` `loader` | 드론·무기·**적(플라즈모이드)**·맵 JSON 필수필드 + 교차참조 · 로더 fetch 성공/에러경로 |
| UI/FX | `targetBrackets` `hudLayout` `hudLayoutRects` `aimArrows` | 코너 브래킷 거리 페이드 · **화면투영(projectToScreen)·체력라벨(labelText)** · **화면비례 HUD 위젯 크기(hudSizes)·박스 배치(rects)** · **조준선 둘레 적방향 화살표(aimArrow/arrowOffset)** |
| 투영/데이터 | `worldMap` `osm` `introHelpers` `cinematicFade` | equirectangular 투영·**클러스터/확대 박스(clusterDots/zoomMapBox/projectInBox)** · OSM 변환 · 컷씬 헬퍼(ease/rng/fallFrag/track 등)·**컷씬 페이드** |

> 데이터 검증(`specs.test.ts`)은 tsc가 못 보는 `public/*.json`의 누락/오타/dangling 참조(무기·맵·적 id)와
> 권역 스키마를 빌드 타임에 차단한다. `DEFAULT_PLASMOID ≡ plasmoid.json` 동치도 테스트로 고정(드리프트 방지).

## e2e 플레이테스트 하네스 — [tests/e2e/playtest.mjs](../../tests/e2e/playtest.mjs) (수동 도구)

모바일 합성 락(hasTouch) 경로로 **헤드리스에서 게임 루프를 실제 구동**하고 HUD DOM 을 주기 샘플링해
전투 타임라인(처치·HP·낙인·심판 파문·미션 상태)을 수집한다 — 유닛이 못 잡는 회귀(파문 진앙 면제 버그,
미션 로드 실패 등)를 실플레이로 검증하는 용도(CI 미편입). 서버 기동 후
`node tests/e2e/playtest.mjs <base> <mapId> <WALKER|FLYER> <seconds> <outPrefix>` — summary JSON(타임라인·
이벤트·gameSec 시간 지연 보정치)과 스크린샷을 남긴다. 헤드리스 렌더 지연으로 게임 시간이 1/3~1/5 로
흐르므로 절대 수치보다 거동 관찰용.

## e2e 스모크 — [tests/e2e/smoke.mjs](../../tests/e2e/smoke.mjs)

빌드 산출물을 Playwright로 띄워 먼저 **인트로 시네마틱**(재생 중 비-블랙·Esc 메뉴 복귀·에러 0)을 검증한 뒤,
`public/maps/index.json` **카탈로그 전 전장**(현재 스트리밍 3맵 `seoul-stream`·`everest-stream`·`busan-stream`)을 차례로 실제 로드/플레이하며 검증:
1. 콘솔/페이지 에러 0
2. 게임 `playing` 진입(오버레이 숨김) — 세계지도 점 클릭(클러스터면 대표 점 → 확대창 세부 점) → 팝업 드론 버튼 → 출격 경로
3. 미니맵 렌더됨(프레임 루프 동작)
4. 메인 WebGL 화면이 블랙이 아님(스크린샷 PNG 크기 휴리스틱)

단위 테스트가 못 잡는 **렌더/블랙스크린 회귀**를 가드(인트로 재생·메뉴 복귀 경로 포함).

## 데이터 생성 스크립트

- [`scripts/gen-worldmap.mjs`](../../scripts/gen-worldmap.mjs) — Natural Earth 110m land(퍼블릭
  도메인) GeoJSON → equirectangular SVG 경로 → `src/ui/worldLand.ts`. 재생성: `node scripts/gen-worldmap.mjs`.
- [`scripts/osm.mjs`](../../scripts/osm.mjs) — OSM 원시 데이터 → 로컬 미터 투영 + 건물 높이/도로 폭/
  폴리곤 면적 산출(맵 JSON 빌드 유틸). 순수 함수는 `osm.test.ts`가 가드.

## 개발 서버의 맵 서빙 — [vite-serve-maps.mjs](../../scripts/vite-serve-maps.mjs)

맵 청크는 수만 개라 `server.watch.ignored: ["**/public/maps/**"]` 로 워처에서 뺀다. 그런데 Vite 는
**public/ 파일 색인을 워처로 갱신**하므로, 워처에서 빼면 새로 구운 셀이 색인에 영영 안 들어오고
요청이 **SPA 폴백(index.html, HTTP 200)** 으로 샌다.

증상: 새 도시를 빌드해도 메뉴에서 선택 시 "타일 월드 로드 실패 — 타일 매니페스트 없음". 서버를
재시작해야만 고쳐졌다. 실패가 404 가 아니라 **200 + HTML** 이라 네트워크 탭만 봐선 원인이 안 보인다.

`serveMapsFromDisk()` 플러그인이 `<base>maps/**` 를 디스크에서 직접 읽어 이 구멍을 막는다:

- **재시작 불필요** — 도시를 구우면 즉시 잡힌다(100 도시 배치 시 필수)
- **없는 파일은 404** — next() 로 넘기지 않는다. 폴백으로 새면 누락이 조용히 묻힌다
- 경로 탈출(`../`)·잘못된 인코딩 차단, `Cache-Control: no-cache`(재빌드 즉시 반영)
- 개발 서버 전용(`apply: "serve"`) — 프로덕션은 `public/` 이 `dist/` 로 복사되므로 불필요

⚠️ `watch.ignored` 와 이 플러그인은 **한 쌍**이다. 하나만 두면 대량 watch 불안정(전자 없음) 또는
새 셀 미검출(후자 없음)이 재발한다. 계약은 [tests/serveMaps.test.ts](../../tests/serveMaps.test.ts)가 고정.

## 맵 데이터 파이프라인 — [build-pipeline.mjs](../../scripts/build-pipeline.mjs)

스트리밍 타일 월드(`public/maps/<lat>/<lon>/`) 생성. 표준 순서로 실행하고 검증 실패 시 중단. 상세 규약·불변식은 [spec/03-maps.md](../spec/03-maps.md).

| 단계 | 스크립트 | 핵심 |
| :--- | :--- | :--- |
| DEM | [build-terrain.mjs](../../scripts/build-terrain.mjs) + [dem.mjs](../../scripts/dem.mjs) | AWS Terrarium 타일 → PNG 디코드 → **bare-earth 형태학 스무딩**(건물 DSM 제거) → `build/<id>.terrain.bin` |
| OSM | [build-maps.mjs](../../scripts/build-maps.mjs) + [osm.mjs](../../scripts/osm.mjs) | 가공(차도만·stroke 병합·지표 하천만·정리) → `build/<id>.json` + 카탈로그 `index.json`. 대면적은 **Geofabrik 추출**([import-extract.mjs](../../scripts/import-extract.mjs) + [osmxml.mjs](../../scripts/osmxml.mjs)) 권장, 소면적은 Overpass 1km 타일 폴백 |
| 청크 | [build-world.mjs](../../scripts/build-world.mjs) + [clip.mjs](../../scripts/clip.mjs) | DEM+OSM 결합 → 셀/블록 디렉터리 1024m 청크 클립(S-H/L-B). DEM 범위로 클램프 |
| 검증 | [validate-world.mjs](../../scripts/validate-world.mjs) + [worldValidate.mjs](../../scripts/worldValidate.mjs) | 매니페스트/청크 16종 불변식, error 시 비0 종료 |

> **중간물(`build/`)** 은 git 비추적·런타임 비사용. **런타임 자산은 셀 청크 + `index.json`·`landmarks.json`** 뿐(=[spec/03-maps.md](../spec/03-maps.md) "저장 분리").
