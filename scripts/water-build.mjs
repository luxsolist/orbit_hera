// Common water extraction/chunking contract. Never derive a river type from its city.
import {bbox, clipRect, clipPolylineToRect, polyArea} from './clip.mjs';
import {waterContains} from './road-grade.mjs';

const STYLES = new Set(['natural', 'engineered', 'canal']);
const KINDS = new Set(['river', 'stream', 'canal', 'lake', 'pond', 'reservoir', 'unknown']);
const yes = value => value === 'yes' || value === 'true' || value === '1';

/** Width tags are estimates/source claims, not measured accuracy. Reject ambiguous ranges. */
export function taggedWaterWidth(value) {
  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet)?$/i);
  if (!match) return null;
  const width = Number(match[1]) * (/^(ft|feet)$/i.test(match[2] ?? '') ? .3048 : 1);
  return width >= .01 && width <= 10000 ? Math.round(width * 100) / 100 : null;
}

export function waterMetadata(tags = {}, osmId, linear = false) {
  const rawKind = KINDS.has(tags.water) ? tags.water : tags.waterway;
  const kind = KINDS.has(rawKind) ? rawKind : tags.waterway === 'riverbank' ? 'river' : 'unknown';
  const canal = kind === 'canal';
  const engineered = yes(tags.channelized) || yes(tags['waterway:channelized']);
  const style = canal ? 'canal' : engineered ? 'engineered' : 'natural';
  const width = taggedWaterWidth(tags.width);
  return {
    ...(osmId ? {osmId} : {}),
    waterInfo: {version: 1, kind, style, styleSource: canal || engineered ? 'tag' : 'default',
      widthSource: linear ? width == null ? 'estimate' : 'tag' : 'outline',
      ...(tags.name ? {name: tags.name} : {})},
    ...(linear ? {w: width ?? (kind === 'river' ? 24 : 6)} : {}),
  };
}

/** Legacy caches have already lost their tags: preserve the shape, never invent provenance. */
export function normalizeWaterFeature(feature) {
  if (feature.waterInfo) return {...feature};
  return {...feature, waterInfo: {version: 1, kind: 'unknown', style: 'natural',
    styleSource: 'legacy', widthSource: feature.w == null ? 'outline' : 'legacy'}};
}

/** Fail before replacing any map tiles. Missing tags are warnings, not guessed urban channels. */
export function auditWaterFeatures(features) {
  const report = {version: 1, count: features.length, styles: {natural: 0, engineered: 0, canal: 0},
    legacy: 0, estimatedWidths: 0, islands: 0, errors: []};
  const validPath = (p, min) => Array.isArray(p) && p.length >= min && p.length % 2 === 0 && p.every(Number.isFinite);
  features.forEach((f, index) => {
    const key = f.osmId ?? `water[${index}]`, info = f.waterInfo;
    if (!info || info.version !== 1 || !STYLES.has(info.style) || !KINDS.has(info.kind)) report.errors.push(`${key}: invalid water classification`);
    else report.styles[info.style]++;
    if (!validPath(f.p, f.w == null ? 6 : 4)) report.errors.push(`${key}: invalid water geometry`);
    else if (f.w == null && polyArea(f.p) <= 0) report.errors.push(`${key}: empty water polygon`);
    if (f.w != null && (!Number.isFinite(f.w) || f.w <= 0)) report.errors.push(`${key}: invalid width`);
    if (f.holes != null && !Array.isArray(f.holes)) report.errors.push(`${key}: invalid islands`);
    else for (const h of f.holes ?? []) {
      report.islands++;
      if (!validPath(h, 6) || polyArea(h) <= 0) report.errors.push(`${key}: invalid island geometry`);
    }
    if (info?.styleSource === 'legacy') report.legacy++;
    if (info?.widthSource === 'estimate') report.estimatedWidths++;
  });
  return report;
}

/** Source-coordinate water -> cell-coordinate pieces. No straightening, convex hull or fixed section.
 * Keep a half-width halo for line rivers: their bank can occupy a tile even when the centerline doesn't.
 * Tile terrain/texture clips that halo at rendering time. Metadata and islands travel with every piece.
 */
export function* waterChunkPieces(feature, project, chunkSize = 1024, inBounds = () => true) {
  const normalized = normalizeWaterFeature(feature);
  const {p, holes, ...meta} = normalized;
  const outer = project(p), inner = (holes ?? []).map(project);
  const [x0, z0, x1, z1] = bbox(outer), halo = feature.w == null ? 0 : feature.w / 2;
  for (let cz = Math.floor((z0 - halo) / chunkSize); cz <= Math.floor((z1 + halo) / chunkSize); cz++) {
    for (let cx = Math.floor((x0 - halo) / chunkSize); cx <= Math.floor((x1 + halo) / chunkSize); cx++) {
      if (!inBounds(cx, cz)) continue;
      const rect = [cx * chunkSize, cz * chunkSize, (cx + 1) * chunkSize, (cz + 1) * chunkSize];
      if (feature.w != null) {
        for (const piece of clipPolylineToRect(outer, rect[0] - halo, rect[1] - halo, rect[2] + halo, rect[3] + halo, .01))
          yield {cx, cz, water: {...meta, p: piece}};
      } else {
        const piece = clipRect(outer, ...rect, .01);
        if (piece.length < 6 || polyArea(piece) < .01) continue;
        const hs = inner.map(h => clipRect(h, ...rect, .01)).filter(h => h.length >= 6 && polyArea(h) >= .01);
        yield {cx, cz, water: {...meta, p: piece, ...(hs.length ? {holes: hs} : {})}};
      }
    }
  }
}

/** Review crossings without moving a river or flattening a bridge to the water level.
 * Spatial bins bound the cost; first offending point per ground road is enough for review.
 * This is a planar conflict audit, not an automatic inference of a missing bridge.
 */
export function auditWaterRoadCrossings(water, roads) {
  const bins = new Map(), size = 256, bounds = [];
  water.forEach((f, index) => {
    const [x0,z0,x1,z1] = bbox(f.p), h = (f.w ?? 0) / 2;
    bounds.push([x0-h,z0-h,x1+h,z1+h]);
    for (let z = Math.floor((z0-h)/size); z <= Math.floor((z1+h)/size); z++)
      for (let x = Math.floor((x0-h)/size); x <= Math.floor((x1+h)/size); x++) {
        const key = `${x},${z}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(index);
      }
  });
  const report = {groundRoadConflicts: 0, gradeSeparatedRoads: 0, unclassifiedRoads: 0, examples: []};
  roads.forEach((road, index) => {
    if (road.bridge || road.tunnel || Number(road.layer)) {report.gradeSeparatedRoads++; return;}
    if (road.bridge == null && road.tunnel == null && road.layer == null) report.unclassifiedRoads++;
    const p = road.p;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i-2], az = p[i-1], dx = p[i]-ax, dz = p[i+1]-az;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx,dz)/4));
      for (let j = 0; j <= steps; j++) {
        const x = ax+dx*j/steps, z = az+dz*j/steps;
        const hit = (bins.get(`${Math.floor(x/size)},${Math.floor(z/size)}`) ?? []).find(k => {const b=bounds[k];return x>=b[0] && z>=b[1] && x<=b[2] && z<=b[3] && waterContains(x,z,water[k]);});
        if (hit == null) continue;
        report.groundRoadConflicts++;
        if (report.examples.length < 100) report.examples.push({road: road.osmId ?? index,
          water: water[hit].osmId ?? hit, x: Math.round(x*100)/100, z: Math.round(z*100)/100});
        return;
      }
    }
  });
  return report;
}
