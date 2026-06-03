# 01 · 데이터 스키마 (JSON 데이터 계약)

SEED의 전투 드론·무기·전장은 모두 **런타임에 내려받는 JSON**으로 정의된다(`src/` 수정 없이
파일 추가만으로 콘텐츠 확장). 이 문서는 그 데이터 계약(스키마)을 정의한다.

- 모든 색은 `"0xRRGGBB"` 문자열(런타임에 `Number(...)`로 파싱).
- 좌표는 로컬 미터(1 unit = 1m, 북 = −Z, 원점 = `meta.lat0/lon0`).
- 스키마 검증은 [`tests/specs.test.ts`](../../tests/specs.test.ts)가 빌드 타임에 고정한다.

소스 타입: [`src/player/DroneSpec.ts`](../../src/player/DroneSpec.ts) ·
[`src/weapons/WeaponSpec.ts`](../../src/weapons/WeaponSpec.ts) ·
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
`rollDeg`(좌우 이동 뱅킹 각), `spawnHeight`(지면 대비 스폰 고도, ceiling 내로 클램프).

**`ActionButton`**: `{ label, key, desc }` — `key`는 `KeyboardEvent.code`. 모바일 버튼을 누르는 동안
그 키를 합성(hold). 배열 순서 = `[ACT1(우상), ACT2(우하=엄지 홈)]`.

---

## 2. 무기 (`public/weapons/`)

### `index.json` — 카탈로그
```jsonc
[
  { "id": "frequency-beam", "name": "주파수 빔 / FREQUENCY BEAM", "type": "beam" },
  { "id": "special-barrage","name": "다중 빔 살포 / BARRAGE",    "type": "barrage" }
]
```
`type`은 `"beam" | "barrage"`.

### `BeamSpec` (`type: "beam"`)
| 필드 | 의미 |
| :--- | :--- |
| `abbr` | 모바일/HUD 짧은 라벨 |
| `range` | 사거리 m |
| `color` | 빔 색 |
| `beamLifetime` | 빔 잔상 수명 s |
| `manual{ damage, freqCost, fireInterval, assistConeDeg }` | 좌클릭 수동 사격(에임 어시스트 콘) |
| `auto{ damage, freqCost, fireInterval, range, coneDeg }` | 근거리 자동발사 |
| `falloff{ refDist, maxMult, minMult }` | 거리 비례 위력(아래 [02](02-drones-weapons.md#데미지-모델)) |

### `BarrageSpec` (`type: "barrage"`)
| 필드 | 의미 |
| :--- | :--- |
| `abbr` | 짧은 라벨 |
| `maxBeams` | 동시 타깃(빔) 최대 수 |
| `coneDeg` | 전방 살포 콘 |
| `range` | 사거리 m |
| `cooldown` | 발동 쿨다운 s |
| `drainRate` | 발동 중 초당 주파수 소모 |
| `salvoInterval` | 살포 간격 s |
| `salvoDamage` | 살포 1회 빔당 데미지 |
| `beamLifetime` | 빔 잔상 수명 s |
| `colorBeam`, `colorGlow` | 빔/글로우 색 |

---

## 3. 전장 (`public/maps/`)

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
- **전장**: `public/maps/<id>.json` + `index.json`(lat/lon 포함). 특수 권역은 `precinct`로 기술.

추가 즉시 [`tests/specs.test.ts`](../../tests/specs.test.ts)가 필수 필드·교차참조(dangling 무기/맵 id)·
권역 스키마를 검증한다.
