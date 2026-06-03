// OSM → 로컬 미터 가공의 순수 헬퍼(부수효과 없음). build-maps.mjs 와 테스트가 공유.

/** lat0/lon0 원점의 등거 투영기 — (lat,lon) → [x,z] 미터(북=-Z), cm 정밀도 반올림. */
export function projFns(lat0, lon0) {
  const M_LAT = 111320;
  const M_LON = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return (lat, lon) => [
    Math.round((lon - lon0) * M_LON * 100) / 100,
    Math.round(-(lat - lat0) * M_LAT * 100) / 100,
  ];
}

/** OSM building 태그 → 높이(m). height > building:levels > 종류별 기본. */
export function buildingHeight(t = {}) {
  if (t.height) {
    const v = parseFloat(String(t.height).replace(/[^\d.]/g, ""));
    if (v > 0) return Math.round(v * 10) / 10;
  }
  if (t["building:levels"]) {
    const v = parseFloat(t["building:levels"]);
    if (v > 0) return Math.round(Math.max(3, v * 3.3) * 10) / 10;
  }
  const b = t.building;
  if (b === "hut" || b === "shed" || b === "roof") return 3;
  if (b === "temple" || b === "shrine" || b === "palace" || b === "pavilion") return 7;
  if (b === "house" || b === "detached" || b === "hanok") return 6;
  return 9;
}

/** highway 종류 → 도로 폭(m). 미지정은 6. */
export const roadWidth = (hw) =>
  ({ motorway: 26, trunk: 24, primary: 28, secondary: 16, tertiary: 11, residential: 7, living_street: 6, pedestrian: 9 }[hw] || 6);

/** 평면 폴리곤 [x0,z0,x1,z1,...] 의 넓이(shoelace, 절댓값). */
export function ringArea(p) {
  let a = 0;
  for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++)
    a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  return Math.abs(a) / 2;
}
