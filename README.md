# CORE 🔴

3D 무인 원격 제어 **3인칭 슈터** / 핵앤슬래시 게임 — **순수 웹(Three.js) 기반 v3.0**.

플레이어는 '링크 조종사'로서 무인 병기에 접속해, 에너지 **주파수 빔**으로 외계 침공체
**플라즈모이드**를 쪼그라뜨리고 소멸(Dissolve)시킨다.

> - 게임 디자인 비전: [docs/spec/overview.md](docs/spec/overview.md)
> - 현행 명세(데이터/조작/규칙): [docs/spec/](docs/spec/01-data-schemas.md)
> - 구현 세부(코드 구조): [docs/implements/](docs/implements/README.md)

## 현재 구현

- **데이터 구동 콘텐츠** — 드론·무기·적·미션·전장을 런타임 **JSON**으로 정의. 코드 수정 없이 파일 추가만으로 확장.
- **전장 선택 메뉴** — 실측 대륙 윤곽 **세계지도**에서 침공 지점 클릭 → 드론 선택 → 즉시 출격.
- **실지형 스트리밍 전장 52종** — 실측 DEM + OpenStreetMap(ODbL) 기반, 도시마다 반경 20km 청크
  스트리밍(서울·부산·런던·파리·로마·뉴욕·카이로·델리…). [도시 100선](docs/spec/09-city-catalog.md)
  중 52개 완료. 신규 도시는 파이프라인(`npm run build:map`) 한 번으로 추가.
- **3인칭 드론 2종** — 보행(점프·회피 대시) / 비행(시선결합 비행·호버·뱅킹 롤). 데이터로 분기하고,
  **실제 렌즈 좌표에서 발사**한다(동체→렌즈 차폐 검사로 벽 너머 사격 차단). 스킨 4종
  (기본형·옵시디언·폴라리스·듄 센티널 — 두 기체 공용 카탈로그, 선택은 기체별 저장). 외형만 바꾸고
  충돌 반경·속도·피해는 동일하다.
- **무기 4종** — 중주파/경주파 **주파수 빔**(전방 자동사격 — 워커 60°·플라이어 45° 반각, 사거리
  1km + 에임 어시스트 수동 2km) + 특수 2종(다중 빔 살포 / 오버드라이브 스트림 — **무력화로 교체
  예정**, [spec/13](docs/spec/13-neutralize.md)). 수동 사격에는 위상 이탈 개체를 실체화시키는
  **관측 펄스**와 재이탈을 봉쇄하는 **관측 계류**가 붙는다.
- **적(플라즈모이드) 3직무 + 보스** — **거머리/LEECH**(지상 러셔 — 접촉 흡수) · **모기/SKEETER**(공중
  카이터 — 원거리 드레인·수직 회피) · **소인체/BRANDER**(중거리 유영 — **낙인 유도탄**: 낙인 자체는
  무피해, 주기적 **심판 파문**이 지나갈 때만 피해 → "회피·근원 격파·파문 통과"의 전투 박자) +
  **다중 투영 보스**(HP 를 공유하는 구체 여러 기 — 어느 쪽을 때려도 같은 체력). 정예·보스는 **전용
  공격 키트**(예고 돌진·원거리 사격·차원이동 / 예고 3초 광역 폭발 — 안전 방향 90°)를 갖는다.
  멀티타깃 어그로 + 전장이 선언하는 구성(`SpawnMix`) + 디졸브 소멸. 적의 공격은 **건물에 막히면
  성립하지 않는다**(플라즈모이드의 건물 통과 이동 자체는 유지).
- **미션 체계 20종** — 승리/실패/투입을 분리한 v2 스키마: 격멸·군집 소탕(horde)·고정 조합전(roster)·
  보스전(분출/회복 링크/소유 파문)·방어(랜드마크 직행 어그로)·페이즈전(밀물 웨이브)·구역 축소·
  복합 제약(격멸+건물 한도) 등. 적은 **강도 피라미드**로 균열에서 점진 증원(잡몹→정예→보스 순).
- **손맛/피드백** — 히트스톱 · 발사 반동 킥 · 피격 셰이크 + **피해 방향 인디케이터** · 파문 통과
  화면 펄스/저음 · 결과 화면 **공명 점수** 채점(어떻게 싸웠는가).
- **안전 스폰/리스폰** — 위험·파문·지지면·옥상 여유를 검사한 후보로 부활하고 3초 피해 보호(직접
  사격 시 즉시 해제). 사망 대기 중 이동·발사는 차단된다.
- **연출** — 절차적 로우폴리 + 라이팅/그림자 + **Bloom** + 디졸브 셰이더 + 절차적 사운드(Web Audio) +
  인트로 절차적 **배경음악**(장면별 무드 모핑 + 리버브, 외부 음원 0).
