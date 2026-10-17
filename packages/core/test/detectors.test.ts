import { describe, expect, it } from 'vitest';
import { detectEvents, type DetectContext } from '../src/detectors';
import { segmentTrack } from '../src/clean';
import { trackDelta } from '../src/geo';
import type { EventType, Observation } from '../src/types';
import { path, series, SYD, T0 } from './helpers';

const ctx = (over: Partial<DetectContext> = {}): DetectContext => ({
  mode: 'recorded',
  staleSec: 60,
  feedDownDuring: () => false,
  isLowCoverage: () => false,
  ...over,
});

const types = (obs: Observation[], c = ctx()) => detectEvents(obs, c).map((e) => e.type);
const has = (obs: Observation[], t: EventType, c = ctx()) => types(obs, c).includes(t);

// Deterministic pseudo-random noise.
const noise = (k: number, amp: number) => Math.sin(k * 12.9898) * amp;

describe('track wraparound', () => {
  it('computes the short way round 359°/1°', () => {
    expect(trackDelta(359, 1)).toBe(2);
    expect(trackDelta(1, 359)).toBe(-2);
    expect(trackDelta(350, 10)).toBe(20);
    expect(Math.abs(trackDelta(10, 190))).toBe(180);
  });

  it('detects a 40° right turn through north, not a 320° left turn', () => {
    const obs = path(20, 5, (k) => ({ track: (340 + Math.min(k, 8) * 5) % 360 }));
    const ev = detectEvents(obs, ctx()).filter((e) => e.type === 'turn');
    expect(ev).toHaveLength(1);
    expect(ev[0].evidence.direction).toBe('right');
    expect(ev[0].evidence.degrees).toBe(40);
    expect(has(obs, 'holding')).toBe(false);
  });
});

describe('noise', () => {
  it('reports nothing for level cruise with small track and altitude jitter', () => {
    const obs = path(120, 5, (k) => ({ track: 90 + noise(k, 3), alt: 36000 + Math.round(noise(k + 7, 50)), gs: 460, baroRate: Math.round(noise(k + 3, 64)) }));
    expect(types(obs)).toEqual([]);
  });

  it('needs at least 60 s and 4 observations for a climb', () => {
    const short = series(4, 10, (k) => ({ alt: 5000 + k * 400, baroRate: 2400 })); // 30 s
    expect(has(short, 'climb')).toBe(false);
    const long = series(8, 10, (k) => ({ alt: 5000 + k * 400, baroRate: 2400 })); // 70 s, 2,800 ft
    expect(has(long, 'climb')).toBe(true);
  });
});

describe('altitude glitch', () => {
  it('flags a one-sample spike as a bad reading, not a dive', () => {
    const obs = series(30, 5, (k) => ({ alt: k === 12 ? 3000 : 35000, baroRate: 0 }));
    const t = types(obs);
    expect(t).toContain('glitch');
    expect(t).not.toContain('rapid-descent');
    expect(t).not.toContain('descent');
    expect(obs[12].glitch).toBe(true);
  });

  it('does not flag a genuine sustained descent', () => {
    const obs = series(40, 5, (k) => ({ alt: 30000 - k * 250, baroRate: -3000 }));
    expect(types(obs)).not.toContain('glitch');
    expect(types(obs)).toContain('descent');
  });
});

describe('rapid descent', () => {
  it('detects > 5,000 fpm sustained for ≥ 30 s, reported once (not also as a descent)', () => {
    const obs = series(30, 5, (k) => ({ alt: 35000 - Math.max(0, k - 5) * 550, baroRate: k >= 5 && k < 25 ? -6600 : 0 }));
    const ev = detectEvents(obs, ctx());
    const rapid = ev.filter((e) => e.type === 'rapid-descent');
    expect(rapid).toHaveLength(1);
    expect(Math.abs(rapid[0].evidence.rateFpm!)).toBeGreaterThan(5000);
    expect(rapid[0].text).toMatch(/Descending unusually quickly/);
    expect(ev.some((e) => e.type === 'descent')).toBe(false);
  });

  it('ignores a bad baro_rate when altitude is not actually dropping', () => {
    const obs = series(20, 5, () => ({ alt: 20000, baroRate: -7000 }));
    expect(has(obs, 'rapid-descent')).toBe(false);
  });
});

describe('holding / circling', () => {
  it('detects ~2 full loops at level altitude and suppresses individual turns', () => {
    // Racetrack: 60 s turn (180°), 60 s straight, repeated.
    const obs = path(96, 5, (k) => {
      const seg = Math.floor(k / 12);
      const within = k % 12;
      const heading = seg % 2 === 0 ? (seg / 2) * 180 + within * 15 : ((seg + 1) / 2) * 180;
      return { track: heading % 360, alt: 9000 + Math.round(noise(k, 40)), gs: 220 };
    });
    const ev = detectEvents(obs, ctx());
    expect(ev.some((e) => e.type === 'holding')).toBe(true);
    expect(ev.some((e) => e.type === 'turn')).toBe(false);
  });

  it('does not call a continuous 360° orbit during a fast descent a hold', () => {
    const obs = path(30, 5, (k) => ({ track: (k * 15) % 360, alt: 20000 - k * 300, gs: 250 }));
    expect(has(obs, 'holding')).toBe(false);
  });
});

