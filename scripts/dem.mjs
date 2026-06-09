// 실측 DEM(AWS Terrarium 타일) 처리 순수 헬퍼 — build-terrain.mjs 와 테스트가 공유(부수효과 없음).
// 좌표/디코드 버그는 지형 전체를 조용히 어긋나게 하므로 단위 테스트로 고정한다.
import zlib from "node:zlib";

/** Terrarium RGB → 표고(m). elevation = R*256 + G + B/256 − 32768. */
export const terrariumElev = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** 분리형 형태학 패스(1D 가로 → 1D 세로, 정사각 커널). op=Math.min(침식)/Math.max(팽창). 가장자리 클램프. */
export function morphPass(grid, size, r, op) {
  const tmp = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = grid[y * size + x];
    for (let k = -r; k <= r; k++) { const xx = x + k < 0 ? 0 : x + k >= size ? size - 1 : x + k; v = op(v, grid[y * size + xx]); }
    tmp[y * size + x] = v;
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = tmp[y * size + x];
    for (let k = -r; k <= r; k++) { const yy = y + k < 0 ? 0 : y + k >= size ? size - 1 : y + k; v = op(v, tmp[yy * size + x]); }
    out[y * size + x] = v;
  }
  return out;
}

/** 분리형 박스 블러(평균) 반경 r. */
export function boxBlur(grid, size, r) {
  if (r <= 0) return grid.slice();
  const tmp = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < size) { s += grid[y * size + xx]; n++; } }
    tmp[y * size + x] = s / n;
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < size) { s += tmp[yy * size + x]; n++; } }
    out[y * size + x] = s / n;
  }
  return out;
}

/**
 * DSM(건물·수목 포함 표면) → bare-earth 근사. 형태학적 열림(침식→팽창, openR)으로 커널보다 좁은
 * 밝은 스파이크(건물)를 제거하고 박스 블러(blurR)로 계단 완화. 넓은 산세는 보존. 순수.
 */
export function bareEarth(grid, size, openR = 4, blurR = 2) {
  let g = morphPass(grid, size, openR, Math.min); // 침식 — 건물 스파이크 제거(지면 레벨로)
  g = morphPass(g, size, openR, Math.max);        // 팽창 — 지형 가장자리 복원(= 열림)
  return boxBlur(g, size, blurR);
}

/** 점(x,z)이 폴리곤 p([x,z,...]) 내부인지 — ray casting. 순수. */
export function pointInPoly(x, z, p) {
  let inside = false; const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

/**
 * 건물 풋프린트 아래 지형만 평탄화 — 도시(건물 DSM 스파이크)는 제거하되 **산·공원 등은 원본 보존**.
 * 마스크된 셀(건물 내부)은 형태학적 침식값(주변 지면 최저)으로 치환, 그 외는 raw. 전역 격자라 청크 이음매 일관. 순수.
 * buildings: [{p:[mapX,mapZ,...]}] (맵-로컬). gOrigin/gStep: DEM 격자 원점·간격(맵-로컬). 반환: 새 Float32Array.
 */
export function flattenUnderBuildings(H, size, buildings, gOrigin, gStep, openR = 4) {
  if (!buildings || !buildings.length) return H;
  const E = morphPass(H, size, openR, Math.min); // 침식 = 주변 지면 최저
  const mask = new Uint8Array(size * size);
  const g = (v) => (v - gOrigin) / gStep;
  for (const b of buildings) {
    const p = b.p; if (!p || p.length < 6) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < z0) z0 = p[i + 1]; if (p[i + 1] > z1) z1 = p[i + 1]; }
    const gx0 = Math.max(0, Math.floor(g(x0))), gx1 = Math.min(size - 1, Math.ceil(g(x1)));
    const gz0 = Math.max(0, Math.floor(g(z0))), gz1 = Math.min(size - 1, Math.ceil(g(z1)));
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      if (pointInPoly(gOrigin + gx * gStep, gOrigin + gz * gStep, p)) mask[gz * size + gx] = 1;
    }
  }
  const out = new Float32Array(H.length);
  for (let i = 0; i < H.length; i++) out[i] = mask[i] ? E[i] : H[i];
  return out;
}

/** 위경도 → 웹 메르카토르 전역 픽셀(줌 z, 타일 256px). 순수. */
export const lonToPx = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z) * 256;
export const latToPx = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z) * 256;
};

/**
 * 최소 PNG 디코더 — 8bit RGB/RGBA/Gray, non-interlaced(terrarium). CRC 미검증.
 * → {width,height,ch,data:Buffer}. zlib 내장만 사용(외부 의존 없음).
 */
export function decodePNG(buf) {
  let p = 8; // 시그니처 스킵
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len; // 길이필드(4) + 타입(4) + 데이터(len) + CRC(4)
  }
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 0;
  if (bitDepth !== 8 || !ch) throw new Error(`unsupported PNG bitDepth=${bitDepth} colorType=${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[rp++]; // 스캔라인 필터 타입
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;               // 좌
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;                // 상
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0; // 좌상
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error("bad PNG filter " + f);
      out[y * stride + x] = r & 0xff;
    }
  }
  return { width, height, ch, data: out };
}
