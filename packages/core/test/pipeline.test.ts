import { describe, expect, it } from 'vitest';
import { Pipeline } from '../src/pipeline';
import { SessionStore } from '../src/sessions';
import { computeStatus } from '../src/status';
import { searchFlights } from '../src/search';
import { aircraftClass } from '../src/filters';
import { path, polls, series, SYD, T0 } from './helpers';

describe('flight sessions', () => {
  it('ignores duplicate and out-of-order observations', () => {
    const store = new SessionStore();
    const obs = series(5, 5, () => ({}));
    store.ingest(obs);
    store.ingest(obs);
    store.ingest([obs[2]]);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].obs).toHaveLength(5);
  });

  it('starts a new session when the callsign changes', () => {
    const store = new SessionStore({ historyWindowSec: null });
    store.ingest([...series(5, 5, () => ({ callsign: 'QFA1' })), ...series(5, 5, () => ({ callsign: 'QFA2' }), T0 + 60_000)]);
    const s = store.all();
    expect(s.map((x) => x.callsign)).toEqual(['QFA1', 'QFA2']);
  });

  it('starts a new session after > 20 min unseen', () => {
    const store = new SessionStore({ historyWindowSec: null });
    store.ingest([...series(5, 5, () => ({})), ...series(5, 5, () => ({}), T0 + 25 * 60_000)]);
    expect(store.all()).toHaveLength(2);
  });

  it('starts a new session on take-off after a landing, and events never carry over', () => {
    const p = new Pipeline({ mode: 'recorded' });
    const inbound = series(20, 5, (k) => (k < 15 ? { squawk: '7700', alt: 3000 - k * 150 } : { onGround: true, alt: null, gs: 30, squawk: '1234' }));
    const ground = series(10, 30, () => ({ onGround: true, alt: null, gs: 5, squawk: '1234' }), T0 + 200_000);
    const outbound = series(10, 5, (k) => ({ alt: 500 + k * 300, gs: 160, squawk: '1234' }), T0 + 600_000);
    for (const poll of polls(inbound, ground, outbound)) p.ingest(poll);
    const sessions = p.store.all();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].landed).toBe(true);
    expect(sessions[0].events.some((e) => e.type === 'squawk-7700')).toBe(true);
    expect(sessions[1].events.some((e) => e.type === 'squawk-7700')).toBe(false);
  });

  it('does not split on ground-flag flicker during the landing roll', () => {
    const store = new SessionStore({ historyWindowSec: null });
    store.ingest(series(12, 2, (k) => (k === 0 ? { alt: 300, gs: 140 } : k === 4 ? { alt: 25, gs: 70 } : { onGround: k > 0, alt: k > 0 ? null : 300, gs: 100 - k * 5 })));
    expect(store.all()).toHaveLength(1);
  });
});

describe('status tag', () => {
  it('shows Landed after an airborne → ground transition, even once the signal goes quiet', () => {
    const store = new SessionStore();
    store.ingest(series(20, 5, (k) => (k < 15 ? { alt: 1500 - k * 100, baroRate: -700, gs: 140 } : { onGround: true, alt: null, gs: 60 - k * 2 })));
    const s = store.all()[0];
    expect(computeStatus(s, s.lastTs)).toBe('Landed');
    expect(computeStatus(s, s.lastTs + 30 * 60_000)).toBe('Landed');
  });

  it('shows Cruising, Climbing, Approach, Taxiing and Unknown', () => {
    const mk = (obs: ReturnType<typeof series>) => {
      const st = new SessionStore();
      st.ingest(obs);
      return st.all()[0];
    };
    const cruise = mk(series(10, 5, () => ({ alt: 36000, baroRate: 0 })));
    expect(computeStatus(cruise, cruise.lastTs)).toBe('Cruising');
    expect(computeStatus(cruise, cruise.lastTs + 120_000)).toBe('Unknown');
    const climb = mk(series(10, 5, (k) => ({ alt: 8000 + k * 200, baroRate: 2400 })));
    expect(computeStatus(climb, climb.lastTs)).toBe('Climbing');
    const approach = mk(series(10, 5, (k) => ({ alt: 3000 - k * 70, baroRate: -800, lat: SYD.lat - 0.1, lon: SYD.lon })));
    expect(computeStatus(approach, approach.lastTs)).toBe('Approach');
    const taxi = mk(series(5, 5, () => ({ onGround: true, alt: null, gs: 15 })));
    expect(computeStatus(taxi, taxi.lastTs)).toBe('Taxiing');
    const few = mk(series(2, 5, () => ({})));
    expect(computeStatus(few, few.lastTs)).toBe('Unknown');
  });
});

