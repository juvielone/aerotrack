// Lists the patterns Aerotrack detects in an archived trace, to choose a demo snippet. Writes nothing.
//
// Usage:
//   npm run find:patterns -- path/to/trace_full_7c4a45.json [--type GO_AROUND] [--stale-sec 120]
//   npm run find:patterns -- path/to/folder-of-traces --near SYD [--min-turn 270]
//     --near keeps only aircraft that came within 30 km of the airport below 10,000 ft, cut to ±45 min around that
//     (a false-positive sweep over many real arrivals); --min-turn also prints turns of at least that many degrees.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AIRPORTS, config, distanceKm, nearestAirport, Pipeline, type EventType, type FlightEvent } from '@aerotrack/core';
import { readTrace, toPolls, tracePoints, type TracePoint } from './trace';

const args = process.argv.slice(2);
const opts: Record<string, string> = {};
const inputs: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i];
  else inputs.push(args[i]);
}
if (!inputs.length) {
  console.error('Usage: npm run find:patterns -- trace_full_<hex>.json [--type <InsightType>] [--stale-sec 120]');
  process.exit(1);
}

/** Routine patterns are left out unless asked for by --type. */
const ROUTINE = new Set<EventType>(['climb', 'descent', 'turn', 'glitch', 'gap']);
const INSIGHT: Record<EventType, string> = {
  climb: 'CLIMB',
  descent: 'DESCENT',
  turn: 'TURN',
  holding: 'POSSIBLE_CIRCLING',
  'rapid-descent': 'RAPID_DESCENT',
  'go-around': 'GO_AROUND',
  'go-around-hint': 'POSSIBLE_GO_AROUND',
  'squawk-7700': 'SQUAWK_7700',
  'squawk-7600': 'SQUAWK_7600',
  glitch: 'DATA_GLITCH',
  gap: 'TRACKING_RESUMED',
};

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

const near = opts.near ? AIRPORTS.find((a) => a.code === opts.near.toUpperCase()) : undefined;
if (opts.near && !near) throw new Error(`Unknown airport ${opts.near}`);
const minTurn = opts['min-turn'] ? Number(opts['min-turn']) : null;
let checked = 0;

/** Points within ±45 min of any moment the aircraft was within 30 km of `near` below 10,000 ft, else []. */
function aroundAirport(points: TracePoint[]): TracePoint[] {
  const close = points
    .filter((p) => p.ac.alt_baro === 'ground' || (typeof p.ac.alt_baro === 'number' && p.ac.alt_baro < 10000))
    .filter((p) => distanceKm(p.ac.lat!, p.ac.lon!, near!.lat, near!.lon) <= 30)
    .map((p) => p.ts);
  if (!close.length) return [];
  const pad = 45 * 60_000;
  return points.filter((p) => close.some((t) => Math.abs(p.ts - t) <= pad));
}

// A folder stands for every .json trace in it (a sweep can have thousands).
const files = inputs.flatMap((src) => (!/^https?:/.test(src) && statSync(src).isDirectory() ? readdirSync(src).filter((f) => f.endsWith('.json')).map((f) => join(src, f)) : [src]));

for (const src of files) {
  let points = tracePoints(await readTrace(src));
  if (near) {
    points = aroundAirport(points);
    if (!points.length) continue;
    checked++;
  }
  const pipeline = new Pipeline({ mode: 'recorded', staleSec: Number(opts['stale-sec'] ?? 120) });
  // Sessions are pruned as replay time moves on, so keep each event's latest version as we go.
  const found = new Map<string, { e: FlightEvent; callsign: string | null }>();
  for (const poll of toPolls(points)) {
    pipeline.ingest(poll);
    for (const s of pipeline.store.current()) for (const e of s.events) found.set(`${s.id}/${e.id}`, { e, callsign: s.callsign });
  }
  const bigTurn = (e: FlightEvent) => minTurn !== null && e.type === 'turn' && (e.evidence.degrees ?? 0) >= minTurn;
  const rows = [...found.values()]
    .filter(({ e }) => (opts.type ? INSIGHT[e.type] === opts.type : !ROUTINE.has(e.type) || bigTurn(e)))
    .sort((a, b) => a.e.startTs - b.e.startTs);
  // In a sweep, only aircraft with something to report are listed.
  if (near && !rows.length) continue;
  console.log(`\n${src}: ${points.length} points, ${utc(points[0].ts)} – ${utc(points[points.length - 1].ts)} UTC`);
  if (!rows.length) console.log('  no matching patterns detected');
  for (const { e, callsign } of rows) {
    const ap = e.evidence.lat !== undefined ? nearestAirport(e.evidence.lat, e.evidence.lon!, 60) : null;
    console.log(
      `  ${INSIGHT[e.type].padEnd(18)} ${utc(e.startTs)} – ${utc(e.endTs).slice(11)} UTC  ${callsign ?? '?'}${e.evidence.degrees ? `  ${e.evidence.degrees}°` : ''}${ap ? `  near ${ap.airport.code}` : ''}` +
        `  (from=${e.startTs - config.insight.recentSec * 1000} to=${e.endTs + config.insight.recentSec * 1000})`,
    );
  }
}
if (near) console.log(`\nChecked ${checked} aircraft that came within 30 km of ${near.code} below 10,000 ft.`);
