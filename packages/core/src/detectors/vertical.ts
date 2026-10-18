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
 * Rapid descent (PRD §4): faster than ~5,000 fpm across ≥ 3 consistent observations for ≥ 30 s,
 * losing at least `minLossFt` of real altitude. Glitch-rejected readings are skipped, so this runs on the cleaned series.
 */
export function detectRapidDescent(obs: Observation[], rates: (number | null)[]): Detected[] {
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
