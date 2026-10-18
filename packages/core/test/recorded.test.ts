// Replays real recorded flights from data/recorded/*.json (supplied separately) and checks the expected insight.
// Template files with no points are skipped: they are placeholders, not data.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyseFlight } from '../src/insights/analyseFlight';
import { selectInsight } from '../src/insights/select';
import type { FlightPoint, InsightType } from '../src/insights/types';
import { Pipeline } from '../src/pipeline';
import type { RawPoll } from '../src/types';

const DIR = join(__dirname, '../../../data/recorded');

interface RecordedFlight {
  id: string;
  title: string;
  flight: { callsign: string; hex?: string };
  expectedInsight: { type: InsightType | null };
  /** Look-alike regressions: patterns this real flight must never be shown as. */
  mustNotShow?: InsightType[];
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

  /** Every insight type the Insights panel would show (after its show gate) during a replay of the flight. */
  function shownDuringReplay(f: RecordedFlight): Set<InsightType> {
    // Archive traces are thinned in steady flight; match the importer's 120 s gap threshold.
    const p = new Pipeline({ mode: 'recorded', staleSec: 120 });
    const seen = new Set<InsightType>();
    for (const poll of toPolls(f)) {
      p.ingest(poll);
      for (const s of p.store.current()) {
        for (const i of analyseFlight({ events: s.events, signal: p.signal(s, poll.now, false) }, poll.now)) {
          if (selectInsight([i], poll.now)) seen.add(i.type);
        }
      }
    }
    return seen;
  }

  for (const f of flights) {
    const expected = f.expectedInsight.type;
    const mustNot = f.mustNotShow ?? [];
    const checks = [expected && `shows ${expected}`, mustNot.length && `never shows ${mustNot.join(', ')}`].filter(Boolean).join(' and ');
    const run = f.points.length && checks ? it : it.skip;
    run(`${f.id}: ${checks || 'template (no points)'} during replay`, () => {
      const seen = shownDuringReplay(f);
      if (expected) expect([...seen]).toContain(expected);
      for (const t of mustNot) expect([...seen]).not.toContain(t);
    }, 120_000);
  }
});
