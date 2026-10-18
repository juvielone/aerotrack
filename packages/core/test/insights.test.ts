// Synthetic test cases for the Insights panel lifecycle. Never shown as real data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { detectEvents, type DetectContext } from '../src/detectors';
import { analyseFlight } from '../src/insights/analyseFlight';
import { evidenceLine, selectInsight } from '../src/insights/select';
import { Pipeline } from '../src/pipeline';
import type { EventType, FlightEvent, SignalState } from '../src/types';
import { path, polls, series, T0 } from './helpers';

const S = 1000;
const ok: SignalState = { stale: false, secondsSinceLast: 5 };

function ev(type: EventType, startSec: number, endSec: number, ongoing: boolean, evidence: Partial<FlightEvent['evidence']> = {}): FlightEvent {
  const startTs = T0 + startSec * S;
  const endTs = T0 + endSec * S;
  return { id: `${type}-${startTs}`, type, severity: 'info', startTs, endTs, ongoing, text: '', evidence: { startTs, endTs, ...evidence } };
}

/** What the panel shows at second `atSec`: the primary insight type, or 'default'. */
function panel(events: FlightEvent[], atSec: number, signal: SignalState = ok): string {
  const now = T0 + atSec * S;
  return selectInsight(analyseFlight({ events, signal }, now), now)?.primary.type ?? 'default';
}

describe('insights panel: show and revert', () => {
  it('shows an active event once it has lasted the minimum time', () => {
    const rapid = ev('rapid-descent', 0, 40, true, { startAlt: 30000, endAlt: 26000, rateFpm: -6200, obsCount: 5 });
    expect(panel([rapid], 40)).toBe('RAPID_DESCENT');
  });

  it('reverts to the default content after the condition has been cleared for minClearedSec', () => {
    const climb = ev('climb', 0, 120, false, { startAlt: 3000, endAlt: 9000 });
    const cleared = config.insight.minClearedSec.climb;
    expect(panel([climb], 120 + cleared - 1)).toBe('CLIMB');
    expect(panel([climb], 120 + cleared + 1)).toBe('default');
  });

  it('does not treat an "ongoing" pattern as active once the aircraft has gone quiet', () => {
    const climb = ev('climb', 0, 120, true);
    const stale: SignalState = { stale: true, secondsSinceLast: 300, cause: 'unexpected', text: 'x' };
    const now = T0 + 420 * S;
    expect(analyseFlight({ events: [climb], signal: stale }, now).map((i) => i.type)).toEqual(['TRACKING_INTERRUPTED']);
  });
});

describe('insights panel: flicker suppression', () => {
  it('does not show a pattern that lasted less than minActiveSec', () => {
    const blip = ev('turn', 0, config.insight.minActiveSec - 5, true, { degrees: 30, direction: 'right' });
    expect(panel([blip], config.insight.minActiveSec - 5)).toBe('default');
  });

  it('stays on the insight when noisy data briefly breaks the pattern', () => {
    // Climb detected 0–100 s, not detected for 10 s, then detected again from 110 s.
    const a = ev('climb', 0, 100, false);
    const b = ev('climb', 110, 200, true);
    const seen = [100, 105, 110, 115, 150, 200].map((t) => panel(t < 110 ? [a] : [a, b], t));
    expect(seen.every((p) => p === 'CLIMB')).toBe(true);
  });
});

describe('insights panel: momentary insights', () => {
  it('shows a confirmed go-around as Recent for recentSec, then reverts', () => {
    const ga = ev('go-around', 0, 300, false, { airport: 'SYD', lowestAlt: 600 });
    const now = T0 + 310 * S;
    const [first] = analyseFlight({ events: [ga], signal: ok }, now);
    expect(first.status).toBe('recent');
    expect(panel([ga], 300 + config.insight.recentSec - 1)).toBe('GO_AROUND');
    expect(panel([ga], 300 + config.insight.recentSec + 1)).toBe('default');
  });

  it('shows an ignored glitch as Recent', () => {
    const g = ev('glitch', 50, 50, false, { rejectedAlt: 12000 });
    expect(panel([g], 60)).toBe('DATA_GLITCH');
    expect(panel([g], 50 + config.insight.recentSec + 1)).toBe('default');
  });

  it('shows a finished rapid descent as Recent once its cleared window has passed', () => {
    const rapid = ev('rapid-descent', 0, 60, false, { rateFpm: -6000 });
    const now = T0 + (60 + config.insight.minClearedSec['rapid-descent'] + 5) * S;
    expect(analyseFlight({ events: [rapid], signal: ok }, now)[0].status).toBe('recent');
  });

  it('says when position updates resumed after a gap', () => {
    const gap = ev('gap', 0, 240, false, { startAlt: 20000, durationSec: 240, gapCause: 'unexpected' });
    const now = T0 + 250 * S;
    const sel = selectInsight(analyseFlight({ events: [gap], signal: ok }, now), now);
    expect(sel?.primary.observed).toBe('Position updates resumed after a 4 min gap.');
    expect(panel([gap], 240 + config.insight.resumedSec + 1)).toBe('default');
  });
});

