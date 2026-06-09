// 실측 세계지도(Natural Earth 110m land, GeoJSON) 윤곽을 equirectangular 로 임베드.
// 대륙 path 는 자동 생성(worldLand.ts, scripts/gen-worldmap.mjs). 점(침공 지점)과 동일 투영(x=lon+180, y=90-lat).
import { LAND_PATH } from "./worldLand";

/** 위경도 → 지도 컨테이너 내 백분율 좌표(equirectangular). 점/팝업 배치 공통. */
export function projectLatLon(lat: number, lon: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * 100, y: ((90 - lat) / 180) * 100 };
}

/**
 * 세계지도 점 겹침 분리 — 근접 도시(서울·부산 등)가 같은 지점에 겹쳐 클릭 안 되는 것 방지.
 * 거리는 **width-% 단위**로 계산(지도 2:1 종횡비 반영 — y%는 px가 절반이라 ×aspect): minSep(width-%) 미만 쌍을
 * 반복적으로 밀어내 분리(실제 위치 근처 유지) [1,99]% 클램프. aspect=H/W(2:1 → 0.5). in-place. 순수.
 */
export function declusterDots(pts: Array<{ x: number; y: number }>, minSep = 2.6, aspect = 0.5): void {
  for (let iter = 0; iter < 24; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x, dy = (pts[j].y - pts[i].y) * aspect; // px 비례(width-%)
        const d = Math.hypot(dx, dy);
        if (d >= minSep) continue;
        if (d < 1e-4) { pts[i].x -= minSep / 2; pts[j].x += minSep / 2; moved = true; continue; } // 완전 겹침 → 가로로 분리
        const push = (minSep - d) / 2, ux = dx / d, uy = dy / d;
        pts[i].x -= ux * push; pts[i].y -= (uy * push) / aspect; // y 밀기는 y-% 로 환산
        pts[j].x += ux * push; pts[j].y += (uy * push) / aspect;
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const p of pts) { p.x = Math.min(99, Math.max(1, p.x)); p.y = Math.min(99, Math.max(1, p.y)); }
}

/** 시안 톤 세계지도(그리드 + 실측 대륙 윤곽). 정적 1회 생성. */
export function buildWorldSvg(): string {
  const W = 360, H = 180;
  const dim = "rgba(52,245,255,0.09)", main = "rgba(52,245,255,0.22)";
  let g = "";
  for (let lon = -150; lon <= 150; lon += 30) {
    const x = lon + 180, m = lon === 0;
    g += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${m ? main : dim}" stroke-width="${m ? 0.5 : 0.3}"/>`;
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = 90 - lat, m = lat === 0;
    g += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${m ? main : dim}" stroke-width="${m ? 0.5 : 0.3}"/>`;
  }
  const land = `<path d="${LAND_PATH}" fill="rgba(52,245,255,0.13)" stroke="rgba(120,245,255,0.62)" stroke-width="0.3" stroke-linejoin="round" fill-rule="evenodd"/>`;
  return (
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="rgba(6,18,28,0.5)"/>` +
    g + land + `</svg>`
  );
}
