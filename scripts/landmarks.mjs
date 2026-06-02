// 랜드마크 "레시피" — 빌드타임에 양식화 메시를 부품 목록(parts)으로 emit.
// 런타임(World.buildStructure)은 데이터를 공통 로직으로 그릴 뿐, 타입별 코드가 없다.
// 좌표는 로컬(랜드마크 원점 기준). 배치(x,z,rot)는 맵 config 에서 적용.
const PI = Math.PI;
const r2 = (v) => Math.round(v * 100) / 100;
const round3 = (a) => a.map(r2);

// 지붕 양식은 데이터로(런타임 hiproof 는 양식 무지). 한국식 팔작: 긴 용마루+마루+망새.
const KR_ROOF = { ridge: 0.6, cap: 0.13, fin: 1.7 };
// 일본식: 짧은 용마루(우진각풍) + 강한 처마 들림(反り), 용마루 마루/망새 없음.
const JP_ROOF = { ridge: 0.34, up: 0.9 };

// ── 한옥 전각 부품(기단+회벽+열주+판문+단청띠+팔작지붕). 재질 인덱스 규약:
//    0 stone, 1 wood, 2 wall, 3 dancheong, 4 tile(지붕), 5 door. ox/oz 만큼 평면 이동. ──
function hallParts(parts, opts, baseY, ox = 0, oz = 0) {
  const { bodyW, bodyD, bodyH } = opts;
  const platformH = opts.platformH ?? 1.6;
  const roofH = opts.roofH ?? Math.max(bodyW, bodyD) * 0.55;
  const box = (s, p, m) => parts.push({ g: "box", s: round3(s), p: round3([p[0] + ox, p[1], p[2] + oz]), m });
  box([bodyW * 2 + 3, platformH, bodyD * 2 + 3], [0, baseY + platformH / 2, 0], 0);
  box([bodyW * 2, bodyH, bodyD * 2], [0, baseY + platformH + bodyH / 2, 0], 2);
  const ncols = Math.max(2, Math.round((bodyW * 2) / 3.2) + 1);
  for (let i = 0; i < ncols; i++) {
    const px = -bodyW + 0.4 + ((bodyW - 0.4 - (-bodyW + 0.4)) * i) / (ncols - 1);
    for (const sz of [-1, 1])
      parts.push({ g: "cyl", rt: 0.42, rb: 0.48, h: bodyH, seg: 8, p: round3([px + ox, baseY + platformH + bodyH / 2, sz * (bodyD + 0.5) + oz]), m: 1 });
  }
  box([Math.min(bodyW, 3.2), bodyH * 0.78, 0.4], [0, baseY + platformH + (bodyH * 0.78) / 2, bodyD + 0.05], 5);
  box([bodyW * 2 + 0.6, 0.8, bodyD * 2 + 0.6], [0, baseY + platformH + bodyH + 0.4, 0], 3);
  const roof = (W, D, H, y) => parts.push({ g: "hiproof", W: r2(W), D: r2(D), H: r2(H), ...KR_ROOF, p: round3([ox, y, oz]), m: 4 });
  if (opts.doubleRoof) {
    roof(bodyW + 2.4, bodyD + 2.4, roofH * 0.55, baseY + platformH + bodyH + 0.8);
    roof(bodyW + 1.0, bodyD + 1.0, roofH * 0.7, baseY + platformH + bodyH + 0.8 + roofH * 0.5);
  } else {
    roof(bodyW + 2.2, bodyD + 2.2, roofH, baseY + platformH + bodyH + 0.8);
  }
}

// 한옥 표준 재질(0~5). 일부 레시피는 4(tile) 등을 바꿔 쓴다.
const M_STONE = { c: "ada793", rough: 0.95, flat: true };
const M_WOOD = { c: "a53e2c", rough: 0.8, flat: true };
const M_WALL = { c: "e8e2d2", rough: 0.9, flat: true };
const M_DANCHEONG = { c: "2f8159", rough: 0.7, flat: true };
const M_TILE = { c: "37414d", rough: 0.85, flat: true };
const M_DOOR = { c: "241712", rough: 0.9, flat: true };
const HALL_MATS = [M_STONE, M_WOOD, M_WALL, M_DANCHEONG, M_TILE, M_DOOR];