describe('go-around', () => {
  const nearSyd = { lat: SYD.lat - 0.06, lon: SYD.lon };
  const approachThenClimb = (land: boolean) =>
    path(land ? 90 : 50, 5, (k) => {
      if (k < 20) return { alt: 2000 - k * 75, gs: 150, track: 0, baroRate: -900 }; // down to ~575 ft
      if (k < 40) return { alt: 575 + (k - 19) * 150, gs: 170, track: 0, baroRate: 1800 }; // up to ~3,575 ft
      if (k < 50) return { alt: 3500, gs: 180, track: 180 };
      if (k < 85) return { alt: Math.max(100, 3500 - (k - 50) * 100), gs: 150, track: 0, baroRate: -1200 };
      return { onGround: true, alt: null, gs: 40, track: 0 };
    }, nearSyd);

  it('confirms only after a later landing', () => {
    expect(has(approachThenClimb(true), 'go-around')).toBe(true);
    expect(has(approachThenClimb(false), 'go-around')).toBe(false);
    expect(has(approachThenClimb(false), 'go-around-hint')).toBe(false);
  });

  it('never labels a normal departure climb', () => {
    const dep = path(40, 5, (k) => (k < 5 ? { onGround: true, alt: null, gs: 20 + k * 30 } : { alt: (k - 4) * 250, gs: 170, baroRate: 3000 }), { lat: SYD.lat, lon: SYD.lon });
    const withLanding = [...dep, ...path(5, 5, () => ({ onGround: true, alt: null, gs: 10 }), { lat: -37.67, lon: 144.84 }, dep[dep.length - 1].ts + 3600_000)];
    expect(has(withLanding, 'go-around')).toBe(false);
  });
});

describe('squawks', () => {
  it('reports 7700 and 7600 as facts', () => {
    const e7700 = detectEvents(series(5, 5, () => ({ squawk: '7700' })), ctx());
    expect(e7700[0].type).toBe('squawk-7700');
    expect(e7700[0].text).toBe('This aircraft is transmitting a general emergency code (7700).');
    const e7600 = detectEvents(series(5, 5, () => ({ squawk: '1234', emergency: 'nordo' })), ctx());
    expect(e7600.map((e) => e.type)).toContain('squawk-7600');
  });
});

describe('gaps', () => {
  const withGap = () => [
    ...series(10, 5, (k) => ({ alt: 30000, track: 90, lat: SYD.lat, lon: SYD.lon + k * 0.01 })),
    ...series(10, 5, (k) => ({ alt: 30000, track: 90, lat: SYD.lat, lon: SYD.lon + 0.5 + k * 0.01 }), T0 + 4 * 60_000),
  ];

  it('splits the track and explains the gap', () => {
    const obs = withGap();
    expect(segmentTrack(obs, 60)).toEqual([
      [0, 9],
      [10, 19],
    ]);
    const gap = detectEvents(obs, ctx()).find((e) => e.type === 'gap')!;
    expect(gap.evidence.gapCause).toBe('unexpected');
    expect(gap.text).toMatch(/The line shows a gap, not the actual path/);
  });

  it('blames our feed when it was down, and coverage in a known low-coverage zone', () => {
    expect(detectEvents(withGap(), ctx({ feedDownDuring: () => true })).find((e) => e.type === 'gap')!.evidence.gapCause).toBe('feed');
    expect(detectEvents(withGap(), ctx({ isLowCoverage: () => true })).find((e) => e.type === 'gap')!.evidence.gapCause).toBe('coverage');
  });

  it('does not count turns or climbs across a gap', () => {
    const obs = [...series(10, 5, () => ({ track: 0, alt: 10000 })), ...series(10, 5, () => ({ track: 180, alt: 20000 }), T0 + 10 * 60_000)];
    const t = types(obs);
    expect(t).not.toContain('turn');
    expect(t).not.toContain('climb');
  });
});

describe('determinism', () => {
  it('produces the same event ids when re-run (no repeated alerts)', () => {
    const obs = series(30, 5, (k) => ({ alt: 35000 - k * 600, baroRate: -7200, squawk: '7700' }));
    const a = detectEvents(obs, ctx()).map((e) => e.id);
    const b = detectEvents(obs, ctx()).map((e) => e.id);
    expect(a).toEqual(b);
  });
});
