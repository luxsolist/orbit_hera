# 03 · 전장 (맵 로스터 + 데이터 모델)

스키마는 [01-data-schemas.md](01-data-schemas.md). 이 문서는 현행 전장과 월드 데이터 모델을 정리한다.

전장 데이터는 **실측 OpenStreetMap(ODbL)** 기반으로 로컬 미터 좌표(1 unit = 1m, 북 = −Z)로
투영돼 있다. 모든 맵 파일은 출처 `meta.source = "OpenStreetMap ODbL"`을 명시한다.

---

## 현행 로스터 (`public/maps/index.json`)

| id | 이름 | 위치 | 건물 수 | 크기 | 특징 |
| :--- | :--- | :--- | ---: | ---: | :--- |
| `gyeongbokgung` | 경복궁 · Gyeongbokgung | 서울 (37.578, 126.977) | 3,765 | ~510 KB | 도심 한복판 왕궁 — **특수 권역(precinct)** |
| `manhattan` | Times Square | 뉴욕 (40.758, −73.986) | 8,087 | ~1.6 MB | 마천루 협곡(확장 ±2.5 km) |
| `osaka` | Osaka Castle · 大阪城 | 오사카 (34.687, 135.526) | 689 | ~146 KB | 일본식 양식(천수각) 샘플 |
| `paris` | Eiffel Tower | 파리 (48.858, 2.295) | 734 | ~263 KB | 샹드마르스 광장 |

`lat/lon`은 메인 화면 세계지도(equirectangular) 점 위치에 사용된다. 진입마다 랜덤 2개가
"침공 중"(붉은 깜빡임), 나머지는 등록 지역(흰 점)으로 표시.

각 맵은 자체 `spawn{ x, z, yaw }`을 갖는다(예: 경복궁 `{0, 360, 0}`, 맨해튼 `{45, 0, π}`).
스폰 높이는 드론별 — 보행은 지면, 비행은 지면 + `spawnHeight`(예: 100 m).

---

## 렌더 구성 요소

맵 1개가 빌드하는 것([`src/world/World.ts`](../../src/world/World.ts)):

- **지형** — 6 km² 로우폴리 평면(360 분할). 높이는 `mountains`(가우시안 봉우리) + 완만한 기복,
  도심 평탄 영역에서는 0으로 수렴. 색은 **단일 옅은 초록 바닥 + 고산 눈(흰색)**([`geo.elevationColor`](../../src/world/geo.ts) `GROUND_GREEN`→`SNOW`),
  비초록 지표(사막/해변/바위/포장 area)는 **단일 황토색 `SAND_TAN`**. (도심 정점색은 모놀리식 World 만 추가 lerp.)
- **건물** — 실측 윤곽을 압출(높이별 색 팔레트), 단일 메시로 병합. 충돌은 OBB/오목 삼각형.
  옥상은 디딤면(올라설 수 있음).
- **도로/차선** — 평면 리본(아스팔트) + 노란 중앙선.
- **수역** — 반투명 면.
- **배경 바위** — 산지(고도 50 m↑)에 화강암 바위 산포(통과 불가 + 디딤 가능 콜라이더).
- **랜드마크** — `landmarks`의 데이터 구동 구조물(전각·동상·탑·다리 등).
- **특수 권역 + 담장** — `precinct`/`boundary` 기반(아래).
- **조명/하늘** — 반구광 + 태양(그림자 플레이어 추종) + 하늘 배경/포그.

---

## 특수 권역 (Precinct) — 맵 고유 처리의 일반화

과거 경복궁 전용으로 코드에 하드코딩됐던 처리(마사토 바닥, 도로 제거, 전통 건물색/기와, 궁장)는
이제 전부 **데이터(`MapData.precinct`)로 일반화**되어 있다. 어떤 맵이든 `boundary` + `precinct`를
주면 동일한 권역 양식을 얻는다(코드 분기 없음).

