# 워커 스킨 에셋

스킨은 `android-01` 모델의 형상·관절·애니메이션과 분리된 JSON 에셋이다.
`public/models/skins/walker/index.json`이 목록 및 기본값을 지정한다.

| ID | 이름 | 외형 |
|---|---|---|
| obsidian | 옵시디언 | 흑연 장갑, 금속 패널, 적색 센서 |
| polar | 폴라리스 | 백색 세라믹 장갑, 주황 패널, 청색 센서 |
| dune | 듄 센티널 | 모래색 무광 장갑, 올리브 패널, 녹색 센서 |

## 코드 구조

- `src/assets/WalkerSkin.ts`: 스키마·검증·카탈로그 로더·PBR 재질 적용.
- `src/assets/WalkerMech.ts`: 형상과 관절 생성, 이름이 고정된 6개 재질 슬롯 소유.
- `src/assets/WalkerThrusters.ts`: 노즐 장착부는 워커의 steel 재질을 빌려 사용한다.
- `src/assets/WalkerPreview.ts`: 스킨 선택, 현재 스킨으로 GLB 내보내기.

```ts
const catalog = await loadWalkerSkins();
const skin = catalog.skins.find(s => s.id === 'polar')!;
const mech = new WalkerMech({ skin });
mech.applySkin(catalog.skins.find(s => s.id === 'dune')!);
const bytes = await exportWalkerGLB({ skin });
```

`applySkin`은 검증을 마친 뒤 기존 재질 객체만 변경한다. 관절, 현재 포즈, 메시 배치,
기본 형상을 재생성하지 않는다. 스킨 소유 장식은 교체하고 스킨의 미세 roughness 텍스처를 적용한다. 인스턴스마다 재질을 소유하므로 다른
워커에는 영향을 주지 않는다. 빌려 쓰는 노즐 재질은 워커만 해제한다.

## 에셋 계약

스키마 버전 1, modelId `android-01`. 필수 슬롯:
`armor`, `trim`, `frame`, `steel`, `accent`, `sensor`.
각 슬롯은 `color` (#RRGGBB), `roughness` (0~1), `metalness` (0~1)를 갖는다.
선택값 `emissive`와 `emissiveIntensity` (0~10)는 생략하면 검정·0이다.
색상은 sRGB로 정의하고 Three.js가 선형 렌더링 색상으로 변환한다.
현재 예제는 PBR 색상·표면 특성 스킨이며, 기존 미세 표면 텍스처를 유지한다.

새 스킨은 기존 JSON을 복사하고 고유 id와 6개 슬롯을 수정한 뒤 index.json에
등록한다. 코드나 GLB 형상을 복제할 필요가 없다. 잘못된 버전·모델·색상·수치는
적용 전에 거부한다. 원본 옵션의 armorColor/trimColor도 유지하되 skin이 있으면
스킨이 우선한다.

GLB 내보내기에는 선택한 스킨의 PBR 재질과 기본 애니메이션이 포함된다.
재질 이름 `walker.<slot>`과 extras의 `skinSlot`, 루트 extras의 `skinId`를 통해
외부 도구에서도 부위를 식별할 수 있다. 로딩된 GLB를 별도 런타임에서 스킨 교체할
때는 이 슬롯으로 재질을 모아 `applyWalkerSkin`에 전달한다. 복제된 장면이 재질을
공유한다면 먼저 재질을 복제하여 인스턴스 간 도색 간섭을 방지한다.


## 스킨 소유 장식 (v5)

`WalkerMech()`는 장식 없는 기본형이며 카탈로그 기본 선택은 `base`다.
`mech.clearSkin()`은 무채색 외피로 되돌리고 모든 장식 메시를 해제한다.
골격·관절·외피·기능 부품은 WalkerMech, 표면 장식은 WalkerGarnish가 소유한다.

JSON의 `garnish` 배열로 장식 종류를 선택한다:
- `panels`: 외피 위의 보조 패널과 가니쉬
- `vents`: 표면 방열 슬릿
- `markings`: 식별 줄무늬
- `fasteners`: 노출 볼트

옵시디언은 panels/vents/fasteners/footGuards/weaponPods, 폴라리스는 panels/markings,
듄 센티널은 vents/markings/fasteners/weaponPods를 사용한다. 빈 배열이면 도색만 적용한다.
장식은 관절에 붙은 `skin_garnish` 하위에 별도 배치되며 기본 메시와 합치지 않는다.
장식 교체 시 기본 관절과 현재 포즈는 유지한다. GLB는 현재 선택에 따라 기본형
또는 장식이 포함된 스킨형으로 내보낸다. 기존 applyWalkerSkin 함수는 재질만
변경하므로 장식까지 교체하려면 WalkerMech.applySkin을 사용한다.

### 발과 무기 부착물

기본 발은 앞쪽 중앙 틈이 없는 일체형 외피다. 앞쪽 양옆의 검은 부품은 `footGuards`, 무기 외측의 검은 박스는 `weaponPods` 옵션으로 스킨에만 포함된다.
옵시디언은 두 옵션 모두, 듄은 무기 박스만 사용하며 폴라는 둘 다 사용하지 않는다. 스킨을 해제하면 부착물도 제거된다.
