# 03 · 월드 (전장 빌드 · 지형 · 충돌)

소스: [World.ts](../../src/world/World.ts), [TerrainField.ts](../../src/world/TerrainField.ts),
[SkyEnvironment.ts](../../src/world/SkyEnvironment.ts), [CollisionWorld.ts](../../src/world/CollisionWorld.ts),
[SpatialGrid.ts](../../src/world/SpatialGrid.ts), [StructureBuilder.ts](../../src/world/StructureBuilder.ts),
[precinct.ts](../../src/world/precinct.ts)

`World`는 한때 724줄 god-class였으나 책임을 3개 모듈로 분리했다: **TerrainField**(공간 질의),
**SkyEnvironment**(대기/조명), **precinct**(권역 양식 해석). `World`는 메시 빌더 + 조율에 집중.


## 팔레트 · 조명 — [palette.ts](../../src/world/palette.ts)

전장의 색·조명 값은 **서로 얽혀 있다**. 하늘을 어둡게 하면 청백 플라즈모이드가 살아나지만 바다와 붙고,
태양을 낮추면 그늘이 죽고, 랜드마크 색을 정하면 황토 지표와 충돌한다. 흩어 두면 하나를 고칠 때 다른 것이
조용히 무너지므로 한 파일에 모으고 [tests/palette.test.ts](../../tests/palette.test.ts)가 계약을 고정한다.

### 파이프라인 전제 (수치를 읽을 때 반드시)

```
씬 → 렌더타깃(선형 HDR, 톤매핑 없음) → 블룸(선형 기준 임계 0.75) → OutputPass(ACES + sRGB)
```

three.js 는 **렌더타깃에 그릴 때 머티리얼 톤매핑을 끈다**(`toneMapping = NoToneMapping`) — 톤매핑은
맨 끝 `OutputPass` 가 일괄 적용한다. 그래서 하늘·플라즈모이드도 예외 없이 같은 경로를 탄다.
확산 반사는 `albedo × irradiance / π` — 조명 강도를 그대로 곱하면 **3배쯤 과대평가**된다.

### 우선순위

① 게임 정보를 나르는 요소(적·빔·랜드마크·잔해)가 배경에 묻히지 않을 것 → ② 그 다음이 "너무
비현실적이지 않을 것". 양자장 플라즈모이드 세계관이라 사실주의는 후순위다.
**배경끼리 붙는 것(눈↔건물, 황토↔담장)은 정보 손실이 아니므로 계약에서 제외한다** — 모든 쌍을
동등하게 보면 정작 중요한 쌍을 놓친다.

### 값과 근거 (2026-08-23 개정)

| 항목 | 이전 | 현재 | 이유 |
|---|---|---|---|
| 하늘 | `0x2f9bf2` | `0x4c7590` | 선명한 파랑이 **청백 플라즈모이드를 삼켰다**(분리 0.058) |
| 반구광 | 1.18 | **1.30** | 태양을 낮춘 만큼 올려 그늘 휘도 보존(0.281 유지) |
| 태양 | 2.00 | **1.00** | 차분한 톤 = 전체 감광이 아니라 **태양↓ + 환경광 유지**(흐린 날 구조) |
| 노출 | 1.05 | 0.95 | 클리핑 해소 |
| 포그 | `0xb8e0ff` 900~5000 | 하늘색, 로드 반경의 0.69~1.0 배 | 아래 참조 |
| 바다 | `0x6fa3c8` | `0x2b6b86` | 연한 파랑이 청백 적(0.189)·하늘과 붙었다 |
| 담장 | `0x9c948a` | `0xc4b9a8` | 어두워진 그늘 건물과 붙었다(0.092) |
| 잔해 | `0x000000` | `0x151a1e` | 순수 검정은 어두운 배경에서 형태가 사라진다 |
| 랜드마크 | 금색 | 호박 `1.6,0.92,0.22` | 금색이 황토 지표와 겹쳤다(0.120). 자홍·청자는 적 스펙트럼과 충돌해 더 나빴다 |

**결과**: 치명 쌍 최소 분리 **0.058 → 0.245(4.2배)**, 0.25 미만 쌍 6개 → 1개.

### 포그의 실질 기능은 청크 경계 은폐다

청크 로드 반경(`STREAM_CFG.fineRadius` = 2,600m) 밖에는 **지오메트리가 없다** — 포그가 없으면 도시가
칼로 자른 듯 끝난다. 그런데 구 설정(900~5000m)은 교전 사거리를 흐리면서(1.5km 에서 15%) 정작 경계는
41% 만 가렸다. 지금은 로드 반경에 맞물려(생성자 인자로 주입) **0~69% 구간 완전 선명 · 경계 100% 은폐**다.

