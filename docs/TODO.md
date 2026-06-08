# TODO — 성능·스케일 개선 로드맵

> 2026-06-05 대화 검토 결과 정리.
> 우선순위는 ⭐ 수로 표기. 공수는 작업일 기준.

---

## 목표

**지구 규모의 맵(광활한 산맥 / 복잡한 도심 / 지하 구조물)에서 플라즈모이드 1,000개와 다수의 유저가 함께 전투를 벌이는 것.**
전투가 없을 때는 자유롭게 세계를 탐방할 수 있어야 한다.

### 최종 달성 가능 수치 (모든 TODO 완료 기준)

| 항목 | 현재 | 목표 달성치 |
|------|------|-----------|
| 플라즈모이드 (클라이언트) | ~150개 | **1,000~2,000개** |
| 맵 크기 | 6×6km 고정 | **지구 전체** (청크 스트리밍) |
| 맵 고도 | ~250m | **8,848m** (실제 DEM) |
| 지하 공간 | 없음 | **지하철·동굴·지하도시** |
| 단일 전투 동시 인원 | 싱글플레이 | **100~150명/인스턴스** |
| 자유 탐방 동시 인원 | 싱글플레이 | **샤드당 1,000~2,000명** |

---

## 목차

1. [플라즈모이드 군집 성능](#1-플라즈모이드-군집-성능)
2. [지형 시스템 — 실제 랜드마크 맵](#2-지형-시스템--실제-랜드마크-맵)
3. [동적 가시거리](#3-동적-가시거리-fog--far-plane-자동-조정)
4. [지하 공간 시스템](#4-지하-공간-시스템)
5. [대규모 월드 스트리밍](#5-대규모-월드-스트리밍-장기)
6. [온라인 멀티플레이 — 인스턴스 방식](#6-온라인-멀티플레이--인스턴스-방식)
7. [난이도 · 플레이어 업그레이드 시스템](#7-난이도--플레이어-업그레이드-시스템)

---

## 1. 플라즈모이드 군집 성능

**현황**: 안정적 전투 가능 한계 약 100~150개. 그 이상은 프레임 드롭. 적은 이제 모기(SKEETER)/거머리(LEECH) 2 아키타입 + 멀티타깃 어그로(§7.0)지만, **군집 성능 병목 구조는 동일**(separation O(n²) + 개체별 mesh). 신규 거동이 개체당 상수 비용을 약간 키움.

### 병목 원인

| 병목 | 위치 | 복잡도 |
|------|------|--------|
| 분리 연산 (separation) | `CoreEnemy.ts:65` `separationVector` | O(n²) — 조기종료 있으나 밀집 시 무력화. **두 아키타입 공통**(거머리 `steerVelocity` / 모기 `kiterVelocity`) |
| 개별 Mesh + Material | `CoreEnemy.ts:264` | 개체당 draw call 2개(셸+코어), 고유 Material 2개 |
| 공간 분할 없음 | `EnemyManager.ts` (`enemies` 배열) | 이웃 탐색·표적 거리 전수 순회 |
| 모기 조향 삼각함수 | `CoreEnemy.ts:153` `turnToward`(acos/sin), 수직회피(cross/sqrt `:206`) | 개체당 상수 비용↑ — 추격형보다 무겁고, 다수 모기 시 가중 |
| 멀티타깃 선택 | `EnemyManager.pickTarget` | O(n×players) — 1인 플레이는 무시 가능, MP 다인에서 누적 |

### 개선 항목

- [x] **⭐⭐⭐ round-robin 프레임 분산** (`CoreEnemy.recomputeSteer` + `EnemyManager`) ✅
  - 조향 속도(`this.vel`) 캐시 — **근접(≤130m, 교전)은 매 프레임 재계산(감각 불변)**, 원거리는 `(frame+idx)%3==0` 일 때만(직선 접근이라 무체감)
  - 원거리 군집의 모기 조향(turnToward·수직회피)·분리 비용 ~1/3. `recomputeSteer` 순수 테스트(`pursue.test.ts`)
  - 재계산=true 시 거동 비트 동일(근접 전투 무변경)

- [x] **⭐⭐⭐ 공간 해시로 분리 연산 가속** (`CoreEnemy.ts` `buildBoidGrid`/`separationVector(…, grid)`) — O(n²) → O(n) ✅
  - 매 프레임 `buildBoidGrid(boids)`(셀 = 2·최대반경 + SEP_MARGIN, 충돌 없는 패킹 키) → 각 개체는 3×3×3 이웃 셀만 순회
  - 셀 ≥ 최대 reach 라 **전수 계산과 결과가 정확히 동일**(누락·중복 0, jitter 없음). 동등성 단위 테스트로 고정(`pursue.test.ts`)
  - `EnemyManager.update`가 grid 빌드 후 `steer.grid` 로 주입(거머리/모기 공통). 분리 비용 ~187K→~선형

- [x] **⭐⭐⭐ 코어 InstancedMesh** (`CoreEnemy.coreScale/coreBright` + `EnemyManager.updateCoreInstances`) ✅
  - 발광 코어를 개체별 메시 → `EnemyManager` 소유 **InstancedMesh 1개**로 일괄 렌더(매 프레임 상태에서 `setMatrixAt`/`setColorAt`). 코어 드로우콜 N→1.
  - 순수 시각 요소(레이캐스트 비대상)라 **전투 코드 무변경** → 안전. e2e 4맵 PASS(렌더·비블랙·에러0). 인스턴싱 파이프라인 구축 완료.
  - 비고: 코어 발광은 `MeshBasic instanceColor = color·coreBright·0.55`(Bloom) — 글로우 톤은 육안 튜닝 필요할 수 있음(`CORE_BLOOM`).

- [x] **⭐⭐⭐ 셸 InstancedMesh — GPU 게이트(전투·레이캐스트)** (`CoreEnemy`/`EnemyManager`/`weapons`) ✅
  - 살아있는 셸 = `EnemyManager` 소유 InstancedMesh(MeshBasic 자체발광, DoubleSide, castShadow) — 매 프레임 상태에서 행렬·색 기록. **개체당 2 draw call → 셸/코어 2 draw call**(드로우콜 ~2N→2). `boundingSphere` 매 프레임 무효화로 이동 인스턴스 적중 보장.
  - 레이캐스트: `hitMeshes=[shellInst]` → `enemyFromHit(hit.instanceId)` 역참조(`beamFx`/`SpecialStream` 공유). `SpecialBarrage` 는 콘 표적(`aliveEnemies`)에 위치 기반 직접 적용(레이캐스트 제거).
  - 디졸브 = **하이브리드**: 살아있는 셸은 인스턴스드, 디졸브 시작 시 개별 그룹(디졸브 셰이더)을 씬에 추가 → 셰이더 인스턴싱 회피.
  - 검증: 타입체크·457 단위테스트·e2e 4맵 렌더 PASS(에러 0). **단, 전투 적중(raycast)은 헤드리스(포인터락 게이트)에서 검증 불가 → 플레이테스트 필요.**

- [ ] **⭐⭐ 화면 밖·원거리 sleep** — frustum + 원거리 개체는 AI(이동·조향·표적선택) 스킵
  - 모기 `turnToward`/수직회피 삼각함수 비용도 함께 절감. 예상 공수: 1일

- [ ] **⭐⭐ 멀티타깃 선택 공간화** (`EnemyManager.pickTarget`, MP 전용)
  - 다인 전장에서 전체 플레이어 전수 거리(O(n×players)) 대신 **근처 플레이어만 후보**로(AOI/`SpatialGrid`)
  - 1인 플레이엔 영향 없음. 6번 멀티플레이와 함께. 예상 공수: 1~2일

- [ ] **⭐ DrainBeams 지오메트리 풀링** (`fx/DrainBeams.ts`)
  - 드레인마다 `CylinderGeometry` 생성·해제 → 길이만 스케일하는 단위 실린더 1개 재사용
  - 다수 모기 동시 드레인 시 GC 완화. 예상 공수: 1~2시간

> **폐기/구현됨 — 옛 "카이팅 방지" 3항목**: 거리기반 속도급등(`altitudeSpeedMult` 사용 — **제거됨**), 포위각 분산(roleAngle), 원거리 재스폰은 모두 **아키타입 재설계로 대체**. 지금은 *적이* 플레이어를 카이팅(모기 도주+예측 리드+수직 회피)하고, 군집 분산은 멀티타깃 어그로(`chooseTarget` `AGGRO_PENALTY`) + separation 이 담당 → 별도 작업 불요.

### 최적화 경로 및 수용 한계

**권장 순서**: 프레임 분산(반나절) → 격자 셀 교체(1일) → InstancedMesh(3~5일) → sleep(1일)

| 개선 단계 | 분리 연산 비용 (n=500) | 수용 가능 개수 |
|---------|-------------------|------------|
| 현재 | ~187K ops/frame | ~150개 |
| + 프레임 분산 k=3 | ~62K ops/frame | ~260개 |
| + 격자 셀 교체 | ~500 ops/frame | ~600개 |
| + InstancedMesh | ~500 ops/frame | ~1,000개 |
| + sleep(원거리·화면밖) | ~500 ops/frame | **~1,000~2,000개** |
| 10,000개 동시 | — | 현실적으로 불가 (WebGL 한계) |

> 카이팅 방지는 더 이상 별도 단계 아님(아키타입으로 구현). MP 다인 시 표적선택 공간화가 추가 변수.

---

## 2. 지형 시스템 — 실제 랜드마크 맵

**현황**: 맵 데이터는 **섹션형 스키마 v2**(terrain/objects/underground). 지형은 **DEM 하이트맵(Float32 .bin) 바이리니어 샘플** 시스템 + **절차적 폴백**(가우시안). 실측 DEM **데이터 취득**만 남음(아래).

### 개선 항목

- [x] **⭐⭐⭐ DEM 하이트맵 지형 시스템 + 섹션형 맵 스키마** ✅ (`MapData`/`TerrainField`/`maps.ts`/`build-terrain.mjs`)
  - **섹션형 스키마 v2**: 한 JSON 안에 `terrain`(높이장/해수면/수역) · `objects`(건물/도로/랜드마크/경계) · `underground`(예약) 독립 섹션 → 맵 에디터에서 레이어별 커스텀 대비. 순수 `normalizeMapData(raw)` 가 **평면(v1)·섹션(v2) 모두 수용**(무중단 마이그레이션).
  - **하이트맵**: `terrain.heightmap`(Float32 raw `.bin`, src/size/meters/origin) → `sampleHeightmap` 바이리니어(− seaLevel). 없으면 **절차적 폴백**. 런타임 `loadTerrainHeights`(fetch→Float32Array, 실패 시 폴백). `TerrainField` 가 우선순위 처리.
  - **빌드 파이프라인**: `build-maps.mjs` 가 v2 섹션형 출력. `build-terrain.mjs synthetic <id>` 로 .bin 생성(런타임 경로 검증 완료). 테스트: `mapData.test.ts`(정규화·샘플), `terrainField.test.ts`(DEM·폴백).
  - **남은 것(데이터 취득, 별도)**: 실 NASA SRTM 90m / AWS Terrarium → `.bin` 변환(네트워크·PNG/GeoTIFF 디코드 의존). `build-terrain.mjs` 의 `sampleElevation` 교체 + 맵별 `heightmap` 스펙 추가 + `camera.far` 확장(에베레스트 조망). 예상 공수: 1~2일

- [ ] **⭐⭐⭐ 지형 콜리전 완성** (`PlayerController.ts:350`)
  - `standSurfaceY()`가 이미 `heightAt()`를 ground로 사용 중 — 절반 구현됨
  - `topAt()` 결과가 -Infinity일 때 terrain을 fallback으로 쓰면 완성
  - 추가 프레임 비용: +0.004ms (무시 가능). 예상 공수: 반나절

- [ ] **⭐⭐⭐ minAltitude 맵 타입별 설정** (드론 스펙 JSON)
  - 현재 `minAltitude: 18` 고정 → 협곡 바닥 비행 불가
  - 협곡/산악 맵 전용 drone spec에서 `minAltitude: 0`으로 변경. 예상 공수: 1시간

- [ ] **⭐⭐ far plane + near plane 확장** (`PlayerController.ts:117`)
  - 에베레스트 조망: `camera.far` 8,000 → 40,000
  - z-fighting 방지: `near` 0.1 → 4 (맵 타입별 조정, near×far 비율 유지). 예상 공수: 1시간

- [ ] **⭐ SEGMENTS 512 옵션** (`World.ts:34`)
  - 현재 16.7m/vertex → 11.7m/vertex로 협곡 세부 표현 향상
  - 메모리 +27MB, 로드 +100ms. 맵 타입별 조건부 적용. 예상 공수: 1시간

### 구현 후 가능한 맵

| 맵 | 필요 작업 |
|---|---------|
| 후지산 배경 실루엣 | 지금 당장 JSON 수정만으로 가능 (h:3776, r:2000) |
| 후지산 착지·전투 | 하이트맵 교체 + 지형 콜리전 |
| 그랜드 캐니언 협곡 비행 | 하이트맵 + 콜리전 + minAltitude 제거 |
| 에베레스트 정상 전투 | 하이트맵 + far plane 확장 |
| 산맥 대규모 전투 | 하이트맵 + far plane + 플라즈모이드 개선 |

---

## 3. 동적 가시거리 (fog · far plane 자동 조정)

**현황**: `SkyEnvironment.ts:36` fog 고정값 `near=900, far=5000`. 환경 무관하게 동일 적용.

### 구현 방식

- **신호**: `renderer.info.render.triangles` (draw call은 부적합 — mergeGeometries로 항상 낮음)
- **반응**: EMA 5~10초 스무딩으로 급격한 변동 방지 (1프레임 지연 무시 가능)

### 환경별 목표값

| 환경 | 삼각형 수 기준 | fog near | fog far | camera.far | near plane |
|------|------------|---------|---------|----------|-----------|
| 고밀도 도시 | 5M+ | 500m | 2,000m | 4,000m | 0.1m |
| 일반 도시 | 2~5M | 700m | 3,500m | 6,000m | 0.1m |
| 교외·저밀도 | 500K~2M | 1,500m | 8,000m | 12,000m | 1m |
| 협곡·산악 | 200~500K | 3,000m | 18,000m | 28,000m | 2m |
| 평원·오픈 | <200K | 5,000m | 25,000m | 40,000m | 4m |
| 심해저 | 맵 타입 override | — | 50m | 500m | 0.1m |

### 개선 항목

- [ ] **⭐⭐⭐ 삼각형 수 기반 fog/far 동적 조정** (`SkyEnvironment.update()`)
  - `renderer.info.render.triangles` → EMA → fog near/far + camera.far lerp
  - near plane 비례 연동 필수 (z-fighting 방지: `near = far × 0.00001` 하한 1m)
  - 예상 공수: 1~2일

- [ ] **⭐⭐ shadow map frustum 연동** (`SkyEnvironment.ts:19`)
  - `shadow.camera.far` 1,400 고정 → fog far의 ~10%로 동적 조정
  - 산악 원경에서 그림자 절단선 방지. 예상 공수: 반나절

- [ ] **⭐ 수중·심해저 맵 타입 flag** (`MapData.ts`)
  - `environment: 'surface' | 'underwater' | 'underground'` 필드 추가
  - underwater 시 fog 알고리즘 bypass → 짧은 가시거리 강제
  - 4번 지하 공간의 레이어 스키마와 통합. 예상 공수: 반나절

---

## 4. 지하 공간 시스템

**현황**: 콜리더 타입 전체(`OBB`, `Tri`, `Circle`, `Wall`)가 `top`(상면)만 있고 `bottom`(하면) 없음 (`CollisionWorld.ts:4-8`). 지형도 단일 레이어. 지하 공간 개념 자체 없음.

### 근본 한계

```
현재 수직 모델:
  resolveCollision() — feetY >= collider.top 이면 통과 (올라서기)
  standSurfaceY()    — heightAt() 또는 topAt() 중 높은 값이 바닥
  → "발 아래 무엇이 있나"만 판단, 머리 위 천장 개념 없음
  → terrain 아래 공간 존재하지 않음
```

### 유형별 구현 가능성

| 공간 유형 | 방법 A (음수 지형 + 천장 콜리더) | 방법 B (레이어 시스템) |
|---------|----------------------------|--------------------|
| 지하차도 (도로 음각) | ✅ | ✅ |
| 교량·고가도로 하부 통과 | ✅ | ✅ |
| 지하 통로 | 부분 | ✅ |
| 지하철 역사 | ❌ | ✅ |
| 자연 동굴 | ❌ | ✅ |
| 수중 동굴 | ❌ | ✅ |
| 지하도시 | ❌ | ✅ |

**방법 A** (난이도: 중, 공수: 2~3주) — 콜리더에 `bottom?: number` 추가, 하위 호환 유지. 지하차도·교량 하부·반지하 커버.

**방법 B** (난이도: 상, 공수: 2~3개월) — `MapData`에 `underground?: SubLayer[]` 추가, 레이어별 독립 `CollisionWorld`. 5번 월드 스트리밍의 동적 CollisionWorld 재작성과 함께 진행 권장.

```typescript
interface SubLayer {
  id: string;
  floorY: number; ceilingY: number;
  buildings: Ring[];
  portals: Portal[]; // 계단·엘리베이터 연결 지점
}
```

### 개선 항목

- [ ] **⭐⭐⭐ 콜리더 `bottom` 필드 추가** (`CollisionWorld.ts:4-8`) — 하위 호환 유지. 예상 공수: 2~3일
- [ ] **⭐⭐⭐ 지형 음수 Y 허용** (`TerrainField.ts`) — DEM 교체 후 음수 통과. 예상 공수: 반나절
- [ ] **⭐⭐ MapData `environment` + 레이어 스키마** (`MapData.ts`) — 3번 수중 flag와 통합. 예상 공수: 1일
- [ ] **⭐⭐ 레이어 전환 로직** (`PlayerController.ts`) — Portal 존 진입 시 레이어 전환. 예상 공수: 1~2주
- [ ] **⭐ 레이어별 렌더링 컬링** — `camera.layers` 마스크로 지상/지하 draw call 분리. 예상 공수: 3~5일

---

## 5. 대규모 월드 스트리밍 (장기)

**현황**: 맵 1장 = JSON 전체 로드, ±3km 하드 경계(`PlayerController.ts:248`). Float32 좌표는 ±3km 넘으면 정밀도 저하.

### 청크 크기 + 고속/고공 churn 분석

맵 데이터는 §2의 **섹션형 스키마(terrain/objects/underground)** 를 청크 좌표로 분할. 청크변 `C`, 로드 반경 `R`, 속도 `v` 일 때:

> **로드율 = 2·R·v / C²** (1/C에 **제곱** 비례 → 작은 청크 + 고속이 치명적). 실측 맨해튼 밀도 ~716동/km²·147KB/km².

| 청크변 | 시야 내(R=3km) | 동/청크 | KB/청크 | v=1000m/s 로드율 |
|---|--:|--:|--:|--:|
| 512 m | ~169 | ~190 | ~39 | **22.9/s** (히치) |
| **1024 m** ⭐ | ~49 | ~750 | ~154 | 5.7/s |
| 2048 m | ~16 | ~3,000 | ~616 | 1.4/s |

- **진짜 비용은 fetch 가 아니라 동기 빌드**(`mergeGeometries` 건물 압출 + 콜리전 삽입) — 청크당 수~수십 ms → 초당 몇 개만 돼도 프레임 히치.
- **고공/고속은 건물 디테일이 보이지도·필요하지도 않음** → 단순히 청크를 키우는 게 아니라 **고도/속도 적응 LOD** 가 핵심.

### 권장 설계

- **기본 청크 1024 m**(2의 거듭제곱 → 인덱스 `floor(x/1024)`, DEM 64²@16m 텍스처 친화). 모바일도 1024(반경 축소로 대응 — 512는 고속과 상충).
- **고도/속도 적응 LOD**: 저고도·저속 = 세밀 청크 1024m(건물+지형, 작은 반경) / 고고도·고속 = **거친 지형 타일 4096m(건물 생략)**, 큰 반경. 고공 v=1000·R=20km 라도 거친 타일만 → 초당 ~2.4(값싼 DEM).
- **비동기·시간예산 빌드**: 프레임당 ≤~4ms 큐로 빌드 분할(또는 Web Worker) → 청크 크기 무관하게 히치를 구조적으로 제거(가장 중요).
- **히스테리시스**(로드 R / 언로드 R+밴드) — 경계 호버 thrash 차단. **속도방향 프리페치**(창을 v·lead 만큼 전진) — 도착 전 준비. **LRU 캐시** — 빠른 왕복 재빌드 회피.

### 개선 항목 (순서 의존성 있음)

- [x] **⭐⭐ ChunkStreamer 스켈레톤** ([chunkStream.ts](../../src/world/chunkStream.ts)) ✅ — 고도/속도 적응 LOD·속도방향 프리페치·히스테리시스·시간예산 빌드 큐·동시fetch 상한·LRU 캐시. 순수 결정 로직(`desiredLoad`/`keepSet`/`fineActive`) + 주입형 `ChunkIO`(fetch/build/dispose) 오케스트레이터. **실 청크 데이터/메시 빌드 배선은 미연결**(IO 훅만). 테스트: [chunkStream.test.ts](../../tests/chunkStream.test.ts).
- [~] **⭐⭐⭐ Floating Origin** — (단순화판 적용) `StreamingWorld` 가 **스폰을 로컬 원점**으로 잡아 플레이어를 0 근처에 유지(셀-로컬 → 로컬 = −origin). 셀(±~8km) 범위 내 Float32 정밀도 확보. 플레이 클램프는 `GameWorld.bounds` 로 일반화(`PlayerController`/`EnemyManager`). **남은 작업**: 셀 경계 횡단 시 재원점화(re-center) — 현재는 단일 셀 내 탐방.
- [~] **⭐⭐⭐ 동적 CollisionWorld** — (단순화판 적용) `StreamingWorld` 가 청크 로드/언로드로 **오브젝트 청크 집합이 바뀔 때만** `CollisionWorld` 전체 재구축(로드된 청크 건물에서). `SpatialGrid` 자체의 증분 add/remove 재작성은 추후(빈도 낮아 현재 재구축으로 충분).
- [x] **⭐⭐ 전지구 타일 월드 생성기 (DEM+OSM 결합)** ([build-world.mjs](../../scripts/build-world.mjs) · [chunkManifest.ts](../../src/world/chunkManifest.ts) · [mapLocator.ts](../../src/world/mapLocator.ts)) ✅
  - **위경도 셀 디렉터리** `maps/<floor(lat)>/<floor(lon)>/` 안에 **1024m 청크 파일 `<cx>_<cz>.json`** — 한 파일에 **지형(DEM 하이트맵 재샘플 33²) + 오브젝트(OSM 건물 centroid·도로 세그먼트·수역) + `underground:null`(추후 병합)** 결합. 셀 원점 = NW 모서리(`cell+1, cell`), 좌표는 셀-로컬 m로 재투영.
  - **셀 매니페스트** `tiles.json`(존재 청크 + 격자 파라미터) + **전역** `maps/landmarks.json`(랜드마크 → 위경도/셀/청크). 위치 조회: 순수 `cellChunkOf(lat,lon)` + `fetchWorldChunkAt(lat,lon)`/`fetchLandmarkLocation`(mapLocator).
  - 경복궁 생성·검증: `maps/37/126/`(99 청크, 10 오브젝트/99 지형, 북한산 청크 550m) + tiles.json + landmarks.json. 테스트: chunkManifest·mapLocator.
  - **기존 `maps/<id>.json` 모놀리식 보존**(레거시, 향후 삭제). 직전 per-id 청크 레이아웃은 이 타일 월드로 대체(build-chunks 제거).
- [x] **⭐⭐ ChunkStreamer ↔ 타일 월드 배선** ([StreamingWorld.ts](../../src/world/StreamingWorld.ts) · [chunkMesh.ts](../../src/world/chunkMesh.ts)) ✅ — `ChunkIO` 구현(fetch=`tiles.json` 게이트 + `<cx>_<cz>.json`, build=청크→메시(지형 격자 색칠 + 건물 압출·표고 안착 + 도로 리본 + 수역), dispose=해제+레지스트리 정리). `heightAt` 바이리니어 샘플 + 오브젝트 청크 집합 변경 시 `CollisionWorld` 재구축 + `queryMinimap`. 게임 진입은 카탈로그 `stream:true` 분기로 `StreamingWorld.create(lat,lon)`(스폰 주변 지형 프리로드). `World`/`StreamingWorld` 공통 표면 = [GameWorld](../../src/world/GameWorld.ts). e2e 스모크 PASS(playing·미니맵·비블랙·에러0). **레거시 `maps/<id>.json` 은 데이터로 보존**(카탈로그 비노출).
- [x] **⭐⭐⭐ 광역 전장 (반경 20km) + 무제한 로밍** ✅ — 경복궁 중심 **반경 20km(58×58km, 1,952 청크, 건물 133k·도로 48k)** 실측 수집. `StreamingWorld.bounds=1e7`(사실상 무제한, 데이터 없는 곳은 평지). 40km DEM(2048²). build-world 가 heightmap 을 `maps.config` 에서 직접 읽어 **DEM↔OSM 분리**.
  - **1km 타일 순차·재개 수집** ([osm.bboxTiles/mergeOSM](../../scripts/osm.mjs) · [build-maps.mjs](../../scripts/build-maps.mjs)) — 큰 타일은 도심에서 Overpass 타임아웃 → ~1km(0.0095°) 분할, 중심→외곽, 좌표 키 캐시(재개), 다중 미러 폴백, 실패 건너뜀. `OSM_PARTIAL=1` 중간 빌드. **모든 광역 맵 공통 규약**([03-maps.md](spec/03-maps.md) 명기).
  - 검증기 `cellOOB` 광역 대응(±250km, 셀 경계 횡단 단일프레임 허용) + `terrain-steep`(DSM 스파이크 가드).
  - **남은 작업**: 셀 경계(경도 127 등) 횡단 = **멀티셀 스트리밍**(build-world 다중 셀 출력 + StreamingWorld 인접 셀 로드)으로 진정한 전지구 로밍.
- [ ] **⭐⭐ 지하·수중 레이어** — 4번과 연동, Y축 멀티레이어(`underground` 섹션).

### 단계별 예상 공수

| 단계 | 내용 | 공수 |
|------|------|------|
| Phase 1 | 멀티맵 순간이동 (현재 구조 최대치) | 2~3주 |
| Phase 2 | Floating Origin + 동적 Grid + 연속 스트리밍 | 2~3개월 |
| Phase 3 | 지구 전체 커버 + 지하/수중 + LOD | 추가 2~3개월 |

---

## 6. 온라인 멀티플레이 — 인스턴스 방식

**현황**: 네트워킹 코드 없음. 순수 싱글플레이어 구조.

### 전체 서버 아키텍처

```
┌─────────────────────────────────────────────────┐
│                  Lobby Server                    │
│  방 생성 / 매칭 / 인스턴스 스폰 / 유저 라우팅     │
└──────────┬──────────────────────┬────────────────┘
           │                      │
    ┌──────▼──────┐        ┌──────▼──────┐
    │  Battle     │        │  Battle     │  ← 방마다 독립 프로세스
    │  Instance A │        │  Instance B │    전투 끝나면 자동 종료
    │  맵:도심    │        │  맵:협곡    │
    │  100명+1000개         50명+1000개  │
    └─────────────┘        └─────────────┘

    ┌─────────────────────────────────────────────┐
    │          Free Roam Server (지역 샤드)        │
    │  지구 규모 / 전투 없음 / 위치 릴레이만        │
    │  샤드당 1,000~2,000명                        │
    └─────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────┐
    │              Map Tile CDN                   │
    │  DEM 하이트맵 청크 / OSM 건물 타일           │
    └─────────────────────────────────────────────┘
```

**인스턴스 생명주기**: 방 생성 → 프로세스 스폰 → 전투 종료 → 프로세스 종료 → 자원 반납 → 유저 Free Roam 복귀. 완전 Stateless라 전투 수에 비례해 선형 확장.

### 맵 크기별 인스턴스 최대 인원

서버 CPU 예산(30tick/s = 33ms) 기준:
```
플라즈모이드 AI (고정):   ~2ms
플레이어 입력 + 검증:     ~0.15ms × N
──────────────────────────────
N=100: ~17ms → 예산의 52%  ✅
N=150: ~24ms → 예산의 74%  ✅
N=200: ~32ms → 예산의 97%  ⚠️
```

| 맵 크기 | AOI 내 플라즈모이드 | 클라이언트 수신 | 권장 최대 인원 |
|--------|-----------------|--------------|-------------|
| 2×2km (밀집 교전) | ~314개 | 1.41 Mbps | **40~50명** (대역폭 한계) |
| 6×6km (도심·협곡) | ~35개 | 0.16 Mbps | **100명** |
| 10×10km (산맥) | ~13개 | 0.06 Mbps | **150명** |
| 20×20km (대규모전) | ~3개 | 0.01 Mbps | **200명** |

### 아키텍처 방향 — 클라이언트 권위 + 서버 랜덤 검증

매 틱 `resolveCollision()` 서버 실행 시 플레이어 1명당 최대 7.7ms/틱 → N=5명만 돼도 30tick/s 예산 초과. 대신:
- 클라이언트가 보낸 위치를 기본 신뢰
- 무비용 사전 필터 + 비정기 랜덤 검증으로 치팅 대응
- PvE 게임이라 치팅 위협이 낮으므로 현실적인 선택

### 동기화 데이터 크기

```
플레이어 1명:      position(12) + yaw/pitch(4) + hp(2) + firing(1) = 32 bytes
플라즈모이드 1개:  position(12) + hp(2) + state(1) = 15 bytes
1,000개 풀 브로드캐스트: 15KB/tick × 30 = 3.6 Mbps/클라이언트
AOI 200m 필터링 후:     ~100개 → 0.36 Mbps/클라이언트 (90% 감소)
```

### 치팅 방지 — 랜덤 검증 시스템

**무비용 사전 필터 (매 틱 항상 실행):**

| 필터 | 판단 기준 | 비용 |
|------|---------|------|
| 속도 위반 | 1틱 이동거리 > max_speed × 1.5 | O(1) |
| 고도 점프 | Y 변화량 > HARD_CEILING / 10 per tick | O(1) |
| HP 급증 | hp가 흡수 이벤트 없이 증가 | O(1) |

**랜덤 벽 통과 검증 (기본 5% 확률):**
- [이전위치 → 현재위치] 선분을 `SpatialGrid`에 질의, OBB 교차 시 위반 판정
- 평균 비용: 0.05ms/틱/플레이어. 치터가 검증 타이밍을 알 수 없어 패턴 회피 불가

**가변 검증율:**
```
평상시:          5%
사전 필터 감지: 50%  (경고 상태)
위반 누적 3회: 100%  (감시 상태) → 누적 시 킥
```

**HP 섀도 추적:** 서버가 `hp_shadow[playerId]` 독립 유지 → 접촉 이벤트 기반 `contactDamage()` 적용 → ±20% 초과 시 강제 덮어쓰기.

**위반 처리:** 경고 1~2회: 조용한 위치 보정 → 3~5회: 강제 동기화 → 6회+: 킥.

### 서버 스펙 추산 (인스턴스 1대, 6km맵, 100명, 1,000개)

```
CPU:      2코어 (~17ms/tick, 여유 충분)
RAM:      512MB~1GB
대역폭:   20 Mbps (AOI 적용 후)
비용:     ~$35/월 (AWS t3.medium 기준)

동시 전투 10개: ~$350/월
Free Roam 샤드 (1,000명): ~$20/월
```

### 개선 항목

- [ ] **⭐⭐⭐ 기본 서버 + 클라이언트 동기화** — WebSocket, 플레이어 위치·상태 브로드캐스트, 플라즈모이드 서버 권위. 예상 공수: 3~4주
- [ ] **⭐⭐⭐ Battle Instance 스폰 시스템** — Lobby → 맵ID·크기·플라즈모이드 수 파라미터로 인스턴스 프로세스 스폰. 전투 종료 시 자동 종료. 예상 공수: 2~3주
- [ ] **⭐⭐⭐ AOI 필터링** — 플레이어 반경 200m 밖 플라즈모이드 전송 제외. 3.6 Mbps → 0.36 Mbps/클라이언트. 예상 공수: 1주
- [ ] **⭐⭐⭐ 랜덤 검증 시스템** — 속도 위반(항상) + 벽 통과(5% 랜덤) + HP 섀도 추적 + 가변 검증율. 예상 공수: 1주
- [ ] **⭐⭐ 위치 보간** — 30tick/s 갱신 사이 클라이언트 측 보간으로 플라즈모이드 텔레포트 방지. 예상 공수: 3~5일
- [ ] **⭐⭐ Free Roam 서버** — 전투 없음, 위치 릴레이만. 지역 샤드 분할로 1,000명+. 예상 공수: 1~2주
- [ ] **⭐ 호스트 권위 P2P 모드** — 서버 없이 1명이 호스트. ~20명 수용. 예상 공수: 2~3주

---

## 7. 난이도 · 플레이어 업그레이드 시스템

> 2026-06-07 대화 검토 결과. 난이도 계수는 "적 파워 ÷ 플레이어 파워"라, **업그레이드 축을 먼저 못박고 난이도를 거기에 맞물려** 설계한다.

### 7.0 배경 — 현재 적 행동 모델 (구현 완료)

플라즈모이드 행동이 **드론 선택에서 분리된 고유 아키타입** 2종으로 정리됨(`PlasmoidSpec.archetypes`):

| 아키타입 | 이름 | 거동 | 주 교전 |
|---|---|---|---|
| `kiter` | **모기 / SKEETER** | keepDist 유지·도주·원거리 드레인 빔·선회 시 수직 회피, 상공 스폰, 소수정예 | 플라이어 |
| `rusher` | **거머리 / LEECH** | 적극 접근·접촉 흡수, 지표 스폰, 떼(swarm) | 워커 |

- 스폰 물량은 **아키타입별 독립 예산**(`archetypeCount`), 매칭 드론 수 비례(자기정렬). 멀티타깃 어그로(`chooseTarget`: 최근접+히스테리시스+분산).
- ⚠️ **§1의 카이팅 방지 항목 재정리**: "거리 기반 속도 급등"은 `altitudeSpeedMult()` 제거로 무효. "포위각 분산 / 원거리 재스폰"은 아키타입 시스템(모기 도주+수직회피, 거머리 떼)으로 대체·재해석됨. §1은 순수 *성능* 항목만 유효.

### 7.1 난이도 설계 철학

> **난이도는 "지루함(체력 스펀지)"이 아니라 "실력 요구치"를 올려야 한다.** 재미는 "맞히기(모기)"·"감당하기(거머리)"지 DPS 갈아넣기가 아니다.

| 팩터 | 올라가는 것 | 역할 |
|---|---|---|
| 체력(HP) | 처치 시간 ↑ | ⚠️ 주팩터 부적합(스펀지). **등급 신호용**(T→색·크기 연동) |
| 이동속도 | 회피·조준·추격 난도 | ✅ 강함(단, 플레이어 대비 **상한 밴드** 내) |
| 공격력 | 실수 시 사망 속도 | △ 보조(무회복이라 급증 시 억울사 — 완만하게) |
| **수(count)** | 동시 처리량·우선순위·AoE 강제 | ✅ 강함(압박감 자연 상승) |

- **아키타입별 주 팩터**: 거머리=**수**, 모기=**민첩**(속도·turnRate·evadeGain·keepDist). 각자 정체성과 일치.
- ⚠️ 함정: 질량 모델(`speedForStrength`)상 강할수록 느려짐 → **온도(HP) 중심 웨이브 스케일링은 "탱키+둔함"으로 드리프트**(최악 조합). 웨이브 난이도는 **수 증가**에 무게, HP는 가끔 엘리트 스파이크에만.

### 7.2 플레이어 업그레이드 — 소스 3계층

| 계층 | 소스 | 먹이는 대상 |
|---|---|---|
| ① 출격 내 임시 | **아이템 수집** | 로그라이트 빌드(귀환/사망 시 소멸) |
| ② 영구 성장 | **처치 수 + 전투 횟수** | 드론 레벨(영구 스탯 완만 성장) |
| ③ 해금 | **랜드마크 · 배틀필드 · 업적** | 무기 등급·신규 드론·퍽 슬롯·**스탯 캡 상향** (raw 스탯 X, 선택지/상한 O — 파워크리프 억제) |

### 7.3 업그레이드 팩터 6축 (드론별)

| 축 | 대상 필드 | 워커(탱크 난투) | 플라이어(글래스 에이스) |
|---|---|---|---|
| 체력/생존 | `vitals.maxHp` + **HP 재생(신규)** | ◎ 주력 | ○ |
| 에너지/지속 | `vitals.maxFreq`·`freqRegen` | ○ | ◎ |
| 이동속도 | `move.speed`·`verticalSpeed` | ○ | ○(과하면 컨트롤난) |
| 선회/핸들링 | 플라이어 `move.accel`·`rollDeg` / 워커 `dash`·`groundAccel` | 대시=포위 돌파 | ◎(accel 9=둔함→모기 잡기 직결) |
| 공격력 | `manual/auto.damage`·특수 `salvoDamage/damage`·`falloff` | ○ | ○ |
| 무기(해금/등급) | `range`·`assistConeDeg`·`maxBeams`·`fireInterval`·`cooldown` | 배러지 `maxBeams`↑ | 오버드라이브 `fireInterval`↓ |

**정체성 보존**: 워커=생존·AoE·대시 / 플라이어=핸들링·정밀·지속. raw 데미지·HP보다 "생존·핸들링·지속"에 무게.

### 7.4 MVP 스펙 — 킬 XP → 레벨 → HP/공격력/재생

**모델**: "출격 시점 스냅샷" — XP는 실시간 누적·저장, 레벨/스탯은 **다음 출격 시작 때 적용**(런 중 재계산 없음). 드론별 레벨 **독립**.

**XP 소스**
| 소스 | 공식 |
|---|---|
| 처치 | `xpForKill(s) = round(10 + 40·s)` (s=strength 0..1 → 10~50) |
| 배틀필드 클리어 | `+200` 정액 |

**레벨 곡선** — `totalXp(L) = round(100·(L-1)^1.6)`, 상한 L20. `levelFromXp(xp)` 파생.

| L | 누적 XP | L | 누적 XP |
|--:|--:|--:|--:|
| 1 | 0 | 10 | 3,360 |
| 2 | 100 | 15 | 7,060 |
| 5 | 915 | 20(캡) | 11,400 |

초반 ≈ 웨이브당 1레벨, 점차 둔화.

**성장 수치 (드론별)**
| 축 | 워커 /레벨 | 플라이어 /레벨 | L20 워커 | L20 플라이어 |
|---|--:|--:|--:|--:|
| maxHp | +6 | +3 | 120→**234** | 60→**117** |
| 데미지 배수 | +2% | +3% | **×1.38** | **×1.57** |
| HP 재생 | +0.5/s | +0.3/s | **9.5/s** | 5.7/s |

**HP 재생 메커닉(신규)**: 피격 후 `3.5s` 정지 → 이후 `hpRegen/s`. 교전 중(드레인/접촉이 피격 갱신)엔 회복 안 됨(재생률 < 지속 드레인) → 빠져야 회복.

**저장 포맷** — 키 `"core.progress"`, 버전 필드, **xp만 저장·level 파생**, 손상 시 리셋:
```json
{
  "v": 1,
  "drones": { "walker": { "xp": 1234 }, "flyer": { "xp": 0 } },
  "stats": { "kills": 342, "battlefieldsCleared": 7, "landmarks": [], "achievements": [] }
}
```
`stats`는 MVP에선 집계만(랜드마크/업적 카운트) — 다음 단계(해금·난이도 연동)가 바로 읽도록 지금부터 포함.

**구현 분해**
- 순수 모듈 `src/player/progression.ts`(전부 단위 테스트): `totalXpForLevel`·`levelFromXp`·`xpForKill`·`droneGrowth(id, level)→{hpBonus,dmgMult,hpRegen}`.
- 저장 모듈 `src/core/progress.ts`: `load/save/addXp/record` + 버전 검증·기본값.
- 적용: `PlayerController`(maxHp+hpBonus, update의 재생+피격 delay), 무기(데미지×dmgMult), `Game`(세션 시작 로드·적용, `onKill`서 XP 누적·저장).

### 7.5 난이도 계수 (진행도 연동) — MVP 직후

- **net = 적 파워 / 플레이어 파워.** 단일 난이도 계수를 **드론 레벨·클리어 배틀필드에 연동**해 동반 스케일(플레이어보다 약간 뒤처지게 = 러버밴딩, 성장 쾌감 유지).
- 계수가 곱하는 대상: **`count ×`(주), `speed ×`(플레이어 대비 상한 클램프), `attack ×`(완만)**. **HP는 T 시스템에 위임**(신호용).

### 개선 항목

- [ ] **⭐⭐⭐ MVP 진행 시스템** — 순수 `progression.ts`(+테스트) → 저장 모듈 → PlayerController/무기/Game 적용. 킬 XP→레벨→HP·데미지 성장 + HP 재생. 곡선·수치 전부 상수화. 예상 공수: 2~3일
- [ ] **⭐⭐⭐ 단일 난이도 계수(진행도 연동)** — `count×·speed×(클램프)·attack×`, HP는 T 위임. 레벨/배틀필드에 연동. 예상 공수: 1~2일
- [ ] **⭐⭐ 무기 해금** — 랜드마크/배틀필드 게이트 → 무기 등급(Mk2)·특수 파라미터. 예상 공수: 3~5일
- [ ] **⭐⭐ 아이템 로그라이트** — 출격 내 임시 강화 드롭/픽업·빌드. 예상 공수: 1~2주
- [ ] **⭐ 업적 시스템** — 마일스톤 → 해금/캡 상향/코스메틱. 예상 공수: 1주
- [ ] **⭐ 런 중 즉시 레벨업** — 스냅샷 → 실시간 스탯 반영(연출 포함). 예상 공수: 2~3일

---

## 현재 프레임 예산 참고

```
60fps = 16.7ms/frame

현재 사용량 (도시 맵, 적 20개):
  GPU — Composer.render()      8~12ms  ← 주 병목
  CPU — EnemyManager.update()  2~4ms   (O(n²) boid steering)
  CPU — PlayerController       1~2ms   (collision substeps)
  CPU — heightAt() per-frame   <0.2ms  (무시 가능)
  ──────────────────────────────────
  합계                        13~20ms  (여유 -3~+3ms, 타이트)

목표 달성 후 예상 (플라즈모이드 1,000개):
  GPU — Composer.render()      8~10ms  (InstancedMesh, 산악맵은 도시 merged 없어 오히려 감소)
  CPU — EnemyManager.update()  ~2ms    (격자 셀 O(n))
  CPU — PlayerController       1~2ms
  ──────────────────────────────────
  합계                        11~14ms  ← 60fps 안정
```

새 기능 추가 전 GPU 병목(`Composer.render`) 개선이 선행되어야 함.
