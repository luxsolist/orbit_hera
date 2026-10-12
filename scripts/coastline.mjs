// OSM has no sea polygons: the sea is terrain at or below 0m. DEM noise over open water
// (+1..+5m) then renders as land patches. natural=coastline ways keep land on their left,
// so the nearest coastline segment classifies each lattice sample as sea or land.
export const COAST_BAND = 3000; // m — classify only this close to a coastline
export const SEA_DEPTH = -1, SHORE_LAND = 1; // m relative to sea level
const SEA_NOISE_LIMIT = 15; // m — a higher "sea" sample is a misclassification, never lowered
const BUCKET = 512;

/** lines: flat [x0,z0,x1,z1,...] in the lattice's coordinate frame. */
export function coastIndex(lines) {
  const segs = [], buckets = new Map();
  for (const p of lines) for (let i = 2; i < p.length; i += 2) {
    const s = { ax: p[i - 2], az: p[i - 1], bx: p[i], bz: p[i + 1], prev: i >= 4 ? [p[i - 4], p[i - 3]] : null, next: i + 2 < p.length ? [p[i + 2], p[i + 3]] : null };
    if (s.ax === s.bx && s.az === s.bz) continue;
    segs.push(s);
    for (let x = Math.floor(Math.min(s.ax, s.bx) / BUCKET); x <= Math.floor(Math.max(s.ax, s.bx) / BUCKET); x++)
      for (let z = Math.floor(Math.min(s.az, s.bz) / BUCKET); z <= Math.floor(Math.max(s.az, s.bz) / BUCKET); z++) {
        const k = x + "_" + z; let list = buckets.get(k); if (!list) buckets.set(k, list = []); list.push(s);
      }
  }
  return { segs, buckets };
}

const cross = (ax, az, bx, bz) => ax * bz - az * bx;
/** true = land, false = sea, null = farther than band from any coastline. */
export function coastSide(index, x, z, band = COAST_BAND) {
  const bx0 = Math.floor(x / BUCKET), bz0 = Math.floor(z / BUCKET), rings = Math.ceil(band / BUCKET);
  let best = null, bestD = band * band;
  for (let r = 0; r <= rings; r++) {
    if (best && (r - 1) * BUCKET > Math.sqrt(bestD)) break;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const s of index.buckets.get(bx0 + dx + "_" + (bz0 + dz)) ?? []) {
        const vx = s.bx - s.ax, vz = s.bz - s.az, t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz)));
        const px = s.ax + vx * t, pz = s.az + vz * t, d = (x - px) ** 2 + (z - pz) ** 2;
        if (d < bestD) { bestD = d; best = { s, t }; }
      }
    }
  }
  if (!best) return null;
  const { s, t } = best, vx = s.bx - s.ax, vz = s.bz - s.az;
  // Lattice frame: x east, z south. "Left of travel" (north-up) is cross(v, p-a) < 0 here.
  const left = (ax, az, ux, uz) => cross(ux, uz, x - ax, z - az) < 0;
  if (t > 0 && t < 1) return left(s.ax, s.az, vx, vz);
  // Nearest point is a vertex: combine both segments by the turn direction.
  const other = t === 0 ? s.prev : s.next;
  if (!other) return left(s.ax, s.az, vx, vz);
  const [ox, oz] = other;
  const [ux, uz, wx, wz, ax, az, cx, cz] = t === 0 ? [s.ax - ox, s.az - oz, vx, vz, ox, oz, s.ax, s.az] : [vx, vz, ox - s.bx, oz - s.bz, s.ax, s.az, s.bx, s.bz];
  const l1 = left(ax, az, ux, uz), l2 = left(cx, cz, wx, wz), leftTurn = cross(ux, uz, wx, wz) < 0;
  return leftTurn ? l1 && l2 : l1 || l2;
}

/** Clamps lattice samples near the coast: sea below sea level, coastal land above it. */
export function applyCoastline(L, lines, seaLevel = 0) {
  if (!lines?.length) return { sea: 0, land: 0 };
  const index = coastIndex(lines);let sea = 0, land = 0;
  for (let j = 0; j < L.size; j++) for (let i = 0; i < L.size; i++) {
    const k = j * L.size + i, h = L.grid[k] - seaLevel;
    if (h > SEA_NOISE_LIMIT) continue;
    const side = coastSide(index, L.orig + i * L.step, L.orig + j * L.step);
    if (side === false && h > SEA_DEPTH) { L.grid[k] = seaLevel + SEA_DEPTH; sea++; }
    else if (side === true && h < SHORE_LAND) { L.grid[k] = seaLevel + SHORE_LAND; land++; }
  }
  return { sea, land };
}
