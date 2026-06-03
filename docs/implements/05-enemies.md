# 05 · 적 (플라즈모이드 · 스폰 · 웨이브)

소스: [SeedEnemy.ts](../../src/enemies/SeedEnemy.ts), [EnemyManager.ts](../../src/enemies/EnemyManager.ts)

## SeedEnemy — 플라즈모이드

박동하는 유기적 에너지 구체. 빔 누적 피격으로 쪼그라들다 디졸브 소멸(셰이더).

`update(dt, target)`는 두 책임으로 분리(가독성):
- **`updateVisual(dt)`** — 피격 플래시(제곱 감쇠) · 디졸브 진행 · 박동(pulse) 스케일/발광.
  소멸 중이면 `false` 반환 → 이동 생략.
- **`updateMotion(dt, target)`** — 3D 추적 + 자유 부유 + 공격 쿨다운.

### 이동 — 자유 부유 + 3D 추적
- **지형/물체와 충돌하지 않고** 자유롭게 떠다닌다(지표면 지향성·강하 없음).
- 플레이어를 향해 **상하 포함 3D**로 다가온다 — 순수 `pursueStep(from, to, speed, dt, stopDist)`.
  `STOP_DIST=2.2m` 이내면 정지(접촉 교전 거리). ([tests/pursue.test.ts](../../tests/pursue.test.ts))
- 미세 상하 흔들림(`BOB_AMPLITUDE=0.4`, 누적 없는 진동)으로 부유감.

### 전투
- `applyFrequencyHit(damage)` — HP 차감, 0 이하면 `dissolving` 전이(처치). 피격 시 발광/플래시.
- `tryAttack(playerPos, range)` — 사거리 안 + 쿨다운(1s) 0이면 공격 true.
- 상태: `alive → dissolving → dead`(디졸브 완료). `dead`는 매니저가 정리.

## EnemyManager — 공중 스폰 / 웨이브 / 집계

### 공중 스폰 (`spawnOne`)
- 플레이어 주변 근거리 밴드(반경 55~205 m, `TERRAIN_HALF` 클램프)에 배치.
- 고도는 순수 `spawnAltitude(u)` = `u^SPAWN_BIAS × SPAWN_CEILING` (`2.5`, `300m`).
  지수 가중으로 **지상에 가까울수록 빈도↑**(경계 u=0→0, u→1→300, 단조).
  ([tests/spawn.test.ts](../../tests/spawn.test.ts))
- 스케일·속도는 웨이브 비례(`speed = 4.5 + wave×0.4 + rand`).

### 웨이브 (`startNextWave`)
- `pendingSpawns = 4 + wave×2`를 0.35 s 간격 점진 스폰.
- 화면 적이 모두 정화(`enemies.length === 0` + 대기 0)되면 다음 웨이브 — 무한 증식.
- 집계: `killCount`(`registerKill`→`onKill`), `wave`(`onWaveChange`). `onPlayerHit`로 피격 통지.

`update(dt)` — 점진 스폰 → 각 적 `update`(플레이어 좌표 전달) + `tryAttack` → 사망 적 정리 →
웨이브 종료 판정.
