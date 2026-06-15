# 03 · 월드 (전장 빌드 · 지형 · 충돌)

소스: [World.ts](../../src/world/World.ts), [TerrainField.ts](../../src/world/TerrainField.ts),
[SkyEnvironment.ts](../../src/world/SkyEnvironment.ts), [CollisionWorld.ts](../../src/world/CollisionWorld.ts),
[SpatialGrid.ts](../../src/world/SpatialGrid.ts), [StructureBuilder.ts](../../src/world/StructureBuilder.ts),
[precinct.ts](../../src/world/precinct.ts)

`World`는 한때 724줄 god-class였으나 책임을 3개 모듈로 분리했다: **TerrainField**(공간 질의),
**SkyEnvironment**(대기/조명), **precinct**(권역 양식 해석). `World`는 메시 빌더 + 조율에 집중.

## 맵 데이터 — 섹션형 스키마 v2 + 정규화

맵 JSON은 **`terrain` / `objects` / `underground`** 독립 섹션(맵 에디터 레이어별 커스텀 대비). 로더가 순수
`normalizeMapData(raw)`([MapData.ts](../../src/world/MapData.ts))로 **평면(v1)·섹션(v2) 모두** canonical 섹션형
(`NormalizedMap`)으로 변환 → `World`/`TerrainField`는 `map.terrain.*`/`map.objects.*`만 소비. 기존 평면 맵 무수정 동작.
([tests/mapData.test.ts](../../tests/mapData.test.ts))

## World — 전장 메시 빌더

