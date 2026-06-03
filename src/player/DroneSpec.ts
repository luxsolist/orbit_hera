// 전투 드론 스펙 — 기체별 세부 설정을 데이터(JSON)로 외부화한다.
// 보행/비행 등 이동 형태(mode)와 기체 치수·바이탈·시야·대시를 한 곳에 기술해,
// 새 드론은 src/ 수정 없이 public/drones/<id>.json 추가만으로 도입한다.

/** 보행 드론 점프/중력 스펙(상승 감속 → 하강 가속 → 종단속도 유지). */
export interface JumpSpec {
  velocity: number; // 점프 초기 상승 속도
  riseGravity: number; // 상승 감속(정점까지 속도 감소)
  fallGravity: number; // 하강 가속(점점 빨라짐)
  fallTerminal: number; // 종단(일정한 낙하) 속도
  maxRiseHeight: number; // 디딘 지면 대비 이 높이 이상이면 추가 점프 금지
  coyoteTime: number; // 발판 이탈 직후 점프 허용 유예
}

/** 보행 이동 — 지면/중력/점프. */
export interface WalkMove {
  mode: "walk";
  speed: number; // 목표 수평 속도
  groundAccel: number; // 지상 가감속 응답(클수록 빠릿)
  airAccel: number; // 공중 응답(관성)
  jump: JumpSpec;
}

/** 비행 이동 — 무중력 호버, 수직 추력으로 상승/하강. */
export interface FlyMove {
  mode: "fly";
  speed: number; // 목표 수평 속도
  accel: number; // 수평·수직 가감속 응답
  verticalSpeed: number; // 상승/하강 목표 속도(Space=상승, Ctrl/C=하강)
  ceiling: number; // 디딘 지면 대비 최대 비행 고도
  rollDeg: number; // 좌우 이동 시 최대 롤(뱅킹) 각도(도)
  spawnHeight: number; // 스폰 시 지면 대비 시작 고도(m) — 공중 투입
}

export type DroneMove = WalkMove | FlyMove;

/**
 * 모바일 동작 버튼(우하단 클러스터 하단 행). 누르는 동안 key 를 합성(hold)한다.
 * PlayerController 가 그 key 를 보행/비행 로직에서 읽음 — 예: 점프=Space(탭), 상승=Space(홀드),
 * 점프/상승=Space, 대시/하강=ShiftLeft(보행=대시 · 비행=하강). 배열 순서 = [ACT1(우상), ACT2(우하=엄지 홈)].
 */
export interface ActionButton {
  label: string; // 버튼 표시(텍스트/아이콘, 예 "JUMP" "▲")
  key: string; // 합성할 키 코드(KeyboardEvent.code)
  desc: string; // 조작 안내용 설명(예 "점프" "상승")
}

/** 전투 드론 1기의 전체 스펙. */
export interface DroneSpec {
  id: string;
  name: string; // HUD 유닛명(짧게)
  displayName: string; // 표시명(목록용)
  body: { eyeHeight: number; radius: number }; // 시점 높이 / 충돌 반경
  vitals: { maxHp: number; maxFreq: number; freqRegen: number };
  view: { fov: number; mouseSensitivity: number };
  dash?: { speed: number; duration: number; cooldown: number }; // 없으면 대시 불가(예: 비행 드론)
  move: DroneMove;
  actions: ActionButton[]; // 모바일 동작 버튼(최대 2개)
  weapons: { primary: string; special: string }; // 무기 스펙 id 참조(public/weapons/<id>.json)
}

/** 드론 카탈로그(선택 UI/관리용) 항목. */
export interface DroneCatalogEntry {
  id: string;
  name: string;
  displayName: string;
  mode: DroneMove["mode"];
}
