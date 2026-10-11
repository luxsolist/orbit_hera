# GitHub Releases 지도 관리

등록 도시: 서울(37/126), 로마(41/12), 아테네(37/23). 목록은 `config/map-cities.json`이 정본이다.

세 도시 모두 [완성 지도 청크](completed-map-chunks.md) 형식이다. 청크 하나에 지형·도로·상세·외벽 적용 결과(컴파일된 가로 포함)와 재빌드 입력(`mapBuild.input`)이 함께 들어 있다. 런타임은 완성 청크만 읽고, 보정 계산은 빌드(`MapCorrections.ts`, `complete-map-chunks.mjs`)에서만 한다.

- 원본(편집용 청크 `public/maps/<셀>/<block>/<cx>_<cz>.json`)은 GitHub Releases에 보관하고 Git 추적에서 제외한다. 로컬 파일은 유지한다.
- 게임용 2×2 압축 묶음(`public/maps/bundles/<도시>/*.bin`)과 인덱스(`src/world/<도시>-bundles.json`), 릴리스 포인터(`config/map-releases/<도시>.json`), `tiles.json`은 Git에 둔다.
- 상세/도로/외벽 보정 파일(`public/maps/details/<도시>/` 등)은 빌드 중 `restoreMapBuildInputs`가 완성 청크의 `mapBuild.input`에서 다시 꺼내 쓰는 임시 위치다.

## 공통 명령

| 명령 | 역할 |
|---|---|
| `npm run build:map-bundles -- <도시 또는 all>` | 원본에서 묶음 생성 |
| `npm run maps:prepare:city -- <도시 또는 all>` | 원본 검증 및 로컬 백업 생성(게시 안 함) |
| `npm run maps:publish:city -- <도시 또는 all>` | 재생성 후 게시·재다운로드 검증, 포인터 갱신 |
| `npm run maps:restore:city -- <도시 또는 all>` | 누락된 원본만 복원(기존 파일은 덮어쓰지 않음) |
| `npm run maps:verify -- <도시 또는 all>` | 게시 포인터·묶음 해시·전체 청크 포함 여부 검증 |

`all`은 등록 도시를 순차 처리한다. 실패 시 중단하며 앞서 완료한 도시를 롤백하지 않는다. 같은 데이터로 재실행하면 이미 게시한 릴리스를 검증해 재사용하고, 다른 데이터는 새 릴리스로 만든다(기존 릴리스는 덮어쓰지 않음). 게시에는 gh 로그인과 저장소 쓰기 권한이 필요하다. 기본 `npm test`는 등록 도시의 누락 원본을 자동 복원한다(Python 3 필요).

## 지도 수정 후

1. `npm run build:map -- <맵 id>` 또는 `npm run build:city-surfaces -- <도시>`로 완성 청크를 다시 만든다.
2. `npm run maps:publish:city -- <도시>`: 2×2 묶음 재생성, 원본과 묶음의 완전 일치 검증, 원본 압축, Releases 업로드, 재다운로드 검증, 포인터 갱신.
3. 관련 테스트와 `npm run maps:verify` 실행.
4. 코드·압축 묶음·인덱스·릴리스 포인터를 함께 커밋한다. 묶음을 다시 만든 뒤 게시하지 않으면 포인터의 `bundleIndexSha256`이 어긋나 `npm run build`(prebuild 검증)가 실패한다.

묶음 생성기는 새 해시 파일을 쓰고, 현재 인덱스가 참조하지 않는 오래된 `.bin`은 게시 시 정리된다.

## 배포

`npm run build`는 원본 재생성 대신 게임용 묶음과 릴리스 포인터 일치를 검사한다. 원본 없이 빌드할 수 있고, 플레이 중에는 같은 서버 경로의 압축 묶음만 받는다.

## 신규 도시 등록

1. `config/street-regions.json`에 도시 전역 가로 구역(`city-wide`, `enabled:true`)을 등록한다. 등록된 도시만 `scripts/maps.config.mjs`의 맵 목록에 오른다.
2. `config/map-cities.json`에 도시 ID와 원본 셀을 등록한다(예: `"rome": [41, 12]`). 같은 셀의 중복 등록은 실패한다.
3. `src/world/cities/detail.ts`에 도시 상세 프로필을 추가하고 `cities/index.ts`에 연결한다.
4. `npm run build:map -- <맵 id>`로 완성 청크를 빌드한 뒤 위의 묶음·게시 절차를 따른다.
5. 원본 복원을 별도 폴더에서 검증한 다음 해당 셀 원본만 Git 추적에서 제외하고 `.gitignore`에 추가한다.
