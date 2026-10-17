import { nearestAirport } from '../airports';
import { config } from '../config';
import type { Observation } from '../types';
import { type Detected, sec } from './common';

/**
 * Go-around (PRD §4.2): an approach segment near an airport (descending, below ~2,000 ft above the airport,
 * approach speed), followed by a climb of ≥ ~1,000 ft with no ground observation in between.
 * Confirmed only once a later landing is observed in the same session, so a normal departure is never mislabelled.
 * Unconfirmed candidates are returned as 'go-around-hint' only when `showHint` is set.
 */
export function detectGoArounds(obs: Observation[], rates: (number | null)[], staleSec: number, showHint: boolean): Detected[] {
  const g = config.goAround;
  const out: Detected[] = [];

  interface Approach {
    airport: string;
    elevFt: number;
    startIdx: number;
    startAlt: number;
    minIdx: number;
    minAlt: number;
  }
  let ap: Approach | null = null;
  let prevTs: number | null = null;

  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    // A ground observation or a data gap ends any approach we were tracking.
    if (o.onGround || (prevTs !== null && o.ts - prevTs > staleSec * 1000)) {
      ap = null;
    }
    prevTs = o.ts;
    if (o.onGround || o.alt === null || o.glitch) continue;

    if (!ap) {
      const near = nearestAirport(o.lat, o.lon, g.nearAirportKm);
      const r = rates[i];
      if (near && o.alt - near.airport.elevFt <= g.approachAglFt && (o.gs ?? 0) <= g.approachMaxGsKt && r !== null && r < -200) {
        ap = { airport: near.airport.code, elevFt: near.airport.elevFt, startIdx: i, startAlt: o.alt, minIdx: i, minAlt: o.alt };
      }
      continue;
    }

    if (o.alt < ap.minAlt) {
      ap.minAlt = o.alt;
      ap.minIdx = i;
    }
    if (ap.startAlt - ap.minAlt >= g.minApproachDescentFt && o.alt - ap.minAlt >= g.climbFt) {
      // Climbed away from the approach without touching down. Confirm with a later landing.
      const landing = obs.findIndex((x, n) => n > i && x.onGround);
      const low = obs[ap.minIdx];
      const confirmed = landing > 0;
      if (confirmed || showHint) {
        out.push({
          type: confirmed ? 'go-around' : 'go-around-hint',
          severity: 'notice',
          startTs: obs[ap.startIdx].ts,
          endTs: confirmed ? obs[landing].ts : o.ts,
          ongoing: !confirmed,
          evidence: {
            startTs: obs[ap.startIdx].ts,
            endTs: o.ts,
            airport: ap.airport,
            lowestAlt: ap.minAlt,
            startAlt: ap.startAlt,
            endAlt: o.alt,
            durationSec: sec(o.ts - obs[ap.startIdx].ts),
            lat: low.lat,
            lon: low.lon,
          },
        });
      }
      ap = null;
    } else if (o.alt - ap.elevFt > g.approachAglFt + g.climbFt + 500) {
      ap = null; // well above the approach zone again
    }
  }
  return out;
}
