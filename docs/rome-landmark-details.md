# 로마 랜드마크 지도·공개 치수 기반 모델

## 범위와 정확도

대표 목록 24개를 점검하고 11개 건축 모델, 3개 소형/토목 모델과 22개 상세 청크를 적용했다. OSM의 실제 평면, 기관 공개 치수, 사진을 참고한 비율을 사용한다. 사진측량 모델이나 현장 전수 측량 복원은 아니다. 기존 로마의 밝은 애니메이션 조명·팔레트는 유지한다.

| 대상 | 반영 | 남은 근사/검토 |
|---|---|---|
| 콜로세움 | 타원형 아치열, 북측 높은 외벽, 낮은 남측, 비어 있는 경기장·내부 벽 | 부서진 개별 석재/정확한 관중석 잔존 형태, 회전 방향 정밀 대조 |
| 판테온 | 원통 본체, 오쿨루스를 남긴 돔, 북쪽 기둥 현관 | 외부 돔 단차, 내부 조각·벽감 |
| 산 피에트로 | 잘못된 장소 수정, 원본 윤곽 본당·별도 돔·랜턴·십자가 | 광장 열주랑과 입면 조각 전체 복원은 미포함 |
| 산탄젤로 성 | 원형 성채·기단·상층·흉벽 | 천사상은 축약 실루엣, 내부 성곽 세부 |
| 트레비 분수 | 별도 수반·기둥·중앙 벽감·석재군 | 인물상/물줄기 정밀 표현은 미포함. 팔라초 폴리와 접합 추가 대조 필요 |
| 시스티나 성당 | 원본 평면의 벽돌/석재 본체·경사 지붕 | 실내 벽화 미포함 |
| 산타 마리아 마조레 | 본당·경사 지붕·별도 75m 종탑 | 종탑 수평 위치/작은 돔은 사진 기반 추가 조정 대상 |
| 산 조반니 인 라테라노 | 원본 평면·중정 보존·석재 기둥·지붕 | 파사드 인물상·내부는 미포함 |
| 바티칸 박물관 | 원본 건물 윤곽·중정·외피 | 박물관 단지 전체 모든 동의 특수 모델은 미포함 |
| 티투스/콘스탄티누스 개선문 | 1개/3개 실제로 열린 아치·상부 장식대 | 부조 축약, 충돌 통과 정밀 검증 필요 |
| 스페인 계단 | 지도 중심선의 계단 구간과 지형 랜딩 연결 | 전체 11개 램프 폭/분기와 난간 완전 복원은 아님 |
| 산탄젤로 다리 | 원본 윤곽 방향·5개 석조 아치·난간·축약 조각, 양끝 DEM 높이 연결 | 상판 보행 충돌/은행 접점 실측 고도는 미확정 |
| 진실의 입 | 지도 위치의 지름 1.8m 석재 원반·얼굴 | 조각 세부와 현관 벽의 접촉 정밀 대조 |
| 포로 로마노/카라칼라 욕장 | 지도 표면, 남아 있는 지도상 유적 벽, 일치하는 유적의 집 모양 외피 제거 | 모든 내부 유구 높이·발굴 지형 미실측 |
| 나보나/캄포 데 피오리/캄피돌리오/베네치아 광장 | 지도 광장 경계와 포장 표면 | 광장별 바닥 문양·분수·조각 전체는 미포함 |
| 팔라티노 언덕/트라스테베레 | 기존 실제 지도·DEM 보존, 임의 건물로 대체하지 않음 | 추가 지형/수목 정밀화는 후속 |
| 카타콤베 | 기존 지상 건물·지형 유지, 지하묘지의 허구 고층 외피 생성 안 함 | 지하 공간은 미구현 |
| 아피아 가도 | 기존 unresolved 유지 | 전체 노선 식별 후 별도 작업 필요 |

## 출처와 측정 기준

