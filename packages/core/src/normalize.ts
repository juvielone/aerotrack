import type { Observation, RawAircraft, RawPoll } from './types';

export function normalizeAircraft(ac: RawAircraft, pollNow: number): Observation | null {
  if (!ac.hex || typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return null;
  const onGround = ac.alt_baro === 'ground';
  const age = ac.seen_pos ?? ac.seen ?? 0;
  const callsign = ac.flight?.trim() || null;
  return {
    hex: ac.hex.toLowerCase(),
    callsign,
    ts: Math.round(pollNow - age * 1000),
    lat: ac.lat,
    lon: ac.lon,
    alt: onGround ? null : typeof ac.alt_baro === 'number' ? ac.alt_baro : null,
    onGround,
    gs: ac.gs ?? null,
    track: ac.track ?? ac.true_heading ?? null,
    baroRate: ac.baro_rate ?? ac.geom_rate ?? null,
    squawk: ac.squawk ?? null,
    emergency: ac.emergency ?? null,
    category: ac.category ?? null,
    type: ac.t ?? null,
    reg: ac.r ?? null,
    dbFlags: ac.dbFlags ?? 0,
  };
}

export function normalizePoll(poll: RawPoll): Observation[] {
  const out: Observation[] = [];
  for (const ac of poll.ac ?? []) {
    const o = normalizeAircraft(ac, poll.now);
    if (o) out.push(o);
  }
  return out;
}