`gyeongbokgung.json`의 `precinct` 예 ([01](01-data-schemas.md#precinctspec--권역-일반화-예-궁궐-경내) 참고):
- `groundColor` 마사토 바닥, `suppressRoads` 경내 도로/차선 제거
- `building` 단청 벽체 + 층고 8 m 상한 + 대형 마당(>2000 m²) 생략 + 청기와 옥상 슬래브
- `wall` 둘레 궁장(높이 4 m, `gates` 사대문 개구부는 비움 → 점프로 넘거나 문으로 통과)

---

## 월드맵 데이터 출처/생성

메인 화면 세계지도 대륙 윤곽은 **Natural Earth 110m land(퍼블릭 도메인)**를 equirectangular
SVG 경로로 변환해 임베드한다([`src/ui/worldLand.ts`](../../src/ui/worldLand.ts), 생성기
[`scripts/gen-worldmap.mjs`](../../scripts/gen-worldmap.mjs)). 재생성: `node scripts/gen-worldmap.mjs`.

맵 타일/건물 데이터는 OSM(ODbL)이므로 UI에 `Map data © OpenStreetMap contributors` 크레딧을 표기한다.

---

## 맵데이터 수집·가공 파이프라인 (단일 진입점)

맵을 (재)생성할 때는 개별 스크립트를 직접 호출하지 말고 **파이프라인 프로그램**을 쓴다 —
수집·가공·검증을 표준 순서로 실행하고, 검증 실패 시 빌드를 중단한다.

```
npm run build:map -- <id> [--no-terrain] [--zoom=13]
# 내부: build-terrain(real DEM) → build-maps(OSM) → build-world(타일 청크) → validate-world(게이트)
```

| 단계 | 스크립트 | 출력 |
|---|---|---|
| 1 실측 DEM | [`build-terrain.mjs real`](../../scripts/build-terrain.mjs) (PNG 디코드 [`dem.mjs`](../../scripts/dem.mjs)) | **`build/<id>.terrain.bin`**(중간물) |
| 2 OSM 수집·가공 | [`build-maps.mjs`](../../scripts/build-maps.mjs) (헬퍼 [`osm.mjs`](../../scripts/osm.mjs)) | **`build/<id>.json`**(중간물) + `public/maps/index.json`(카탈로그) |
| 3 타일 청크 | [`build-world.mjs`](../../scripts/build-world.mjs) (면/수역 청크 클립) | **`public/maps/<lat>/<lon>/*`**(런타임) |
| 4 검증 게이트 | [`validate-world.mjs`](../../scripts/validate-world.mjs) (순수 [`worldValidate.mjs`](../../scripts/worldValidate.mjs)) | error 시 비0 종료 |

> **저장 분리**: 가공 OSM(`<id>.json`)·DEM(`.bin`)은 **빌드 중간물**이라 `build/`(git 비추적)에 둔다 — 런타임은 읽지 않는다. **모든 런타임 맵 데이터는 셀 구조**로만 저장(+ 카탈로그 `index.json`·`landmarks.json`). 중간물을 `public/maps` 에 두거나 커밋하지 않는다.
>
> **셀 내 블록 분산**: 셀 디렉터리에 청크 파일 수천 개가 평면으로 쌓이지 않도록 **블록 디렉터리** 한 단계를 더 둔다 —
> `public/maps/<floorLat>/<floorLon>/<bx>_<bz>/<cx>_<cz>.json`, 여기서 `<bx>_<bz> = floor(cx/BLOCK)_floor(cz/BLOCK)`(BLOCK=16). 블록당 ≤ BLOCK²=**256 파일**(경복궁 20km = 1,600 청크 → 12 블록 디렉터리, 평균 ~133). 블록 크기는 `tiles.json.block` 에 기록되고 런타임 [`worldChunkPath`](../../src/world/chunkManifest.ts)/[`StreamingWorld`](../../src/world/StreamingWorld.ts) 가 동일 계산으로 경로를 만든다. 규칙: **`<cx>_<cz>` = 셀 NW 원점 기준 1024m 청크의 정수 격자 인덱스**(cx=동/1024, cz=남/1024).

### 대면적 OSM 수집 — **Geofabrik 추출 우선**(모든 광역 맵 공통 규약)

광역(반경 수 km↑)은 **Geofabrik 지역 추출(.osm.pbf)에서 bbox 만 잘라 한 번에** 확보한다. Overpass 타일 폭격(서버 부하·과부하 시 빈 200 반환으로 누락)을 피하고 **완전·재현 가능**. 절차:

```
# 1) 지역 추출 1회 다운로드(예 남한 ~280MB)
curl -L -o /tmp/south-korea.osm.pbf https://download.geofabrik.de/asia/south-korea-latest.osm.pbf
# 2) osmconvert 빌드(단일 C, zlib 필요 — 의존성 설치 불가 환경 대비 소스 컴파일)
gcc osmconvert.c -lz -O3 -o /tmp/osmconvert
# 3) bbox 추출 + 스트리밍 파싱 → Overpass-JSON 캐시(/tmp/osm-<id>.json)
node --max-old-space-size=8192 scripts/import-extract.mjs <id>
# 4) 이후 동일: build-maps(캐시 가공) → build-world → validate
node scripts/build-maps.mjs <id> && node scripts/build-world.mjs <id> && node scripts/validate-world.mjs <id>
```

- [`import-extract.mjs`](../../scripts/import-extract.mjs): `osmconvert -b=W,S,E,N --complete-ways --complete-multipolygons` 로 bbox 추출 → [`osmxml.mjs`](../../scripts/osmxml.mjs) **스트리밍 파서**(node 문자열 한계 초과 700MB+ 도 readline 라인 단위, node ref→geometry 해석)로 Overpass `out geom` 호환 `{elements}` 생성. processOSM 은 그대로 재사용.
- **build-world 가 오브젝트를 DEM(맵) 범위 청크로 클램프** — 추출의 `--complete-*` 가 bbox 밖(긴 도로·거대 relation·위도 셀 밖)까지 끌어와도 맵 밖 지오메트리는 폐기(좌표 범위 밖 방지). 수역 선형도 도로처럼 청크 클립.
- **저장 규약 유지**: 산출은 항상 `public/maps/<floorLat>/<floorLon>/<cx>_<cz>.json` + `tiles.json`. 광역은 단일 셀 좌표 프레임에서 `cx/cz` 확장(멀티셀 전).
- **다른 지역 맵도 동일**하게 Geofabrik 추출 기반으로 수집한다.

**폴백(소면적/추출 없음)**: bbox>0.06° 면 [`build-maps`](../../scripts/build-maps.mjs) 가 **~1km(0.0095°) Overpass 타일**([`osm.bboxTiles`](../../scripts/osm.mjs))로 중심→외곽 순차·재개 수집(좌표 키 캐시, 데이터 우선 응답, 실패 건너뜀). 단 공개 Overpass 처리량 한계로 대면적은 비권장.

배틀필드는 무제한([`StreamingWorld.bounds`](../../src/world/StreamingWorld.ts)=`1e7`) — 플레이어 주변만 스트리밍 로드, 데이터 없는 곳은 평지(y=0).

### 검증 불변식(회귀 가드)

지금까지 발생한 버그 클래스를 수치 불변식으로 고정한다 — `npm run validate:world -- <id>` 단독 실행 가능,
실제 생성 타일은 `tests/worldValidate.test.ts`가 매 테스트마다 0-error를 확인한다:

- 지형: NaN/Inf 없음, `heights.length == size²`, 표고 범위 정상
- **면/수역(클립 대상)은 반드시 자기 청크 경계 내** ← 산비탈 부유 판/공중 물 재발 차단
- 폴리곤 비퇴화(≈0 면적 경고), 좌표 유한, **셀-로컬 좌표 범위(NW 원점 음수/거대값=투영 버그)**
- **도형 품질**: 영길이 모서리(중복 정점)·자기교차 footprint(bowtie) 경고 — 퇴화 삼각형/이상 압출 위험(과거 검은 화면 원인)
- 생성기↔런타임 격자 일치(`tiles.mLon == cellMLon(cell)`), 청크 인덱스 셀 범위 내
- **인접 청크 지형 연속성**(공유 모서리 표고 일치 — 크랙/이음새 검출)
- **매니페스트 플래그 ↔ 파일 내용**(terrain/objects desync 검출)
- **DEM 교차검증**(청크 표고가 소스 `.bin` 을 독립 재샘플한 값과 일치 — 투영/샘플 회귀 직접 검출)
- **스폰 지표면**(스트리밍 카탈로그 스폰 청크가 존재 + 지형 보유 — 시작 추락/공중 방지)
- **동일 footprint 건물 중복**(centroid+면적+정점수 시그니처 — OSM 중복 way/청킹 버그로 인한 z-fighting 검출)

### 재현성

`OSM_DATE=2024-01-01T00:00:00Z npm run build:map -- <id>` 처럼 환경변수를 주면 Overpass `[date:]`
스냅샷으로 **그 시점 OSM 데이터를 고정 수집** → 같은 입력에 같은 결과(재빌드 재현 가능).

**규칙 추가 방법(지속 개선)**: `worldValidate.mjs`의 `validateChunk`/`validateManifest`에 검사를 더하고
`tests/worldValidate.test.ts`에 정상/이상 케이스를 추가한다(순수 함수라 네트워크 불필요).

### 정확한 지형/오브젝트 원칙

- 출시 맵 지형은 **항상 실측 DEM**(합성 모드는 프로토타입 전용). DEM 해상도 ≥ 청크 샘플 간격(32 m).
- **레이어 강제 순서**(`chunkMesh.LAYER_Y`): 지형(0) < 면 < 수역 < 보도 < 차도 < 중앙선 < 건물/벽. 녹색 면이 도로를 덮지 않도록 보장.
- **식생(초록) area 는 렌더 생략** — 지형이 이미 단일 초록이라 중복(겹침 z-fighting/자글거림 제거). 비초록(황토) area 만 지형 위에 깐다.
- **담장/울타리는 건물처럼 처리** — 폴리라인 ≤12m 리샘플 + 정점 지형 드레이프로 **윗면을 매끄럽게**, 바닥은 구간 최저 지표 아래로 스커트(공중 부유·높이 끊김 제거). 양면 수직 리본([`chunkMesh.ts`](../../src/world/chunkMesh.ts)).
- 1개 지형 셀보다 넓게 걸치는 오브젝트는 **단일 평면 금지** — 건물은 footprint 최저 지표까지 압출,
  **면은 삼각분할 후 긴 모서리를 세분(maxEdge 16m)해 지형에 밀착**(경계만 드레이프하면 큰 삼각형이 떠올라 도로를 덮음 → 세분으로 방지),
  수역은 경계 최저 지표 평탄, 도로는 **마이터 조인트 연속 리본**(겹침/조각 없음) + **차도 중앙선**(연 무광 노랑, 노면 위)([`chunkMesh.ts`](../../src/world/chunkMesh.ts)). 도로 리본·중앙선은 렌더 지오메트리라 청크 페이로드 증가 없음.
- **폴리곤 정리(수집 시점, [`osm.mjs`](../../scripts/osm.mjs))**: 연속 중복 정점 제거, 자기교차 건물=볼록껍질 복구·면=드롭,
  동일 footprint 건물 dedup, **도로 곡선 스무딩**(Chaikin 코너 커팅 + 직선 구간 솎음(tol 0.2) → 굴곡 완화, 데이터 폭증 방지).
- **도로는 차도만 수집**([`osm.isVehicularHighway`](../../scripts/osm.mjs)) — 보도/오솔길/계단/자전거도로/보행자전용 제외(도로 위 보도 조각 제거).
- **지표 노출 하천만 수집**([`osm.surfaceWaterways`](../../scripts/osm.mjs)) — `tunnel`·`layer<0`·`covered`([`isUndergroundWaterway`](../../scripts/osm.mjs))는 복개. 나아가 **하천(stream)** 은 연결 수계(끝점 공유)에 복개 구간이 하나라도 있으면 전체 제외(중학천 등 복개천의 **태그 누락 지표 구간까지** 숨김). 강/운하는 복개 구간만 제외·지표부 유지, 복개 없는 순수 지표 하천(산 계곡)은 노출.
- **강/하천 중심선(water `w`)은 렌더 시 얇은 리본**([`chunkMesh.ts`](../../src/world/chunkMesh.ts)) — 선형 하천을 면으로 채우면 자기교차 퇴화 폴리곤이 되어 공중에 파란 판이 생김 → 폭 w 리본으로. 면(연못/호수)만 채움.
- **도로 stroke 병합**([`osm.mergeStrokes`](../../scripts/osm.mjs)) — OSM 이 교차로마다 끊은 같은-폭 way 들을 가장 직선에 가까운 방향으로 이어 **교차로 관통 연속 폴리라인**으로 합침(병합 후 스무딩). 간선 중앙선·표면이 교차로에서 끊기지 않음(경복궁 간선 조각 87→21, 중앙값 90m→437m).
- **도로/담장은 청크에 폴리라인으로 저장**([`build-world.mjs`](../../scripts/build-world.mjs) `clipPolylineToRect`, Liang-Barsky) — 2점 세그먼트로 쪼개지 않고
  청크 경계로 클립한 **연속 조각**을 유지해, 렌더 시 연속 리본·중앙선이 끊김 없이 곡선을 따른다(조각남 방지).
- **도로는 렌더 시 ≤12m 로 리샘플 + 리본의 양 가장자리 정점까지 지형 드레이프**([`chunkMesh.pushRibbon`](../../src/world/chunkMesh.ts)) — 긴 세그먼트(종방향)·넓은 폭(횡방향 교차 경사) 모두 지형에 밀착해 가장자리로 지형(초록)이 솟지 않음.
- **도로/중앙선 폴리라인 끝점을 진행방향으로 연장**(`extendEnd`, min(반폭,10)m) — OSM way·청크 클립 경계·교차로에서 조각들이 겹쳐 사이 틈(초록)·중앙선 끊김을 메움.
- **중앙선은 간선도로(폭≥16m: primary/secondary)에만** — 작은 도로까지 그리면 교차로에서 가는 노란선이 뒤엉킴. 굵기 0.4m.
- **실측 DEM 은 bare-earth 스무딩**(`dem.bareEarth`, 형태학적 열림+블러) — terrarium DSM 의 건물 스파이크 제거로 도심 지면 평탄화(도로 밑 지형 솟음 방지). 검증기 `terrain-steep` 경고로 회귀 가드.
- **드레이프 높이(`sampleChunkHeight`)는 지형 메시 삼각분할(a,c,b)+(b,c,d)과 동일 보간**(bilinear 아님) — 렌더되는 삼각형 평면값과 정확히 일치해야 도로/면이 지형 위로 떠 비평면(새들) 셀에서도 초록이 솟지 않음. 레이캐스트 테스트로 회귀 가드.
