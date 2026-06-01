# SEED — 구현 문서 (Implementation Notes)

이 디렉터리는 현재 코드베이스에 **실제로 구현되어 있는** 내용을 시스템 단위로 정리한 문서 모음이다.
기획/명세는 [../spec/overview.md](../spec/overview.md), 사용자용 요약은 [../../README.md](../../README.md)를 참고한다.

> 기준 버전: `package.json` v0.3.0 · Vertical Slice (Core Combat Loop)
> 스택: Three.js (WebGL2) + 커스텀 GLSL · Vite + TypeScript(strict)

## 현재 마일스톤

플레이어는 '링크 조종사'로서 무인 병기(`ANDROID-01`)에 원격 접속해, 에너지 **주파수 빔**으로
외계 씨앗 군집을 쪼그라뜨리고 **디졸브(Dissolve)** 소멸시킨다. 적은 웨이브 단위로 무한 증식한다.

```
타이틀 → (LINK IN) → 전투 루프 ⇄ (ESC) 일시정지
                         │
                      (사망) → LINK LOST → 재접속
```

## 문서 색인

| 문서 | 내용 |
| :--- | :--- |
| [01-architecture.md](01-architecture.md) | 전체 구조 · 게임 루프 · 상태 머신 · 시스템 배선 |
| [02-input-and-player.md](02-input-and-player.md) | 입력(Pointer Lock/키보드) · FPS 컨트롤러(이동/점프/대시/충돌) |
| [03-world.md](03-world.md) | 절차적 로우 폴리 지형 · 라이팅 · 하늘/안개 · 바위 콜라이더 |
| [04-weapon-beam.md](04-weapon-beam.md) | 주파수 빔 히트스캔 · 에임 어시스트 · 거리 비례 위력 · 임팩트 FX |
| [05-enemies.md](05-enemies.md) | 씨앗 적 유닛(박동/추적/디졸브) · 스폰/웨이브 매니저 |
| [06-fx-and-ui.md](06-fx-and-ui.md) | 디졸브 셰이더 · Bloom · 데미지 넘버 · HUD/오버레이 |
| [07-build-and-tooling.md](07-build-and-tooling.md) | Vite/TS 설정 · 스크립트 · Playwright 스모크(drive.mjs) |

## 소스 트리

```
src/
  main.ts                     진입점 — Game 부트스트랩
  core/Game.ts                루프/상태/시스템 오케스트레이션
  core/Input.ts               키보드 + Pointer Lock 입력
  world/World.ts              절차적 지형 + 라이팅 + 콜라이더
  player/PlayerController.ts   FPS 이동/조준/점프/대시/충돌
  weapons/FrequencyBeam.ts     히트스캔 빔 + 에임 어시스트 + 이펙트
  enemies/SeedEnemy.ts         씨앗 적(박동/추적/디졸브)
  enemies/EnemyManager.ts      스폰/웨이브/집계/정리
  fx/dissolve.ts              디졸브 셰이더 머티리얼(GLSL)
  fx/postprocessing.ts        UnrealBloom 컴포저
  fx/damageNumbers.ts         플로팅 데미지 넘버 FX
  ui/HUD.ts, ui/styles.css     HUD 오버레이
index.html                    캔버스 + HUD/오버레이 정적 마크업
```
