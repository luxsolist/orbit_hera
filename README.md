# SEED 🌱

3D 무인 원격 제어 FPS / 핵앤슬래시 게임 — **순수 웹(Three.js) 기반 v3.0**.

플레이어는 '링크 조종사'로서 무인 병기에 접속해, 에너지 **주파수 빔**으로 외계 씨앗 군집을
쪼그라뜨리고 소멸(Dissolve)시킨다.

> 전체 기획/기술 명세는 [docs/spec/overview.md](docs/spec/overview.md) 참고.

## 현재 구현 (Vertical Slice — Core Combat Loop)

- 절차적 **로우 폴리 지형** + 라이팅 + **Bloom** 포스트 프로세싱
- **FPS 컨트롤러** — Pointer Lock 마우스룩, WASD 이동, 점프/중력, 대시
- **에너지 주파수 빔** (히트스캔) — 적중 시 적을 쪼그라뜨리고 **디졸브 셰이더**로 소멸
- **외계 씨앗 적** — 박동 애니메이션, 추적 AI, 점증 웨이브 스폰
- **원격 접속 HUD** — 체력/주파수 게이지, 크로스헤어, 처치 수, 웨이브, 피격 비네팅

## 조작

| 입력 | 동작 |
| :--- | :--- |
| `W A S D` | 이동 |
| `SPACE` | 점프 |
| `SHIFT` | 대시 |
| `MOUSE` | 조준 |
| `좌클릭` | 주파수 빔 조사 |
| `ESC` | 링크 해제(일시정지) |

## 실행

> **요구사항:** [Node.js](https://nodejs.org/) 18+ (현재 개발 머신에는 미설치 — 설치 후 진행).

```bash
npm install      # 의존성 설치 (three, vite, typescript)
npm run dev      # 개발 서버 (HMR) — 브라우저 자동 오픈
npm run build    # 타입체크 + 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
npm run typecheck
```

## 기술 스택

- **렌더링:** Three.js (WebGL2) + 커스텀 GLSL (디졸브 셰이더)
- **포스트 프로세싱:** EffectComposer + UnrealBloomPass
- **빌드:** Vite + TypeScript (strict)

## 구조

```
src/
  main.ts                 진입점
  core/Game.ts            루프/시스템 오케스트레이션
  core/Input.ts           키보드 + Pointer Lock 입력
  world/World.ts          절차적 로우 폴리 지형 + 라이팅
  player/PlayerController.ts  FPS 이동/조준
  weapons/FrequencyBeam.ts    히트스캔 빔 + 이펙트
  enemies/SeedEnemy.ts        씨앗 적(박동/추적/디졸브)
  enemies/EnemyManager.ts     스폰/웨이브/집계
  fx/dissolve.ts          디졸브 셰이더 머티리얼
  fx/postprocessing.ts    Bloom 컴포저
  ui/HUD.ts, ui/styles.css    HUD 오버레이
```

## 로드맵

Link Swap(기체 전환) → 무인 병기 종류 분화 → 절차적 지형을 실지형(OSM/DEM) 스트리밍으로 →
RTS 빌드업 → 온라인 협동. 향후 Flutter WebView는 선택적 배포 채널로만.
