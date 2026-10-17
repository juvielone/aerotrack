import type { Observation } from '../types';
import { type Detected, sec } from './common';

type Kind = 'squawk-7700' | 'squawk-7600';

function kindOf(o: Observation): Kind | null {
  if (o.squawk === '7700' || o.emergency === 'general') return 'squawk-7700';
  if (o.squawk === '7600' || o.emergency === 'nordo') return 'squawk-7600';
  return null;
}

/** Emergency (7700) and radio-failure (7600) codes. Stated as fact only; no cause. */
export function detectSquawks(obs: Observation[]): Detected[] {
  const out: Detected[] = [];
  let cur: { kind: Kind; from: number; to: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const a = obs[cur.from];
    const b = obs[cur.to];
    out.push({
      type: cur.kind,
      severity: 'alert',
      startTs: a.ts,
      endTs: b.ts,
      ongoing: cur.to === obs.length - 1,
      evidence: {
        startTs: a.ts,
        endTs: b.ts,
        squawk: cur.kind === 'squawk-7700' ? '7700' : '7600',
        durationSec: sec(b.ts - a.ts),
        obsCount: cur.to - cur.from + 1,
        startAlt: a.alt,
        endAlt: b.alt,
      },
    });
    cur = null;
  };
  obs.forEach((o, i) => {
    const k = kindOf(o);
    if (k && cur?.kind === k) cur.to = i;
    else {
      flush();
      if (k) cur = { kind: k, from: i, to: i };
    }
  });
  flush();
  return out;
}
