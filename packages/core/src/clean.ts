import { config } from './config';
import type { Observation } from './types';

/**
 * Flags single-sample altitude spikes: an implausible jump (> ~20,000 fpm) that reverts within 1–2 samples.
 * Mutates `glitch` on the observations and returns the indices that were flagged.
 * The latest sample can't be judged until the next one arrives, so it is never flagged.
 */
export function markGlitches(obs: Observation[]): number[] {
  const { impliedRateFpm, revertSamples, revertToleranceFt } = config.glitch;
  const flagged: number[] = [];
  for (const o of obs) o.glitch = false;

  let prev = -1;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    if (o.alt === null) continue;
    if (prev < 0) {
      prev = i;
      continue;
    }
    const p = obs[prev];
    const diff = o.alt - (p.alt as number);
    const dtMin = (o.ts - p.ts) / 60000;
    if (dtMin > 0 && Math.abs(diff) >= 1000 && Math.abs(diff) / dtMin > impliedRateFpm) {
      // Does a later sample come back near the previous good altitude?
      let revertAt = -1;
      for (let j = i + 1, seen = 0; j < obs.length && seen < revertSamples; j++) {
        if (obs[j].alt === null) continue;
        seen++;
        if (Math.abs((obs[j].alt as number) - (p.alt as number)) <= revertToleranceFt) {
          revertAt = j;
          break;
        }
      }
      if (revertAt > 0) {
        for (let k = i; k < revertAt; k++) {
          if (obs[k].alt !== null) {
            obs[k].glitch = true;
            flagged.push(k);
          }
        }
        i = revertAt - 1;
        continue;
      }
    }
    prev = i;
  }
  return flagged;
}

/** Splits a track into [from, to] index ranges wherever consecutive points are more than `staleSec` apart. */
export function segmentTrack(obs: Pick<Observation, 'ts'>[], staleSec: number = config.stale.staleSec): [number, number][] {
  if (!obs.length) return [];
  const out: [number, number][] = [];
  let start = 0;
  for (let i = 1; i < obs.length; i++) {
    if (obs[i].ts - obs[i - 1].ts > staleSec * 1000) {
      out.push([start, i - 1]);
      start = i;
    }
  }
  out.push([start, obs.length - 1]);
  return out;
}

/**
 * Vertical rate (fpm) at each observation: reported baro_rate when present, otherwise derived
 * from the previous valid altitude at least 10 s earlier. null on the ground, for glitches or with no basis.
 */
export function verticalRates(obs: Observation[]): (number | null)[] {
  const rates: (number | null)[] = new Array(obs.length).fill(null);
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    if (o.onGround || o.alt === null || o.glitch) continue;
    if (o.baroRate !== null) {
      rates[i] = o.baroRate;
      continue;
    }
    for (let k = i - 1; k >= 0; k--) {
      const p = obs[k];
      if (p.onGround || p.alt === null || p.glitch) break;
      const dt = (o.ts - p.ts) / 60000;
      if (dt * 60 >= 10) {
        if (dt * 60 <= 120) rates[i] = (o.alt - p.alt) / dt;
        break;
      }
    }
  }
  return rates;
}
