// Converts ADSB.lol globe_history / readsb `trace_full_<hex>.json` files (gzipped or plain, local path or URL)
// into a replayable recording. Use this for real past incidents found via news or Reddit.
// Also writes the same points as FlightPoint[] to data/recorded/<id>.json (recorded-flight template format).
//
// Usage:
//   npm run import:trace -- --id qf-go-around --title "QF… go-around at SYD" \
//     [--reported-cause "…"] [--source-link https://…] [--description "…"] [--stale-sec 120] \
//     [--expect GO_AROUND] [--from 20:10 --to 20:45] [--origin DPS --destination SYD] [--speed 16] \
//     (path/to/trace_full_7c1234.json … | --hex 7c1234 --date 2026-10-16)
//
// --hex/--date fetches the trace from that day's archive (only the aircraft's directory, ~15 MB) and caches it.
// --from/--to (UTC, HH:MM on --date or ISO) keep only the eventful snippet; find the window with find:patterns.
// --expect checks that Aerotrack itself detects that pattern in the snippet, and refuses to write otherwise.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { airlineName, airlinePrefix, analyseFlight, Pipeline, type FlightPoint, type InsightType } from '@aerotrack/core';
import { env } from '../src/env';
import { SPEEDS } from '../src/replay';
import { archiveParts, fetchArchivedTrace } from './globeHistory';
import { parseUtc, readTrace, toPolls, tracePoints, type TracePoint } from './trace';

const args = process.argv.slice(2);
const opts: Record<string, string> = {};
const inputs: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i];
  else inputs.push(args[i]);
}
if (!opts.id || (!inputs.length && !(opts.hex && opts.date))) {
  console.error('Usage: npm run import:trace -- --id <id> --title "<title>" [--expect <InsightType>] [--from HH:MM --to HH:MM] (trace_full_<hex>.json … | --hex <icao> --date YYYY-MM-DD)');
  process.exit(1);
}

const recDir = join(env.dataDir, 'recordings');
mkdirSync(recDir, { recursive: true });
let archiveUrl: string | null = null;
if (opts.hex) {
  const hex = opts.hex.toLowerCase();
  if (!/^~?[0-9a-f]{6}$/.test(hex)) throw new Error(`--hex must be a 6-character ICAO hex (got "${opts.hex}")`);
  // Cached so a re-import doesn't download again.
  const cached = join(recDir, `trace_full_${hex}_${opts.date}.json`);
  if (existsSync(cached)) {
    console.log(`[import] using cached ${cached}`);
  } else {
    const { tag, url, parts } = await archiveParts(opts.date);
    archiveUrl = url;
    console.log(`[import] fetching ${hex} from ${tag}…`);
    writeFileSync(cached, await fetchArchivedTrace(hex, parts));
    console.log(`[import] cached → ${cached}`);
  }
  inputs.push(cached);
}

let points: TracePoint[] = [];
for (const src of inputs) {
  const t = await readTrace(src);
  const pts = tracePoints(t);
  points.push(...pts);
  console.log(`[import] ${src}: ${pts.length} points for ${String(t.icao).toLowerCase()}`);
}
points.sort((a, b) => a.ts - b.ts);

// Keep only the eventful snippet (with its lead-in) so the demo loads instantly.
const day = opts.date ?? new Date(points[0]?.ts ?? 0).toISOString().slice(0, 10);
const from = opts.from ? parseUtc(opts.from, day) : -Infinity;
const to = opts.to ? parseUtc(opts.to, day) : Infinity;
if (to <= from) throw new Error('--to must be after --from');
points = points.filter((p) => p.ts >= from && p.ts <= to);
if (!points.length) throw new Error('No points in the --from/--to window');
const polls = toPolls(points);
const staleSec = Number(opts['stale-sec'] ?? 120);

// Verification gate: the snippet must show the expected pattern through the same pipeline the app uses.
let focus: { hex: string; ts: number } | undefined;
if (opts.expect) {
  const expect = opts.expect as InsightType;
  const p = new Pipeline({ mode: 'recorded', staleSec });
  for (const poll of polls) {
    p.ingest(poll);
    for (const s of p.store.current()) {
      if (focus) break;
      if (analyseFlight({ events: s.events, signal: p.signal(s, poll.now, false) }, poll.now).some((i) => i.type === expect)) focus = { hex: s.hex, ts: poll.now };
    }
    if (focus) break;
  }
  if (!focus) {
    console.error(`[import] Aerotrack does not detect ${expect} in this snippet. Nothing written. Check the window with npm run find:patterns.`);
    process.exit(2);
  }
  console.log(`[import] verified: ${expect} shows at ${new Date(focus.ts).toISOString()}`);
}