describe('feed health', () => {
  const traffic = () => Array.from({ length: 6 }, (_, n) => series(10, 5, () => ({ hex: `a${n}`, callsign: `TST${n}`, lat: SYD.lat - 0.3 - n * 0.1 })));

  it('blames our feed, not the aircraft, when polls fail', () => {
    const p = new Pipeline({ mode: 'live' });
    for (const poll of polls(...traffic())) p.ingest(poll);
    const last = T0 + 45_000;
    for (let t = last + 5000; t <= last + 90_000; t += 5000) p.ingest({ now: t, error: 'HTTP 503' });
    const snap = p.snapshot(last + 90_000);
    expect(snap.feed.down).toBe(true);
    expect(snap.aircraft.every((a) => a.signal.cause === 'feed')).toBe(true);
    expect(snap.aircraft[0].signal.text).toMatch(/problem on our side/);
  });

  it('treats all aircraft going stale at once as a feed problem', () => {
    const p = new Pipeline({ mode: 'live' });
    for (const poll of polls(...traffic())) p.ingest(poll);
    p.ingest({ now: T0 + 150_000, ac: [] });
    expect(p.snapshot(T0 + 150_000).feed.down).toBe(true);
  });

  it('reports a single aircraft gap as unexpected when the feed is healthy', () => {
    const p = new Pipeline({ mode: 'live' });
    const others = Array.from({ length: 6 }, (_, n) => series(40, 5, () => ({ hex: `b${n}`, callsign: `OK${n}`, lat: SYD.lat - 0.3 - n * 0.1 })));
    const lost = series(10, 5, () => ({ hex: 'lost1', callsign: 'LOST1', lat: SYD.lat - 0.2 }));
    for (const poll of polls(...others, lost)) p.ingest(poll);
    const a = p.snapshot(T0 + 195_000).aircraft.find((x) => x.hex === 'lost1')!;
    expect(a.signal.stale).toBe(true);
    expect(a.signal.cause).toBe('unexpected');
    expect(a.signal.text).toMatch(/We stopped receiving positions from this aircraft/);
  });
});

describe('pipeline', () => {
  it('keeps full history for a selected aircraft and marks insufficient history', () => {
    const p = new Pipeline({ mode: 'recorded' });
    for (const poll of polls(path(30, 5, () => ({ track: 90 })))) p.ingest(poll);
    const id = p.snapshot().aircraft[0].sessionId;
    const d = p.detail(id)!;
    expect(d.track).toHaveLength(30);
    expect(d.insufficientHistory).toBe(false);
    const p2 = new Pipeline({ mode: 'recorded' });
    for (const poll of polls(series(2, 5, () => ({})))) p2.ingest(poll);
    expect(p2.detail(p2.snapshot().aircraft[0].sessionId)!.insufficientHistory).toBe(true);
  });
});

describe('search', () => {
  const items = [
    { sessionId: '1', callsign: 'QFA1', reg: 'VH-OQA', hex: '7c4ee8' },
    { sessionId: '2', callsign: 'QLK426D', reg: 'VH-QON', hex: '7c5305' },
    { sessionId: '3', callsign: 'JST761', reg: 'VH-VQG', hex: '7c6c96' },
  ];
  it('maps flight number to callsign (QF1 → QFA1)', () => {
    expect(searchFlights('QF1', items).exact.map((i) => i.sessionId)).toEqual(['1']);
    expect(searchFlights('jq 761', items).exact.map((i) => i.sessionId)).toEqual(['3']);
    expect(searchFlights('VHVQG', items).exact.map((i) => i.sessionId)).toEqual(['3']);
  });
  it('suggests near matches for operational callsigns', () => {
    const r = searchFlights('QF426', items);
    expect(r.exact).toEqual([]);
    expect(r.suggestions.map((i) => i.sessionId)).toContain('2');
  });
});

describe('aircraft class', () => {
  it('treats A0 airliners with an airline callsign as passenger and excludes military', () => {
    expect(aircraftClass({ category: 'A0', dbFlags: 0, callsign: 'JST761' })).toBe('passenger');
    expect(aircraftClass({ category: 'A3', dbFlags: 1, callsign: 'ASY01' })).toBe('military');
    expect(aircraftClass({ category: 'B2', dbFlags: 0, callsign: null })).toBe('non-airliner');
    expect(aircraftClass({ category: 'A7', dbFlags: 0, callsign: 'RSCU201' })).toBe('rotorcraft');
  });
});
