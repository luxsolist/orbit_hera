// Read-only audit of cached source maps, also used to check old caches before a rebuild.
import {readFileSync, writeFileSync} from 'node:fs';
import {normalizeWaterFeature, auditWaterFeatures, auditWaterRoadCrossings} from './water-build.mjs';
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('usage: node scripts/audit-water.mjs <map-id> [map-id ...]');
let failed = false;
for (const id of ids) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid map id');
  const raw = JSON.parse(readFileSync(`build/${id}.json`, 'utf8'));
  const water = (raw.terrain?.water ?? raw.water ?? []).map(normalizeWaterFeature);
  const report = auditWaterFeatures(water);
  if (!report.errors.length) report.crossings = auditWaterRoadCrossings(water, raw.objects?.roads ?? raw.roads ?? []);
  writeFileSync(`build/${id}.water-audit.json`, JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify({id, ...report, crossings: report.crossings && {...report.crossings, examples: report.crossings.examples.slice(0,3)}}));
  failed ||= report.errors.length > 0;
}
if (failed) process.exitCode = 1;