// 다리 공통: 데크 + 난간 + 교각/반원 아치. deckM/pierM 은 재질 인덱스.
function bridgeBaseParts(parts, len, width, deckY, spans, archR, deckM, pierM) {
  const box = (s, p, m) => parts.push({ g: "box", s: round3(s), p: round3(p), m });
  box([len, 2, width], [0, deckY, 0], deckM);
  for (const sz of [-1, 1]) box([len, 1.4, 0.8], [0, deckY + 1.6, (sz * width) / 2], deckM);
  for (let i = 0; i <= spans; i++) {
    const x = -len / 2 + (i / spans) * len;
    box([4, deckY, width * 0.92], [x, deckY / 2 - 1, 0], pierM);
    if (i < spans)
      parts.push({ g: "cyl", rt: archR, rb: archR, h: width, seg: 16, tl: PI, ry: PI / 2, rz: PI / 2, p: round3([x + len / spans / 2, deckY - 1.5, 0]), m: pierM });
  }
}

// ───────────────────────────── 경복궁 ─────────────────────────────

function geunjeongjeon() {
  const parts = [
    { g: "box", s: [34, 1.4, 30], p: [0, 0.7, 0], m: 0 },
    { g: "box", s: [26, 1.4, 22], p: [0, 2.1, 0], m: 0 },
  ];
  hallParts(parts, { bodyW: 9, bodyD: 7, bodyH: 7, platformH: 1.2, roofH: 10, doubleRoof: true }, 2.8);
  return { mats: HALL_MATS, parts, colliders: [{ x: 0, z: 0, r: 16, top: 2.8 }, { x: 0, z: 0, r: 11, top: 18 }], excludeR: 30 };
}

function gwanghwamun() {
  // 재질: 0~5 한옥 표준 + 6 피어석(a9a290) + 7 해태석(979187)
  const mats = [...HALL_MATS, { c: "a9a290", rough: 0.95, flat: true }, { c: "979187", rough: 0.95, flat: true }];
  const parts = [];
  const baseHalf = 15, archHalf = 2.1, depth = 9;
  const archX = [-8.5, 0, 8.5];
  const edges = [-baseHalf];
  for (const a of archX) edges.push(a - archHalf, a + archHalf);
  edges.push(baseHalf);
  const boxColliders = [];
  for (let i = 0; i < edges.length; i += 2) {
    const xa = edges[i], xb = edges[i + 1];
    parts.push({ g: "box", s: round3([xb - xa, 7, depth]), p: round3([(xa + xb) / 2, 3.5, 0]), m: 6 });
    boxColliders.push({ x0: r2(xa), x1: r2(xb), z0: -depth / 2, z1: depth / 2 });
  }
  for (const a of archX) parts.push({ g: "box", s: [archHalf * 2, 2, depth], p: [a, 6, 0], m: 6 });
  hallParts(parts, { bodyW: 12, bodyD: 3.4, bodyH: 5, platformH: 0.8, roofH: 7, doubleRoof: true }, 7);
  for (const ox of [-13, 13]) {
    parts.push({ g: "box", s: [2, 1.6, 3], p: [ox, 0.8, 8], m: 7 });
    parts.push({ g: "box", s: [1.4, 1.4, 1.4], p: [ox, 1.9, 9], m: 7 });
  }
  return { mats, parts, boxColliders, excludeR: 24 };
}

function gyeonghoeru() {
  const mats = [
    { c: "3f76e4", rough: 0.25, metal: 0.3, opacity: 0.82 }, // 0 water
    { c: "a9a290", rough: 0.95, flat: true }, // 1 rim stone
    { c: "ada793", rough: 0.95, flat: true }, // 2 pillar stone
    { c: "a53e2c", rough: 0.8, flat: true }, // 3 deck wood
    { c: "2f8159", rough: 0.7, flat: true }, // 4 band
    { c: "37414d", rough: 0.85, flat: true }, // 5 tile
  ];
  const parts = [
    { g: "plane", s: [46, 36], p: [0, 0.4, 0], m: 0 },
    { g: "box", s: [50, 0.8, 40], p: [0, 0.3, 0], m: 1 },
    { g: "box", s: [26, 1.2, 18], p: [0, 7, 0], m: 3 },
    { g: "box", s: [26.6, 1, 18.6], p: [0, 8.1, 0], m: 4 },
    { g: "hiproof", W: 16, D: 12, H: 8, ...KR_ROOF, p: [0, 8.6, 0], m: 5 },
  ];
  for (let ix = -2; ix <= 2; ix++)
    for (let iz = -1; iz <= 1; iz++) parts.push({ g: "cyl", rt: 0.55, rb: 0.6, h: 6, seg: 8, p: [ix * 5, 3.5, iz * 6], m: 2 });
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 14, top: 20 }], excludeR: 30 };
}