포그 제거를 검토했으나 **적(디졸브 셰이더)에는 포그 처리가 없어** 제거해도 적 시인성 이득이 0 이고,
경계만 드러난다.

## 랜드마크 시각 구분

랜드마크는 **승격된 건물**이라 렌더 지오메트리가 일반 건물과 같다(병합 메시). 그런데 사수 미션이
실제로 랜드마크를 표적으로 삼게 된 뒤(어그로 변조)에도 렌더가 똑같으면 **무엇을 지켜야 하는지 볼 수
없다**. 두 층위로 가른다:

| 층위 | 방법 | 파일 |
|---|---|---|
| 3D | 정점색을 **따뜻한 금색**(linear `1.5, 1.1, 0.42`)으로 고정 | [chunkMesh.ts](../../src/world/chunkMesh.ts) `LANDMARK_GLOW` |
| 미니맵(근경) | 호박색 footprint 를 일반 건물 **위에** 덧그림 | [Minimap.ts](../../src/ui/Minimap.ts) `C_LANDMARK` · `MinimapSink.landmark` |
| 미니맵(마커) | 반경 안은 **호박색 점**, 밖은 **테두리 화살표**(방향) | [Minimap.ts](../../src/ui/Minimap.ts) `drawLandmarks` · [minimapView.ts](../../src/ui/minimapView.ts) `pickEdgeMarkers` |

**밝기만으로는 안 된다(측정)**: `cityMat` 은 `MeshStandardMaterial` 이라 정점색이 **알베도**이고 조명에
곱해진 뒤 ACES 톤매핑(노출 1.05)이 하이라이트를 압축한다. 중성 밝은 색(1.45,1.42,1.30)으로 재보면

| 조건 | 랜드마크 | 최고층 일반 건물 | 차이 |
|---|---|---|---|
| 직사광(조명 ≈3) | 0.98 | 0.95 | **0.027 — 사실상 구분 불가** |
| 그늘(조명 ≈0.5) | 0.74 | 0.62 | 0.122 |

낮 전장은 대부분 직사광이라 밝기 단독은 실패한다. **따뜻한 색조**를 넣으면 톤매핑이 채널별로 압축하므로
파랑을 낮춘 만큼 포화 상태에서도 색이 남는다 — 직사광 차이가 **0.027 → 0.097(3.6배)**, 그늘은 0.286.

**색상을 쓰되 채도는 낮게**: 플라즈모이드가 온도 스펙트럼으로 빨강~파랑 전 구간을 쓰므로 고채도
랜드마크는 원거리에서 적으로 오독된다. 금색은 저채도라 안전하고, 붉은 피격 틴트(`DAMAGE_RED`)와도
갈린다(녹색 성분이 높다). 미니맵은 적(붉은 계열)·플레이어/HUD(시안)가 차지하지 않은 호박색이 빈 자리라
3D 금색과 **같은 색 언어**로 이어진다.

**배수가 아니라 고정색인 이유**: 일반 건물은 높이에 따라 linear 0.578(6m)~0.956(100m)로 폭이 넓다.
배수를 곱하면 낮은 랜드마크가 높은 일반 건물보다 어두워져 구분이 뒤집힌다. R 채널이 어떤 일반 건물보다
밝고 `FLASH_COLOR`(2.0)보다는 어둡다 — 파괴 순간 번쩍임이 여전히 더 밝게 읽힌다.

> 🔭 **한계**: 직사광에서는 여전히 대비가 크지 않다(0.097). 3D 표식이 확실해야 한다면 HUD 웨이포인트가
> 정공법이다. 현재 "어디로 가야 하나"의 신뢰 채널은 **미니맵**이다.

미니맵 **footprint** 는 충돌체에 랜드마크 플래그가 없어(콜라이더는 형상만 안다) 청크 등록분(`objReg`)에서
직접 고른다 — [`forEachLandmarkNear`](../../src/world/chunkMesh.ts)(순수, 중심 기준 컬링 + 여유 120m).
🔭 모놀리식 `World` 경로는 미배선(현 카탈로그가 전부 스트리밍이라 미사용).

미니맵 **마커**(점·화살표)의 출처는 footprint 가 아니라 [`BuildingCombat.forEachLandmark`](../../src/world/BuildingCombat.ts) 다.
이유가 둘 있다: ① **site 랜드마크**(해변·가트·교량 — `registerSite`)는 렌더 바인딩이 없어 footprint 경로로는
영영 안 보인다(바라나시는 큐레이션 11개 중 5개가 site 다), ② 파괴 여부를 footprint 는 모른다 —
무너진 랜드마크는 **빈 원**으로 남겨 사수 미션의 피해 현황이 읽히게 한다.

