# GitHub Releases 지도 관리

서울과 부산에 적용한다. 원본은 GitHub Releases, 게임용 2×2 압축 묶음은 Git에 보관한다. 각 도시 일반 청크 1,600개는 Git 추적에서 제외하고 로컬 파일은 유지한다. 수작업·교정 내역을 검토할 수 있도록 랜드마크 상세, 외벽, 도로 보정 및 도시 목록은 Git에도 남기고 원본 백업과 게임용 묶음에 함께 포함한다.

| 도시 | 원본 셀 | 묶음 | 게임용 압축 용량 | 원본 백업 |
|---|---|---:|---:|---:|
| 서울 | 37/126 | 400 | 16.34MB | 3,596파일 / 16.19MB |
| 부산 | 35/129 | 420 | 4.76MB | 2,396파일 / 4.75MB |

부산 격자의 시작·끝이 2×2 경계와 맞지 않아 부분 묶음이 생긴다. 1,600개 청크는 빠짐없이 한 번씩 포함된다. 부산의 직렬화된 묶음 데이터는 16.53MB → 4.76MB로 약 71.2% 감소했다.

### 부산 작업 명령

```bash
npm run maps:restore:busan
npm run build:busan-bundles
npm test -- tests/mapBundles.test.ts tests/busanDetails.test.ts
npm run maps:publish:busan
npm run maps:verify
```

이하 접미사가 없는 복원·게시 명령은 서울용이다. `maps:verify`와 빌드 전 검증은 두 도시 모두 검사하며 기본 `npm test`는 두 도시의 누락 원본을 자동 복원한다. Python 도구를 직접 사용할 때는 `--city busan`을 붙인다.

부산 경로는 `public/maps/35/129/`, `public/maps/details/busan/`, `public/maps/road-grade/35/129/`, `public/maps/bundles/busan/`, `src/world/busan-bundles.json`, `config/map-releases/busan.json`이다. 원본 압축은 `busan-source.tar.gz`이다. 교량·진입로·해안 지형도 detail 데이터에 포함되며, 런타임은 기존처럼 부산 상세 보정 후 도로 고도 보정을 적용한다. 모델 생성 코드는 앱 코드로 공유한다.

도시 목록은 `config/map-cities.json`, 공통 생성기는 `scripts/build-map-bundles.mjs`, 공통 검증기는 `scripts/verify-map-bundles.mjs`에서 관리한다. 런타임도 `MapBundles.ts`의 공통 캐시·로더를 사용한다.


## 처음 내려받은 개발 환경
`npm run maps:restore`로 원본을 복원한다. 공개 Releases는 로그인 없이 다운로드하고 SHA-256/전체 파일 목록/각 파일 해시를 확인한다. 비공개 접근은 로그인한 gh로 복구한다. 기존 로컬 파일은 덮어쓰지 않는다. 기본 `npm test`는 필요한 원본이 없으면 자동 복원한다. 개별 테스트 명령을 직접 실행하기 전에는 복원을 먼저 한다. Python 3가 필요하다.

## 지도 수정 후
1. 로컬 원본·보정 데이터 수정.
2. `npm run maps:publish`: 서울 2×2 묶음 재생성, 원본과 묶음의 완전 일치 검증, 원본 압축, 새 Releases 업로드, 재다운로드 검증, `config/map-releases/seoul.json` 갱신.
3. 관련 테스트와 `npm run maps:verify` 실행.
4. 코드·압축 묶음·릴리스 포인터를 함께 커밋/푸시.

릴리스 이름은 원본 파일 해시 목록과 묶음 인덱스에서 계산한다. 같은 데이터로 재실행하면 이미 게시한 릴리스를 검증해 재사용한다. 다른 데이터는 새 릴리스로 만들고 기존 릴리스는 덮어쓰지 않는다. 게시에는 gh 로그인 및 저장소 쓰기 권한이 필요하다. 릴리스 태그의 코드 커밋은 게시 당시 HEAD이며 데이터의 정확한 버전은 동봉 manifest/index와 SHA-256이 기준이다.

## 배포
`npm run build`는 원본 재생성 대신 게임용 묶음과 Releases 포인터 일치를 검사한다. 따라서 서울·부산 원본 없이 빌드할 수 있다. 생성 압축 파일은 같은 서버 경로에서 서빙하므로 플레이 중 GitHub Releases에 직접 접속하지 않는다. 원본이 없는 환경에서 지도 묶음이 실패하면 재시도하고 오류를 보고한다.

