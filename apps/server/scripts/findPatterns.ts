// Lists the patterns Aerotrack detects in an archived trace, to choose a demo snippet. Writes nothing.
//
// Usage:
//   npm run find:patterns -- path/to/trace_full_7c4a45.json [--type GO_AROUND] [--stale-sec 120]
import { config, nearestAirport, Pipeline, type EventType, type FlightEvent } from '@aerotrack/core';
import { readTrace, toPolls, tracePoints } from './trace';

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

for (const src of inputs) {
  const points = tracePoints(await readTrace(src));
  const pipeline = new Pipeline({ mode: 'recorded', staleSec: Number(opts['stale-sec'] ?? 120) });
  // Sessions are pruned as replay time moves on, so keep each event's latest version as we go.
  const found = new Map<string, { e: FlightEvent; callsign: string | null }>();
  for (const poll of toPolls(points)) {
    pipeline.ingest(poll);
    for (const s of pipeline.store.current()) for (const e of s.events) found.set(`${s.id}/${e.id}`, { e, callsign: s.callsign });
  }
  const rows = [...found.values()]
    .filter(({ e }) => (opts.type ? INSIGHT[e.type] === opts.type : !ROUTINE.has(e.type)))
    .sort((a, b) => a.e.startTs - b.e.startTs);
  console.log(`\n${src}: ${points.length} points, ${utc(points[0].ts)} – ${utc(points[points.length - 1].ts)} UTC`);
  if (!rows.length) console.log('  no matching patterns detected');
  for (const { e, callsign } of rows) {
    const near = e.evidence.lat !== undefined ? nearestAirport(e.evidence.lat, e.evidence.lon!, 60) : null;
    console.log(
      `  ${INSIGHT[e.type].padEnd(18)} ${utc(e.startTs)} – ${utc(e.endTs).slice(11)} UTC  ${callsign ?? '?'}${near ? `  near ${near.airport.code}` : ''}` +
        `  (from=${e.startTs - config.insight.recentSec * 1000} to=${e.endTs + config.insight.recentSec * 1000})`,
    );
  }
}
