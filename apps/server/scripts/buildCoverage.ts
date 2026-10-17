// Builds data/coverage-grid.json: known low-coverage zones from historical point density in our recordings
// (PRD §4.3). A cell is "low coverage" when it has few points, or when airborne aircraft often drop out there.
// Usage: npm run build:coverage
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellKey, config, normalizePoll, type CoverageGrid } from '@aerotrack/core';
import { env } from '../src/env';
import { getRecording, listRecordings } from '../src/recordings';

const gridDeg = config.coverage.gridDeg;
const cells: Record<string, number> = {};
const dropouts: Record<string, number> = {};

const recs = listRecordings().filter((r) => r.kind === 'live-capture');
if (!recs.length) {
  console.error('No live-capture recordings found. Run `npm run record` first.');
  process.exit(1);
}

for (const info of recs) {
  const { polls } = getRecording(info.id)!;
  const last = new Map<string, { ts: number; lat: number; lon: number; ground: boolean }>();
  for (const poll of polls) {
    for (const o of normalizePoll(poll)) {
      const k = cellKey(o.lat, o.lon, gridDeg);
      const prev = last.get(o.hex);
      if (prev && prev.ts === o.ts) continue;
      cells[k] = (cells[k] ?? 0) + 1;
      if (prev && !prev.ground && o.ts - prev.ts > config.stale.staleSec * 1000) {
        const pk = cellKey(prev.lat, prev.lon, gridDeg);
        dropouts[pk] = (dropouts[pk] ?? 0) + 1;
      }
      last.set(o.hex, { ts: o.ts, lat: o.lat, lon: o.lon, ground: o.onGround });
    }
  }
  console.log(`[coverage] ${info.id}: ${polls.length} polls`);
}

const counts = Object.values(cells).sort((a, b) => a - b);
const median = counts[Math.floor(counts.length / 2)] ?? 0;
const sparse = Math.max(3, median * 0.05);
const low = Object.keys(cells).filter((k) => cells[k] < sparse || ((dropouts[k] ?? 0) >= 3 && (dropouts[k] ?? 0) / cells[k] > 0.02));

const grid: CoverageGrid = { gridDeg, center: [env.lon, env.lat], cells, low };
writeFileSync(join(env.dataDir, 'coverage-grid.json'), JSON.stringify(grid));
console.log(`[coverage] ${Object.keys(cells).length} cells with data, ${low.length} marked low-coverage (median ${median} pts/cell)`);