현재 변경은 Git의 최신 트리에서 원본을 제외한다. 과거 커밋에 남은 지도 용량은 줄이지 않으며, 이력 재작성은 수행하지 않는다. 서울·부산 외 도시는 기존 방식을 유지한다.


## 담당자가 바뀌어도 확인할 기준 파일

| 대상 | 기준 경로 | 관리 방법 |
|---|---|---|
| 편집용 서울 청크 | `public/maps/37/126/<block>/<cx>_<cz>.json` | 로컬 유지, Git 제외, Releases에서 복원 |
| 도시 청크 목록 | `public/maps/37/126/tiles.json` | Git 유지 |
| 랜드마크 상세/외벽/도로 보정 | `public/maps/details/seoul/`, `public/maps/landmark-appearance/seoul/`, `public/maps/road-grade/37/126/` | Git 유지, 원본 백업과 게임용 묶음에도 포함 |
| 게임용 압축 파일 | `public/maps/bundles/seoul/*.bin` | Git 유지 |
| 묶음별 파일명/해시/포함 청크 | `src/world/seoul-bundles.json` | 재생성 결과, 직접 수정하지 않음 |
| 게시 완료한 원본 버전 | `config/map-releases/seoul.json` | 게시·재다운로드 검증 성공 후 갱신 |
| 릴리스 생성 중간 결과 | `build/map-releases/<tag>/` | Git 제외, 로컬 산출물 |
| 공통 랜드마크 모델 생성 코드 | `src/world/cities/` 등 | 앱 코드로 공유, 지도 압축에 중복 포함하지 않음 |

현재 파일명이나 릴리스 태그를 추측하지 말고 포인터 JSON에서 확인한다. `bundleIndexSha256`이 게임용 묶음 인덱스와 원본 백업을 연결한다. 릴리스에는 `seoul-source.tar.gz`와 `release.json`이 첨부된다. 원본 압축 안에는 파일별 해시 목록인 `MANIFEST.json`과 당시 `bundle-index.json`이 들어 있다.

## 단계별 실제 작업 명령

프로젝트 루트에서 실행한다. Python 3.9 이상(`python3`), Node/npm이 필요하다. 게시 시에는 `gh auth login`으로 로그인한 GitHub CLI가 필요하다. 현재 환경은 WSL에서 실행한다.

```bash
# 1. 처음 작업하거나 편집용 원본이 없는 경우
npm run maps:restore

# 2. 원본/보정 데이터를 수정한 후 로컬 묶음 생성
npm run build:seoul-bundles

# 3. 원본과 묶음 동등성 및 로더 검사
npm test -- tests/mapBundles.test.ts tests/mapLocator.test.ts tests/chunkPreparation.test.ts tests/cityTileLookup.test.ts
npm run typecheck

# 4. 결과를 확정해 GitHub Releases에 게시
npm run maps:publish

# 5. 게시 버전 검증 및 배포 산출물 생성
npm run maps:verify
npm run build
```

검증 후 `git status`로 관련 변경을 확인하고 같은 커밋으로 묶어 푸시한다. 릴리스 업로드만으로 저장소 변경이나 웹게임 배포가 완료되지는 않는다. 초기 도입 때 준비한 원본 추적 제외도 커밋·푸시해야 원격 저장소의 최신 트리에 반영된다. 과거 이력은 그대로 남는다.

`python3 scripts/map-release.py prepare`는 원본 검증과 백업 생성까지만 수행한다. `maps:publish`는 다시 묶음을 생성한 후 실제 게시한다. `maps:verify` 및 `npm run build`는 게시된 인덱스와 압축 파일의 일치를 검사하지만, 그 이후 로컬에서 바꾼 원본까지 자동 재생성하거나 검증하지 않는다. 원본 수정 후에는 반드시 2~4단계를 거친다.

## 실패하거나 이전 작업을 이어받았을 때

