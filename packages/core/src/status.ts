import { nearestAirport } from './airports';
import { config } from './config';
import type { FlightSession, StatusTag } from './types';
import { verticalRates } from './clean';

/** Flight status tag (PRD §4.1), derived from alt_baro, gs and baro_rate. */
export function computeStatus(s: FlightSession, now: number, staleSec: number = config.stale.staleSec): StatusTag {
  const c = config.status;
  const obs = s.obs;
  const last = obs[obs.length - 1];
  if (!last) return 'Unknown';
  const stale = now - last.ts > staleSec * 1000;

  if (last.onGround) {
    // "Landed" matters most (pain point 2), so it survives the aircraft going quiet at the gate.
    if (s.landed) return 'Landed';
    if (stale) return 'Unknown';
    const gs = last.gs ?? 0;
    if (gs > c.taxiMaxKt) return 'Taking off';
    if (gs >= c.taxiMinKt) return 'Taxiing';
    return 'On ground';
  }

  if (stale || obs.length < c.minObs) return 'Unknown';

  // Ground → airborne within the last ~60 s.
  for (let i = obs.length - 1; i > 0; i--) {
    if (last.ts - obs[i].ts > c.takeoffWindowSec * 1000) break;
    if (obs[i - 1].onGround && !obs[i].onGround) return 'Taking off';
  }

  // Median vertical rate over the last ~60 s.
  const rates = verticalRates(obs);
  const recent: number[] = [];
  for (let i = obs.length - 1; i >= 0 && last.ts - obs[i].ts <= 60_000; i--) {
    if (rates[i] !== null) recent.push(rates[i] as number);
  }
  if (recent.length < 2) return 'Airborne';
  recent.sort((a, b) => a - b);
  const median = recent[Math.floor(recent.length / 2)];
  const alt = last.alt ?? 0;

  if (median >= config.vertical.rateFpm) return 'Climbing';
  if (median <= -config.vertical.rateFpm) {
    if (alt < c.approachMaxFt && nearestAirport(last.lat, last.lon, c.approachNearKm)) return 'Approach';
    return 'Descending';
  }
  if (alt >= c.cruiseMinFt) return 'Cruising';
  return 'Airborne';
}
