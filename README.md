# SEED 🌱

3D 무인 원격 제어 FPS / 핵앤슬래시 게임 — **순수 웹(Three.js) 기반 v3.0**.

플레이어는 '링크 조종사'로서 무인 병기에 접속해, 에너지 **주파수 빔**으로 외계 침공체
**플라즈모이드**를 쪼그라뜨리고 소멸(Dissolve)시킨다.

> - 게임 디자인 비전: [docs/spec/overview.md](docs/spec/overview.md)
> - 현행 명세(데이터/조작/규칙): [docs/spec/](docs/spec/01-data-schemas.md)
> - 구현 세부(코드 구조): [docs/implements/](docs/implements/README.md)

## 현재 구현

- **데이터 구동 콘텐츠** — 드론·무기·전장을 런타임 **JSON**으로 정의. 코드 수정 없이 파일 추가만으로 확장.
- **전장 선택 메뉴** — 실측 대륙 윤곽 **세계지도**에서 침공 지점 클릭 → 드론 선택 → 즉시 출격.
- **실지형 전장 4종** — OpenStreetMap(ODbL) 기반 경복궁·맨해튼·오사카·파리. 건물/도로/수역/랜드마크
  + 경복궁 **특수 권역**(마사토 바닥·전통 건물·궁장)까지 데이터로 일반화.
- **드론 2종** — 보행(점프·회피 대시) / 비행(시선결합 비행·호버·뱅킹 롤). 데이터로 분기.
- **무기 2종** — 주파수 빔(자동발사 + 에임 어시스트 수동) + 다중 빔 살포(특수, 콘 다중 타깃).
- **적(플라즈모이드)** — 공중(0~300m, 지상 편향) 스폰 + 지형 무시 3D 추적 + 디졸브 소멸 + 점증 웨이브.
- **연출** — 절차적 로우폴리 + 라이팅/그림자 + **Bloom** + 디졸브 셰이더 + 절차적 발사음(Web Audio).
- **모바일** — 가로 모드 가상 조이스틱 + 드론/무기별 버튼 클러스터.
- **품질** — Vitest 단위 **115개** + Playwright e2e 스모크(4맵), 빌드 시 소스맵 hidden + 난독화.

## 조작

| 입력 | 보행 드론 | 비행 드론 |
| :--- | :--- | :--- |
| `W A S D` | 이동 | 시선결합 이동 |
| `MOUSE` | 조준 | 조준(비행 방향 결합) |
| `좌클릭` | 주파수 빔 | 주파수 빔 |
| `우클릭` | 다중 빔 살포(특수) | 다중 빔 살포(특수) |
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
npm run test:e2e # 빌드 + Playwright 스모크(4맵)
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
  core/                         Game(루프/상태) · Input · MobileControls · Sfx · loader
  player/                       DroneSpec · PlayerController(보행/비행) · drones
  weapons/                      FrequencyBeam · SpecialBarrage · targeting · WeaponSpec · beamFx
  enemies/                      SeedEnemy(3D 추적·디졸브) · EnemyManager(공중 스폰/웨이브)
  world/                        World · TerrainField · SkyEnvironment · CollisionWorld · precinct
  ui/                           MenuScreen(세계지도) · HUD · Minimap · RearView
  fx/                           dissolve · postprocessing(Bloom) · damageNumbers
  intro/                        CinematicPlayer · scenes · MenuBackground
public/{drones,weapons,maps}/   런타임 데이터(JSON)
docs/{spec,implements}/         명세 · 구현 문서
```

전체 소스 트리와 시스템별 설명: [docs/implements/README.md](docs/implements/README.md).

## 로드맵

Link Swap(전장 중 기체 전환) → 드론 종류 확장(수중/탱크/전투기) → 전장 스트리밍 확대 →
RTS 빌드업 → 온라인 협동 → 코어(최종 보스). 향후 Flutter WebView는 선택적 배포 채널로만.
