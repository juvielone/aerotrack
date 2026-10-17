// Synthetic test fixtures. Never shown as real data.
import type { Observation, RawAircraft, RawPoll } from '../src/types';

export const T0 = Date.UTC(2026, 9, 18, 0, 0, 0);
export const SYD = { lat: -33.9461, lon: 151.1772 };

export function ob(partial: Partial<Observation> & { ts: number }): Observation {
  return {
    hex: 'abc123',
    callsign: 'TST1',
    lat: SYD.lat - 0.5,
    lon: SYD.lon,
    alt: 10000,
    onGround: false,
    gs: 300,
    track: 0,
    baroRate: null,
    squawk: '1234',
    emergency: null,
    category: 'A3',
    type: 'A320',
    reg: 'VH-TST',
    dbFlags: 0,
    ...partial,
  };
}

/** n observations every dtSec, with fields from fn(k). */
export function series(n: number, dtSec: number, fn: (k: number) => Partial<Observation>, start = T0): Observation[] {
  return Array.from({ length: n }, (_, k) => ob({ ts: start + k * dtSec * 1000, ...fn(k) }));
}

/** Move a point along a heading at gs knots for dt seconds (flat-earth approximation, fine for tests). */
export function step(lat: number, lon: number, trackDeg: number, gsKt: number, dtSec: number): [number, number] {
  const distKm = (gsKt * 1.852 * dtSec) / 3600;
  const rad = (trackDeg * Math.PI) / 180;
  const dLat = (distKm * Math.cos(rad)) / 111.32;
  const dLon = (distKm * Math.sin(rad)) / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

/** Integrate a path: fn(k) gives track/alt/gs/onGround; positions are computed. */
export function path(n: number, dtSec: number, fn: (k: number) => Partial<Observation>, from = { lat: SYD.lat - 0.5, lon: SYD.lon }, start = T0): Observation[] {
  let { lat, lon } = from;
  const out: Observation[] = [];
  for (let k = 0; k < n; k++) {
    const p = fn(k);
    const o = ob({ ts: start + k * dtSec * 1000, lat, lon, ...p });
    out.push(o);
    [lat, lon] = step(lat, lon, o.track ?? 0, o.gs ?? 0, dtSec);
  }
  return out;
}

export function toRaw(o: Observation): RawAircraft {
  return {
    hex: o.hex,
    flight: o.callsign ? o.callsign.padEnd(8) : undefined,
    r: o.reg ?? undefined,
    t: o.type ?? undefined,
    alt_baro: o.onGround ? 'ground' : (o.alt ?? undefined),
    gs: o.gs ?? undefined,
    track: o.track ?? undefined,
    baro_rate: o.baroRate ?? undefined,
    squawk: o.squawk ?? undefined,
    emergency: o.emergency ?? undefined,
    category: o.category ?? undefined,
    dbFlags: o.dbFlags,
    lat: o.lat,
    lon: o.lon,
    seen_pos: 0,
  };
}

/** One poll per observation time, containing every aircraft observed at that time. */
export function polls(...tracks: Observation[][]): RawPoll[] {
  const byTs = new Map<number, RawAircraft[]>();
  for (const t of tracks) for (const o of t) byTs.set(o.ts, [...(byTs.get(o.ts) ?? []), toRaw(o)]);
  return [...byTs.entries()].sort((a, b) => a[0] - b[0]).map(([now, ac]) => ({ now, ac }));
}
