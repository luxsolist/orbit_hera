# 07 · 빌드 · 테스트 · 툴링

## 스택 / 스크립트

- **Three.js**(WebGL2) + **Vite** + **TypeScript**(strict, `noUnusedLocals/Parameters`).
- 의존성: `three`. 개발: `vite`, `typescript`, `vitest`, `playwright`, `vite-plugin-javascript-obfuscator`.

| 스크립트 | 동작 |
| :--- | :--- |
| `npm run dev` | Vite 개발 서버(HMR) |
| `npm run build` | `tsc --noEmit` + `vite build` → `dist/` |
| `npm run typecheck` | 타입체크만 |
| `npm test` | Vitest 단위 1회 |
| `npm run test:watch` | Vitest watch |
| `npm run test:e2e` | `vite build` 후 Playwright 스모크 |

## 빌드 하드닝 (소스 보호) — [vite.config.ts](../../vite.config.ts)

공개 배포 시 원본 소스/데이터 노출을 줄인다:
- **`sourcemap: "hidden"`** — 소스맵은 생성하되 번들에 참조를 두지 않음(배포 안 하면 원본 비공개,
  내부 에러 추적엔 사용 가능).
- **난독화**(`apply: "build"`) — 우리 소스(`src/*`)만 식별자 리네임(hexadecimal) + 문자열 배열
  (base64, threshold 0.75). `node_modules`(three)·생성 데이터(`worldLand`)는 제외.
  controlFlowFlattening·selfDefending·debugProtection 등 위험/무거운 옵션은 **비활성**(기능/성능 보존).
- 데이터(`public/*.json`)는 정적 자산이라 그대로 노출됨 — 민감 로직은 데이터에 두지 않음.

## 테스트 스위트 (Vitest — 16파일 / 115테스트, node 환경)

핵심 로직을 **순수 함수로 빼서** 부수효과 없이 가드한다.

| 영역 | 파일 | 가드 |
| :--- | :--- | :--- |
| 플레이어 | `PlayerController` `spawn` | 점프 적분 · 비행/보행 스폰 높이 · 적 스폰 고도 분포 |
| 적 | `pursue` | 3D 추적(전 방향 동일 속도·정지거리·순수) |
| 무기 | `targeting` `WeaponSpec` | 콘 조준 선별 · 거리 비례 데미지 |
| 모바일 | `mobileJoystick` | 데드존·8방향·속도 4단계 |
| 월드 | `CollisionWorld` `SpatialGrid` `terrainField` `precinct` `geo` `StructureBuilder` | 충돌/격자/지형 질의/권역 양식/지오 유틸/랜드마크 |
| 데이터 | `specs` | 드론·무기·맵 JSON 필수 필드 + 교차참조 + 권역 스키마 |
| 투영/데이터 | `worldMap` `osm` `introHelpers` | equirectangular 투영 · OSM 변환(scripts/osm.mjs) · 컷씬 헬퍼 |

> 데이터 검증(`specs.test.ts`)은 tsc가 못 보는 `public/*.json`의 누락/오타/dangling 참조(무기·맵 id)와
> 권역 스키마를 빌드 타임에 차단한다.

## e2e 스모크 — [tests/e2e/smoke.mjs](../../tests/e2e/smoke.mjs)

빌드 산출물을 Playwright로 띄워 **4개 전장 전부**를 실제 로드/플레이하며 검증:
1. 콘솔/페이지 에러 0
2. 게임 `playing` 진입(오버레이 숨김) — 세계지도 점 클릭 → 팝업 드론 버튼 → 출격 경로
3. 미니맵 렌더됨(프레임 루프 동작)
4. 메인 WebGL 화면이 블랙이 아님(스크린샷 PNG 크기 휴리스틱)

단위 테스트가 못 잡는 **렌더/블랙스크린 회귀**를 가드(인트로 재생·메뉴 복귀 경로 포함).

## 데이터 생성 스크립트

- [`scripts/gen-worldmap.mjs`](../../scripts/gen-worldmap.mjs) — Natural Earth 110m land(퍼블릭
  도메인) GeoJSON → equirectangular SVG 경로 → `src/ui/worldLand.ts`. 재생성: `node scripts/gen-worldmap.mjs`.
- [`scripts/osm.mjs`](../../scripts/osm.mjs) — OSM 원시 데이터 → 로컬 미터 투영 + 건물 높이/도로 폭/
  폴리곤 면적 산출(맵 JSON 빌드 유틸). 순수 함수는 `osm.test.ts`가 가드.
