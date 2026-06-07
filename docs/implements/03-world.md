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
`queryMinimap(cx,cz,r,sink)`(미니맵용 근처 형상 방문), `update(px,pz)`(→ sky 태양 추종).

## TerrainField — 공간 질의 계층 (순수)

맵 데이터로부터 연속 공간 함수를 해석적으로 계산. 같은 (x,z)엔 항상 같은 값(부수효과 없음 →
테스트 가능, [tests/terrainField.test.ts](../../tests/terrainField.test.ts)).

- `heightAt(x,z)` — **DEM 하이트맵 우선**: `terrain.heightmap` + 로드된 `heights` 있으면 `sampleHeightmap`
  바이리니어(− `seaLevel`); 없으면 **절차적 폴백**(가우시안 봉우리 합 + 완만 기복, 도심 평탄 영역에서 0 수렴).
- `cityMask(x,z)` — 건물 분포 bbox 안=1 → 가장자리 산지=0(smoothstep).
- `inPalace(x,z)` — 경계 폴리곤(`objects.boundary`) 내부 판정(레이캐스팅). 권역/담장/도로억제의 기하 게이트.
- 하이트맵 빌드: `scripts/build-terrain.mjs`(Float32 raw `.bin`) — 합성 생성기 + 실 DEM 가이드.

## SkyEnvironment — 대기/조명

반구광 + 태양(평행광, 그림자 2048² · 프러스텀 ±420) + 보조광 + 하늘 배경/포그. `update(px,pz)`가
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