function statueYi() {
  const mats = [
    { c: "a9a290", rough: 0.95, flat: true }, // 0 granite
    { c: "4f9578", rough: 0.5, metal: 0.65, flat: true }, // 1 bronze
    { c: "bcbcbc", rough: 0.4, metal: 0.7, flat: true }, // 2 steel
  ];
  const top = 10.3;
  const b = (s, p, m) => ({ g: "box", s, p: round3(p), m });
  const parts = [
    b([9, 1.2, 9], [0, 0.6, 0], 0),
    b([5.4, 8.4, 4.6], [0, 5.4, 0], 0),
    b([6.2, 0.7, 5.2], [0, 9.95, 0], 0),
    b([1.9, 3, 1.4], [0, top + 1.5, 0], 1),
    b([2.5, 2.9, 1.6], [0, top + 4.4, 0], 1),
    b([1, 0.7, 1.6], [-1.5, top + 5.4, 0], 1),
    b([1, 0.7, 1.6], [1.5, top + 5.4, 0], 1),
    b([0.7, 2.6, 0.8], [-1.6, top + 4.2, 0.2], 1),
    b([0.7, 2.6, 0.8], [1.6, top + 4.2, 0.4], 1),
    b([1.05, 1.15, 1], [0, top + 6.4, 0], 1),
    // 투구(둥근 바리 + 둥근 정수리 + 작은 간주) — 한국식 장수 투구(뾰족한 일본 카부토 지양)
    { g: "cyl", rt: 0.6, rb: 1.05, h: 0.75, seg: 10, p: [0, top + 7.0, 0], m: 1 },
    { g: "cyl", rt: 0.18, rb: 0.62, h: 0.4, seg: 10, p: [0, top + 7.55, 0], m: 1 },
    { g: "cyl", rt: 0.05, rb: 0.2, h: 0.45, seg: 6, p: [0, top + 7.95, 0], m: 1 },
    b([0.22, 5.2, 0.16], [0.2, top + 2.4, 1.0], 2),
    b([0.5, 0.6, 0.5], [0.2, top + 5.1, 1.0], 1),
    b([1, 0.18, 0.5], [0.2, top + 4.75, 1.0], 1),
  ];
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 5.2, top: 30 }], excludeR: 9 };
}

function statueSejong() {
  const mats = [
    { c: "ada793", rough: 0.95, flat: true }, // 0 granite
    { c: "eecb35", rough: 0.35, metal: 0.85, flat: true }, // 1 gold
  ];
  const top = 4.0;
  const b = (s, p, m) => ({ g: "box", s, p: round3(p), m });
  const parts = [
    b([12, 1, 10], [0, 0.5, 0], 0),
    b([8.4, 3, 7.2], [0, 2.5, 0], 0),
    b([5.2, 2.2, 3.6], [0, top + 1.1, 0.2], 1),
    b([1.4, 1.3, 1.9], [-1.2, top + 1.0, 1.7], 1),
    b([1.4, 1.3, 1.9], [1.2, top + 1.0, 1.7], 1),
    b([3.3, 2.7, 1.9], [0, top + 3.4, 0], 1),
    b([0.95, 2.2, 1.5], [-1.8, top + 3.0, 0.4], 1),
    b([0.95, 2.2, 1.5], [1.8, top + 3.0, 0.4], 1),
    b([1.6, 0.45, 1.1], [1.3, top + 2.4, 1.5], 1),
    b([1.25, 1.35, 1.15], [0, top + 5.05, 0], 1),
    b([1.45, 0.55, 1.3], [0, top + 5.9, 0], 1),
    b([0.5, 0.7, 0.5], [0, top + 6.4, 0], 1),
  ];
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 6.2, top: 20 }], excludeR: 11 };
}

