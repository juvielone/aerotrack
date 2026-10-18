import { config } from '../config';
import type { Observation } from '../types';
import { type Detected, sec } from './common';

type Dir = 1 | -1 | 0;

/**
 * Sustained climb / descent (PRD §4): ±1,000 ft over ≥ 60 s and ≥ 4 obs, or sustained |baro_rate| > 500 fpm.
 * One differing sample inside a run is tolerated as noise.
 */
export function detectClimbDescent(obs: Observation[], rates: (number | null)[]): Detected[] {
  const { altFt, windowSec, minObs, rateFpm } = config.vertical;
  const idx: number[] = [];
  const dirs: Dir[] = [];
  obs.forEach((o, i) => {
    const r = rates[i];
    if (r === null || o.alt === null) return;
    idx.push(i);
    dirs.push(r >= rateFpm * 0.6 ? 1 : r <= -rateFpm * 0.6 ? -1 : 0);
  });

  const out: Detected[] = [];
  let k = 0;
  while (k < idx.length) {
    const dir = dirs[k];
    if (dir === 0) {
      k++;
      continue;
    }
    let end = k;
    let j = k + 1;
    while (j < idx.length) {
      if (dirs[j] === dir) {
        end = j;
        j++;
      } else if (j + 1 < idx.length && dirs[j + 1] === dir) {
        j++; // single noisy sample
      } else break;
    }
    const first = obs[idx[k]];
    const last = obs[idx[end]];
    const count = end - k + 1;
    const dur = (last.ts - first.ts) / 1000;
    const dAlt = (last.alt as number) - (first.alt as number);
    const allFast = idx.slice(k, end + 1).every((i) => Math.abs(rates[i] as number) > rateFpm);
    if (count >= minObs && dur >= windowSec && (Math.abs(dAlt) >= altFt || allFast) && Math.sign(dAlt) === dir) {
      out.push({
        type: dir > 0 ? 'climb' : 'descent',
        severity: 'info',
        startTs: first.ts,
        endTs: last.ts,
        ongoing: idx[end] === obs.length - 1,
        evidence: {
          startTs: first.ts,
          endTs: last.ts,
          startAlt: first.alt,
          endAlt: last.alt,
          rateFpm: Math.round(dAlt / (dur / 60)),
          durationSec: sec(last.ts - first.ts),
          obsCount: count,
        },
      });
    }
    k = end + 1;
  }
  return out;
}

/**
 * Rapid descent (PRD §4), either of:
 * - steep: faster than ~5,000 fpm across ≥ 3 consistent observations for ≥ 30 s, losing at least `minLossFt`;
 * - large: ≥ `largeLossFt` lost within `largeWindowSec` at ≥ `largeMinAvgFpm` on average (a long emergency descent
 *   that is never steep for 30 s straight, e.g. a depressurisation descent at ~3,200 fpm for 8 min).
 * Overlapping episodes are reported once. Glitch-rejected readings are skipped, so this runs on the cleaned series.
 */
export function detectRapidDescent(obs: Observation[], rates: (number | null)[]): Detected[] {
  const out: Detected[] = [...steepDescents(obs, rates)];
  for (const d of largeDescents(obs)) {
    const i = out.findIndex((e) => e.startTs <= d.endTs && e.endTs >= d.startTs);
    if (i < 0) out.push(d);
    else out[i] = mergeDescents(out[i], d, obs);
  }
  return out.sort((a, b) => a.startTs - b.startTs);
}

