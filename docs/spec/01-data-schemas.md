# 01 · 데이터 스키마 (JSON 데이터 계약)

CORE의 전투 드론·무기·전장은 모두 **런타임에 내려받는 JSON**으로 정의된다(`src/` 수정 없이
파일 추가만으로 콘텐츠 확장). 이 문서는 그 데이터 계약(스키마)을 정의한다.

- 모든 색은 `"0xRRGGBB"` 문자열(런타임에 `Number(...)`로 파싱).
- 좌표는 로컬 미터(1 unit = 1m, 북 = −Z, 원점 = `meta.lat0/lon0`).
- 스키마 검증은 [`tests/specs.test.ts`](../../tests/specs.test.ts)가 빌드 타임에 고정한다.

소스 타입: [`src/player/DroneSpec.ts`](../../src/player/DroneSpec.ts) ·
[`src/weapons/WeaponSpec.ts`](../../src/weapons/WeaponSpec.ts) ·
[`src/enemies/PlasmoidSpec.ts`](../../src/enemies/PlasmoidSpec.ts) ·
[`src/world/MapData.ts`](../../src/world/MapData.ts)

---

## 1. 드론 (`public/drones/`)

### `index.json` — 카탈로그
```jsonc
[
  { "id": "walker", "name": "ANDROID-01", "displayName": "보행 드론 / WALKER", "mode": "walk" },
  { "id": "flyer",  "name": "DRONE-V1",   "displayName": "비행 드론 / FLYER",  "mode": "fly" }
]
```
`id`마다 `public/drones/<id>.json` 상세 파일이 존재해야 한다. `mode`는 `"walk" | "fly"`.

### `<id>.json` — DroneSpec
| 필드 | 타입 | 의미 |
| :--- | :--- | :--- |
| `id` | string | 카탈로그 id와 일치 |
| `name` | string | HUD 유닛명(짧게) |
| `displayName` | string | 목록 표시명 |
| `body.eyeHeight` | number | 시점(카메라) 높이 m |
| `body.radius` | number | 충돌 수평 반경 m |
| `vitals.maxHp` | number | 최대 체력 |
| `vitals.maxFreq` | number | 최대 주파수(특수무기 자원) |
| `vitals.freqRegen` | number | 초당 주파수 회복 |
| `view.fov` | number | 시야각(도) |
| `view.mouseSensitivity` | number | 라디안/픽셀 |
| `dash` | object? | `{ speed, duration, cooldown }` — **없으면 대시 불가**(비행 드론) |
| `move` | `WalkMove \| FlyMove` | 이동 형태(아래) |
| `actions` | `ActionButton[]` | 모바일 동작 버튼(최대 2개) |
| `weapons.primary` | string | 기본 무기 id (`public/weapons/<id>.json` 참조) |
| `weapons.special` | string | 특수 무기 id |

**`WalkMove`** (`mode: "walk"`): `speed`, `groundAccel`, `airAccel`, `jump{ velocity, riseGravity,
fallGravity, fallTerminal, maxRiseHeight, coyoteTime }`.

**`FlyMove`** (`mode: "fly"`): `speed`, `accel`, `verticalSpeed`, `ceiling`(지면 대비 최대 고도),
`rollDeg`(좌우 이동 뱅킹 각), `spawnHeight`(지면 대비 스폰 고도, ceiling 내로 클램프),
`minAltitude?`(비행 하한 고도 — 지면 대비, 지상 안전지대로 못 내려오게. 없으면 0).

**`ActionButton`**: `{ label, key, desc }` — `key`는 `KeyboardEvent.code`. 모바일 버튼을 누르는 동안
그 키를 합성(hold). 배열 순서 = `[ACT1(우상), ACT2(우하=엄지 홈)]`.

---

## 2. 무기 (`public/weapons/`)