describe('insights panel: priority', () => {
  it('orders squawk > tracking gap > rapid descent > circling > go-around and counts the rest', () => {
    const all = [
      ev('go-around', 0, 590, false),
      ev('holding', 0, 600, true, { degrees: 400 }),
      ev('rapid-descent', 500, 600, true, { rateFpm: -6000 }),
      ev('squawk-7700', 500, 600, true),
      ev('climb', 0, 600, true),
    ];
    const now = T0 + 600 * S;
    const sel = selectInsight(analyseFlight({ events: all, signal: ok }, now), now);
    expect(sel?.primary.type).toBe('SQUAWK_7700');
    expect(sel?.moreCount).toBe(4);
    expect(analyseFlight({ events: all, signal: ok }, now).map((i) => i.type)).toEqual(['SQUAWK_7700', 'RAPID_DESCENT', 'POSSIBLE_CIRCLING', 'GO_AROUND', 'CLIMB']);

    const lost: SignalState = { stale: true, secondsSinceLast: 120, cause: 'unexpected', text: 'x' };
    const noSquawk = all.filter((e) => e.type !== 'squawk-7700');
    expect(panel(noSquawk, 600, lost)).toBe('TRACKING_INTERRUPTED');
    expect(panel(noSquawk.filter((e) => e.type !== 'rapid-descent'), 600)).toBe('POSSIBLE_CIRCLING');
  });
});

describe('insights: wording and evidence', () => {
  it('formats a compact evidence line', () => {
    expect(evidenceLine({ windowStart: T0, windowEnd: T0 + 40 * S, rate: -6170, sampleCount: 5 })).toBe('−6,200 ft/min over 40 s, 5 readings');
    expect(evidenceLine({ windowStart: T0, windowEnd: T0 })).toBe('');
  });

  it('never says FlightSense and never states a cause for squawks', () => {
    const now = T0 + 60 * S;
    const ins = analyseFlight({ events: [ev('squawk-7700', 0, 60, true), ev('squawk-7600', 0, 60, true)], signal: ok }, now);
    for (const i of ins) {
      expect(JSON.stringify(i)).not.toMatch(/FlightSense/);
      expect(i.limitations).toMatch(/can't tell/);
    }
  });

  it('labels circling as possible and carries its confidence', () => {
    const now = T0 + 300 * S;
    const [c] = analyseFlight({ events: [ev('holding', 0, 300, true, { degrees: 500, confidence: 'high', startAlt: 9000 })], signal: ok }, now);
    expect(c.title).toBe('Possible circling');
    expect(c.confidence).toBe('high');
  });
});

describe('detectors: edge cases (synthetic)', () => {
  const ctx: DetectContext = { mode: 'recorded', staleSec: 60, feedDownDuring: () => false, isLowCoverage: () => false };
  const typesOf = (obs: Parameters<typeof detectEvents>[0]) => detectEvents(obs, ctx).map((e) => e.type);

  it('never emits 7500 (type only)', () => {
    const obs = series(20, 5, () => ({ squawk: '7500' }));
    expect(typesOf(obs).filter((t) => t.startsWith('squawk'))).toEqual([]);
  });

  it('treats emergency=general as 7700 and emergency=nordo as 7600', () => {
    expect(typesOf(series(10, 5, () => ({ emergency: 'general' })))).toContain('squawk-7700');
    expect(typesOf(series(10, 5, () => ({ emergency: 'nordo' })))).toContain('squawk-7600');
  });

  it('skips turn and circling rules when track is missing', () => {
    const obs = path(96, 5, (k) => ({ track: (k * 15) % 360, alt: 9000, gs: 200 })).map((o) => ({ ...o, track: null }));
    expect(typesOf(obs)).not.toContain('holding');
    expect(typesOf(obs)).not.toContain('turn');
  });

  it('skips vertical rules when altitude is missing', () => {
    const obs = series(40, 5, () => ({ alt: null, baroRate: -6000 }));
    expect(typesOf(obs).filter((t) => t === 'climb' || t === 'descent' || t === 'rapid-descent')).toEqual([]);
  });
});

describe('replay timing', () => {
  afterEach(() => vi.useRealTimers());

  it('uses replay time, so a flight replayed days later does not show tracking interrupted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 5 * 24 * 3600 * S); // wall clock: five days after the recording
    const obs = series(30, 5, (k) => ({ alt: 35000 - Math.max(0, k - 5) * 550, baroRate: k >= 5 ? -6600 : 0 }));
    const p = new Pipeline({ mode: 'recorded' });
    for (const poll of polls(obs)) p.ingest(poll);
    const d = p.detail(p.snapshot().aircraft[0].sessionId)!;
    expect(d.signal.stale).toBe(false);
    expect(d.insights.map((i) => i.type)).not.toContain('TRACKING_INTERRUPTED');
    expect(d.insights[0].type).toBe('RAPID_DESCENT');
  });

  it('follows the replay clock for showing and reverting', () => {
    const obs = series(30, 5, (k) => ({ alt: 35000 - Math.max(0, k - 5) * 550, baroRate: k >= 5 ? -6600 : 0 }));
    const p = new Pipeline({ mode: 'recorded' });
    for (const poll of polls(obs)) p.ingest(poll);
    const id = p.snapshot().aircraft[0].sessionId;
    const last = obs[obs.length - 1].ts;
    const at = (ms: number) => {
      const d = p.detail(id, ms)!;
      return selectInsight(d.insights, ms)?.primary.type ?? 'default';
    };
    expect(at(last)).toBe('RAPID_DESCENT');
    // Replay paused long enough for the aircraft to look stale: the gap takes over.
    expect(at(last + 5 * 60 * S)).toBe('TRACKING_INTERRUPTED');
  });
});
