# 도시 구조물 분류와 검증

## 원칙

건물 크기나 주변 빌딩 높이만으로 용도를 판정하지 않는다. OSM의 건물 태그와 시설 용도 태그를 함께 확인한다. 주택·빌딩·복합시설은 보존하고, 공중화장실·승강장·쉼터 등의 독립 시설은 분리한다. 노드로 표시된 화장실이나 매점이 근처에 있다는 이유로 전체 건물을 바꾸지 않는다.

정본 함수는 `scripts/osm.mjs`의 `surfaceBuildingKind`, `structureFields`, `buildingHeightInfo`, `auditStructureRecords`다. 일반 지도 생성, 기존 지도 보정, 빌드/압축 전 감사가 공유한다.

| 타입 | 태그 근거 예시 | 근거가 없을 때 높이 | 표현 |
|---|---|---|---|
| 승강장 | public_transport/highway/railway=platform | 3m | 낮은 바닥, 지붕 태그가 있을 때 기둥·지붕 |
| 쉼터 | amenity=shelter, building=shelter | 3m | 개방형 기둥·지붕 |
| 독립 지붕 | building=roof | 3m | 원본 외곽선과 내부 구멍을 따르는 지붕 |
| 공중화장실 | building=toilets 또는 building=yes/public + amenity=toilets | 3.2m | 낮은 밀폐 건물, 빌딩식 창문 반복 제외 |
| 매점 | building=kiosk 또는 building=yes/public + shop=kiosk | 3m | 낮은 밀폐 건물 |
| 차고 | building=garage/garages | 3m | 밀폐 건물 |
| 창고·작은 오두막 | building=shed/hut/cabin | 3m | 밀폐 건물 |
| 설비실 | building=service/transformer_tower | 3.5m | 밀폐 건물 |

표의 높이는 설계 기본값이며 실측값이 아니다. 유효한 height와 building:levels가 있으면 우선 보존한다. 작은 시설로 분류됐는데 높이가 크게 명시된 경우 자동 축소하지 않고 검토 경고를 남긴다. 명시적으로 apartments/office/hotel 등으로 분류된 복합 건물은 내부 화장실·매점 태그만으로 변경하지 않는다. 지하층만 있는 시설은 지상 건물에서 제외한다.

## 공통 빌드 연결

- `build-maps.mjs`: 건물 높이 추정 전 시설 타입을 판정한다. 닫힌 시설 면은 building 태그가 없어도 분류할 수 있으며, 작은 시설 면적 하한은 2㎡다. 일반 건물 12㎡ 필터와 구분한다.
- 시설은 주변 빌딩 높이 보간의 대상과 기준 모두에서 제외한다.
- `build-world.mjs`: 시설 종류와 높이 출처를 검사하고 facilityKind/structureKind/roofed를 청크에 보존한다.
- `MapCorrections`: 개방형 시설만 별도 structures 경로로 보낸다. 기존 궁궐·동상·랜드마크 고증 모델은 우선한다. 밀폐된 화장실 등은 낮은 건물 충돌을 유지한다.
- `chunkMesh`/`StreetPlatform`: 개방 시설은 기둥 충돌만 생성한다. 밀폐 시설은 빌딩용 반복 창문을 적용하지 않는다. 독립 지붕의 오목한 외곽선을 사각형으로 채우지 않는다.
- `validate-city-surfaces.mjs`: 모든 도시에서 구조물 타입 테스트와 실제 청크 감사를 수행한다. 시설의 이웃 빌딩 높이 상속, 잘못된 기본 높이, 미지원 타입·비정상 높이는 빌드/압축을 실패시킨다.

## 기존 지도 감사와 보정

```sh
# 메타데이터/높이 정책 감사 (원본 미대조 항목은 별도 집계)
node scripts/audit-structure-types.mjs seoul
# 로컬 원본 XML을 사용해 의미 분류 대조; 기본은 읽기 전용
node scripts/audit-structure-types.mjs seoul build/seoul-reference/statue-sejong.osm
# 여러 XML 또는 {"way/ID": {"building":"yes",...}} 태그 사전 JSON 사용 가능
node scripts/audit-structure-types.mjs seoul build/small-structure-source-tags.json --apply
# 파생 자료와 로컬 압축본 갱신
node scripts/build-city-surfaces.mjs seoul
node scripts/build-map-bundles.mjs seoul
```

보정 전 원본은 `build/structure-type-backups/<city>/<run>/`에 보존한다. 보고서는 `build/<city>-structure-types.json`, 적용 내역은 `build/<city>-structure-types-applied.json`에 남는다. 원본 자료의 취득·갱신과 GitHub Release 게시 작업은 별도다. 원본 대조 없이 형상만으로 분류한 시설이 있다고 보고해서는 안 된다.

