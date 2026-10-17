import type { Observation } from '../types';
import { type DetectContext, type Detected, gapCause, sec } from './common';

/** One event per rejected altitude reading: "One altitude reading was inconsistent and has been ignored." */
export function glitchEvents(obs: Observation[], flagged: number[]): Detected[] {
  return flagged.map((i) => {
    const o = obs[i];
    return {
      type: 'glitch' as const,
      severity: 'info' as const,
      startTs: o.ts,
      endTs: o.ts,
      ongoing: false,
      evidence: { startTs: o.ts, endTs: o.ts, rejectedAlt: o.alt ?? undefined, lat: o.lat, lon: o.lon },
    };
  });
}

/** Gaps in the track longer than the stale threshold, with a cause classification (PRD §4.3). */
export function gapEvents(obs: Observation[], ctx: DetectContext): Detected[] {
  const out: Detected[] = [];
  for (let i = 1; i < obs.length; i++) {
    const a = obs[i - 1];
    const b = obs[i];
    if (b.ts - a.ts <= ctx.staleSec * 1000) continue;
    // Ground coverage is patchy (PRD §4.1 note): gaps while on the ground are expected, not notable.
    if (a.onGround && b.onGround) continue;
    const cause = a.onGround || b.onGround ? 'coverage' : gapCause(ctx, a.lat, a.lon, a.ts, b.ts);
    out.push({
      type: 'gap',
      severity: cause === 'unexpected' ? 'notice' : 'info',
      startTs: a.ts,
      endTs: b.ts,
      ongoing: false,
      evidence: {
        startTs: a.ts,
        endTs: b.ts,
        durationSec: sec(b.ts - a.ts),
        gapCause: cause,
        startAlt: a.alt,
        endAlt: b.alt,
        lat: a.lat,
        lon: a.lon,
      },
    });
  }
  return out;
}
