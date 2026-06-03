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
  도심 평탄 영역에서는 0으로 수렴. 잔디→숲→화강암→도심 정점색 그라데이션.
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