반경 밖 랜드마크는 테두리 화살표로 방향만 준다. **각도가 겹치면 버린다**(`pickEdgeMarkers`, 최대 4개 ·
최소 간격 12.6°) — 밀집 도시는 로드 반경 안에만 수십 개라(로마 실측 69개) 전부 그리면 테두리가
화살표로 둘러싸여 방향 정보가 사라진다. 겹침 제거가 이 기능의 핵심이지 장식이 아니다.

### 미니맵 고도 줌

미니맵이 담는 월드 반경은 **지면 상대 고도(AGL)** 로 정한다 — 낮으면 확대(반경 45m), 높으면 축소(300m).
곡선은 거듭제곱(`R = 80·(AGL/100)^0.58`, [minimapView.ts](../../src/ui/minimapView.ts) `minimapRadiusFor`):

| AGL | 반경 | 상황 |
|---|---|---|
| ~1.7m | 45m (하한) | 보행 드론 — 골목 단위 식별 |
| ~37m | 45m | 하한에 닿는 지점 |
| 100m | 80m | 비행 스폰(`flyer.spawnHeight`) — 종전 고정값 70m 과 비슷 |
| 1000m | 300m (상한) | 비행 천장 — 구역 조망 |

**절대 Y 가 아니라 AGL** 인 이유: 절대 높이를 쓰면 고지대 전장(에베레스트)에서 지상에 서 있어도 최대
축소가 된다. `PlayerController.HARD_CEILING`·`StreamingWorld` LOD 도 같은 규약이다.

로그 곡선은 검토했으나 버렸다 — 1000m 에서 124m 에 그쳐 고고도가 무의미해진다. 선형은 반대로 저고도에서
거의 변하지 않는다.

반경이 변하면 **거리 링도 둥근 수로 다시 고른다**(`ringRadiiFor` — 2~4개 유지). 고정 20/40/60 을 그대로
두면 축척을 잃는다. 같은 이유로 현재 반경을 원 밖 좌하단에 숫자로 표기한다(정사각 캔버스에 내접원이라
네 모서리는 비어 있다).

고도는 비행 중 빠르게 변하므로 목표 반경을 그대로 쓰면 미니맵이 떨린다 — 지수 감쇠로 따라간다
(`approach`, τ=0.35s). dt 를 그대로 곱하면 프레임률에 따라 수렴 속도가 달라진다.

### 위상 이탈 개체 — 미니맵은 방향만(2026-08-24)