- **모바일** — 가로 모드 가상 조이스틱 + 드론/무기별 버튼 클러스터(시야 민감도 데스크탑 수준).
- **성능** — 타일 준비를 Worker 로 분리(데이터 파싱·건물/지형 생성·도로·충돌 형상)하고 메인
  스레드는 프레임 예산 안에서 조립만 한다. 가시 2.6km / 선준비 3.6km 를 구분하고 충돌은 청크별
  증분 갱신. `?diag`·도시 뷰어에 공통 성능 패널(FPS/p95·제출 삼각형·타일 상태).
- **개발 도구** — `/tools/asset-editor.html` 에셋 스튜디오(드론·플라즈모이드·인트로·도시 탐방·
  미션 편집). 도시 뷰어는 게임과 같은 스트리밍·보정 경로를 쓴다.
- **품질** — Vitest 단위 **1,788개**(116파일) + Playwright e2e 스모크(전 맵) + 헤드리스 플레이테스트
  하네스, 빌드 시 소스맵 hidden + 난독화.

## 조작

| 입력 | 보행 드론 | 비행 드론 |
| :--- | :--- | :--- |
| `W A S D` | 이동 | 시선결합 이동 |
| `MOUSE` | 조준 | 조준(비행 방향 결합) |
| `좌클릭` | 주파수 빔 | 주파수 빔 |
| `우클릭` | 다중 빔 살포(특수) | 오버드라이브(특수) |
| `SPACE` | 점프 | 상승 |
| `SHIFT` | 대시 | 하강 |
| `R` | 링크 리와인드(자기 위치·HP + 주변 파괴 건물을 4초 전으로) | 동일 |
| `ESC` | 일시정지(링크 해제) | 일시정지 |

조작 안내는 드론 데이터(`actions`)에서 동적으로 생성된다. 모바일은 좌측 조이스틱 + 우하단 버튼
(포인터 잠금을 막는 내장 브라우저는 `/?controls=touch` 로 터치 조작 선택).

## 실행