function blueHouse() {
  const mats = [M_STONE, M_WOOD, M_WALL, M_DANCHEONG, { c: "3f72a8", rough: 0.85, flat: true }, M_DOOR];
  const parts = [];
  hallParts(parts, { bodyW: 17, bodyD: 9, bodyH: 8, platformH: 1.8, roofH: 12, doubleRoof: true }, 0);
  for (const sx of [-1, 1]) hallParts(parts, { bodyW: 7, bodyD: 6, bodyH: 5, platformH: 1.0, roofH: 6 }, 0, sx * 32, 4);
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 22, top: 30 }], excludeR: 45 };
}

function folkMuseum() {
  const mats = [{ c: "ada793", rough: 0.95, flat: true }, { c: "8e3b2c", rough: 0.8, flat: true }, M_DANCHEONG, M_TILE];
  const parts = [{ g: "box", s: [26, 3, 26], p: [0, 1.5, 0], m: 0 }];
  const tiers = [10, 8.6, 7.2, 5.8, 4.4], tierH = [6, 5, 4.4, 3.8, 3.2];
  let y = 3;
  for (let i = 0; i < tiers.length; i++) {
    const w = tiers[i], h = tierH[i];
    parts.push({ g: "box", s: round3([w * 2, h, w * 2]), p: [0, r2(y + h / 2), 0], m: 1 });
    parts.push({ g: "box", s: round3([w * 2 + 0.6, 0.7, w * 2 + 0.6]), p: [0, r2(y + h + 0.35), 0], m: 2 });
    parts.push({ g: "hiproof", W: r2(w + 2.6), D: r2(w + 2.6), H: r2(w * 0.7), ...KR_ROOF, p: [0, r2(y + h + 0.7), 0], m: 3 });
    y += h + w * 0.5;
  }
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 13, top: 45 }], excludeR: 30 };
}

function mmca() {
  const mats = [
    { c: "9c5a44", rough: 0.9, flat: true }, // 0 brick
    { c: "c2bcae", rough: 0.92, flat: true }, // 1 concrete
    { c: "7f9fb0", rough: 0.25, metal: 0.35, opacity: 0.85, flat: true }, // 2 glass
  ];
  const blocks = [
    [40, 12, 26, -22, 0, 0],
    [30, 16, 22, 18, 4, 1],
    [22, 10, 30, 8, -24, 0],
    [26, 14, 16, -30, -22, 1],
  ];
  const parts = blocks.map(([w, h, d, ox, oz, m]) => ({ g: "box", s: [w, h, d], p: [ox, h / 2, oz], m }));
  parts.push({ g: "box", s: [30, 12, 0.6], p: [18, 6, -12.8], m: 2 });
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 34, top: 24 }], excludeR: 55 };
}

function sejongCenter() {
  const mats = [{ c: "b9b2a0", rough: 0.92, flat: true }, { c: "4a4d52", rough: 0.9, flat: true }];
  const parts = [
    { g: "box", s: [62, 26, 32], p: [0, 13, -4], m: 0 },
    { g: "box", s: [50, 22, 1], p: [0, 13, 12.2], m: 1 },
    { g: "box", s: [70, 3, 40], p: [0, 26, 0], m: 0 },
    { g: "box", s: [66, 2, 12], p: [0, 1, 22], m: 0 },
  ];
  for (let i = -6; i <= 6; i++) parts.push({ g: "cyl", rt: 2.4, rb: 1.6, h: 24, seg: 10, p: round3([i * 4.6, 12, 14]), m: 0 });
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 34, top: 30 }], excludeR: 50 };
}

function dongsipjagak() {
  const mats = [...HALL_MATS, { c: "9b958b", rough: 0.95, flat: true }];
  const parts = [{ g: "box", s: [13, 8, 13], p: [0, 4, 0], m: 6 }];
  hallParts(parts, { bodyW: 4.5, bodyD: 4.5, bodyH: 3.2, platformH: 0.6, roofH: 5 }, 8);
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 9, top: 20 }], excludeR: 14 };
}