- 원본: OpenStreetMap contributors, ODbL. `scripts/data/rome-reference.json`에 지오메트리·OSM 식별자·확보일을 보존했다. 출처: https://www.openstreetmap.org/copyright
- 콜로세움 현재 최상부 48.5m: https://colosseo.it/restauri/colosseo/ . 수평 188×156m 참고: https://colosseo-roma.it/en/explore/coliseum/architecture/ . 층·두께·석재 색은 해석값이다.
- 판테온 내부 지름/높이 43.30m: https://direzionemuseiroma.cultura.gov.it/en/pantheon/ . 외벽 반지름·현관 비례는 사진 근사이며 내부 지름을 외벽 지름으로 쓰지 않았다.
- 산 피에트로 돔 최고높이 약 136m: https://www.basilicasanpietro.va/it/help/la-basilica . OSM 본체 height=54 태그와 전체 높이는 별개다. 본체/드럼/곡면 분할은 해석값.
- 산타 마리아 마조레 종탑 75m: https://www.basilicasantamariamaggiore.va/it/basilica/storia-e-arte/esterni.html . 본당 높이는 사진 근사 30m다.
- 개선문 높이: OSM way/23913953 height=15.4, way/23590989 height=21. 기관 소개: https://turismoroma.it/en/node/74596 . 기관 간 콘스탄티누스 높이 표기가 달라 모델에는 명시적인 OSM 21m를 사용했다.
- 스페인 계단 형태·사진: https://www.turismoroma.it/en/places/spanish-steps . 지형 연결은 현재 DEM을 따르며 계단 24m 메타데이터는 사진 근사이고 렌더링 높이를 강제하지 않는다.
- 분수: https://www.turismoroma.it/en/places/poli-palace-trevi-fountain . 26m는 이 구현의 사진 근사값.
- 성/다리: https://www.turismoroma.it/it/node/87 , https://www.turismoroma.it/en/places/santangelo-bridge . 성 48m는 사진 근사이며 다리의 상판 절대고도는 양쪽 DEM에서 얻는다.
- 진실의 입 지름 약 1.80m: https://www.turismoroma.it/it/node/1787 . 원반 두께/얼굴은 축약했다.

## 재생성과 검증

```bash
npm run build:rome-details
npm run audit:landmark-details -- rome
npm test -- tests/romeDetails.test.ts tests/seoulDetails.test.ts tests/busanDetails.test.ts tests/mapLocator.test.ts tests/chunkMesh.test.ts
npm run typecheck
```

원본 지도와 DEM은 직접 수정하지 않는다. `RomeDetail`은 일치하는 원본 평면에만 모델을 연결하고 새 원본 형상은 명시적인 add 목록으로 추가한다. 애매한 복수 매칭은 빌드를 실패시킨다. 랜드마크 목록의 잘못된 산 피에트로 ID도 수정했으므로 새 지도 빌드와 편집기 조회에서 유지된다.

`docs/rome-landmark-model-audit.json`은 모델별 높이 출처/결합 방식/청크 목록이다. 도시별로 재발 방지 기준은 [공통 제작·검증 절차](landmark-rendering-workflow.md)를 따른다. 자동 감사가 통과해도 모든 장소의 시각·충돌·실측 일치가 확인된 것은 아니다.

## 이번 검증 기록

서울·부산·로마 데이터 감사 통과, 관련 테스트 53개 및 타입 검사 통과. 도시 뷰어에서 콜로세움/판테온의 낮 화면과 산 피에트로의 수정된 이동 좌표를 확인했다. 모든 장소의 정면·측면·야경·전투 충돌 확인을 완료한 것은 아니다. 공통 윤곽 비교 함수는 같은 경계 상자의 다른 도형 거부, 역순 링 허용, 인접 건물 거부를 별도로 확인했다.

## 압축 지도 배포

로마도 공통 2×2 압축·Releases 경로를 사용한다. 새 환경에서는 `npm run maps:restore:city -- rome`로 편집용 원본을 복원한다. 상세 오버레이 수정 후 `npm run maps:publish:city -- rome`와 `npm run maps:verify`를 실행한다. 모델 코드만 수정했을 때는 앱 재배포가 필요하다. 원본/보정 JSON과 모델 생성 코드는 역할이 다르며 후자는 Git에 유지한다.
