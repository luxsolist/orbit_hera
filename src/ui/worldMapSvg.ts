// 실측 세계지도(Natural Earth 110m land, GeoJSON) 윤곽을 equirectangular 로 임베드.
// 대륙 path 는 자동 생성(worldLand.ts, scripts/gen-worldmap.mjs). 점(침공 지점)과 동일 투영(x=lon+180, y=90-lat).
import { LAND_PATH } from "./worldLand";

/** 위경도 → 지도 컨테이너 내 백분율 좌표(equirectangular). 점/팝업 배치 공통. */
export function projectLatLon(lat: number, lon: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * 100, y: ((90 - lat) / 180) * 100 };
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