function jogyesa() {
  const mats = [...HALL_MATS, { c: "b2aa98", rough: 0.95, flat: true }];
  const parts = [];
  hallParts(parts, { bodyW: 14, bodyD: 9, bodyH: 8, platformH: 1.4, roofH: 11, doubleRoof: true }, 0);
  parts.push({ g: "box", s: [5, 2, 5], p: [-22, 1, 9], m: 6 });
  let py = 2;
  for (let i = 0; i < 7; i++) {
    const w = r2(3.4 - i * 0.35);
    parts.push({ g: "box", s: [w, 1, w], p: [-22, r2(py + 0.5), 9], m: 6 });
    parts.push({ g: "box", s: [r2(w + 1.4), 0.5, r2(w + 1.4)], p: [-22, r2(py + 1.25), 9], m: 6 });
    py += 1.6;
  }
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 18, top: 28 }], excludeR: 40 };
}

// ───────────────────────────── 파리 ─────────────────────────────

function eiffelTower() {
  const P1 = 57, P2 = 115, TOP = 276, TIP = 324, baseH = 52, kneeH = 30, p2H = 16;
  const parts = [];
  const strut = (a, b, thick) => parts.push({ g: "strut", a: round3(a), b: round3(b), thick: r2(thick), m: 0 });
  const box = (s, p) => parts.push({ g: "box", s: round3(s), p: round3(p), m: 0 });
  const deck = (y, half, h) => {
    box([half * 2, h, 4], [0, y, half]); box([half * 2, h, 4], [0, y, -half]);
    box([4, h, half * 2], [half, y, 0]); box([4, h, half * 2], [-half, y, 0]);
  };
  const ring = (y, half) => {
    for (const sx of [-1, 1]) strut([sx * half, y, -half], [sx * half, y, half], 1.2);
    for (const sz of [-1, 1]) strut([-half, y, sz * half], [half, y, sz * half], 1.2);
  };
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const bx = sx * baseH, bz = sz * baseH, kx = sx * kneeH, kz = sz * kneeH, tx = sx * p2H, tz = sz * p2H;
      strut([bx, 0, bz], [kx, P1, kz], 7);
      strut([kx, P1, kz], [tx, P2, tz], 6);
      strut([bx, 14, bz], [kx * 0.9, P1 * 0.55, kz * 0.9], 1.6);
      strut([bx * 0.7, P1 * 0.4, bz * 0.7], [kx, P1, kz], 1.6);
    }
  deck(P1, 34, 3.5); deck(P2, 17, 2.6);
  const ringH = [P2, 150, 195, 240, TOP], ringR = [16, 12, 8, 4.5, 2.6];
  for (let i = 0; i < ringH.length - 1; i++) {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        strut([sx * ringR[i], ringH[i], sz * ringR[i]], [sx * ringR[i + 1], ringH[i + 1], sz * ringR[i + 1]], 2.4 - i * 0.3);
        strut([sx * ringR[i], ringH[i], sz * ringR[i]], [-sx * ringR[i + 1] * 0.2, (ringH[i] + ringH[i + 1]) / 2, sz * ringR[i + 1]], 0.9);
      }
    ring(ringH[i + 1], ringR[i + 1]);
  }
  box([7, 5, 7], [0, TOP + 2.5, 0]);
  parts.push({ g: "cyl", rt: 0.4, rb: 0.9, h: r2(TIP - TOP), seg: 6, p: [0, r2((TOP + TIP) / 2 + 2), 0], m: 0 });
  const colliders = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) colliders.push({ x: sx * 42, z: sz * 42, r: 7, top: 80 });
  return { mats: [{ c: "6e5847", rough: 0.7, metal: 0.3, flat: true }], parts, colliders, excludeR: 75 };
}

function pontIena() {
  const mats = [{ c: "b8b0a0", rough: 0.95, flat: true }, { c: "a49c8a", rough: 0.95, flat: true }];
  const parts = [];
  bridgeBaseParts(parts, 160, 32, 6, 5, 9, 0, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ g: "box", s: [4, 8, 4], p: [sx * 76, 9, sz * 14], m: 0 });
  return { mats, parts, excludeR: 28 };
}