### `index.json` — 카탈로그
```jsonc
[
  { "id": "frequency-beam-heavy", "name": "중주파 빔 / HEAVY BEAM", "type": "beam" },
  { "id": "frequency-beam-light", "name": "경주파 빔 / LIGHT BEAM", "type": "beam" },
  { "id": "special-barrage",      "name": "다중 빔 살포 / BARRAGE", "type": "barrage" },
  { "id": "special-overdrive",    "name": "오버드라이브 / OVERDRIVE","type": "stream" }
]
```
`type`은 `"beam" | "barrage" | "stream"`. 기본무기는 드론별로 다르다(walker=heavy, flyer=light).
`WeaponSpec` 유니온 = `BeamSpec | BarrageSpec | StreamSpec`.

### `BeamSpec` (`type: "beam"`)
| 필드 | 의미 |
| :--- | :--- |
| `abbr` | 모바일/HUD 짧은 라벨 |
| `range` | 사거리 m |
| `color` | 빔 색 |
| `beamLifetime` | 빔 잔상 수명 s |
| `muzzleOffsets?` | 발사관 측면 오프셋 배열 m — 없으면 단발(`[0]`), `[-x,x]`면 듀얼 발사관(데미지는 **발사관당** 적용) |
| `manual{ damage, freqCost, fireInterval, assistConeDeg }` | 좌클릭 수동 사격(에임 어시스트 콘) |
| `auto{ damage, freqCost, fireInterval, range }` | 근거리 360° 오토파이어(콘 없음 — 최근접 소프트락) |
| `falloff{ refDist, maxMult, minMult }` | 거리 비례 위력(아래 [02](02-drones-weapons.md#데미지-모델)) |

오토와 수동은 **독립 쿨다운**으로 같은 프레임에 동시 발사 가능하다(`auto.coneDeg`는 360° 전환으로 제거됨).

### `BarrageSpec` (`type: "barrage"`)
| 필드 | 의미 |
| :--- | :--- |
| `abbr` | 짧은 라벨 |
| `maxBeams` | 동시 타깃(빔) 최대 수 |
| `coneDeg` | 전방 살포 콘 |
| `range` | 사거리 m |
| `cooldown` | 사용 종료 후 쿨다운 s |
| `drainRate` | 발동 중 초당 주파수 소모 |
| `salvoInterval` | 살포 간격 s |
| `salvoDamage` | 살포 1회 빔당 데미지 |
| `beamLifetime` | 빔 잔상 수명 s |
| `colorBeam`, `colorGlow` | 빔/글로우 색 |
| `falloff{ refDist, maxMult, minMult }` | 거리 비례 위력(특수는 일반보다 완만) |

### `StreamSpec` (`type: "stream"`)
오버드라이브 — 발동 시 게이지가 닳을 때까지 듀얼 발사관으로 전방 연속 사격.

| 필드 | 의미 |
| :--- | :--- |
| `abbr` | 짧은 라벨 |
| `range` | 사거리 m |
| `cooldown` | 사용 종료 후 쿨다운 s |
| `drainRate` | 발동 중 초당 주파수 소모 |
| `fireInterval` | 사격 간격 s |
| `damage` | 발사관당 타격(거리 falloff 적용) |
| `assistConeDeg` | 에임 어시스트 콘 |
| `muzzleOffsets` | 발사관 측면 오프셋 배열(듀얼) |
| `beamLifetime` | 빔 잔상 수명 s |
| `colorBeam`, `colorGlow` | 빔/글로우 색 |
| `falloff{ refDist, maxMult, minMult }` | 거리 비례 위력(특수는 일반보다 완만) |

특수무기(`barrage`/`stream`)는 공통 `SpecialWeapon` 인터페이스(update/reset/cooldownReady/
cooldownRemainingSec/isActive)로 구동되며, 쿨다운은 **게이지 소진(사용 종료) 후부터** 시작한다.

---

## 3. 적 (`public/enemies/`)

### `index.json` — 카탈로그
```jsonc
[ { "id": "plasmoid", "name": "플라즈모이드 / PLASMOID" } ]
```
`id`마다 `public/enemies/<id>.json` 상세 파일이 존재해야 한다.

### `<id>.json` — PlasmoidSpec
체력(밸런스)과 보이는 크기(연출)를 분리하는 "분리형" 모델. 색은 별 표면온도(K)에 묶인다.

| 필드 | 타입 | 의미 |
| :--- | :--- | :--- |
| `id`, `name` | string | 카탈로그 id / 표시명 |
| `hp.basePerArea` | number | 가장 낮은 색·지름 1m 기준 HP (`HP = basePerArea × 지름² × 색가중치`) |
| `hp.minDiameter` / `hp.maxDiameter` | number | 체력 산정용 지름 하한/상한 m |
| `color.stops[]` | `ColorStop[]` | 온도-색-가중치 기준점(저온 적색·최약 → 고온 청백·최강) |
| `visual.minDiameter` / `visual.maxDiameter` | number | 렌더 지름 하한 / 소프트캡 m |
| `visual.anchorHp` / `visual.anchorDiameter` | number | 앵커(이 HP일 때 이 렌더 지름)로 크기 곡선 역산 |
| `visual.exponent` | number | 크기 곡선 가파름(0.7~1.0, 클수록 보스가 거대) |
| `spawn.tempAlpha` | number | 온도 희귀도 지수 α (`f(T) ∝ T^-α`, 클수록 고온 희귀) |
| `spawn.speedMax` / `spawn.speedMin` | number | (레거시) 질량 모델 속도 — 현재 개체 속도는 아키타입 `speed`/`speedMin` 사용 |
| `spawn.hpFloor` / `spawn.hpCeil` | number | '강함' 정규화 하한/상한 HP |
| `contact.hpDamage` | number | 약체(s=0) 접촉 시 흡수 에너지 = 플레이어 HP 피해 = 적 회복량(러셔 전용) |
| `contact.strengthMul` | number | 강함 s=1 추가 배수 → `×(1+strengthMul·s)` |
| `archetypes.rusher` | `RusherArchetype` | 지상 돌격형(거머리) — 접근+접촉 흡수 |
| `archetypes.kiter` | `KiterArchetype` | 공중 도주형(모기) — 거리 유지+원거리 드레인 |

**`ColorStop`**: `{ temp(K), color("0xRRGGBB"), weight(체력 가중치, 최저색=1.0 기준) }`.

이동 난이도는 더 이상 고도에 의존하지 않는다 — 과거 `altitude` 블록과 `contact.altWeakRef/altWeakMin`는
제거됐다. 개체 행동은 드론과 무관한 **고유 아키타입**(`archetypes`)으로 정의한다.

**공통 베이스**(rusher·kiter 모두): `name`("국문 / ENGLISH" 표시명),
`spawnAltMin`/`spawnAltMax`(지면 대비 스폰 고도 밴드 m), `countBase`(웨이브1 동시 수, 매칭 드론 1인 기준),
`countCap`(웨이브 증가분 상한, 1인 기준), `killRefund`(처치 시 플레이어 HP 환수),
`speed`(가장 빠른=적색·약체 속도), `speedMin`(가장 느린=청백·강체 속도). 개체 속도 = `speed↔speedMin`를
색 강도 `colorStrength01`로 보간(적색=`speed`, 청백=`speedMin`). 물량은 매칭 드론 수에 비례(러셔=워커, 카이터=플라이어).

**`RusherArchetype`** = 베이스(추가 필드 없음 — 접근+접촉 흡수).

**`KiterArchetype`** (베이스 + ): `turnRateDeg`(선회 상한 °/s), `keepDist`(유지 적정거리 m),
`keepBand`(히스테리시스 반폭 m), `strafeMix`(`homeDir` 없을 때 폴백 거동: 1=접선 선회 / 0=도주), `orbitRef`(이 접선속도 m/s에서
선회 회피 최대), `evadeGain`(선회 감지 시 궤도면 이탈 강도), `attackRange`(원거리 드레인 사거리 m),
`drainDamage`(1틱 흡수량=플레이어 HP 피해=적 성장량), `drainInterval`(드레인 틱 간격 s). 개체별 무작위 `homeDir`(keepDist 구 위 방위)는 런타임 주입(스펙 아님).

순수 산출식(체력·색·렌더크기·속도·온도 샘플·아키타입 물량)은 [`PlasmoidSpec.ts`](../../src/enemies/PlasmoidSpec.ts)에
모듈로 분리되어 있고, 내장 `DEFAULT_PLASMOID`가 JSON과 동치임을 테스트가 검증한다.

---

## 4. 전장 (`public/maps/`)

### `index.json` — 카탈로그 (`MapCatalogEntry`)
`{ id, name, subtitle, bytes?, buildings?, lat?, lon? }`. `lat/lon`은 세계지도 점 표시용(equirectangular).

### `<id>.json` — MapData
| 필드 | 의미 |
| :--- | :--- |
| `id`, `name`, `subtitle` | 식별/표시 |
| `meta{ lat0, lon0, source }` | 투영 원점 + 출처(OSM ODbL) |
| `buildings: Ring[]` | 건물 윤곽(`p:[x,z,...]`, `h` 높이) |
| `roads: Ring[]` | 도로 폴리라인(`w` 폭) |
| `water: Ring[]` | 수역 폴리곤 |
| `boundary?: number[]` | 닫힌 경계 폴리곤(특수 권역/담장 기준) |
| `gates?` | 담장 개구부(문) `{x,z,r}[]` |
| `landmarks?: Landmark[]` | 데이터 구동 양식화 구조물(전부 `type:"structure"`) |
| `mountains?: Mountain[]` | 배경 산세(가우시안 봉우리 `{x,z,h,r}`) |
| `spawn?: { x, z, yaw }` | 플레이어 스폰(없으면 원점) |
| `precinct?: PrecinctSpec` | 경계 내부 특수 권역 양식(아래) |

### `PrecinctSpec` — 권역 일반화 (예: 궁궐 경내)
경계(`boundary`) 내부를 코드 분기 없이 데이터로 특수 처리한다.
```jsonc
"precinct": {
  "groundColor": "0xd49a3e",          // 포장 대신 맨땅 바닥색(예: 마사토)
  "suppressRoads": true,               // 권역 내 아스팔트/차선 제거
  "building": {
    "color": "0xcc5a28",               // 권역 건물 벽체색(단청 등)
    "maxHeight": 8,                    // 층고 상한
    "skipEnclosuresOver": 2000,        // 이 면적↑ 인클로저(마당 솔리드) 생략
    "roof": { "color": "0x3a5c82", "thickness": 1.4 }  // 옥상 슬래브(기와)
  },
  "wall": { "height": 4, "thickness": 0.9, "bodyColor": "0xc8b48c", "capColor": "0x3a5c82" }
}
```
`Landmark.excludeR`: 이 반경 안 OSM 건물을 생략하고 양식화 메시로 대체.

---

## 신규 콘텐츠 추가 (코드 수정 0)

- **드론**: `public/drones/<id>.json` 작성 + `index.json`에 한 줄. `mode`로 보행/비행 자동 분기.
- **무기**: `public/weapons/<id>.json` 작성 + `index.json`. 드론의 `weapons.{primary,special}`에서 참조.
- **적**: `public/enemies/<id>.json` 작성 + `index.json`. 체력·색·크기·속도가 데이터로 산출된다.
- **전장**: `public/maps/<id>.json` + `index.json`(lat/lon 포함). 특수 권역은 `precinct`로 기술.

추가 즉시 [`tests/specs.test.ts`](../../tests/specs.test.ts)가 필수 필드·교차참조(dangling 무기/맵 id)·
권역 스키마를 검증한다.