## 2026-09-27 서울 확인 결과

현재 청크 건물 280,929개 중 로컬 XML 태그와 ID 대조 가능했던 건물은 17,398개다. 이 범위에서 공중화장실 23개, 쉼터 19개, 승강장 2개, 매점 1개, 설비실 1개, 독립 지붕 289개, 지하 시설 2개를 확인했다. 분류/높이 메타데이터 337건을 26개 청크에 반영했다. 모든 항목이 잘못된 높이였다는 의미는 아니다.

사례: `way/714737994` 화장실 77m → 기본 3.2m, `way/554305319` 화장실 52m → 기본 3.2m, `way/1553534003` 화장실 40.5m → 기본 3.2m, `way/1555070026` 쉼터 29m → 기본 3m. 원본에 큰 높이가 명시된 지붕 10건은 그대로 두고 검토 대상으로 기록했다.

263,531개는 이번 원본과 ID 대조되지 않았다. 그중 좁은 면적에 높은 추정 높이가 붙은 후보는 21,194개지만, 실제 주택·세장형 빌딩이 포함될 수 있으므로 자동 수정하지 않았다. 이 숫자는 오류 확정 건수가 아니다. 저장된 국가 PBF는 EOF 오류가 있어 완전한 원본으로 사용하지 않았다. 향후 정상적인 도시 전체 원본을 확보해 같은 감사 도구로 검사 범위를 넓힌다.


## 이름·용도 미상 소형 외곽선의 높이 보정

`estimatedFootprintHeightLimit` / `constrainEstimatedBuildingHeight`를 모든 도시가 공유한다. 주변 빌딩 높이는 작은 구조물의 높이를 뒷받침하는 근거가 아니므로, **추정 높이(default/neighbor)이고 이름·랜드마크·시설 분류·명시 높이/층수가 없는 경우**에만 다음 설계 상한을 적용한다.

- 25㎡ 이하: 3.5m.
- 25–50㎡: 면적에 따라 3.5–6.5m로 선형 증가.
- 50㎡ 초과: 이번 제한의 적용 대상에서 제외.

기존 높이가 더 낮으면 올리지 않는다. 주택 종류별 높이, height/levels 출처, 고증 모델, 랜드마크는 보존한다. 화장실·매점으로 용도를 추측하지 않으며 실측값이라고 취급하지 않는다. 보정 출처는 `footprint-estimate`다. 건물은 청크에 중심점 기준으로 **전체 외곽선**을 저장하므로, 경계에서 잘린 큰 건물 조각을 소형 구조물로 판정하는 방식이 아니다.

공통 경로는 신규 OSM 보간의 마지막 단계, 가공 원본을 읽는 `build-world.mjs`, 기존 도시 재처리 `build-city-surfaces.mjs`다. `validate-city-surfaces.mjs`는 압축/배포 전에도 실제 전체 청크의 위반을 검사한다.

```sh
# 전체 도시 청크를 검사만 수행 (미보정 대상이 남으면 실패)
node scripts/rebuild-building-heights.mjs seoul
# 기존 도로·하천·지형 및 시설 분류를 보존하며 높이 재처리 + 표면 재생성/검증
node scripts/build-city-surfaces.mjs seoul
# 2×2 전송용 압축본 재생성 (검증 재실행)
node scripts/build-map-bundles.mjs seoul
```

이 재처리는 기존 원본 청크를 입력으로 사용한다. OSM/DEM을 다시 수집해 월드 전체를 생성하는 빌드와 구분한다. 변경 청크는 `build/building-height-backups/<city>/<run>/`에 백업하고, `build/<city>-building-heights-applied.json`에 변경 목록을 남긴다. GitHub Releases 갱신은 별도 게시 절차다.


2026-09-27 서울 재처리: 전체 1,600개 청크, 건물 280,927개 검사. 719개 청크의 11,253개 추정 높이를 제한했다. 제보 지점(37.568222, 126.977570), `way/1551642466`은 13㎡/18.5m에서 3.5m로 보정됐다. 변경 청크와 백업을 대조해 h/heightSource 외 건물 속성, 도로·지형·하천 데이터가 같음을 확인했다. 원본 높이·층수·종류별 높이 77,773개(변경 청크 내)는 보존됐다. 적용 후 재검사에서 추가 보정은 0개였다. 넓은 건물과 용도 미상 시설의 실제 용도를 모두 확인했다는 의미는 아니다.
