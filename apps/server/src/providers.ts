import type { RawAircraft, RawPoll } from '@aerotrack/core';

export interface Provider {
  id: string;
  /** Attribution label shown in the UI. */
  label: string;
  url(lat: number, lon: number, radiusNm: number): string;
  parse(body: any): RawPoll;
}

// Both return readsb-format aircraft; we normalise the envelope to { now: ms, ac: [] }.
export const PROVIDERS: Record<string, Provider> = {
  adsblol: {
    id: 'adsblol',
    label: 'ADSB.lol (ODbL)',
    url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`,
    parse: (body) => ({ now: body.now ?? Date.now(), ac: (body.ac ?? []).map(slimAircraft) }),
  },
  adsbfi: {
    id: 'adsbfi',
    label: 'adsb.fi',
    url: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`,
    parse: (body) => ({ now: body.now ? Math.round(body.now * 1000) : Date.now(), ac: (body.aircraft ?? []).map(slimAircraft) }),
  },
};

const KEEP: (keyof RawAircraft)[] = [
  'hex', 'flight', 'r', 't', 'alt_baro', 'gs', 'track', 'true_heading', 'baro_rate', 'geom_rate',
  'squawk', 'emergency', 'category', 'dbFlags', 'lat', 'lon', 'seen_pos', 'seen',
];

/** Keeps only the fields Aerotrack uses (recordings stay small). */
export function slimAircraft(ac: any): RawAircraft {
  const out: any = {};
  for (const k of KEEP) if (ac[k] !== undefined) out[k] = ac[k];
  return out;
}

export async function fetchPoll(provider: Provider, lat: number, lon: number, radiusNm: number): Promise<RawPoll> {
  const res = await fetch(provider.url(lat, lon, radiusNm), {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'aerotrack-hackathon/0.1' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return provider.parse(await res.json());
}