function pontBirHakeim() {
  const mats = [{ c: "788a7d", rough: 0.6, metal: 0.35, flat: true }, { c: "bab1a0", rough: 0.95, flat: true }];
  const len = 240, width = 24, deckY = 6, beamY = deckY + 13;
  const parts = [];
  bridgeBaseParts(parts, len, width, deckY, 6, 8, 0, 0);
  parts.push({ g: "box", s: [r2(len * 0.8), 2.5, 7], p: [0, beamY, 0], m: 0 });
  for (let i = -8; i <= 8; i++) parts.push({ g: "cyl", rt: 1, rb: 1, h: beamY - deckY - 1, seg: 8, p: round3([(i / 8) * len * 0.4, (deckY + beamY) / 2, 0]), m: 0 });
  for (const sx of [-1, 1]) parts.push({ g: "cyl", rt: 2.2, rb: 2.4, h: beamY + 4, seg: 12, p: [sx * 9, (beamY + 4) / 2, 0], m: 1 });
  parts.push({ g: "box", s: [26, 3, width + 2], p: [0, beamY + 5, 0], m: 1 });
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 12, top: 30 }], excludeR: 28 };
}

function quaiBranly() {
  const colors = ["9c3b2c", "b07a2c", "c06a2c", "6e4a2c", "b8962f", "8a3f2a"];
  const mats = [
    { c: "474a50", rough: 0.85, flat: true }, // 0 body
    { c: "6f93a8", rough: 0.25, metal: 0.4, opacity: 0.85, flat: true }, // 1 glass
    { c: "3f6e34", rough: 0.9, flat: true }, // 2 green
    { c: "8e3b2c", rough: 0.8, flat: true }, // 3 piloti
    ...colors.map((c) => ({ c, rough: 0.85, flat: true })), // 4~9 색박스
  ];
  const len = 190, depth = 22, floorY = 6;
  const parts = [];
  for (let i = -6; i <= 6; i++)
    for (const sz of [-1, 1]) parts.push({ g: "cyl", rt: 0.7, rb: 0.7, h: floorY, seg: 8, p: round3([(i / 6) * len * 0.45, floorY / 2, (sz * depth) / 2 - sz * 1.5]), m: 3 });
  parts.push({ g: "box", s: [len, 16, depth], p: [0, floorY + 8, 0], m: 0 });
  parts.push({ g: "box", s: [len, 14, 0.6], p: [0, floorY + 8, depth / 2 + 0.3], m: 1 });
  for (let i = 0; i < 11; i++) {
    const w = 6 + (i % 3) * 4, h = 4 + ((i * 5) % 7);
    parts.push({ g: "box", s: [w, h, 5], p: round3([-len / 2 + 12 + i * 16, floorY + 6 + ((i * 3) % 8), -depth / 2 - 2.5]), m: 4 + (i % 6) });
  }
  parts.push({ g: "box", s: [0.8, 18, depth], p: [-len / 2 - 0.4, floorY + 9, 0], m: 2 });
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 26, top: 30 }], excludeR: 50 };
}

function palaisTokyo() {
  const mats = [{ c: "cfc6ad", rough: 0.92, flat: true }, { c: "3f76e4", rough: 0.2, metal: 0.4, opacity: 0.8 }];
  const wingLen = 64, wingD = 18, colH = 17;
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push({ g: "box", s: [wingLen, 22, wingD], p: [sx * 34, 11, 0], m: 0 });
    for (let i = -3; i <= 3; i++)
      parts.push({ g: "box", s: [2.4, colH, 2.4], p: round3([sx * 34 + (i / 3) * (wingLen / 2 - 4), colH / 2, (-sx * wingD) / 2 - sx * 2]), m: 0 });
    parts.push({ g: "box", s: [wingLen + 2, 2.5, wingD + 6], p: [sx * 34, colH + 1.5, 0], m: 0 });
  }
  parts.push({ g: "box", s: [26, 1.5, 40], p: [0, 0.75, 0], m: 0 });
  parts.push({ g: "plane", s: [14, 24], p: [0, 1.6, 0], m: 1 });
  return { mats, parts, colliders: [{ x: 34, z: 0, r: 14, top: 30 }, { x: -34, z: 0, r: 14, top: 30 }], excludeR: 60 };
}

// ───────────────────────────── 일본 ─────────────────────────────