생성자 `(scene, map: NormalizedMap, terrainHeights?)` — 순서대로 빌드(= 의존 순서): `field` → 지형 → 도로 →
차선 → 수역 → 건물 → 랜드마크 → 권역 담장 → `collision.finalize()` → `sky`. `terrainHeights`(DEM `.bin`)는
`Game`이 `loadTerrainHeights`로 로드해 주입(없으면 절차적 폴백). 빌더별 역할은 [spec/03-maps.md](../spec/03-maps.md#렌더-구성-요소).

외부 API: `heightAt(x,z)`(→ field 위임), `resolveCollision`/`topAt`(→ collision 위임),
`queryMinimap(cx,cz,r,sink)`(미니맵용 근처 형상 방문), `update(px,pz,py?)`(→ sky 태양 추종 + 스트리밍 청크 로드/언로드, `py`는 고도 기반 프리페치에 사용).

## StreamingWorld — 전지구 타일 월드(청크 스트리밍)

`World`(모놀리식 1장)의 대체 — 플레이어 주변만 1024m 청크로 로드/언로드. 둘 다 공통 표면 [`GameWorld`](../../src/world/GameWorld.ts)
(`group/spawn/bounds/heightAt/topAt/resolveCollision/queryMinimap/update`)를 구현해 `Game`이 동일하게 다룬다.
카탈로그 `stream:true` 항목이면 `StreamingWorld.create(lat,lon)`로 진입.

- **데이터 소스**: `public/maps/<floorLat>/<floorLon>/<bx>_<bz>/<cx>_<cz>.json`(1024m 청크) + `tiles.json`(존재 청크·격자·`block`). 빌드는 [맵 파이프라인](07-build-test-tooling.md#맵-데이터-파이프라인-build-pipelinemjs), 규약은 [spec/03-maps.md](../spec/03-maps.md).
- **스트리밍**([chunkStream.ts](../../src/world/chunkStream.ts)): 속도방향 프리페치·히스테리시스·시간예산 빌드 큐·LRU. 주입형 `ChunkIO`(fetch=`tiles.json` 게이트+블록 경로, build=[chunkMesh](../../src/world/chunkMesh.ts), dispose).
- **부동 원점(단순화)**: 스폰을 로컬 원점(0,0)으로 잡아 Float32 정밀도 확보(셀-로컬 = 로컬 + origin). `bounds=1e7`(사실상 무제한 — 데이터 없는 곳은 평지 y=0). 셀 경계 횡단 재원점화/멀티셀은 추후.
- **무작위 시작 위치(건물 밀집 도심 위주)**: 매 게임 `pickSpawnChunk`([chunkManifest](../../src/world/chunkManifest.ts))로 **건물 밀집 도심 청크**를 골라 그 중심을 로컬 원점으로 삼는다 → 맵마다 다른 곳에서 시작(플레이어는 여전히 로컬 (0,0) = 정밀도 유지). **밀집도 = 반경 R(=2) 청크 이웃 중 건물(objects) 청크 수**, 밀집도 상위 `topFrac`(=25%) 안에서 무작위 선택(도심 코어 집중 + 변주). 시작 방위(yaw)도 무작위. 건물 청크 없으면(에베레스트 등) 지형 청크 폴백. **작전구역(미션 `zoneRadius`)·적 일괄 스폰이 이 도심 중심을 기준**으로 잡히고, 플레이어는 이 구역(반경 5km) 밖으로 못 나간다(`PlayerController.setZone`/`clampToZone`, 미니맵에 호박색 경계 표시).
- **질의 계층**: 로드된 청크 레지스트리에서 `heightAt`(삼각분할 일치 보간 `sampleChunkHeight`) · 오브젝트 청크 집합 변경 시 `CollisionWorld` 재구축 · `queryMinimap`.
- **청크 메시**([chunkMesh.ts](../../src/world/chunkMesh.ts)): 단일 초록/황토/눈 지형(면 세분 드레이프) + **지형 표면 베이크 텍스처** + 건물 압출 + 담장/강 리본. 모두 렌더 지오메트리(청크 페이로드 불변).
  - **표면 베이크 텍스처**(`bakeSurfaceTexture`): 도로/수역/면(area)·간선 중앙선을 **캔버스에 그려 지형 표면 텍스처로 굽는다**(별도 3D 리본 메시 아님 — 드로우콜·정점 절감). 도로는 minimap 질의용으로만 별도 수집.
  - **수역 구멍 보존**: 수역 폴리곤의 내부 구멍(섬·제방, `holes` 배열)을 SVG even-odd 채우기로 물에서 제외해 텍스처에 반영.
  - **건물 높이 보간**: 경사 지형에 건물을 안착시키기 위해 footprint **각 모서리 표고를 샘플**해 최저점(`minGround`) 기준으로 baseY(−0.6m 스커트)를 내리고, 지붕은 **중심 고도 + 높이**로 잡아 처마선을 일관되게 유지. 표고 샘플은 지형 메시 삼각분할과 동일하게 보간(`sampleChunkHeight`).

## TerrainField — 공간 질의 계층 (순수)

맵 데이터로부터 연속 공간 함수를 해석적으로 계산. 같은 (x,z)엔 항상 같은 값(부수효과 없음 →
테스트 가능, [tests/terrainField.test.ts](../../tests/terrainField.test.ts)).

- `heightAt(x,z)` — **DEM 하이트맵 우선**: `terrain.heightmap` + 로드된 `heights` 있으면 `sampleHeightmap`
  바이리니어(− `seaLevel`); 없으면 **절차적 폴백**(가우시안 봉우리 합 + 완만 기복, 도심 평탄 영역에서 0 수렴).
- `cityMask(x,z)` — 건물 분포 bbox 안=1 → 가장자리 산지=0(smoothstep).
- `inPalace(x,z)` — 경계 폴리곤(`objects.boundary`) 내부 판정(레이캐스팅). 권역/담장/도로억제의 기하 게이트.
- 하이트맵 빌드: `scripts/build-terrain.mjs`(Float32 raw `.bin`) — 합성 생성기 + 실 DEM 가이드.

## SkyEnvironment — 대기/조명

반구광 + 태양(평행광, 그림자 2048² · 프러스텀 ±420) + 보조광 + 하늘 배경/포그. `update(px,pz,py?)`가
태양과 그림자 프러스텀을 플레이어 위치로 평행이동(광원 방향 고정) → 큰 맵에서도 그림자 유지.

## 특수 권역 (Precinct)

맵 고유 처리를 데이터로 일반화한 핵심. `boundary` 내부에 `precinct` 양식을 적용한다(코드 분기 없음).

- **지형** — `precinct.groundColor`면 경계 내부를 그 색 맨땅으로(예: 마사토).
- **도로/차선** — `precinct.suppressRoads`면 경계 내부 구간 생략.
- **건물** — 순수 [`resolveBuildingStyle(inPrecinct, baseH, area, pb)`](../../src/world/precinct.ts)가
  층고 상한·지붕 슬래브·권역 색·대형 인클로저 생략을 결정([tests/precinct.test.ts](../../tests/precinct.test.ts)).
- **담장** — `precinct.wall`이면 경계 폴리라인을 따라 둘레 담장(치수/색 데이터), `gates` 개구부는 비움.

> 일반화 이전엔 경복궁 전용 상수가 `World.ts`에 하드코딩돼 있었고, `LANDMARK_R` 폴백 테이블·명명
> `LandmarkType` 유니온도 있었으나, 전 랜드마크가 `type:"structure"` + `excludeR`로 통일되며 제거됨.

## 충돌 (CollisionWorld + SpatialGrid)

콜라이더 종류: 원기둥(바위), 건물 OBB(볼록) + 오목 footprint 삼각 분할, 담장 AABB. 모두 등록 후
`finalize()`로 균일 격자 공간 인덱스(`SpatialGrid`) 구축(브로드페이즈).

- `resolveCollision(x,z,r,feetY)` — 겹치면 분리 법선으로 밀어냄. **윗면(top)보다 발이 높으면 통과**
  → 옥상/바위 위/담장 위에 설 수 있고, 낮은 담장은 점프로 넘을 수 있음.
- `topAt(x,z)` — 그 지점 디딤면 높이(서기 판정용).
- 가드: [tests/CollisionWorld.test.ts](../../tests/CollisionWorld.test.ts) (12),
  [tests/SpatialGrid.test.ts](../../tests/SpatialGrid.test.ts) (5).

## StructureBuilder — 데이터 구동 랜드마크

`Landmark.parts`(box/cyl/cone/plane/hiproof/strut) + `mats`(색/재질) 명세를 해석해 양식화 메시 +
콜라이더를 생성. 전각/동상/탑/다리 등이 전부 동일 인터프리터로 빌드된다(한국 기와·일본 천수각 처마
들림 등은 part 파라미터로 표현). 가드: [tests/StructureBuilder.test.ts](../../tests/StructureBuilder.test.ts).

## 건물 전투 (BuildingCombat)

소스: [BuildingCombat.ts](../../src/world/BuildingCombat.ts) · 가드: [tests/buildingCombat.test.ts](../../tests/buildingCombat.test.ts)

도시 건물·랜드마크에 **체력**을 부여해 플라즈모이드의 공격 대상으로 만든다(적의 공격 경로는
[05-enemies](05-enemies.md#매-프레임-군집-조향--공격-update) 참고). `World`/`StreamingWorld`가 빌드 시
건물을 등록(`registerBuilding`/`registerLandmark`)하고, `EnemyManager`가 표적 질의(`nearestTarget`)·피해
적용(`damage`)을 호출하며, 매 프레임 `update(dt)`로 연출을 진행한다.

- **체력 = 부피 기반** — 일반 건물 `maxHp = max(HP_MIN=40, 바닥면적 × 높이 × HP_PER_M3=0.04)`,
  랜드마크는 고유 hp 또는 기본값 `LANDMARK_HP_DEFAULT=6000`.
- **부분 갱신(드로우콜 보존)** — 건물은 성능상 청크 단위 **단일 병합 메시**로 렌더된다. 등록 시 건물별
  **정점 범위(`vStart`/`vCount`)**만 기록해 두면, 병합을 유지한 채 개별 건물의 정점 색(점진 적색 틴트)·
  위치(붕괴)만 부분 갱신할 수 있다. 랜드마크는 개별 `Group`이라 group 변환(scale/sink)으로 처리.
- **파괴 시퀀스** — 체력 0 → `beginDestroy`: 번쩍(`FLASH_DUR=0.16s`, 블룸 유발) → 슬로우 붕괴
  (`COLLAPSE_DUR=1.5s`, 윗부분이 더 크게 흩어지며 가라앉음) → 셸을 지하로 묻고(`buryShell`) **검정 잔해
  더미**만 남김.
- **검정 잔해(rubble)** — 파괴물은 인트로 해변 집 붕괴처럼 낮게 쌓인 각진 조각 더미로 남기되, **조명 무관
  순수 검정 단색**(`RUBBLE_BLACK`, `MeshBasic`)으로 통일해 지상/공중 어디서든 즉시 눈에 띄게 한다. 모든
  잔해는 **단일 InstancedMesh**(드로우콜 1개, 상한 `MAX_RUBBLE=2048`)에 footprint 크기로 인스턴싱.
- **충돌 개방** — 파괴 시 `collision.openBuildingAt`으로 해당 콜라이더를 열어 잔해 위를 통과할 수 있게 한다.
- **스트리밍 영속** — 파괴 이력을 안정 ID(중심 좌표 해시)로 `destroyed`에 보관 → 청크가 언로드/재로드돼도
  파괴 상태가 복원된다(`restoreRubble*`). 스트리밍 충돌 재구축 후엔 `reopenDestroyed`로 콜라이더를 다시 개방.
