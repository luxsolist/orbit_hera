// 얽힘 택소노미 — 랜드마크를 "인간 관측·얽힘 누적" 유형으로 분류한다(순수, THREE/DOM 비의존).
// 정본: docs/spec/06-missions.md §8(공개 규칙) · 서사편 §5(⚠️ 심층 독해).
// 규칙: 적의 수확 우선순위 지도(씨앗 장 분포) = 인간의 관측·얽힘 누적 열지도. 이 분류가
// 미션 표적 선정·해제 저항 보정·브리핑 문구의 단일 출처가 된다. 신규 도시는 수동 지정(cls)
// 또는 OSM 태그 자동 분류(classifyOsmTags)로 편입 — 파이프라인(build-maps)이 통과시킨다.
// 표면 어휘 주의(서사편 §8.1): 표시명·브리핑은 얽힘·기억·관측·결맞음·의례만 사용.

/** 얽힘 유형 식별자(내부 id — 코드/데이터 전용). */
export type EntanglementClass =
  | "deep-roots" //  오래 선 자리 — 관측 누적(구시가·궁·성곽)
  | "ritual" //      의례의 자리 — 반복 측정의 안정화(종교시설·오래된 시장)
  | "archive" //     기억의 응축고 — 얽힘 잔향의 집적(박물관·도서관)
  | "resonance" //   결맞음의 광장 — 거시 위상 동기(광장·경기장·공연장)
  | "relay" //       이음의 탑 — 원격 얽힘 증폭 노드(방송탑·역·항구·등대)
  | "memorial"; //   추모의 자리 — 소멸을 동결하는 지속 관측(위령비·묘지)

/** 유형별 메타 — 표시명/브리핑(표면 어휘)·미션 힌트·해제 저항 배율(🔭 적용 예정 노브). */
export interface EntanglementClassMeta {
  cls: EntanglementClass;
  name: string; // 표시명(HUD/도감/브리핑 헤더) — 표면 어휘만
  brief: string; // 브리핑 템플릿 한 줄 — 세계관 통로(표면 어휘만)
  missionHint: string; // 이 유형이 주로 걸리는 미션 성격(06-missions §3 참조용 메모)
  resistMul: number; // 해제 저항 — 랜드마크 HP/재안착 보정 배율(🔭 BuildingCombat 적용 예정)
  dissolveResist: boolean; // 함락 연출에서 마지막까지 형태 유지(디졸브/강등 저항 — 아트 규칙 🔭)
}

export const ENTANGLEMENT_CLASSES: Record<EntanglementClass, EntanglementClassMeta> = {
  "deep-roots": {
    cls: "deep-roots",
    name: "오래 선 자리",
    brief: "오래 머문 자리일수록 얽힘이 짙다 — 그들이 먼저 노린다.",
    missionHint: "방어(패턴 15) — 도시 최우선 표적",
    resistMul: 1.5,
    dissolveResist: true,
  },
  ritual: {
    cls: "ritual",
    name: "의례의 자리",
    brief: "의례가 계속되는 한 이 자리는 흔들리지 않는다 — 의례를 지켜라.",
    missionHint: "방어 — 해제 저항 최고(같은 관측의 반복이 자리를 붙든다)",
    resistMul: 1.6,
    dissolveResist: true,
  },
  archive: {
    cls: "archive",
    name: "기억의 응축고",
    brief: "아무것도 정말로 사라진 적 없다 — 여기 보관되어 있는 한.",
    missionHint: "방어 — 상실 시 서사 비용 최대(응축된 얽힘의 일괄 해제)",
    resistMul: 1.4,
    dissolveResist: true,
  },
  resonance: {
    cls: "resonance",
    name: "결맞음의 광장",
    brief: "수만이 한 박자로 뛰던 자리다 — 결맞음은 그들의 표적이자 우리의 무기다.",
    missionHint: "협동 공명(공명 파티) 무대 — MP 미션 우선 배치",
    resistMul: 1.2,
    dissolveResist: false,
  },
  relay: {
    cls: "relay",
    name: "이음의 탑",
    brief: "만난 적 없는 이들을 이어온 자리다 — 끊기면 도시의 얽힘이 옅어진다.",
    missionHint: "방어 — 상실 시 후속 미션 얽힘 밀도 하락(메타 루프 연동 🔭)",
    resistMul: 1.0,
    dissolveResist: false,
  },
  memorial: {
    cls: "memorial",
    name: "추모의 자리",
    brief: "기억하는 한 사라지지 않는다 — 이 자리가 그 증거다.",
    missionHint: "방어 — 관측 고정(W1)과 같은 물리의 인간 편",
    resistMul: 1.3,
    dissolveResist: true,
  },
};

/**
 * OSM 태그 → 얽힘 유형 자동 분류(순수). 전 세계 도시 공통 태그만 사용 — 신규 도시를
 * 파이프라인에 넣으면 랜드마크 후보가 자동 분류된다. 해당 없으면 null(일반 건물).
 * 우선순위: 추모(가장 구체) → 의례 → 응축고 → 결맞음 → 이음 → 오래 선 자리(가장 포괄).
 */
export function classifyOsmTags(tags: Record<string, string | undefined>): EntanglementClass | null {
  const t = tags;
  // 추모 — 위령비·기념비·묘지(historic=memorial|monument 는 deep-roots 보다 먼저)
  if (t.historic === "memorial" || t.historic === "monument") return "memorial";
  if (t.landuse === "cemetery" || t.amenity === "grave_yard") return "memorial";
  // 의례 — 종교시설(현역 의례 지속)
  if (t.amenity === "place_of_worship" || t.building === "temple" || t.building === "church" || t.building === "mosque")
    return "ritual";
  // 응축고 — 박물관·도서관·기록관
  if (t.tourism === "museum" || t.amenity === "library" || t.amenity === "archive") return "archive";
  // 결맞음 — 광장·경기장·대공연장
  if (t.place === "square" || t.leisure === "stadium" || t.building === "stadium" || t.amenity === "theatre")
    return "resonance";
  // 이음 — 통신탑·등대·역·공항·항구(원격 얽힘 노드)
  if (t.man_made === "tower" || t.man_made === "communications_tower" || t.man_made === "lighthouse") return "relay";
  if (t.railway === "station" || t.aeroway === "terminal" || t.amenity === "ferry_terminal") return "relay";
  // 오래 선 자리 — 그 외 모든 사적·유산(포괄 폴백)
  if (t.historic !== undefined || t.heritage !== undefined || t.building === "castle" || t.building === "palace")
    return "deep-roots";
  return null;
}
