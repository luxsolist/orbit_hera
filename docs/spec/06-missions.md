# 06 · 미션/종료조건 체계 — 3축 분해와 패턴 카탈로그 (정본)

> **정본 문서** — 미션 체계의 설계 기준. 현행 런타임 데이터 계약(v1 `MissionSpec`)은
> [01-data-schemas §5](01-data-schemas.md#5-미션-publicmissions)가 담당하고, 이 문서는
> **v2 스키마(설계 목표)와 패턴 카탈로그**를 정의한다. v2 는 [`missionV2.ts`](../../src/game/missionV2.ts)의
> `toLegacy()` 로 표현 가능한 부분집합부터 단계 도입한다.

---

## 1. 설계 원칙 — 종료조건 3축 직교 분해

v1 은 `kind` 하나에 승리·실패·투입이 뭉쳐 있어 패턴 확장이 조합 폭발한다. v2 는 세 축을 분리한다:

| 축 | 값 | 비고 |
| :--- | :--- | :--- |
| **승리(goal)** | `purge`(N기 격멸) · `purge-role`(특정 직무만 전멸) · `purge-all`(투입 전량) · `survive`(시간 생존) · `guard`(대상 사수 + 유지 시간) · `suture`(봉합 게이지 — §2.4 연계) · `score`(공명 점수 목표) | 하나만 |
| **실패(fail)** | 리스폰 소진 · 시간 초과 · 건물 손실 한도 · 랜드마크 손실 한도 | **복수 조합** — "격멸 + 건물 ≤3" 같은 복합 제약 |
| **투입(deploy)** | `pyramid`(현행 점진 증원) · `horde`(대량 저체력·높은 동시 상한) · `roster`(고정 조합·증원 없음) · `boss`(보스 ± 수행원) · `phased`(다단계 — [tactical.ts](../../src/game/tactical.ts)) | 조합/진형 작업은 `roster.units` 확장으로 수렴 |

여기에 **변조(modifiers)** 레이어가 직교로 얹힌다: 파문 주기 배수 · 구역 축소 · 게이지 회복 배수(옅은 장) ·
어그로 성향(랜드마크 직행) · 건물 낙인 허용. 채점(공명 점수)은 전 미션 공통 공식([implements/08](../implements/08-game-instance-mission.md))이며
`score` 골만 목표치를 가진다.

## 2. MissionSpec v2 스키마

소스 타입: [`src/game/missionV2.ts`](../../src/game/missionV2.ts). JSON 예시(jsonc):

```jsonc
{
  "id": "surgical",
  "name": "정밀 정화 / SURGICAL",
  "brief": "얽힘이 짙은 구역이다. 무너뜨리지 말고 걷어내라.", // 브리핑 — 표면 어휘 규칙(§7) 준수
  "goal": { "type": "purge", "count": 30 },
  "fail": { "respawns": 2, "timeLimit": 300, "maxBuildingLoss": 3, "maxLandmarkLoss": 0 },
  "deploy": { "model": "pyramid", "count": 30, "totalHp": 70000, "bossHp": 10000,
              "concurrentCap": 16, "reinforceInterval": 1.5, "spawnRadius": 1200 },
  "zoneRadius": 4000,
  "modifiers": { "aggro": "building" }
}
```

| 필드 | 의미 |
| :--- | :--- |
| `goal` | 승리 조건 1개. `purge{count}` / `purge-role{role}` / `purge-all` / `survive{seconds}` / `guard{target: "landmarks"\|"buildings", hold}` / `suture{gauge}` / `score{target}` |
| `fail.respawns` | 리스폰 예산(<0 무한). 초과 시 실패 |
| `fail.timeLimit` | 격멸형 시간 초과 실패(초). 0 = 무제한. `survive`/`guard` 는 goal 의 `seconds`/`hold` 가 승리 타이머 |
| `fail.maxBuildingLoss` / `maxLandmarkLoss` | 손실 한도(도달 시 실패). 0 = 미사용 — **모든 goal 과 조합 가능**(복합 제약) |
| `deploy` | 투입 모델(§1 표). `roster.units[] = { role, count, hp, shield?, formation?, behavior?, anchor? }` — **진형** cluster(밀집)/ring(중심 포위)/line(전선) · **행동** hunt/hold(거점 고수)/patrol(배치점 순회)/escort(anchor 유닛 추종). hunt 외 행동도 사거리 내 기회 공격은 수행하며 **피격 시 진형을 버리고 hunt 전환** |
| `zoneRadius` | 작전구역(m). 0 = 무제한 |
| `modifiers` | `sweepPeriodMul` · `zoneShrink{everySec, step, minRadius}` · `freqRegenMul` · `aggro` · `buildingBrands` · `offTargetPenalty` — 전부 선택 |

### 체감 분화 — 승리 조건만으로는 미션이 갈리지 않는다

2026-08-23 실플레이 피드백("목표가 달라도 전부 사냥으로 느껴진다")의 교훈: **goal 은 "언제 끝나는가"만
정하고 "무엇을 해야 하는가"는 안 정한다.** 최적 전략이 같으면 승리 조건이 6종이어도 체감은 하나다.
행동을 가르는 건 변조와 적 행동 쪽이다:

| 미션 성격 | 걸어야 할 변조 | 없으면 |
|---|---|---|
| 사수형(`guard`) | `aggro: landmark/building` | 적이 플레이어만 쫓아 표적이 안 깎인다 = 생존전과 동일 |
| 표적 사냥(`purge-role`) | `offTargetPenalty` — 비표적 1기당 시간 차감 | 잡몹 처치가 공짜라 "전부 죽인다"가 늘 최적 = 격멸전과 동일 |
| 생존형(`survive`) | (구 `killHealMul: 0`) | 2026-08-25 회복 전면 폐지로 **전 미션 공통** — 이 변조 자체가 제거됐다 |

전제 조건 둘(엔진 쪽): **유발(`provoked`)은 감쇠 타이머**여야 하고(영구 래치면 첫 교전 뒤 전장 전체가
플레이어만 쫓는다 — 360° 자동사격이라 유발을 피할 수도 없다), **인식 해제 반경도 어그로 변조를 따라야**
한다(획득만 막고 해제 히스테리시스를 남기면 한 번 붙은 적이 영영 안 떨어진다).

**v1 호환**: `toLegacy(v2)` 가 현 엔진이 구동 가능한 부분집합(goal `purge`/`survive`/`guard` × deploy `pyramid` × 변조 없음)을
v1 `MissionSpec` 으로 변환한다. 불가하면 `null` — 엔진 훅(§5) 도입에 맞춰 해제. 현행 4미션은 v2 로 기술해도
v1 과 동치임을 테스트가 고정한다([tests/missionV2.test.ts](../../tests/missionV2.test.ts)).

## 3. 패턴 카탈로그 (20종)

상태: ✅ 현 엔진 표현 가능 · △ 소규모 확장 · 🔭 신규 훅 필요(§5 번호).

**A. 군집 소탕 — 핵앤슬래시 강화 (`horde`)**

| # | 이름 | goal / fail | deploy·modifiers | 상태 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 대정화 / GRAND PURGE | **purge-all 150** / 리스폰·시간 360s | horde(350HP 균일·동시 55) + sweepPeriodMul 0.7 — ✅ 완전체 | ✅ |
| 2 | 해일 / TIDE | survive 270s / 리스폰 | phased horde ×3(90초 간격 밀물) — ✅ **풀 편입** | ✅ |
| 3 | 최후 저지선 / LAST STAND | survive 240s / 리스폰 | horde + zoneShrink(45초마다 −800m, 최소 1200m) — ✅ **풀 편입** | ✅ |
| 4 | 공명 시험 / RESONANCE TRIAL | score / 시간 | horde + 콤보 배수 채점 | 🔭①(채점 확장) |

**B. 전략 조합전 — 고정 로스터 (`roster`, 증원 없음)**

| # | 이름 | goal / fail | deploy·modifiers | 상태 |
| :--- | :--- | :--- | :--- | :--- |
| 5 | 편대 해체 / DISBAND | purge-all(18기) / 리스폰·시간 | roster(소인체 4×1500 + 정예 6×3500 + 모기 8×900, 유닛별 클러스터 배치) — ✅ **풀 편입**(진형 순찰은 조합 정립 단계) | ✅(진형 제외) |
| 6 | 근원 사냥 / BRAND HUNT | **purge-role(marker, 6기)** / 리스폰·시간 | roster(소인체 6 + 호위 16) + sweepPeriodMul 0.6 — ✅ 완전체 | ✅ |
| 7 | 호위 붕괴 / BODYGUARD | purge-role(elite) / 리스폰·시간 | roster(정예 1×12000 shield 0.3 + 호위 18) — ✅ **풀 편입** | ✅ |
| 8 | 이중 전선 / TWO FRONTS | purge-all(24기) / 리스폰·시간 | roster 4유닛 클러스터(고공축 vs 지상축) — ✅ **풀 편입** | ✅ |
| 9 | 정예 소탕 / CULL | purge-all(7기) / 리스폰·시간 | roster(정예 7×4000) — ✅ **풀 편입**(준위 강등 브레이크포인트는 🔭) | ✅(강등 제외) |

**C. 중간보스전 (`boss` ± 수행원)**

| # | 이름 | goal / fail | deploy·modifiers | 상태 |
| :--- | :--- | :--- | :--- | :--- |
| 10 | 삼중 투영 / TRIPLE PROJECTION | purge-all(5기) / 리스폰·시간 | boss(30000×투영 3 + 모기 호위 4) — ✅ **풀 편입**(다그룹 연전은 phased 단계, [서사편 §1.10 ③] ⚠️) | ✅(연전 제외) |
| 11 | 성숙체 / THE MATURED | purge-role(boss) / 리스폰·시간 | boss(25000×1 + emit 8초 3기 + ownSweep) — ✅ **풀 편입** | ✅ |
| 12 | 쌍생 / GEMINATE PAIR | purge-all(2기) / 리스폰·시간 | boss groups 2 + healLink(500m·초당 400, 필라멘트 가시화) — ✅ **풀 편입** | ✅ |

**D. 최종보스전 (`phased` — tactical)**

| # | 이름 | goal / fail | deploy·modifiers | 상태 |
| :--- | :--- | :--- | :--- | :--- |
| 13 | 봉합전 / SUTURE | **suture** / 리스폰 | phased: 투영 소탕 → 균열 노출 → 지속 조사(관측 고정 게이지) → 반격 파문 — 격멸이 아니라 봉합이 목표(§2.4) | 🔭⑤⑥ |
| 14 | 부유 요새 / THE CARRIER | purge-role(boss) / 리스폰 | phased: 1km+ 상공(§3.2 보스 전용 고도) 투하 웨이브 ↔ 약점 노출 사이클 | 🔭①⑤⑥ |

**E. 랜드마크 방어 — 얽힘 밀도 우선 표적**

| # | 이름 | goal / fail | deploy·modifiers | 상태 |
| :--- | :--- | :--- | :--- | :--- |
| 15 | 오래 선 자리 / DEEP ROOTS | guard(landmarks, 300s) / 랜드마크 0 손실 | pyramid + **aggro: landmark**(플레이어 무시 직행 — 때려야 어그로) — ✅ **풀 편입** | ✅ |
| 16 | 순례길 / PILGRIMAGE | guard(landmarks, 3곳 순차) / 랜드마크 한도 | phased(전조 콘솔 예고 → 표적 이동) — 기동 방어 | 🔭④⑥ |
| 17 | 공성 낙인 / SIEGE BRAND | guard(landmarks) / 랜드마크 파괴 | pyramid(소인체 비중↑) + **buildingBrands**(랜드마크 낙인 → 파문 피해) | 🔭④(+커터 단계) |
| 18 | 마지막 등불 / LAST LIGHT | guard(landmarks, 장기) / 랜드마크 0 | phased 강도 상승 + 함락 권역 연출(와이어프레임) 선행 도입 | 🔭④⑥ |

**F. 복합 제약전 (modifier 중심)**

| # | 이름 | goal / fail | deploy·modifiers | 상태 |
| :--- | :--- | :--- | :--- | :--- |
| 19 | 정밀 정화 / SURGICAL | purge 40 / **건물 ≤15**·리스폰·시간 | pyramid + **aggro: building**(적이 도시만 노림 — 어그로를 끌어와야 한도가 버팀). ✅ 완전체(한도는 플레이테스트로 하향 검토) | ✅ |
| 20 | 옅은 장 / THIN FIELD | purge-all(15기) / 리스폰·시간 | roster + **freqRegenMul 0.5** — ✅ **풀 편입** | ✅ |

## 4. 난이도·서사 배치 지침

- 패턴군 A(군집)가 Ⅰ단계 기본 소비, B~C 가 중반 숙련(직무 식별 훈련 — 6번이 튜토리얼 성격),
  D-13(봉합전)이 1막 클라이맥스([서사편 §5] ⚠️), E 는 1막 전반에 산재(브리핑이 세계관 계시 통로).
- **떼(A)와 정예(B·C)는 상호 보완** — 살포/광역·복선 노출(동시 경직·소산 표류)은 A 가, 관측 병기
  문법(고정·계류)·표적 선택은 B·C 가 담당한다. 풀 회전에서 A:BC 비율로 리듬을 만든다.

## 5. 필요 엔진 훅 (도입 로드맵)

| 훅 | 내용 | 해금되는 패턴 |
| :--- | :--- | :--- |
| ① deploy 모델 분리 ✅ | `horde`/`roster`/`boss` 투입기 — **구현됨**(`startHorde`/`startRoster`, elite=고체력 러셔·boss=다중 투영 그룹, `purge-all` 은 `deployKillCredits` 로 스펙 도출 평가). `RosterUnit` 의 진형(formation)/행동 필드는 조합 정립 단계에서 확장 | 1~12, 14, 20 |
| ② 복합 실패 조건 ✅ | goal 과 무관하게 fail 4종 동시 평가(v1 은 kind 별 1개) — **구현됨**: 런타임이 v2 직구동(`evaluateMissionV2`), JSON v2 전환, 패턴 19 풀 편입 | 19 및 전 패턴의 제약 조합 |
| ③ 직무별 격멸 목표 ✅ | `purge-role` — **구현됨**: `deployRole` 태깅(elite/boss 는 행동과 별개 직무) + `EnemyManager.roleKills` 집계 + `deployRoleCredits` 로 목표치 도출(roster/boss 투입 한정 — 확률 혼합 투입은 runnable 게이트가 거름). 보스 = 그룹당 1크레딧 | 5~7, 9, 11, 14 |
| ④ 어그로 성향 노브 ✅ | `aggro: landmark/building` — **구현됨**: 인식 **획득·해제 반경 둘 다 0**(때려서 provoked 될 때만 플레이어 교전) + landmark 는 거리 무제한 직행(`nearestLandmark`). 변조 게이트는 지원 키만 해금(`SUPPORTED_MODIFIERS`) | 15~18 |
| ⑤ 보스 행동 확장 ✅ | **구현됨**: 소유 파문(ownSweep — 파문 원점이 보스를 따라감)·잡몹 분출(emit, 생존 상한 게이트)·회복 링크(healLink — 그룹 간 상호 회복 + 필라멘트 가시화)·호위 방패(RosterUnit.shield — 호위 생존 중 피해 감쇄, 표시 데미지도 반영). 페이즈 약점은 phased 콘텐츠 단계 🔭 | 7, 11~14 |
| ⑥ 구역·페이즈 스크립트 ✅(부분) | **구현됨**: `phased`(페이즈 = HUD 웨이브, 전멸/afterSec 트리거, 카운터 관통 누적) · `zoneShrink`(주기 축소 + 에너지 벽 재생성 + 저음 신호) · `freqRegenMul`(옅은 장) · `sweepPeriodMul`. 다지점은 roster 클러스터가 담당. suture goal·랜드마크 연계 스폰 선정(16·18 완전체)은 콘텐츠 단계 🔭 | 2, 3, 8, 13, 14, 16, 18 |

권장 순서: **② → ① roster → ③ → ④ → ⑤ → ⑥** (②③ 은 소규모, ① 이 조합 정립 작업과 병행).

## 6. v1 → v2 마이그레이션 (진행 상황)

1. ✅ v2 타입·변환기(`toLegacy`/`fromLegacy`) 정의.
2. ✅ **런타임 v2 직구동**(훅 ②): `GameInstance` → `evaluateMissionV2`(fail 4종 동시 평가) ·
   `missions/index.json` v2 전환 · v1 항목은 로더 `normalizeMissionPool` 이 `fromLegacy` 로 수용 ·
   현 엔진 미지원 goal/deploy 는 `runnableV2` 가 풀에서 자동 제외(훅 도입 시 자동 편입).
3. ✅ **deploy 모델 분리**(훅 ①): `horde`/`roster`/`boss` 투입기 + `purge-all` 평가(스펙 도출) —
   패턴 1(대정화)·5(편대 해체)·10(삼중 투영) 풀 편입. `phased` 는 훅 ⑥과 함께.
4. ✅ **직무별 격멸**(훅 ③): `purge-role` — 패턴 6(근원 사냥) 풀 편입.
5. ✅ **어그로 변조**(훅 ④): `aggro` — 패턴 15(오래 선 자리) 풀 편입 + 정밀 정화 완전체.
6. ✅ **보스 행동 확장**(훅 ⑤): shield·emit·ownSweep·groups·healLink — 패턴 7(호위 붕괴)·9(정예 소탕)·
   11(성숙체)·12(쌍생) 풀 편입.
7. ✅ **구역·페이즈**(훅 ⑥ 부분): phased·zoneShrink·freqRegenMul·sweepPeriodMul — 패턴 2(해일)·
   3(최후 저지선)·8(이중 전선)·20(옅은 장) 풀 편입(**총 18미션 / 패턴 15/20 가동**).
   잔여: score(4)·suture(13)·부유 요새(14)·순례길/공성 낙인/마지막 등불(16~18) — 각인·봉합·커터 콘텐츠 단계.
8. ✅ **진형/행동 정립**: `RosterUnit.formation/behavior/anchor` — 배치 3종(cluster/ring/line) ×
   행동 4종(hunt/hold/patrol/escort, 피격 시 hunt 전환·기회 공격 유지). 적용: 편대 해체(정예 포위
   순찰 + 모기 호위), 근원 사냥·호위 붕괴(호위가 실제로 곁을 지킴), 정예 소탕(포위 순찰),
   이중 전선(두 전선 hold + 각 축 호위). 공격 패턴 자체는 직무(§6.7 로스터)가 담당 —
   유닛별 수치 튜닝(tune)은 후속 🔭.

## 7. 세계관·어휘 가드

- **랜드마크 우선 표적의 근거(정본)**: 오래 서 있고 많은 사람이 머문 자리일수록 **관측과 얽힘이
  누적된 시공간**이며, 그들은 그런 곳부터 푼다 — 상세 독해는 [서사편 §5](../private/05x-narrative-truth.md) ⚠️.
- 브리핑·미션명 등 표면 문자열은 **얽힘·기억·관측·자리(허용 어휘)** 로 쓴다. "정보(량)·데이터·밀도 높은
  데이터" 류는 L4 인접 — 표면 금지([서사편 §8.1] 판별 기준 준용). 이 문서의 패턴명은 전부 허용 어휘로 작성됨.
- 신규 미션 추가 체크리스트는 [서사편 §8.6] ⚠️ 를 따른다(표시명·브리핑 금지 어휘 검사 포함).

## 8. 얽힘 택소노미 — 랜드마크 분류와 미션 자동 생성 (정본)

**통합 규칙**: 적의 수확 우선순위 지도(씨앗 장 분포)는 **인간의 관측·얽힘 누적 열지도**와 일치한다.
오래 선 자리·의례의 자리·기억의 응축고가 뜨겁고, 사람이 떠난 신도시·폐허는 옅다(→ 패턴 20 "옅은 장"의
근거). 이 한 규칙으로 **미션 배치 = 그 도시의 인문 지리**가 되어, 전 세계 어느 도시를 파이프라인에
넣어도 "어디를 지키는가"가 자동으로 이야기가 된다. 심층 독해는 [서사편 §5](../private/05x-narrative-truth.md) ⚠️.

### 8.1 6대 유형 (소스: [`src/world/entanglement.ts`](../../src/world/entanglement.ts))

| 내부 id | 표시명 | 물리 독해(표면) | OSM 자동 분류 태그 | 게임 효과 |
| :--- | :--- | :--- | :--- | :--- |
| `deep-roots` | 오래 선 자리 | 관측 누적(구시가·궁·성곽) | `historic=*`, `heritage=*`, castle/palace | 최우선 표적 · 저항 ×1.5 · 디졸브 저항 |
| `ritual` | 의례의 자리 | **반복 측정의 안정화** — 같은 의례의 반복이 자리를 붙든다(관측 고정 W1 과 동일 물리) | `amenity=place_of_worship`, temple/church/mosque | 저항 ×1.6(최고) · 디졸브 저항 |
| `archive` | 기억의 응축고 | 기록·유품 = 얽힘 잔향의 집적 — "아무것도 정말로 사라진 적 없다" | `tourism=museum`, `amenity=library/archive` | 저항 ×1.4 · 상실 시 서사 비용 최대 |
| `resonance` | 결맞음의 광장 | 군중의 거시 위상 동기(합창·응원·집회) | `place=square`, `leisure=stadium`, theatre | 협동 공명(MP) 무대 · ×1.2 |
| `relay` | 이음의 탑 | 원격 얽힘 증폭(만난 적 없는 이들을 잇는 자리 — 얽힘 스와핑) | tower/lighthouse, station/terminal | 상실 시 후속 미션 얽힘 밀도 하락(메타 루프 🔭) |
| `memorial` | 추모의 자리 | **소멸을 동결하는 지속 관측** — 기억하는 한 사라지지 않는다(제논) | `historic=memorial/monument`, cemetery | 저항 ×1.3 · 디졸브 저항 |

분류 우선순위: 추모(구체) → 의례 → 응축고 → 결맞음 → 이음 → 오래 선 자리(포괄 폴백) → null(일반 건물).

### 8.2 파생 규칙 (② 공짜 수확 — 기존 시스템 재독)

- **해제 저항**(🔭): 유형별 `resistMul` 을 랜드마크 HP·재안착에 적용 — "의례가 계속되는 한 흔들리지
  않는다". 적 입장에선 실패가 잦은 구역 → 더 큰 전력을 투입하는 고난도 방어의 자연 근거.
- **디졸브 저항**(아트 규칙 🔭): `dissolveResist` 유형은 함락 연출(로우 폴리→와이어프레임→공백)에서
  **마지막까지 형태를 유지** — 손때·닳은 계단 = 환경에 새겨진 관측 기록의 시각화([물리편 §3] 확장).
- **낙인의 인간 독해**(무비용 — [서사편 §6.1] ⚠️ 정본 승격): 찍힐 때는 무해하고 심판(파문)이 지나갈 때
  낙인찍힌 자만 다치며 근원을 없애면 낙인이 사라진다 — 이미 구현된 메커닉이 곧 사회적 낙인의 구조다.

### 8.3 데이터 흐름

1. **수동 지정**: `scripts/maps.config.mjs` 랜드마크 항목에 `cls` — 경복궁 일대 11개 분류 완료
   (근정전·광화문 deep-roots / 세종·이순신 동상 memorial / 민속박물관·MMCA archive / 세종문화회관
   resonance / 조계사 ritual). ⚠️ 반영에는 `npm run build:map` 재생성 필요.
2. **자동 분류**: 신규 도시 대량 편입 시 `classifyOsmTags(tags)` 로 OSM 랜드마크 후보를 자동 분류
   (파이프라인 통합 🔭 — bake 통과 배선은 완료).
3. **런타임**: `Landmark.cls`([MapData](../../src/world/MapData.ts)) → 미션 표적 선정(훅 ④)·저항
   보정·브리핑 템플릿(`ENTANGLEMENT_CLASSES[cls].brief`)의 단일 출처.

## 9. Director — 미션 체계를 조작하는 감독 (포인터)

미션 선택·변조·증원·이벤트는 **Director 인터페이스**([`src/game/director.ts`](../../src/game/director.ts))를
통해 조작된다 — 규칙 기반 구현(캠페인 챕터 선택기)이 기본이고, 라이브 환경에서는 AI 감독(LLM)이 같은
인터페이스로 교체된다. 감독 출력은 스키마·밸런스 봉투(`DIRECTOR_LIMITS`)·표면 어휘 필터
([`surfaceVocab.ts`](../../src/game/surfaceVocab.ts) — §7 규칙의 런타임 강제)를 통과한 것만 적용.
아키텍처·로드맵은 [TODO §10](../TODO.md), 심층 근거는 [서사편 §1.10](../private/05x-narrative-truth.md) ⚠️.
