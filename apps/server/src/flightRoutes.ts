import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlightRoute, RouteAirport } from '@aerotrack/core';
import { env } from './env';

interface CacheEntry {
  route: FlightRoute | null;
  fetchedAt: number;
}

const HIT_TTL_MS = 24 * 3600_000;
const MISS_TTL_MS = 3600_000;
const TIMEOUT_MS = 5000;
const UA = { 'User-Agent': 'aerotrack-hackathon/0.1' };
let adsbLolDownUntil = 0;

/**
 * Planned routes by callsign: ADSB.lol routeset first, ADSBdb as fallback.
 * Cached in memory and on disk (data/route-cache.json) so recorded demos work offline.
 * Looked up on demand for the selected flight only.
 */
export class RouteService {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<FlightRoute | null>>();
  private path = join(env.dataDir, 'route-cache.json');
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    if (existsSync(this.path)) {
      try {
        for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, CacheEntry>)) this.cache.set(k, v);
      } catch {
        // Corrupt cache: start empty.
      }
    }
  }

  async lookup(callsign: string, lat?: number, lon?: number): Promise<FlightRoute | null> {
    const cs = callsign.trim().toUpperCase();
    const hit = this.cache.get(cs);
    if (hit && Date.now() - hit.fetchedAt < (hit.route ? HIT_TTL_MS : MISS_TTL_MS)) return hit.route;
    const pending = this.inFlight.get(cs);
    if (pending) return pending;

    const p = (async () => {
      try {
        let lol: FlightRoute | null | undefined;
        if (Date.now() >= adsbLolDownUntil) {
          lol = await fromAdsbLol(cs, lat, lon).catch(() => undefined);
          // Don't make every lookup wait for a timeout while ADSB.lol is unreachable.
          if (lol === undefined) adsbLolDownUntil = Date.now() + 10 * 60_000;
        }
        const route = lol !== undefined ? lol : await fromAdsbDb(cs);
        this.cache.set(cs, { route, fetchedAt: Date.now() });
        this.scheduleSave();
        return route;
      } catch {
        // Both providers failed (offline): any cached answer beats none.
        return hit?.route ?? null;
      } finally {
        this.inFlight.delete(cs);
      }
    })();
    this.inFlight.set(cs, p);
    return p;
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.cache)));
    }, 2000);
  }

  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.cache)));
  }
}

/** undefined = provider failed (try the next one); null = provider says unknown. */
async function fromAdsbLol(cs: string, lat?: number, lon?: number): Promise<FlightRoute | null | undefined> {
  const res = await fetch('https://api.adsb.lol/api/0/routeset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...UA },
    body: JSON.stringify({ planes: [{ callsign: cs, lat: lat ?? 0, lng: lon ?? 0 }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return undefined;
  const body = await res.json();
  const r = Array.isArray(body) ? body[0] : null;
  const airports: any[] = r?._airports ?? [];
  if (airports.length < 2) return null;
  const ap = (a: any): RouteAirport => ({ iata: a.iata ?? null, icao: a.icao ?? null, name: a.location ?? a.name ?? a.icao, lat: Number(a.lat), lon: Number(a.lon) });
  return { callsign: cs, origin: ap(airports[0]), destination: ap(airports[airports.length - 1]), source: 'ADSB.lol' };
}

async function fromAdsbDb(cs: string): Promise<FlightRoute | null> {
  const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ADSBdb HTTP ${res.status}`);
  const fr = ((await res.json()) as any)?.response?.flightroute;
  if (!fr?.origin || !fr?.destination) return null;
  const ap = (a: any): RouteAirport => ({ iata: a.iata_code ?? null, icao: a.icao_code ?? null, name: a.municipality ?? a.name, lat: Number(a.latitude), lon: Number(a.longitude) });
  return { callsign: cs, origin: ap(fr.origin), destination: ap(fr.destination), source: 'ADSBdb' };
}