> **요구사항:** [Node.js](https://nodejs.org/) 18+
> 지도 원본 복원·테스트에는 **Python 3.9+**(`python3` 명령), Releases 게시에는 **GitHub CLI**(`gh`) 로그인과 저장소 쓰기 권한이 필요합니다.

```bash
npm install      # 의존성 설치
npm run dev      # 개발 서버 (HMR) — 브라우저 자동 오픈
npm run build    # 타입체크 + 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
npm test         # 단위 테스트 전체 (Vitest)
npm run test:fast     # 일반 개발용(긴 시뮬레이션·지도 검증 제외)
npm run test:extended # 긴 전투 시뮬레이션·월드 검증·서울 전수·메모리 예산
npm run test:e2e # 빌드 + Playwright 스모크(카탈로그 전 맵)
```

전장 데이터 파이프라인(별도 — OSM 추출본 필요, [spec/03-maps](docs/spec/03-maps.md)):

```bash
npm run build:map -- <id>   # DEM → OSM 가공 → 청크 → 검증 게이트
npm run gen:cities          # 도시 100선 config 생성
npm run validate:world      # 산출 타일 불변식 전수 검사
npm run audit:landmarks     # 랜드마크 큐레이션 감사
```

## 지도 원본·압축 묶음·Releases 관리

도시 등록 기준은 `config/map-cities.json`입니다. 도시별 코드 복사 없이 공통 명령으로 처리합니다.

```bash
npm run build:map-bundles -- busan   # 지정 도시 묶음 생성
npm run maps:restore:city -- all     # 등록된 모든 도시의 누락 원본 복원
npm run maps:publish:city -- busan   # 지정 도시 생성·검증·실제 게시
npm run maps:verify -- all          # 등록된 모든 도시 검사
```

`all`은 등록된 도시만 뜻하며 현재는 서울·부산·로마입니다. 기존 도시별 명령도 호환됩니다.
신규 도시는 [등록·전환 절차](docs/map-releases.md#신규-도시-등록과-공통-명령)를 따릅니다.


**서울·부산·로마 적용:** 일반 지도 청크는 로컬에서 편집하고 GitHub Releases에 백업합니다.
Git에는 게임용 **2×2 압축 묶음(서울 400개, 부산 420개, 로마 441개)**, 묶음 인덱스, 릴리스 포인터와 랜드마크/도로 보정 데이터를 보관합니다.
게임·도시 뷰어는 같은 서버의 압축 묶음을 읽으며, 플레이 중 Releases에 직접 접속하지 않습니다.
그 외 도시는 기존 개별 파일 방식을 사용합니다. 부산은 격자 경계의 부분 묶음 때문에 420개입니다.

```bash
npm run maps:restore:busan   # 부산 원본 복원
npm run maps:restore         # 처음 받았거나 원본이 없을 때 복원; 기존 로컬 파일은 보존
# 원본 지도 또는 랜드마크/도로 보정 데이터 수정
npm run build:seoul-bundles  # 로컬 확인용 묶음 재생성; GitHub 업로드 없음
npm test -- tests/mapBundles.test.ts tests/mapLocator.test.ts tests/chunkPreparation.test.ts tests/cityTileLookup.test.ts
npm run maps:publish        # 확정한 지도: 재생성 → 원본 검증 → Releases 게시·재다운로드 검증
npm run maps:publish:busan  # 부산 재생성·검증·Releases 게시
npm run maps:verify         # 게임용 묶음과 게시한 원본 버전의 연결 확인
npm run build              # 버전 검증 후 배포 빌드
# 관련 코드·압축 묶음·인덱스·릴리스 포인터를 함께 커밋/푸시
```

`maps:publish`는 **실제로 GitHub에 릴리스를 게시**하지만 커밋·푸시·게임 배포는 하지 않습니다.
`npm test`는 필요한 원본을 자동 복원합니다. `test:fast`, `test:extended`, 직접 Vitest 실행은 자동 복원하지 않으므로 먼저 서울 `maps:restore`, 부산 `maps:restore:busan`을 실행하세요.
원본을 수정한 뒤 `npm run build`만 실행해도 묶음이 갱신되는 것은 아닙니다.

- [운영 절차·복원·장애 대응·후속 작업](docs/map-releases.md)
- [서울 압축 형식·캐시·스트리밍 구조](docs/seoul-map-bundles.md)
- [로마 원본 백업 버전](config/map-releases/rome.json)
- [부산 원본 백업 버전](config/map-releases/busan.json)
- [서울 원본 백업 버전](config/map-releases/seoul.json) — 태그·다운로드 해시의 기준

## 기술 스택

- **렌더링:** Three.js (WebGL2) + 커스텀 GLSL(디졸브 셰이더)
- **포스트 프로세싱:** EffectComposer + UnrealBloomPass
- **오디오:** Web Audio 절차적 합성(에셋 없음)
- **빌드:** Vite + TypeScript(strict). 배포 빌드는 sourcemap `hidden` + 식별자/문자열 난독화.

## 구조

```
src/
  main.ts                       진입점 — Game 부트스트랩
  core/                         Game(루프/상태/히트스톱/구역축소) · Input · MobileControls · Sfx · loader
  game/                         mission(v1 계약) · missionV2(3축 스키마·평가) · GameInstance(페이즈 드라이버) · missions
  player/                       DroneSpec · PlayerController(물리 기준 좌표) · DronePresentation(3인칭 기체·실제 렌즈) · ThirdPersonCamera · SpawnPlanner(안전 스폰)
  weapons/                      FrequencyBeam · SpecialBarrage · SpecialStream · targeting · WeaponSpec · beamFx
  enemies/                      CoreEnemy(3D 추적·직무·공유 체력) · EnemyManager(투입기 4종/어그로) · EliteBossCombat(정예·보스 전용 공격) · BrandSystem(낙인·심판 파문) · EnemyPlasmoidRenderer · EnemyVisibility · PlasmoidSpec
  world/                        World · StreamingWorld(청크) · ChunkPreparation/chunk.worker(타일 선준비) · ChunkCollisionWorld · BuildingCombat · entanglement(얽힘 택소노미) · precinct
  ui/                           MenuScreen(세계지도) · HUD(낙인/파문 경고·피해 방향) · Minimap · RearView
  fx/                           dissolve · postprocessing(Bloom) · damageNumbers · DrainBeams · EnergyWall
  intro/                        CinematicPlayer · scenes · CinematicAudio(절차적 배경음악) · MenuBackground
  editor/                       에셋 스튜디오(도시 탐방·미션 편집 — /tools/asset-editor.html)
public/{drones,weapons,maps,enemies,missions,models}/  런타임 데이터(JSON)
scripts/                        전장 빌드 파이프라인(OSM·DEM·청크·검증·도로 보정)
tools/                          단독 뷰어(에셋 에디터·프리뷰·인트로 플레이어)
docs/{spec,implements}/         명세 · 구현 문서(+ docs/private: 비공개 서사 정본)
```

전체 소스 트리와 시스템별 설명: [docs/implements/README.md](docs/implements/README.md).

## 로드맵

**무력화 체계**([spec/13](docs/spec/13-neutralize.md) — 드론 특수무기를 연속발사에서 무력화로 교체,
보스 특수 능력을 무력화 공격 패턴으로. 미구현) → 계시 콘텐츠(동시 타격 실험 미션 → 다중 투영 보상
보스) → 1막 클라이맥스 보스전·부유 요새 → Link Swap(전장 중 기체 전환)·드론 종류 확장 →
전 세계 도시 확대(도시 100선 잔여 48개 · 얽힘 택소노미 기반 미션 자동 생성) → RTS 빌드업 → 온라인 협동.
정본 순서는 [docs/spec/06-missions.md](docs/spec/06-missions.md) §5. 향후 Flutter WebView는 선택적 배포 채널로만.

### 랜드마크 제작 기준

- [도시 공통 제작·검증 절차](docs/landmark-rendering-workflow.md)
- [로마 적용 범위·출처·정확도](docs/rome-landmark-details.md)
- `npm run audit:landmark-details -- <도시>`: 원본 결합·높이·표면·지형 입력 검사
