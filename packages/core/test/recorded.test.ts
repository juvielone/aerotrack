// Replays real recorded flights from data/recorded/*.json (supplied separately) and checks the expected insight.
// Template files with no points are skipped: they are placeholders, not data.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyseFlight } from '../src/insights/analyseFlight';
import type { FlightPoint, InsightType } from '../src/insights/types';
import { Pipeline } from '../src/pipeline';
import type { RawPoll } from '../src/types';

const DIR = join(__dirname, '../../../data/recorded');

interface RecordedFlight {
  id: string;
  title: string;
  flight: { callsign: string; hex?: string };
  expectedInsight: { type: InsightType | null };
  points: FlightPoint[];
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const flights = files.map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as RecordedFlight);

function toPolls(f: RecordedFlight): RawPoll[] {
  const callsign = f.flight.callsign === 'UNKNOWN' ? undefined : f.flight.callsign;
  return [...f.points]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((p) => ({
      now: p.timestamp,
      ac: [
        {
          hex: f.flight.hex ?? f.id,
          flight: callsign,
          lat: p.lat,
          lon: p.lon,
          alt_baro: p.onGround ? 'ground' : (p.altitudeFt ?? undefined),
          gs: p.groundSpeedKt ?? undefined,
          track: p.headingDeg ?? undefined,
          baro_rate: p.verticalRateFpm ?? undefined,
          squawk: p.squawk ?? undefined,
          emergency: p.emergency ?? undefined,
          seen_pos: 0,
        },
      ],
    }));
}

describe('recorded flights', () => {
  it('finds the recorded-flight folder', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of flights) {
    const run = f.points.length && f.expectedInsight.type ? it : it.skip;
    run(`${f.id}: shows ${f.expectedInsight.type} at some point during replay`, () => {
      // Archive traces are thinned in steady flight; match the importer's 120 s gap threshold.
      const p = new Pipeline({ mode: 'recorded', staleSec: 120 });
      const seen = new Set<InsightType>();
      for (const poll of toPolls(f)) {
        p.ingest(poll);
        for (const s of p.store.current()) {
          for (const i of analyseFlight({ events: s.events, signal: p.signal(s, poll.now, false) }, poll.now)) seen.add(i.type);
        }
      }
      expect([...seen]).toContain(f.expectedInsight.type);
    }, 120_000);
  }
});