// 天守閣(천수각) — 石垣(석축 기단) + 회벽 다층 탑신 + 일본식 급경사 지붕 + 千鳥破風 + 鯱.
// 한국 전각과 같은 hiproof 를 쓰되 양식 파라미터(JP_ROOF: 짧은 용마루+강한 처마 들림)만 다름.
function tenshukaku() {
  const mats = [
    { c: "8d877b", rough: 0.95, flat: true }, // 0 石垣 화강암
    { c: "efe9dc", rough: 0.9, flat: true }, // 1 회벽(흰 벽)
    { c: "2a2722", rough: 0.85, flat: true }, // 2 흑판벽/하단 흑목·창
    { c: "5a6b5c", rough: 0.8, flat: true }, // 3 기와(銅綠 동록 — 오사카성 녹청 지붕)
    { c: "d4b13e", rough: 0.4, metal: 0.7, flat: true }, // 4 금(鯱/장식)
  ];
  const parts = [];
  const box = (s, p, m, extra) => parts.push({ g: "box", s: round3(s), p: round3(p), m, ...extra });
  const roofJP = (W, H, yy) => parts.push({ g: "hiproof", W: r2(W), D: r2(W), H: r2(H), ...JP_ROOF, p: [0, r2(yy), 0], m: 3 });
  // 石垣(아래가 넓은 배흘림 석축 2단)
  box([42, 9, 42], [0, 4.5, 0], 0);
  box([34, 3, 34], [0, 10.5, 0], 0);
  const tiers = [13, 11, 9, 7], tierH = [7.5, 6.4, 5.6, 5];
  let y = 12, topRoof = 0, topRW = 0;
  for (let i = 0; i < tiers.length; i++) {
    const w = tiers[i], h = tierH[i], roofH = w * 0.5;
    box([w * 2, h, w * 2], [0, y + h / 2, 0], 1); // 회벽(흰 벽) 탑신
    box([w * 2 + 0.4, h * 0.32, w * 2 + 0.4], [0, y + (h * 0.32) / 2, 0], 2); // 하단 흑판벽(腰板)
    box([w * 2 + 0.1, 1.5, 0.4], [0, y + h * 0.66, w + 0.1], 2); // 검은 살창(앞)
    const ry = y + h + 0.5;
    roofJP(w + 2.4, roofH, ry); // 일본식 짧은 용마루 + 강한 처마 들림(反り)
    topRoof = ry + roofH;
    topRW = (w + 2.4) * JP_ROOF.ridge;
    if (i < 2) {
      // 千鳥破風(앞면 삼각 박공 + 작은 지붕)
      box([w * 0.85, 0.5, w * 0.5], [0, ry + 0.1, w * 0.7], 1);
      parts.push({ g: "hiproof", W: r2(w * 0.5), D: r2(w * 0.32), H: r2(w * 0.42), ridge: 0.05, up: 0.6, p: [0, r2(ry + 0.2), r2(w * 0.75)], m: 3 });
    }
    y += h + roofH * 0.62;
  }
  // 鯱(샤치호코) — 최상단 용마루 양끝 금장식(몸통 + 꼬리)
  for (const sx of [-1, 1]) {
    box([0.7, 2.4, 0.5], [sx * topRW, topRoof - 0.5, 0], 4, { rz: sx * 0.45 });
    parts.push({ g: "cone", r: 0.45, h: 1.1, p: round3([sx * (topRW + 0.6), r2(topRoof + 0.7), 0]), rz: sx * 0.9, m: 4 });
  }
  return { mats, parts, colliders: [{ x: 0, z: 0, r: 24, top: topRoof }], excludeR: 48 };
}

/** 타입 → 레시피. 빌드 스크립트가 config 의 {type,x,z,rot} 를 structure 로 베이킹. */
export const RECIPES = {
  geunjeongjeon,
  gwanghwamun,
  gyeonghoeru,
  "statue-yi": statueYi,
  "statue-sejong": statueSejong,
  "blue-house": blueHouse,
  "folk-museum": folkMuseum,
  mmca,
  "sejong-center": sejongCenter,
  dongsipjagak,
  jogyesa,
  "eiffel-tower": eiffelTower,
  "pont-iena": pontIena,
  "pont-bir-hakeim": pontBirHakeim,
  "quai-branly": quaiBranly,
  "palais-tokyo": palaisTokyo,
  tenshukaku,
};
