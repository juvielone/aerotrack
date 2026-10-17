import { config } from '../config';
import { trackDelta } from '../geo';
import type { Observation } from '../types';
import { type Detected, sec } from './common';

interface Step {
  i: number;
  ts: number;
  d: number;
}

/** Track changes between consecutive airborne observations, not bridging data gaps. */
function steps(obs: Observation[], staleSec: number): Step[][] {
  const runs: Step[][] = [];
  let cur: Step[] = [];
  let prev: Observation | null = null;
  obs.forEach((o, i) => {
    if (o.onGround || o.track === null) {
      if (cur.length) runs.push(cur);
      cur = [];
      prev = null;
      return;
    }
    if (prev && prev.track !== null) {
      if (o.ts - prev.ts > staleSec * 1000) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else {
        cur.push({ i, ts: o.ts, d: trackDelta(prev.track, o.track) });
      }
    }
    if (!cur.length) cur.push({ i, ts: o.ts, d: 0 });
    prev = o;
  });
  if (cur.length) runs.push(cur);
  return runs;
}

/**
 * Possible holding / circling (PRD §4): cumulative track change ≥ 300° within ~6 min at a roughly level altitude.
 */
export function detectHolding(obs: Observation[], staleSec: number): Detected[] {
  const { minDeg, windowSec, maxAltSpreadFt } = config.holding;
  const out: Detected[] = [];
  for (const run of steps(obs, staleSec)) {
    const cum: number[] = [];
    let c = 0;
    for (const s of run) cum.push((c += s.d));
    const windows: [number, number][] = [];
    for (let j = 0; j < run.length; j++) {
      for (let i = j - 1; i >= 0 && run[j].ts - run[i].ts <= windowSec * 1000; i--) {
        if (Math.abs(cum[j] - cum[i]) >= minDeg) {
          const alts = run.slice(i, j + 1).map((s) => obs[s.i]).filter((o) => o.alt !== null && !o.glitch).map((o) => o.alt as number);
          if (alts.length && Math.max(...alts) - Math.min(...alts) <= maxAltSpreadFt) windows.push([i, j]);
          break;
        }
      }
    }
    // Merge overlapping qualifying windows into episodes.
    let ep: [number, number] | null = null;
    const episodes: [number, number][] = [];
    for (const w of windows) {
      if (ep && w[0] <= ep[1]) ep[1] = Math.max(ep[1], w[1]);
      else {
        if (ep) episodes.push(ep);
        ep = [w[0], w[1]];
      }
    }
    if (ep) episodes.push(ep);
    for (const [a, b] of episodes) {
      const first = obs[run[a].i];
      const last = obs[run[b].i];
      const degrees = Math.abs(cum[b] - cum[a]);
      out.push({
        type: 'holding',
        severity: 'notice',
        startTs: first.ts,
        endTs: last.ts,
        ongoing: run[b].i === obs.length - 1,
        evidence: {
          startTs: first.ts,
          endTs: last.ts,
          startAlt: first.alt,
          endAlt: last.alt,
          degrees: Math.round(degrees),
          direction: cum[b] - cum[a] > 0 ? 'right' : 'left',
          durationSec: sec(last.ts - first.ts),
          obsCount: b - a + 1,
        },
      });
    }
  }
  return out;
}

/**
 * Sustained turn (PRD §4): cumulative track change ≥ 30° within 90 s, ignoring < 5° per sample, wraparound-safe.
 * Turns inside a holding episode are not reported separately.
 */
export function detectTurns(obs: Observation[], staleSec: number, holding: Detected[]): Detected[] {
  const { minDeg, windowSec, noiseDeg, maxStraightSec } = config.turn;
  const out: Detected[] = [];
  for (const run of steps(obs, staleSec)) {
    let k = 0;
    while (k < run.length) {
      if (Math.abs(run[k].d) < noiseDeg) {
        k++;
        continue;
      }
      const dir = Math.sign(run[k].d);
      let end = k;
      let lastTurnTs = run[k].ts;
      for (let j = k + 1; j < run.length; j++) {
        const d = run[j].d;
        if (Math.abs(d) < noiseDeg) {
          if (run[j].ts - lastTurnTs > maxStraightSec * 1000) break;
          continue;
        }
        if (Math.sign(d) !== dir) break;
        end = j;
        lastTurnTs = run[j].ts;
      }
      // Max turning inside any 90 s window of this run.
      let best = 0;
      let lo = k;
      let sum = 0;
      for (let j = k; j <= end; j++) {
        if (Math.abs(run[j].d) >= noiseDeg) sum += Math.abs(run[j].d);
        while (run[j].ts - run[lo].ts > windowSec * 1000) {
          if (Math.abs(run[lo].d) >= noiseDeg) sum -= Math.abs(run[lo].d);
          lo++;
        }
        best = Math.max(best, sum);
      }
      if (best >= minDeg) {
        const total = run.slice(k, end + 1).reduce((s, x) => s + (Math.abs(x.d) >= noiseDeg ? Math.abs(x.d) : 0), 0);
        // The turn starts at the observation before the first turning step.
        const first = obs[k > 0 ? run[k - 1].i : run[k].i];
        const last = obs[run[end].i];
        const insideHold = holding.some((h) => first.ts <= h.endTs && last.ts >= h.startTs);
        if (!insideHold) {
          out.push({
            type: 'turn',
            severity: 'info',
            startTs: first.ts,
            endTs: last.ts,
            ongoing: run[end].i === obs.length - 1,
            evidence: {
              startTs: first.ts,
              endTs: last.ts,
              degrees: Math.round(total),
              direction: dir > 0 ? 'right' : 'left',
              durationSec: sec(last.ts - first.ts),
              obsCount: end - k + 2,
            },
          });
        }
      }
      k = end + 1;
    }
  }
  return out;
}
