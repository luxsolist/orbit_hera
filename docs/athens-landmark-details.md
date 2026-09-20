# 아테네 랜드마크 상세 모델

## 자료와 정확도
2026-09-20 조회한 OSM 원본 윤곽은 `scripts/data/athens-reference.json`에 보관한다. OpenStreetMap 기여자 / ODbL. 지리 좌표와 윤곽은 지도 자료이며 측량 성과로 간주하지 않는다. 공개 치수와 사진으로 형태를 해석한 절차적 모델이다. 사진측량 실사 에셋이나 완전 복원이 아니며 기존 애니메이션 셰이딩을 유지한다.

- 파르테논 평면 69.5 × 30.9m 참고: https://www.ascsa.edu.gr/uploads/media/hesperia/40205744.pdf (배치는 OSM 윤곽 사용)
- 에레크테이온의 비대칭 부지와 6개 여인상 주랑: https://www.theacropolismuseum.gr/en/node/16472
- 여인상 Π 배치: https://www.theacropolismuseum.gr/en/erechtheion-karyatid-kore-e
- 아크로폴리스 박물관 유리/콘크리트/대리석: https://www.theacropolismuseum.gr/en/museum-building 및 https://www.theacropolismuseum.gr/sites/default/files/2021-02/architectural_fact_sheet.pdf
- 국립고고학박물관 정면 사진: https://www.namuseum.gr/wp-content/uploads/2022/03/nam-brochure-%CE%95%CE%9D-low.pdf
- 판아테나이코 경기장: https://www.panathenaicstadium.gr/en/panathenaic-stadium/
- 하드리아누스 문 18 × 13.5 × 2.3m 참고: https://en.wikipedia.org/wiki/Arch_of_Hadrian_(Athens)
- 극장/부지 참고: https://www.thisisathens.org/neighbourhoods/acropolis-koukaki-guide
- 아크로폴리스 항공사진: https://walksineurope.com/athens-acropolis-and-acropolis-museum-tour

## 18개 대상 처리
| 대상 | 적용 및 남은 한계 |
|---|---|
| 파르테논 | 8×17 외곽 열주, 기단, 개방된 지붕, 잔존 내벽. 손상/복원 공사 상태와 조각은 근사 |
| 에레크테이온 | 비대칭 주랑, 남쪽 6개 여인상 모티브. 개별 조각/부지 단차 정밀 복원은 미완 |
| 아탈로스의 스토아 | 2층 열주, 낮은 기와 지붕 |
| 디오니소스 극장 | 열린 반원형 관람석과 무대 유구. 실제 파손 분포는 근사 |
| 헤로데스 음악당 | 계단식 관람석, 3단 아치 무대벽. 공사 가설물 미포함 |
| 제우스 신전 | 잔존 기둥 15개와 넘어진 기둥 모티브. 개별 기둥 좌표는 사진 비례 근사 |
| 하드리아누스 문 | 열린 아치, 상부 열주/박공 |
| 판아테나이코 경기장 | 열린 U자 대리석 관람석과 트랙. 출입구/좌석 통로는 단순화 |
| 국립고고학박물관 | 원본 중정 유지, 석재/황토 외피와 정면 열주/박공. 세부 날개 구성 근사 |
| 아크로폴리스 박물관 | 원본 윤곽, 유리 외피/상층 전시실/수직 프레임. 상층 회전각은 아직 단순화 |
| 아크로폴리스 | 원본 경계의 석재 부지. DEM 유지; 방어벽과 암벽 정밀 모델은 후속 |
| 고대 아고라 | 원본 부지와 내부 제외 영역 유지. 모든 개별 유구 복원은 후속 |
| 케라메이코스 | 원본 지면/제외 영역 유지. 묘비 조각 등은 후속 |
| 신타그마·모나스티라키 | 광장 경계/내부 제외 영역으로 지면 처리 |
| 아레오파고스 | 기존 지형 유지. 임의 건축물/새 암석 모델 추가 안 함 |
| 리카비토스 | 하부 케이블카 역으로 잘못 연결된 카탈로그를 정상의 OSM node 835178426로 수정. 기존 DEM 유지 |
| 플라카 | 도시 구역으로 기존 건물 군집 유지. 단일 대형 랜드마크 건물 추가 안 함 |

## 구조와 검증
`build-athens-details.py`가 원본 지도와 일치하는 윤곽만 연결한다. 일치 없음은 출처 윤곽 추가, 중복은 오류. 부지/열린 극장/경기장/아치는 건물 충돌 상자로 만들지 않고 `athensSites`로 렌더링한다. 시각 모델 내부 좌석·기둥의 정밀 충돌은 아직 없으며 신전 등 건축물은 기존 외곽 충돌 방식이다. 원본 DEM과 도로는 변경하지 않는다.

공통 `MapCorrections → applyRegionalDetail` 경로로 게임·도시뷰어·worker 모두 반영한다. 모델 부품은 합친 지오메트리/정점 색으로 처리하고 개별 기둥마다 draw call을 늘리지 않는다.

```
python3 scripts/build-athens-details.py
npm run audit:landmark-details -- athens
npx vitest run tests/athensDetails.test.ts tests/romeDetails.test.ts tests/mapLocator.test.ts
npm run typecheck
```

`docs/athens-landmark-model-audit.json`에 15개 모델/부지와 원본 ID, 결합 방식, 높이 근거를 기록한다. 아테네는 공통 2×2 압축/Releases 파이프라인을 사용한다. 상세 파일(athensSites 포함)은 일반 지도와 같은 압축 묶음 및 원본 백업에 포함한다. 렌더링 코드 자체는 Git에서 관리한다. 지도/상세 수정 후 `npm run maps:publish:city -- athens`로 묶음과 백업을 함께 갱신한다.

경기장은 부지 relation 19023844와 별개인 building=stadium relation 19023846을 실제 모델 결합 대상으로 사용한다. 원본 중복 상자 제거는 해당 건축물 윤곽 일치로만 수행한다.