const durationSec = (points[points.length - 1].ts - points[0].ts) / 1000;
// Default speed plays the snippet in about 90 s.
const speed = Number(opts.speed ?? SPEEDS.find((s) => durationSec / s <= 90) ?? SPEEDS[SPEEDS.length - 1]);

const file = `${opts.id}.ndjson`;
writeFileSync(join(recDir, file), polls.map((p) => JSON.stringify(p)).join('\n') + '\n');

const lats = points.map((p) => p.ac.lat as number);
const lons = points.map((p) => p.ac.lon as number);
const manifestPath = join(recDir, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const entry = {
  id: opts.id,
  title: opts.title ?? opts.id,
  file,
  date: new Date(points[0].ts).toISOString(),
  source: 'ADSB.lol (ODbL)',
  kind: 'imported-trace',
  center: [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2],
  zoom: Number(opts.zoom ?? 8),
  // Archived traces are thinned in steady flight, so a longer stale threshold avoids false gaps.
  staleSec,
  speed,
  ...(opts.expect && { expectedInsight: opts.expect }),
  ...(focus && { focus }),
  ...(opts.description && { description: opts.description }),
  ...(opts['reported-cause'] && { reportedCause: opts['reported-cause'] }),
  ...(opts['source-link'] && { sourceLink: opts['source-link'] }),
};
const i = manifest.findIndex((m: { id: string }) => m.id === opts.id);
if (i >= 0) manifest[i] = { ...manifest[i], ...entry };
else manifest.push(entry);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[import] wrote ${polls.length} polls (${Math.round(durationSec / 60)} min, plays at ${speed}×) → data/recordings/${file} and updated manifest.json`);

// ---- Recorded-flight template (data/recorded/<id>.json), format adapted from teamate-src/data/*.json ----------
// Only fields present in the trace are filled; unknowns stay "UNKNOWN". No points are invented.
const flightPoints: FlightPoint[] = points.map(({ ts, ac }) => ({
  timestamp: ts, // position time from the trace
  lat: ac.lat as number,
  lon: ac.lon as number,
  altitudeFt: typeof ac.alt_baro === 'number' ? ac.alt_baro : null,
  verticalRateFpm: ac.baro_rate ?? null,
  groundSpeedKt: ac.gs ?? null,
  headingDeg: ac.track ?? null,
  squawk: ac.squawk ?? null,
  emergency: ac.emergency ?? null,
  onGround: ac.alt_baro === 'ground',
}));
const callsigns = [...new Set(points.map((p) => p.ac.flight?.trim()).filter(Boolean))];
const callsign = callsigns[0] ?? null;
if (callsigns.length > 1) console.warn(`[import] snippet covers several flights (${callsigns.join(', ')}); template uses ${callsign}. Narrow --from/--to.`);
const prefix = airlinePrefix(callsign);
const templateDir = join(env.dataDir, 'recorded');
mkdirSync(templateDir, { recursive: true });
const template = {
  id: opts.id,
  mode: 'recorded',
  title: opts.title ?? opts.id,
  flight: {
    hex: points[0].ac.hex,
    callsign: callsign ?? 'UNKNOWN',
    airline: (prefix && airlineName(prefix)) || 'UNKNOWN',
    aircraftType: points.map((p) => p.ac.t).find(Boolean) ?? 'UNKNOWN',
    origin: opts.origin ?? 'UNKNOWN',
    destination: opts.destination ?? 'UNKNOWN',
  },
  recording: {
    date: new Date(points[0].ts).toISOString(),
    source: 'ADSB.lol globe_history (ODbL)',
    sourceUrl: archiveUrl,
    newsSourceUrl: opts['source-link'] ?? null,
  },
  expectedInsight: { type: opts.expect ?? null },
  ...(focus && { focus }),
  ...(opts['reported-cause'] && { reportedCause: opts['reported-cause'] }),
  points: flightPoints,
};
writeFileSync(join(templateDir, `${opts.id}.json`), JSON.stringify(template, null, 2) + '\n');
console.log(`[import] wrote ${flightPoints.length} points → data/recorded/${opts.id}.json`);
