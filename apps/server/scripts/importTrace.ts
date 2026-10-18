// Converts ADSB.lol globe_history / readsb `trace_full_<hex>.json` files (gzipped or plain, local path or URL)
// into a replayable recording. Use this for real past incidents found via news or Reddit.
//
// Also writes the same points as FlightPoint[] to data/recorded/<id>.json (recorded-flight template format).
//
// Usage:
//   npm run import:trace -- --id qf-go-around --title "QF… go-around at SYD" \
//     [--reported-cause "…"] [--source-link https://…] [--description "…"] [--stale-sec 120] [--expect GO_AROUND] \
//     path/to/trace_full_7c1234.json [more traces…]
//   npm run import:trace -- --id qf-go-around --title "…" --hex 7c1234 --date 2026-10-16
//     (streams that day's ADSB.lol globe_history archive, up to ~4 GB, until the trace is found, then caches it)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { airlineName, airlinePrefix, type FlightPoint, type RawAircraft, type RawPoll } from '@aerotrack/core';
import { env } from '../src/env';
import { archiveParts, fetchArchivedTrace } from './globeHistory';

const args = process.argv.slice(2);
const opts: Record<string, string> = {};
const inputs: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i];
  else inputs.push(args[i]);
}
if (!opts.id || (!inputs.length && !(opts.hex && opts.date))) {
  console.error('Usage: npm run import:trace -- --id <id> --title "<title>" [--reported-cause …] [--source-link …] (trace_full_<hex>.json … | --hex <icao> --date YYYY-MM-DD)');
  process.exit(1);
}

const recDir = join(env.dataDir, 'recordings');
mkdirSync(recDir, { recursive: true });
let archiveUrl: string | null = null;
if (opts.hex) {
  const hex = opts.hex.toLowerCase();
  if (!/^~?[0-9a-f]{6}$/.test(hex)) throw new Error(`--hex must be a 6-character ICAO hex (got "${opts.hex}")`);
  // Cached so a re-import doesn't stream the archive again.
  const cached = join(recDir, `trace_full_${hex}_${opts.date}.json`);
  if (existsSync(cached)) {
    console.log(`[import] using cached ${cached}`);
  } else {
    const { tag, url, parts } = await archiveParts(opts.date);
    archiveUrl = url;
    console.log(`[import] streaming ${tag} (${parts.length} parts) for ${hex}…`);
    writeFileSync(cached, await fetchArchivedTrace(hex, parts));
    console.log(`[import] cached → ${cached}`);
  }
  inputs.push(cached);
}

async function readInput(src: string): Promise<any> {
  let buf: Buffer;
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } else buf = readFileSync(src);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return JSON.parse(buf.toString('utf8'));
}

// readsb trace point: [secondsAfterTimestamp, lat, lon, alt|"ground"|null, gs, track, flags, vertRate, details|null, ...]
const points: { ts: number; ac: RawAircraft }[] = [];
for (const src of inputs) {
  const t = await readInput(src);
  const hex = String(t.icao).toLowerCase();
  const state: Partial<RawAircraft> = { r: t.r, t: t.t, dbFlags: t.dbFlags };
  for (const p of t.trace as any[]) {
    const [dt, lat, lon, alt, gs, track, , vrate, details] = p;
    if (details) {
      if (details.flight) state.flight = details.flight;
      if (details.squawk) state.squawk = details.squawk;
      if (details.emergency) state.emergency = details.emergency;
      if (details.category) state.category = details.category;
    }
    points.push({
      ts: Math.round((t.timestamp + dt) * 1000),
      ac: {
        ...state,
        hex,
        lat,
        lon,
        alt_baro: alt === 'ground' ? 'ground' : (alt ?? undefined),
        gs: gs ?? undefined,
        track: track ?? undefined,
        baro_rate: vrate ?? undefined,
        seen_pos: 0,
      } as RawAircraft,
    });
  }
  console.log(`[import] ${src}: ${t.trace.length} points for ${hex} ${state.flight?.trim() ?? ''}`);
}
points.sort((a, b) => a.ts - b.ts);

const polls: RawPoll[] = [];
for (const p of points) {
  const last = polls[polls.length - 1];
  if (last && last.now === p.ts) last.ac!.push(p.ac);
  else polls.push({ now: p.ts, ac: [p.ac] });
}

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
  staleSec: Number(opts['stale-sec'] ?? 120),
  ...(opts.description && { description: opts.description }),
  ...(opts['reported-cause'] && { reportedCause: opts['reported-cause'] }),
  ...(opts['source-link'] && { sourceLink: opts['source-link'] }),
};
const i = manifest.findIndex((m: { id: string }) => m.id === opts.id);
if (i >= 0) manifest[i] = { ...manifest[i], ...entry };
else manifest.push(entry);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[import] wrote ${polls.length} polls → data/recordings/${file} and updated manifest.json`);

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
if (callsigns.length > 1) console.warn(`[import] trace covers several flights (${callsigns.join(', ')}); template uses ${callsign}. The replay splits them into sessions.`);
const prefix = airlinePrefix(callsign);
const templateDir = join(env.dataDir, 'recorded');
mkdirSync(templateDir, { recursive: true });
const template = {
  id: opts.id,
  mode: 'recorded',
  title: opts.title ?? opts.id,
  flight: {
    callsign: callsign ?? 'UNKNOWN',
    airline: (prefix && airlineName(prefix)) || 'UNKNOWN',
    aircraftType: points.map((p) => p.ac.t).find(Boolean) ?? 'UNKNOWN',
    origin: 'UNKNOWN',
    destination: 'UNKNOWN',
  },
  recording: {
    date: new Date(points[0].ts).toISOString(),
    source: 'ADSB.lol globe_history (ODbL)',
    sourceUrl: archiveUrl,
    newsSourceUrl: opts['source-link'] ?? null,
  },
  expectedInsight: { type: opts.expect ?? null },
  points: flightPoints,
};
writeFileSync(join(templateDir, `${opts.id}.json`), JSON.stringify(template, null, 2) + '\n');
console.log(`[import] wrote ${flightPoints.length} points → data/recorded/${opts.id}.json`);
