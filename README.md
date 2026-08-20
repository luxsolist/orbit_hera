# CORE 🔴

3D 무인 원격 제어 FPS / 핵앤슬래시 게임 — **순수 웹(Three.js) 기반 v3.0**.

플레이어는 '링크 조종사'로서 무인 병기에 접속해, 에너지 **주파수 빔**으로 외계 침공체
**플라즈모이드**를 쪼그라뜨리고 소멸(Dissolve)시킨다.

> - 게임 디자인 비전: [docs/spec/overview.md](docs/spec/overview.md)
> - 현행 명세(데이터/조작/규칙): [docs/spec/](docs/spec/01-data-schemas.md)
> - 구현 세부(코드 구조): [docs/implements/](docs/implements/README.md)

## 현재 구현

- **데이터 구동 콘텐츠** — 드론·무기·적·미션·전장을 런타임 **JSON**으로 정의. 코드 수정 없이 파일 추가만으로 확장.
- **전장 선택 메뉴** — 실측 대륙 윤곽 **세계지도**에서 침공 지점 클릭 → 드론 선택 → 즉시 출격.
- **실지형 스트리밍 전장 3종** — 실측 DEM + OpenStreetMap(ODbL) 기반 **서울·에베레스트·부산**
  (반경 20km 청크 스트리밍). 신규 도시는 파이프라인(`npm run build:map`) 한 번으로 추가.
- **드론 2종** — 보행(점프·회피 대시) / 비행(시선결합 비행·호버·뱅킹 롤). 데이터로 분기.
- **무기 4종** — 중주파/경주파 **주파수 빔**(360° 자동발사 + 에임 어시스트 수동) + 특수 2종(다중 빔
  살포 / 오버드라이브 스트림). 같은 대상을 지속 조사하면 감속→동결시키는 **관측 고정** 문법 포함.
- **적(플라즈모이드) 3직무 + 보스** — **거머리/LEECH**(지상 러셔 — 접촉 흡수) · **모기/SKEETER**(공중
  카이터 — 원거리 드레인·수직 회피) · **소인체/BRANDER**(중거리 유영 — **낙인 유도탄**: 낙인 자체는
  무피해, 주기적 **심판 파문**이 지나갈 때만 피해 → "회피·근원 격파·파문 통과"의 전투 박자) +
  **다중 투영 보스**(HP 를 공유하는 구체 여러 기 — 어느 쪽을 때려도 같은 체력). 멀티타깃 어그로 +
  구성 비례 자기정렬 + 디졸브 소멸.
- **미션 체계 18종** — 승리/실패/투입을 분리한 v2 스키마: 격멸·군집 소탕(horde)·고정 조합전(roster)·
  보스전(분출/회복 링크/소유 파문)·방어(랜드마크 직행 어그로)·페이즈전(밀물 웨이브)·구역 축소·
  복합 제약(격멸+건물 한도) 등. 적은 **강도 피라미드**로 균열에서 점진 증원(잡몹→정예→보스 순).
- **손맛/피드백** — 히트스톱 · 발사 반동 킥 · 피격 셰이크 + **피해 방향 인디케이터** · 파문 통과
  화면 펄스/저음 · 처치 HP 환수 · 결과 화면 **공명 점수** 채점(어떻게 싸웠는가).
- **연출** — 절차적 로우폴리 + 라이팅/그림자 + **Bloom** + 디졸브 셰이더 + 절차적 사운드(Web Audio) +
  인트로 절차적 **배경음악**(장면별 무드 모핑 + 리버브, 외부 음원 0).
- **모바일** — 가로 모드 가상 조이스틱 + 드론/무기별 버튼 클러스터(시야 민감도 데스크탑 수준).
- **품질** — Vitest 단위 **999개**(54파일) + Playwright e2e 스모크(3맵) + 헤드리스 플레이테스트
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
| `ESC` | 일시정지(링크 해제) | 일시정지 |

조작 안내는 드론 데이터(`actions`)에서 동적으로 생성된다. 모바일은 좌측 조이스틱 + 우하단 버튼.

## 실행

> **요구사항:** [Node.js](https://nodejs.org/) 18+

```bash
npm install      # 의존성 설치
npm run dev      # 개발 서버 (HMR) — 브라우저 자동 오픈
npm run build    # 타입체크 + 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
npm test         # 단위 테스트 (Vitest)
npm run test:e2e # 빌드 + Playwright 스모크(3맵)
```

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
  player/                       DroneSpec · PlayerController(보행/비행·반동/셰이크) · drones
  weapons/                      FrequencyBeam · SpecialBarrage · SpecialStream · targeting · WeaponSpec · beamFx
  enemies/                      CoreEnemy(3D 추적·직무·공유 체력) · EnemyManager(투입기 4종/어그로/보스 행동) · BrandSystem(낙인·심판 파문) · PlasmoidSpec
  world/                        World · StreamingWorld(청크) · BuildingCombat · entanglement(얽힘 택소노미) · precinct
  ui/                           MenuScreen(세계지도) · HUD(낙인/파문 경고·피해 방향) · Minimap · RearView
  fx/                           dissolve · postprocessing(Bloom) · damageNumbers · DrainBeams · EnergyWall
  intro/                        CinematicPlayer · scenes · CinematicAudio(절차적 배경음악) · MenuBackground
public/{drones,weapons,maps,enemies,missions}/  런타임 데이터(JSON)
docs/{spec,implements}/         명세 · 구현 문서(+ docs/private: 비공개 서사 정본)
```

전체 소스 트리와 시스템별 설명: [docs/implements/README.md](docs/implements/README.md).

## 로드맵

전투 체계 재정립 계속(관측 계류·복구 사격·건물 낙인·준위 강등) → 계시 콘텐츠(동시 타격 실험 미션 →
다중 투영 보상 보스) → 봉합전(최종 보스)·부유 요새 → Link Swap(전장 중 기체 전환)·드론 종류 확장 →
전 세계 도시 확대(얽힘 택소노미 기반 미션 자동 생성) → RTS 빌드업 → 온라인 협동.
정본 순서는 [docs/spec/06-missions.md](docs/spec/06-missions.md) §5. 향후 Flutter WebView는 선택적 배포 채널로만.