function steepDescents(obs: Observation[], rates: (number | null)[]): Detected[] {
  const { rateFpm, minObs, minSec, minLossFt } = config.rapidDescent;
  const out: Detected[] = [];
  let runStart = -1;
  let runEnd = -1;
  const flush = () => {
    if (runStart < 0) return;
    const a = obs[runStart];
    const b = obs[runEnd];
    const count = obs.slice(runStart, runEnd + 1).filter((o, n) => rates[runStart + n] !== null).length;
    const dur = (b.ts - a.ts) / 1000;
    const lost = (a.alt as number) - (b.alt as number);
    // Altitude must actually drop consistently with the rate (guards against a bad baro_rate).
    const actualFpm = dur > 0 ? lost / (dur / 60) : 0;
    if (count >= minObs && dur >= minSec && lost >= minLossFt && actualFpm >= rateFpm * 0.7) {
      out.push({
        type: 'rapid-descent',
        severity: 'warning',
        startTs: a.ts,
        endTs: b.ts,
        ongoing: runEnd === obs.length - 1,
        evidence: {
          startTs: a.ts,
          endTs: b.ts,
          startAlt: a.alt,
          endAlt: b.alt,
          rateFpm: -Math.round(actualFpm),
          durationSec: sec(b.ts - a.ts),
          obsCount: count,
        },
      });
    }
    runStart = runEnd = -1;
  };
  for (let i = 0; i < obs.length; i++) {
    const r = rates[i];
    if (r === null) {
      if (obs[i].glitch) continue; // ignored readings don't break a run
      flush();
      continue;
    }
    if (r <= -rateFpm) {
      if (runStart < 0) runStart = i;
      runEnd = i;
    } else flush();
  }
  flush();
  return out;
}

/** Large sustained altitude loss within a short window (see detectRapidDescent). Never bridges a data gap. */
function largeDescents(obs: Observation[]): Detected[] {
  const { largeLossFt, largeWindowSec, largeMinAvgFpm, largeMaxGapSec } = config.rapidDescent;
  const pts = airborneIdx(obs);
  const episodes: [number, number][] = [];
  let runStart = 0;
  for (let b = 0; b < pts.length; b++) {
    if (b > 0 && obs[pts[b]].ts - obs[pts[b - 1]].ts > largeMaxGapSec * 1000) runStart = b;
    for (let a = runStart; a < b; a++) {
      const durMs = obs[pts[b]].ts - obs[pts[a]].ts;
      if (durMs > largeWindowSec * 1000) continue;
      const lost = (obs[pts[a]].alt as number) - (obs[pts[b]].alt as number);
      if (lost >= largeLossFt && lost / (durMs / 60000) >= largeMinAvgFpm) {
        const last = episodes[episodes.length - 1];
        if (last && a <= last[1]) last[1] = b;
        else episodes.push([a, b]);
        break;
      }
    }
  }
  return episodes.map(([a, b]) => descentEvent(obs, pts[a], pts[b], b - a + 1));
}

function airborneIdx(obs: Observation[]): number[] {
  const out: number[] = [];
  obs.forEach((o, i) => {
    if (!o.onGround && o.alt !== null && !o.glitch) out.push(i);
  });
  return out;
}

function descentEvent(obs: Observation[], from: number, to: number, count: number): Detected {
  const a = obs[from];
  const b = obs[to];
  const min = (b.ts - a.ts) / 60000;
  return {
    type: 'rapid-descent',
    severity: 'warning',
    startTs: a.ts,
    endTs: b.ts,
    ongoing: to === obs.length - 1,
    evidence: {
      startTs: a.ts,
      endTs: b.ts,
      startAlt: a.alt,
      endAlt: b.alt,
      rateFpm: -Math.round(((a.alt as number) - (b.alt as number)) / min),
      durationSec: sec(b.ts - a.ts),
      obsCount: count,
    },
  };
}

/** One episode covering both, with evidence recomputed over the combined window. */
function mergeDescents(x: Detected, y: Detected, obs: Observation[]): Detected {
  const from = obs.findIndex((o) => o.ts === Math.min(x.startTs, y.startTs));
  const to = obs.findIndex((o) => o.ts === Math.max(x.endTs, y.endTs));
  const count = obs.slice(from, to + 1).filter((o) => !o.onGround && o.alt !== null && !o.glitch).length;
  return descentEvent(obs, from, to, count);
}
