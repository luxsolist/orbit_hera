# 완성 지도 청크

도로·보도 메시, 보정된 지형/도로 높이, 건물·구조물, 하천·담장·시설 및 랜드마크 적용 결과를 기존 지도 청크 JSON에 저장한다. 게임과 도시 뷰어는 mapBuild.version=1 청크에 보정을 다시 적용하지 않고, 별도 detail/road-grade/appearance 파일을 요청하지 않는다.

## 파일 구성

- 기존 public/maps/<위도>/<경도>/<블록>/<청크>.json: 최종 WorldChunk와 mapBuild.input.
- mapBuild.input: 보정 전 원본과 편집용 입력. 재빌드에서만 사용하며 생성된 streetPlan은 중복 저장하지 않는다.
- compiledStreet: 렌더링/충돌용 메시와 시설 배치. 이미 terrain/objects로 반영한 배열은 중복 저장하지 않는다.
- 타일 목록·압축 색인·도시 설정은 공통 관리 파일로 유지한다. 청크별 보정 결과 파일은 남기지 않는다.

## 명령

~~~bash
node scripts/complete-map-chunks.mjs seoul
node scripts/validate-complete-chunks.mjs seoul
node scripts/build-map-bundles.mjs seoul
node scripts/map-command.mjs publish seoul
~~~

첫 명령은 현재 검증된 입력과 설계 결과로 완성 청크를 다시 생성한다. 기존 보정 경로의 최종 결과와 모든 필드를 전수 비교한 뒤 저장하고, 포함된 청크의 별도 보정 파일을 제거한다. 두 번째는 청크 구조·지형·메시 유효성 및 추가 보정 파일 부재 검사다. 압축은 완성 청크 4개를 묶고, 마지막 명령은 압축 검증·Releases 업로드·재다운로드 검증 후 버전 포인터를 갱신한다.

전체 설계를 다시 계산하려면 기존 build:city-surfaces 또는 build:street-regions를 사용한다. 시작할 때 mapBuild.input을 복원하여 원본으로 설계하고, 종료 때 다시 통합한다. 중간 보정 파일은 빌드 작업 중에만 존재하며 완료 산출물에는 남지 않는다. 기존 압축 묶음은 새 묶음 생성이 모두 끝날 때까지 유지한다. 부분 설계 변경 시 다른 청크의 완성 메시도 보존한다.

독립적인 구형 보정 생성기만 실행한 뒤 배포하지 않는다. 공통 빌드/완성/검증 단계까지 실행해야 한다. 원본 OSM/PBF는 재수집·설계 입력이며 실행 청크와 별개다.

## 배포와 Git

Releases는 완성 청크 안의 재빌드 입력까지 백업한다. 별도 보정 파일 없이 빈 작업 폴더에서도 원본 입력을 복구할 수 있다. 게임용 2×2 묶음, 색인, 릴리스 포인터와 코드는 Git에 유지하며 완성 JSON 청크는 기존 도시별 ignore 규칙을 따른다. 아직 전환하지 않은 도시의 별도 파일은 그대로 유지한다.

## 서울 적용 검증 (2026-09-28)

1,600청크를 기존 최종 지형·객체·메시와 전수 동등성 비교 후 저장했다. 별도 road-grade/detail/appearance 파일 0개. 2×2 묶음 400개, 직렬화 합계 3,225,249,832바이트 → 압축 1,140,705,428바이트. 원본 입력 보존 때문에 파일 통합 자체가 큰 용량 절감을 의미하지는 않는다.

일반 회귀검사 144파일 1,855개, 묶음 전수검사 4개 도시, 랜드마크·메모리 검사 5개, 타입 검사 통과. 원본 복원 후 재완성 왕복 일치, 별도 파일 요청 없는 단독 청크 로딩, 중복 보정 방지를 검사했다.

게시 후에는 현재 압축 색인에 없는 이전 묶음을 public 폴더에서 build/map-bundle-cache로 이동한다. 파일을 보존하면서 실행/배포 폴더에는 현재 묶음만 남긴다. 현재 릴리스 포인터·색인·묶음 해시가 일치하지 않으면 이 정리를 실행하지 않는다. 공통 publish 명령의 마지막 단계이며, 단독 실행은 node scripts/prune-map-bundles.mjs seoul이다.


게시 완료: [maps-seoul-47e52f42c5a0de1b](https://github.com/luxsolist/orbit_hera/releases/tag/maps-seoul-47e52f42c5a0de1b). 원본 백업은 청크 1,600개와 타일 목록 1개, 총 1,601파일 / 1,143,941,418바이트다. GitHub 재다운로드 후 압축 SHA-256, 파일 목록, 개별 파일 해시와 압축 색인 일치를 확인했다. public에는 현재 묶음 400개만 남겼고 이전 묶음 3,872개는 build/map-bundle-cache/seoul로 이동했다.