[§2.1 위상 이탈](../spec/05-dimensional-cosmology.md#21-위상-이탈-벌크-여행--예정)은 실은 이미 실전
적용 상태였다(`DEFAULT_PLASMOID.phase` 설정 + 워커 빔의 `manual.decohere`/`pinSec`) — 남은 건 미니맵
표기 하나였다. 예전엔 이탈 개체도 **정확한 위치**에 빈 원("확률 구름")을 그렸는데, "질량-에너지
서명(=중력 이상)만 새어 나온다"는 설정과 어긋난다 — 정확한 좌표를 안다는 건 이미 관측한 것이다.

이제 위상 개체는 미니맵에 **위치를 아예 올리지 않는다.** 대신 테두리에 속이 빈 다이아몬드가
펄스(`Minimap.drawPhaseDirections` — `PHASE_PULSE_HZ` 1.6Hz)로 방향만 가리킨다. 랜드마크 화살표
(호박색·꽉 참·고정)와 형태·채움으로 갈라 오독을 막는다. 정확한 위치는 **화면의 중력 렌즈 왜곡**
(§2.7.1, [`lensDistort.ts`](../../src/fx/lensDistort.ts))으로만 읽힌다 — 미니맵(방향)과 화면(정밀 위치)
을 서로 다른 채널로 쪼갠 것. 여러 개체가 겹치면 `pickEdgeMarkers`로 가까운 순 솎아낸다(랜드마크와
동일 로직 재사용, 거리 게이트만 없앰 — 위상 개체는 근거리라도 위치를 안 주므로 항상 방향 후보).

## 맵을 깔고 도시를 선언한다 — 위치 순수 함수

**맵** = 셀 디렉터리(`maps/<lat>/<lon>/`)와 그 안의 위치 키 청크. 데이터의 유일한 소유자.
**도시** = 이름 + 영역(중심·반경) + 메타(장·국가·큐레이션). **자기 데이터가 없는 가상 개념.**

이게 성립하는 조건이 하나다:

> **청크 내용은 그 위치의 순수 함수다.**

파일 레이아웃은 원래부터 이 모델이었다 — 경로에 도시 이름이 없다. 도시에 묶여 있던 건 **빌드 입력**뿐이다.

### 무엇이 도시에 묶여 있었나

예전에는 도시마다 자기 중심의 2048² DEM(`.bin`)을 굽고 청크가 그것을 샘플했다. 청크 샘플 **위치**는
이미 셀-로컬 정수 격자라 도시와 무관했는데 **높이 조회만** 도시별 격자에 묶여 있었다. 그래서 한 셀에
두 도시가 살면 경계에서 지형이 어긋났다.

고친 곳은 둘이고, **둘 다 필요했다**(오사카↔나라 12.2km 겹침 실측):

| 단계 | 이음새 오류 |
|---|---|
| 전환 전 | 1,145 |
| 공유 샘플러만 | 33 |
| + 평탄화 여유 범위 | **0** |

1. **공유 샘플러** — [`geodem.sampleMosaic`](../../scripts/geodem.mjs)가 위경도 순수 함수다(Terrarium
   타일 픽셀이 전역 좌표라 어떤 bbox 로 모자이크를 만들었는지와 무관). 셀 정렬 작업 격자
   (`cellLattice`, 청크당 52샘플 = 19.69m, halo 12)에서 청크 표고를 뽑는다.
2. **평탄화 여유 범위** — 남은 33건의 원인. 도시마다 자기 추출의 건물만으로 평탄화하니 커버리지
   경계 청크가 이웃 건물을 몰라 값이 어긋났다. 추출 bbox 에 **1,500m 여유**(`EXTRACT_MARGIN_M`)를 두고,
   평탄화는 커버리지 **+1청크**(`inFlat`) 범위 건물을 전부 본다. 청크 기록은 커버리지 안만.

실측 확인: 소유자 다른 인접 쌍 52개 · 모서리 표본 1,716점 **전부 0m**.

### 큐레이션은 전역 레지스트리

도시가 가상이면 청크에 실리는 랜드마크도 위치로 결정돼야 한다. 도시별 목록만 적용하면 같은 청크를
누가 굽느냐로 랜드마크 표시가 달라진다(순수 함수 위반). 그래서 `landmark-catalog.json` 을 전역
레지스트리로 보고 **좌표가 커버리지에 드는 모든 항목**을 적용한다 — 도시 이름은 조회·관리용 라벨이다.
실측 영향: 100도시 중 1곳(선전 ← 홍콩 만불사). 겹치는 땅에서 두 도시가 같은 랜드마크를 보는 게 옳다.

### 남은 것과 사라진 것

| 항목 | 전환 후 |
|---|---|
| `PLACEHOLDER`/배치 조정 | **불필요** — 나라 반경 11.2km → 규격 20km 복원 |
| 겹침 양보·차단 | **제거** — 겹쳐도 같은 값이라 다시 써도 무해 |
| 소유 표기(`m`) | **유지** — 스폰을 자기 영역으로 한정([`chunksOwnedBy`](../../src/world/chunkManifest.ts)) |
| `tiles.json` 병합 | **유지** — 셀당 하나라 항목 합집합 필요 |
| 검증기 DEM | 격자 단일 경로([`build/<id>.lattice.bin`](../../scripts/validate-world.mjs)) |
| 도시별 `.terrain.bin` | 청크 경로에서 미사용(모놀리식 `World` 폴백만 사용) |

스트리밍은 소유로 제한하지 않는다 — 옆 도시로 이어지는 지형은 정상이고 작전구역(5km)이 플레이어를 묶는다.

🔭 **작업 격자가 정사각·단일 원점**이다(`morphPass`/`flattenUnderBuildings` 전제). 셀 안에서 x·z 인덱스가
치우친 도시는 격자가 커진다 — 실측 최대 부산 6525²(170MB). 100도시 규모에서 문제되면 축별 원점으로
일반화할 자리다.

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

- **`nearestLandmark(x, z)`** — 어그로 변조(`aggro: "landmark"` — 미션 훅 ④)용 최근접 intact 랜드마크
  질의. 랜드마크는 소수라 반경 무제한 전수 탐색(전장 반대편이라도 직행 표적). 없으면 null → 호출부가
  일반 건물 폴백.
- **랜드마크 얽힘 분류** — `Landmark.cls`(MapData)에 얽힘 택소노미 유형(6종 — 정본
  [spec/06-missions §8](../spec/06-missions.md))이 실린다. 분류기·메타(표시명/브리핑/저항 배율)는
  [entanglement.ts](../../src/world/entanglement.ts)(순수 — OSM 태그 자동 분류 `classifyOsmTags` 포함,
  [tests/entanglement.test.ts](../../tests/entanglement.test.ts)). 파이프라인 통과: `maps.config.mjs`
  `cls` → `build-maps.mjs` bake → 타일 데이터(반영엔 `npm run build:map` 재생성 필요).

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