| 상황 | 처리 |
|---|---|
| 원본 파일 없음 | `maps:restore` 실행. 기본 `npm test`만 자동 복원하며 다른 테스트 명령은 수동 복원 필요 |
| 기존 원본이 이전 버전이거나 로컬 수정이 있음 | 복원은 기존 파일을 덮어쓰지 않는다. 먼저 별도 작업 폴더에 보관하거나 새로운 체크아웃에서 복원해 비교한다. 복원만으로 최신 원본으로 교체됐다고 판단하지 않는다 |
| `Rebuild bundles` 오류 | 원본과 묶음이 다르다. `build:seoul-bundles`와 관련 테스트 후 게시 |
| `Publish the updated source snapshot` 오류 | 묶음 인덱스와 게시 포인터가 다르다. 의도한 수정이면 `maps:publish`; 임의로 포인터 해시를 고치지 않는다 |
| 게시 도중 네트워크 실패 | `maps:publish` 재실행. 기존 동일 태그는 다운로드 검증 후 재사용한다 |
| 기존 릴리스에 필수 첨부 파일이 없음 | 현재 도구는 기존 릴리스 자산을 자동 보충하지 않는다. 로컬 산출물과 해시를 대조한 뒤 누락 자산만 복구하고 게시 명령을 재실행한다. 다른 내용으로 기존 자산을 교체하지 않는다 |
| 게시 후 코드 커밋/푸시 전 중단 | 포인터·묶음·코드 변경을 확인하고 `maps:verify` 및 관련 테스트 후 함께 커밋/푸시 |
| 해시 불일치 | 손상 또는 다른 버전이다. 검증을 우회하지 말고 정확한 릴리스/인덱스를 확인한다 |
| 이전 버전으로 돌아가야 함 | 그 버전의 코드·묶음 인덱스·압축 파일·릴리스 포인터를 함께 복원한다. 포인터만 바꾸지 않는다. 작업 원본은 별도 깨끗한 폴더에서 복원해 비교한다 |

## 현재 완료 범위와 다음 작업

- 서울: 1,600청크 → 400묶음. 최초 묶음 용량 약 16.34MB.
- 최초 원본 백업: 3,596파일, 약 16.19MB. [게시한 릴리스](https://github.com/luxsolist/orbit_hera/releases/tag/maps-seoul-7705d8c4342812ba). 이후 최신 버전은 포인터 JSON을 따른다.
- 게시한 파일을 재다운로드해 해시·파일 목록을 검증했고, 빈 폴더에 원본 1,600개를 복원하면서 기존 파일을 보존하는 동작도 확인했다.
- 도입 시 관련 테스트 22개 및 타입 검사 통과. 빠른 이동 중 FPS/로딩 지연 개선폭은 아직 비교 측정하지 않았다.
- 다음 우선순위: 변경 사항 커밋 상태 확인 → 깨끗한 체크아웃에서 복원/빌드 확인 → 서울 빠른 이동 비교 측정 → 다른 도시 확대.
- **미구현:** 변경 전 원본 자동 백업, 기존 파일 강제 덮어쓰기 복원, 과거 압축 묶음/릴리스 자동 정리, Git 이력 축소, 자동 커밋·푸시·배포.
- 묶음 생성기는 새 해시 파일을 쓰지만 오래된 `.bin`을 자동 삭제하지 않는다. 정리 시 현재 인덱스뿐 아니라 구버전 배포가 참조하는 파일까지 확인해야 한다.

다른 도시로 확대할 때는 수집 파일 목록, 도시별 묶음 인덱스, 릴리스 포인터, 로더 적용 범위, Git 제외 경로를 함께 일반화한다. 서울 경로를 단순 복사하거나 다른 도시 원본을 먼저 추적 해제하지 않는다.

## 부산 적용 검증

- [부산 최초 원본 릴리스](https://github.com/luxsolist/orbit_hera/releases/tag/maps-busan-9d5da5ae64ccb0de). 최신 버전은 부산 포인터 JSON을 따른다.
- 게시 파일 재다운로드 및 전체 해시 검증 완료. 별도 빈 폴더에 1,600개 청크를 복원하고 기존 파일 보존을 확인했다.
- 서울·부산 원본/보정 데이터 동등성, 부산 음수 좌표·부분 묶음, 교량/해안 보정 순서 등 관련 테스트 29개와 타입 검사 통과.
- 원본 파일은 로컬에 남겨두고 Git 추적만 제외했다. 변경 사항 커밋/푸시는 별도 수행한다.
